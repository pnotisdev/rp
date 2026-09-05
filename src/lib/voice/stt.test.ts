import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeAudio } from './stt'

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('transcribeAudio', () => {
  it('posts multipart form data with the audio file and whisper-1 model to the right URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { text: 'hello there' }))
    vi.stubGlobal('fetch', fetchMock)

    const audio = new Blob(['fake-audio'], { type: 'audio/webm' })
    const result = await transcribeAudio('http://localhost:5001/', audio)

    expect(result).toBe('hello there')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5001/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('trims the transcribed text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { text: '  hello  ' })))
    expect(await transcribeAudio('http://localhost:5001', new Blob())).toBe('hello')
  })

  it('throws the server-provided error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: 'no whisper model loaded' })))
    await expect(transcribeAudio('http://localhost:5001', new Blob())).rejects.toThrow('no whisper model loaded')
  })

  it('prefers a server warning over a server error when both are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { warning: 'model still loading', error: 'generic failure' })),
    )
    await expect(transcribeAudio('http://localhost:5001', new Blob())).rejects.toThrow('model still loading')
  })

  it('falls back to a generic message on a non-ok response with no parseable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error('bad json')) } as unknown as Response),
    )
    await expect(transcribeAudio('http://localhost:5001', new Blob())).rejects.toThrow('Transcription failed (500)')
  })

  it('throws when the response is ok but carries no text field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {})))
    await expect(transcribeAudio('http://localhost:5001', new Blob())).rejects.toThrow('Transcription returned no text')
  })
})
