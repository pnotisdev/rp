import { describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { draftWorld, entriesFrom, planLoreBatches, toLorebookEntries, type WorldStage, type WorldStageStatus } from './generateWorld'

const CORE = JSON.stringify({
  name: 'Saltmarsh',
  description: 'A fog-bound fishing town on a drowned coast.\n\nThe tide decides the working day.',
  rules: 'No magic.\nNo telegraph past the causeway.',
})
const PLACES = JSON.stringify([
  { title: 'Gannet Point', keys: ['lighthouse', 'gannet point'], content: 'The lighthouse has been dark since the Marigold sank.' },
  { title: 'The Wet Dock', keys: ['dock', 'wet dock'], content: 'Boats unload here at the turn of the tide.' },
])
const PEOPLE = JSON.stringify([
  { title: 'Harbour Guild', keys: ['guild', 'harbourmaster'], content: 'The guild sets landing fees and settles disputes.' },
  // Repeats a key already used above, so it should be dropped.
  { title: 'Dock gossip', keys: ['dock'], content: 'Everyone knows everything by noon.' },
])

function sequenceClient(responses: (string | Error)[]): ChatBackend {
  let i = 0
  return {
    generate: vi.fn().mockImplementation(async () => {
      const next = responses[Math.min(i++, responses.length - 1)]
      if (next instanceof Error) throw next
      return next
    }),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(4096),
    tokenCount: vi.fn(),
    abort: vi.fn(),
    getChatTemplate: vi.fn().mockResolvedValue(null),
  }
}

describe('planLoreBatches', () => {
  it('splits a target into batches a small model can answer', () => {
    expect(planLoreBatches(8).map((b) => b.count)).toEqual([4, 4])
    expect(planLoreBatches(16).map((b) => b.count)).toEqual([6, 6, 4])
    expect(planLoreBatches(24).map((b) => b.count)).toEqual([6, 6, 6, 6])
    expect(planLoreBatches(0)).toEqual([])
  })

  it('walks through different categories and caps the total', () => {
    const ids = planLoreBatches(24).map((b) => b.category.id)
    expect(new Set(ids).size).toBe(4)
    expect(planLoreBatches(500).reduce((n, b) => n + b.count, 0)).toBe(40)
  })
})

describe('entriesFrom', () => {
  it('keeps good entries and drops empty, keyless and repeated ones', () => {
    const taken = new Set<string>()
    const out = entriesFrom(
      [
        { title: 'A', keys: ['alpha', ' Beta '], content: '  First.  ' },
        { title: 'B', keys: [], content: 'no keys' },
        { title: 'C', keys: ['gamma'], content: '' },
        { title: 'D', keys: ['ALPHA'], content: 'repeats alpha' },
        'junk',
        { keys: ['delta'], content: 'No title here.' },
      ],
      taken,
    )
    expect(out).toEqual([
      { title: 'A', keys: ['alpha', 'Beta'], content: 'First.' },
      { title: 'delta', keys: ['delta'], content: 'No title here.' },
    ])
    expect(taken.has('beta')).toBe(true)
  })

  it('rejects a response that is not an array', () => {
    expect(() => entriesFrom({ a: 1 }, new Set())).toThrow(/array/)
  })
})

describe('toLorebookEntries', () => {
  it('numbers entries from a start id and marks them keyword-triggered', () => {
    const entries = toLorebookEntries([{ title: 'Lighthouse', keys: ['lighthouse'], content: 'Dark.' }], 5)
    expect(entries[0]).toMatchObject({ id: 5, comment: 'Lighthouse', activationMode: 'keyword', constant: false, enabled: true })
  })
})

describe('draftWorld', () => {
  it('drafts the setting then fills the lorebook batch by batch', async () => {
    const client = sequenceClient([CORE, PLACES, PEOPLE])
    const events: [WorldStage, WorldStageStatus][] = []
    const batches: [number, number][] = []
    const draft = await draftWorld(client, { brief: 'a fog-bound fishing town', loreCount: 8 }, { onStage: (s, st) => events.push([s, st]), onBatch: (d, t) => batches.push([d, t]) })

    expect(draft).toMatchObject({ name: 'Saltmarsh', failed: [] })
    expect(draft.description).toContain('drowned coast')
    expect(draft.rules).toBe('No magic.\nNo telegraph past the causeway.')
    expect(draft.entries.map((e) => e.title)).toEqual(['Gannet Point', 'The Wet Dock', 'Harbour Guild'])
    expect(events).toEqual([['core', 'start'], ['core', 'done'], ['lore', 'start'], ['lore', 'done']])
    expect(batches).toEqual([[1, 2], [2, 2]])
  })

  it('shows later batches what is already written so the model does not repeat it', async () => {
    const client = sequenceClient([CORE, PLACES, PEOPLE])
    await draftWorld(client, { brief: 'x', loreCount: 8 })
    const prompts = (client.generate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].prompt as string)
    expect(prompts[1]).not.toContain('Already written')
    expect(prompts[2]).toContain('Already written')
    expect(prompts[2]).toContain('Gannet Point')
  })

  it('accepts rules written as a list', async () => {
    const client = sequenceClient([JSON.stringify({ name: 'X', description: 'D', rules: ['one', 'two'] })])
    const draft = await draftWorld(client, { brief: 'x', loreCount: 0 })
    expect(draft.rules).toBe('one\ntwo')
    expect(draft.entries).toEqual([])
  })

  it('accepts a description written as paragraphs', async () => {
    const client = sequenceClient([JSON.stringify({ name: 'X', description: ['First paragraph.', ' ', 'Second paragraph.'], rules: [] })])
    const draft = await draftWorld(client, { brief: 'x', loreCount: 0 })
    expect(draft.description).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('fails outright when the setting cannot be drafted', async () => {
    const client = sequenceClient(['not json at all'])
    await expect(draftWorld(client, { brief: 'x' })).rejects.toThrow()
  })

  it('keeps going when one lore batch fails', async () => {
    const client = sequenceClient([CORE, new Error('timeout'), PEOPLE])
    const draft = await draftWorld(client, { brief: 'x', loreCount: 8 })
    expect(draft.entries.map((e) => e.title)).toEqual(['Harbour Guild', 'Dock gossip'])
    expect(draft.failed).toEqual([])
  })

  it('reports a lore failure when nothing at all came back', async () => {
    const client = sequenceClient([CORE, new Error('boom')])
    const events: [WorldStage, WorldStageStatus][] = []
    const draft = await draftWorld(client, { brief: 'x', loreCount: 8 }, { onStage: (s, st) => events.push([s, st]) })
    expect(draft.entries).toEqual([])
    expect(draft.failed).toEqual([{ stage: 'lore', error: 'boom' }])
    expect(events[events.length - 1]).toEqual(['lore', 'failed'])
  })

  it('requires a brief', async () => {
    await expect(draftWorld(sequenceClient([CORE]), { brief: '   ' })).rejects.toThrow(/Describe/)
  })

  it('stops between stages when aborted', async () => {
    const controller = new AbortController()
    const client = sequenceClient([CORE, PLACES])
    const onStage = vi.fn((stage: WorldStage, status: WorldStageStatus) => {
      if (stage === 'core' && status === 'done') controller.abort()
    })
    await expect(draftWorld(client, { brief: 'x' }, { signal: controller.signal, onStage })).rejects.toMatchObject({ name: 'AbortError' })
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('folds the writer style into every prompt', async () => {
    const client = sequenceClient([CORE, PLACES])
    await draftWorld(client, { brief: 'x', loreCount: 4, styleGuidance: 'Dry, spare, no adverbs.' })
    const prompts = (client.generate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].prompt as string)
    expect(prompts.every((p) => p.includes('Dry, spare, no adverbs.'))).toBe(true)
  })
})
