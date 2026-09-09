import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BRANCHING_SCENARIO } from '@/lib/dating/scenarios'
import type { ScenarioGraph } from '@/lib/dating/intimacyStages'

// `importCharacterPack` talks to the local API, so the two resources it creates are stubbed and the
// calls inspected. What's under test is the scenario half: a malformed scene shape must never load,
// and must never be dropped in silence either.

const created: { world?: Record<string, unknown>; character?: Record<string, unknown> } = {}

vi.mock('@/lib/api/client', () => ({
  worldsApi: {
    create: vi.fn(async (payload: Record<string, unknown>) => {
      created.world = payload
      return { id: 'world-1', ...payload }
    }),
  },
  charactersApi: {
    create: vi.fn(async (payload: Record<string, unknown>) => {
      created.character = payload
      return { id: 'char-1', card: { name: 'Sumire' }, ...payload }
    }),
  },
}))

const { importCharacterPack } = await import('./pack')

/** A minimal pack carrying a world with the given scene shapes. */
const packWith = (scenarios: unknown[]) =>
  ({
    kind: 'rp.character-pack',
    version: 1,
    character: { card: { name: 'Sumire' } },
    world: { name: 'Sakura Hill', scenarios },
  }) as never

const valid = (): ScenarioGraph => JSON.parse(JSON.stringify(BRANCHING_SCENARIO))

beforeEach(() => {
  created.world = undefined
  created.character = undefined
})

describe('importCharacterPack — bundled scene shapes', () => {
  it('loads a valid scenario and reports nothing rejected', async () => {
    const result = await importCharacterPack(packWith([valid()]))
    expect(result.rejectedScenarios).toEqual([])
    expect((created.world?.scenarios as ScenarioGraph[]).map((g) => g.id)).toEqual(['branching-explicit'])
  })

  it('never loads a malformed scenario — it would strand a live scene mid-play', async () => {
    const broken = { ...valid(), entryStage: 'nowhere' }
    const result = await importCharacterPack(packWith([broken]))
    expect(created.world?.scenarios).toEqual([])
    expect(result.rejectedScenarios).toHaveLength(1)
  })

  it('names what was rejected and why, rather than dropping it in silence', async () => {
    const broken = { ...valid(), entryStage: 'nowhere' }
    const [reason] = (await importCharacterPack(packWith([broken]))).rejectedScenarios
    // The title, so an author can find the file, and the validator's own reason.
    expect(reason).toContain(BRANCHING_SCENARIO.title)
    expect(reason).toContain('nowhere')
  })

  it('falls back to naming a rejected scenario by id, then by position, when it has no title', async () => {
    const noTitle = { ...valid(), title: '', entryStage: 'nowhere' }
    expect((await importCharacterPack(packWith([noTitle]))).rejectedScenarios[0]).toContain('branching-explicit')
    const anonymous = { version: 1 }
    expect((await importCharacterPack(packWith([anonymous]))).rejectedScenarios[0]).toContain('#1')
  })

  it('keeps the good ones when only some are broken, rather than failing the whole import', async () => {
    const result = await importCharacterPack(packWith([valid(), { version: 1 }]))
    expect((created.world?.scenarios as ScenarioGraph[])).toHaveLength(1)
    expect(result.rejectedScenarios).toHaveLength(1)
    // The character still imported — one bad scene shape is not a reason to lose the card.
    expect(result.character.id).toBe('char-1')
  })

  it('reports nothing for a pack with no world or no scenarios at all', async () => {
    expect((await importCharacterPack(packWith([]))).rejectedScenarios).toEqual([])
    const worldless = { kind: 'rp.character-pack', version: 1, character: { card: { name: 'Sumire' } } } as never
    const result = await importCharacterPack(worldless)
    expect(result.rejectedScenarios).toEqual([])
    expect(result.world).toBeUndefined()
  })
})
