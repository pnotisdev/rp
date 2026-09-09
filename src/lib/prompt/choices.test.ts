import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { ChatMessage } from '@/lib/prompt/builder'
import { generateChoices } from './choices'

function stubClient(reply: string, spy?: (p: Record<string, unknown>) => void): ChatBackend {
  return {
    generate: async (p) => {
      spy?.(p as unknown as Record<string, unknown>)
      return reply
    },
    generateStream: async () => '',
    getEffectiveMaxContext: async () => 4096,
    tokenCount: async () => ({ count: 0 }),
    abort: async () => {},
    getChatTemplate: async () => null,
  }
}

const HISTORY: ChatMessage[] = [
  { id: '1', role: 'user', name: 'Kai', text: 'What do you think of the view?' },
  { id: '2', role: 'char', name: 'Sumire', text: '"It is... fine, I suppose."' },
]
const BASE = { history: HISTORY, charName: 'Sumire', userName: 'Kai' }

describe('generateChoices', () => {
  it('uses a JSON object envelope for backends that prefer validated JSON output', async () => {
    let sent: Record<string, unknown> = {}
    const client = { ...stubClient('{"choices":[{"kind":"action","label":"Wave","text":"*waves*"}]}', (p) => { sent = p }), prefersJsonObject: true }
    expect((await generateChoices(client, BASE))[0]).toMatchObject({ label: 'Wave', text: '*waves*' })
    expect(sent.jsonOutput).toBe(true)
    expect(sent.prompt).toContain('"choices" array')
  })
  it('parses a JSON array of options, defaulting an omitted kind to "line"', async () => {
    const options = await generateChoices(
      stubClient('[{"label":"Tease her","text":"You just love that view, don\'t you?"}]'),
      BASE,
    )
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ kind: 'line', label: 'Tease her', text: "You just love that view, don't you?" })
    expect(options[0].id).toMatch(/^choice-0-/)
  })

  it('drops entries missing a label or text, and non-object entries', async () => {
    const options = await generateChoices(
      stubClient('[{"label":"","text":"x"},{"label":"ok","text":""},null,"nope",{"label":"Real","text":"A real line"}]'),
      BASE,
    )
    expect(options).toEqual([{ id: expect.any(String), kind: 'line', label: 'Real', text: 'A real line', giftId: undefined, giftName: undefined }])
  })

  it('allows at most one gift-kind option, skipping later ones', async () => {
    const options = await generateChoices(
      stubClient(
        '[{"kind":"gift","label":"Give flowers","text":"gives flowers","giftId":"flowers"},' +
          '{"kind":"gift","label":"Give candy","text":"gives candy","giftId":"candy"},' +
          '{"kind":"action","label":"Wave","text":"waves"}]',
      ),
      BASE,
    )
    expect(options.map((o) => o.label)).toEqual(['Give flowers', 'Wave'])
  })

  it('drops a gift-kind option with no giftId', async () => {
    const options = await generateChoices(stubClient('[{"kind":"gift","label":"Give something","text":"gives something"}]'), BASE)
    expect(options).toEqual([])
  })

  it('stops once it has "count" options even if the model proposed more', async () => {
    const options = await generateChoices(
      stubClient('[{"label":"A","text":"a"},{"label":"B","text":"b"},{"label":"C","text":"c"},{"label":"D","text":"d"}]'),
      { ...BASE, count: 2 },
    )
    expect(options.map((o) => o.label)).toEqual(['A', 'B'])
  })

  it('returns [] when the model does not return a JSON array', async () => {
    expect(await generateChoices(stubClient('{"not": "an array"}'), BASE)).toEqual([])
  })

  it('mentions available gifts in the prompt when given, and their absence otherwise', async () => {
    let sent: Record<string, unknown> = {}
    await generateChoices(stubClient('[]', (p) => (sent = p)), {
      ...BASE,
      availableGifts: [{ id: 'flowers', name: 'Flowers', quantity: 2 }],
    })
    expect(sent.prompt).toContain('flowers (Flowers) x2')

    await generateChoices(stubClient('[]', (p) => (sent = p)), BASE)
    expect(sent.prompt).toContain('No gifts are currently available to give.')
  })

  it('labels each turn with its own speaker name, not one charName for every non-user line', async () => {
    // A group scene: the reply we are suggesting follow-ups to came from Kestrel, a participant,
    // while `charName` is still the primary (Sumire). The brainstorm context must show Kestrel as
    // the one who just spoke, or the suggestions drift toward answering Sumire.
    let sent: Record<string, unknown> = {}
    const groupHistory: ChatMessage[] = [
      { id: '1', role: 'user', name: 'Kai', text: 'You two know each other?' },
      { id: '2', role: 'char', name: 'Sumire', text: '"Barely."' },
      { id: '3', role: 'char', name: 'Kestrel', text: '"We met once. It was raining."' },
    ]
    await generateChoices(stubClient('[]', (p) => (sent = p)), { history: groupHistory, charName: 'Sumire', userName: 'Kai' })
    expect(sent.prompt).toContain('Kestrel: "We met once. It was raining."')
    expect(sent.prompt).toContain('Sumire: "Barely."')
    expect(sent.prompt).toContain('Kai: You two know each other?')
  })

  it('only sends the last 8 turns of history', async () => {
    let sent: Record<string, unknown> = {}
    const long: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? 'char' : 'user',
      name: i % 2 ? 'Sumire' : 'Kai',
      text: `line ${i}`,
    }))
    await generateChoices(stubClient('[]', (p) => (sent = p)), { ...BASE, history: long })
    expect(sent.prompt).toContain('line 19')
    expect(sent.prompt).toContain('line 12')
    expect(sent.prompt).not.toContain('line 11')
  })

  describe('when the backend never responds', () => {
    // Before `generateWithTimeout` was wired in, a hang here left the "choices" background-assist
    // indicator stuck forever — the caller only ever clears it once the awaited call settles.
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('times out with a labelled message instead of hanging forever', async () => {
      const hanging: ChatBackend = {
        generate: (_p, signal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
        generateStream: async () => '',
        getEffectiveMaxContext: async () => 4096,
        tokenCount: async () => ({ count: 0 }),
        abort: async () => {},
        getChatTemplate: async () => null,
      }
      const pending = generateChoices(hanging, BASE)
      const assertion = expect(pending).rejects.toThrow(/Suggest choices timed out after 45s/)
      await vi.advanceTimersByTimeAsync(45_000)
      await assertion
    })
  })
})
