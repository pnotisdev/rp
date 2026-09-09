import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient } from './openaiCompatible'
import { fetchOpenAiModelContext, listOpenAiModels } from './detectBackend'
import { isOpenMayhem, loadOpenMayhemModels, OPENMAYHEM_BASE_URL, type OpenMayhemModel } from './openMayhem'

const model: OpenMayhemModel = {
  id: 'example/chat', endpoints: ['CHAT'], context_length: 32768, availability: 'available',
  request_contracts: [
    { endpoint: 'CHAT', required: ['model', 'messages'], attributes: {
      max_tokens: { minimum: 1, maximum: 4096 }, temperature: { minimum: 0, maximum: 2 },
      thinking_mode: { enumValues: ['disabled', 'enabled'] }, stop: {}, presence_penalty: {},
      response_format: {},
    } },
    { endpoint: 'CHAT', required: ['model', 'messages'], attributes: {
      max_tokens: { minimum: 1, maximum: 4096 }, temperature: { minimum: 0, maximum: 2 },
      thinking_mode: { enumValues: ['disabled', 'enabled'] },
      response_format: {},
    } },
  ],
}
const request = { prompt: 'Hello', max_length: 20, max_context_length: 4096 }
const catalog = () => new Response(JSON.stringify({ data: [model] }))
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  fetchMock = vi.fn().mockImplementation(async () => catalog())
  vi.stubGlobal('fetch', fetchMock)
  await loadOpenMayhemModels(true)
  fetchMock.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('OpenMayhem integration', () => {
  it('recognizes only the canonical API root, never lookalike hosts or paths', () => {
    expect(isOpenMayhem(`${OPENMAYHEM_BASE_URL}/`)).toBe(true)
    expect(isOpenMayhem('https://api.openmayhem.ai.attacker.test/v1')).toBe(false)
    expect(isOpenMayhem('https://example.test/api.openmayhem.ai/v1')).toBe(false)
  })

  it('lists conversational models without sending a key to the public catalog', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [
      model, { id: 'image', endpoints: ['IMAGES'] },
      { ...model, id: 'tool-only', request_contracts: [{ ...model.request_contracts![0], required: ['model', 'messages', 'tools'] }] },
    ] })))
    expect(await listOpenAiModels(OPENMAYHEM_BASE_URL, 'private-key')).toEqual(['example/chat'])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openmayhem/models')
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined()
    expect(await fetchOpenAiModelContext(OPENMAYHEM_BASE_URL, model.id)).toBe(32768)
  })

  it('uses the local relay, disables supported thinking, and preserves a short judge budget', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"score":1}' } }] })))
    const client = new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'test-key', model.id)
    expect(await client.generate({ ...request, temperature: 0.7, presence_penalty: 0, stop_sequence: ['stop'], verbosity: 'high' })).toBe('{"score":1}')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/openmayhem/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(JSON.parse(init.body)).toEqual({
      model: model.id, messages: [{ role: 'user', content: 'Hello' }], stream: false,
      temperature: 0.7, max_tokens: 20, thinking_mode: 'disabled',
    })
  })

  it('rejects missing models and invalid budgets before spending credit', async () => {
    await expect(new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', '').generate(request)).rejects.toThrow('Choose an OpenMayhem')
    await expect(new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', model.id).generate({ ...request, max_length: 5000 })).rejects.toThrow('max_tokens=5000')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests validated JSON objects for structured assists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"choices":[]}' } }] })))
    const client = new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', model.id)
    await client.generate({ ...request, jsonOutput: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' })
  })

  it('does not describe the public catalog as proof of a valid key', async () => {
    const client = new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'unverified-key', model.id)
    expect(await client.checkConnection()).toEqual({ ok: true, detail: expect.stringContaining('checked on your first reply') })
    expect(await new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, '', model.id).checkConnection()).toEqual({ ok: false, detail: expect.stringContaining('API key') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads CRLF streaming deltas while ignoring reasoning and usage-only chunks', async () => {
    fetchMock.mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[],"usage":{"cost":"0.00001"}}', 'data: [DONE]', '',
    ].join('\r\n\r\n')))
    const onToken = vi.fn()
    expect(await new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', model.id).generateStream(request, onToken)).toBe('Hello')
    expect(onToken).toHaveBeenCalledExactlyOnceWith('Hello', 'Hello')
  })

  it('surfaces mid-stream errors instead of returning a partial success', async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"error":{"message":"Provider unavailable"}}\n\n'))
    await expect(new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', model.id).generateStream(request, vi.fn())).rejects.toThrow('Provider unavailable')
  })

  it('explains empty reasoning-only completions and preserves credit errors', async () => {
    const client = new OpenAICompatibleClient(OPENMAYHEM_BASE_URL, 'key', model.id)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })))
    await expect(client.generate(request)).rejects.toThrow('generation may still have used credit')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Insufficient credit' } }), { status: 402 }))
    await expect(client.generate(request)).rejects.toMatchObject({ status: 402, message: expect.stringContaining('Insufficient credit') })
  })
})
