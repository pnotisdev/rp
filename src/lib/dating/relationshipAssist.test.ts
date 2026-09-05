import { describe, expect, it } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import type { ChatMessage } from '@/lib/prompt/builder'
import {
  assessDateOutcome,
  assessRelationshipMoment,
  draftHiddenAgenda,
  scaleDeltasForDifficulty,
  suggestDateEvent,
  type RelationshipDeltas,
} from '@/lib/dating/relationshipAssist'

function stubClient(reply: string, spy?: (p: Record<string, unknown>) => void): KoboldClient {
  return {
    generate: async (p: Record<string, unknown>) => {
      spy?.(p)
      return reply
    },
    getEffectiveMaxContext: async () => 4096,
  } as unknown as KoboldClient
}

const deltas = (overrides: Partial<RelationshipDeltas>): RelationshipDeltas => ({
  affection: 0,
  trust: 0,
  chemistry: 0,
  comfort: 0,
  respect: 0,
  curiosity: 0,
  tension: 0,
  ...overrides,
})

describe('scaleDeltasForDifficulty', () => {
  it('leaves deltas untouched on normal difficulty', () => {
    const d = deltas({ affection: 2, tension: -1 })
    expect(scaleDeltasForDifficulty(d, 'normal')).toEqual(d)
  })

  it('softens swings on gentle', () => {
    const d = deltas({ affection: 5, tension: -5 })
    const scaled = scaleDeltasForDifficulty(d, 'gentle')
    expect(scaled.affection).toBe(3)
    expect(scaled.tension).toBe(-3)
  })

  it('sharpens swings on harsh', () => {
    const d = deltas({ affection: 2, tension: -2 })
    const scaled = scaleDeltasForDifficulty(d, 'harsh')
    expect(scaled.affection).toBe(3)
    expect(scaled.tension).toBe(-3)
  })

  it('rounds to the nearest integer rather than drifting to fractions', () => {
    const d = deltas({ affection: 1 })
    const scaled = scaleDeltasForDifficulty(d, 'gentle')
    expect(Number.isInteger(scaled.affection)).toBe(true)
  })

  it('leaves an all-zero delta set as all zero on every difficulty', () => {
    const zero = deltas({})
    expect(scaleDeltasForDifficulty(zero, 'gentle')).toEqual(zero)
    expect(scaleDeltasForDifficulty(zero, 'harsh')).toEqual(zero)
  })
})

describe('draftHiddenAgenda', () => {
  const baseParams = {
    charName: 'Sumire',
    charPersonality: 'Tsundere, prickly when nervous.',
    charGoals: ['finish her thesis'],
    charBoundaries: ['hates being rushed'],
    eventTitle: 'Coffee at the window table',
    warmthLabel: 'near strangers',
  }

  it('trims surrounding quotes and whitespace from the model answer', async () => {
    const agenda = await draftHiddenAgenda(stubClient('  "wants him to notice she dressed up"  '), baseParams)
    expect(agenda).toBe('wants him to notice she dressed up')
  })

  it('returns null for an empty answer rather than a placeholder', async () => {
    expect(await draftHiddenAgenda(stubClient('   '), baseParams)).toBeNull()
  })

  it('caps an unreasonably long answer', async () => {
    const agenda = await draftHiddenAgenda(stubClient('x'.repeat(400)), baseParams)
    expect(agenda?.length).toBe(200)
  })

  it('returns null rather than throwing when the client errors', async () => {
    const throwing = { generate: async () => { throw new Error('offline') }, getEffectiveMaxContext: async () => 4096 } as unknown as KoboldClient
    expect(await draftHiddenAgenda(throwing, baseParams)).toBeNull()
  })
})

const TRANSCRIPT: ChatMessage[] = [
  { id: '1', role: 'user', name: 'Kai', text: 'This is nice.' },
  { id: '2', role: 'char', name: 'Sumire', text: '"It\'s fine, I guess."' },
]

const currentStats: RelationshipDeltas = deltas({ affection: 40, trust: 40, chemistry: 40, comfort: 40, respect: 40, curiosity: 40 })

// Section 9(c)'s (a) item: task-completion detection folded into this same judge call when
// `pendingTasks` is passed, instead of `detectAndMarkTasks` firing its own separate request.
describe('assessRelationshipMoment: task-detection merge', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Thanks for helping me pack up.', charName: 'Sumire', userName: 'Kai', current: currentStats }
  const REPLY_NO_TASKS = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}'
  const pendingTasks = ['Find the missing cat', 'Apologize to the neighbor']

  it("doesn't mention tasks in the prompt and returns [] when pendingTasks is omitted", async () => {
    let sentPrompt = ''
    const moment = await assessRelationshipMoment(
      stubClient(REPLY_NO_TASKS, (p) => {
        sentPrompt = p.prompt as string
      }),
      baseParams,
    )
    expect(sentPrompt).not.toContain('Pending objective tasks')
    expect(sentPrompt).not.toContain('completedTaskIndices')
    expect(moment.completedTaskIndices).toEqual([])
  })

  it('lists the pending tasks and asks for completedTaskIndices when pendingTasks is passed', async () => {
    let sentPrompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"completedTaskIndices":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { ...baseParams, pendingTasks },
    )
    expect(sentPrompt).toContain('Pending objective tasks')
    expect(sentPrompt).toContain('0: Find the missing cat')
    expect(sentPrompt).toContain('1: Apologize to the neighbor')
    expect(sentPrompt).toContain('completedTaskIndices')
  })

  it('returns a valid completed task index from the model', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"completedTaskIndices":[1]}',
      ),
      { ...baseParams, pendingTasks },
    )
    expect(moment.completedTaskIndices).toEqual([1])
  })

  it('filters out-of-range and malformed completed task indices', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"completedTaskIndices":[5,-1,"1",0]}',
      ),
      { ...baseParams, pendingTasks },
    )
    expect(moment.completedTaskIndices).toEqual([0])
  })

  it("ignores a model-hallucinated completedTaskIndices when pendingTasks was never asked for", async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"completedTaskIndices":[0]}',
      ),
      baseParams,
    )
    expect(moment.completedTaskIndices).toEqual([])
  })
})

describe('assessDateOutcome', () => {
  it('defaults to date framing — walkout/hidden-agenda language allowed, no gentler-hangout note', async () => {
    let sentPrompt = ''
    await assessDateOutcome(
      stubClient('{"deltas":{"affection":2,"trust":1,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"recap":"went fine","newFacts":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { transcript: TRANSCRIPT, eventTitle: 'Coffee', charName: 'Sumire', userName: 'Kai', current: currentStats },
    )
    expect(sentPrompt).toContain('date/scene')
    expect(sentPrompt).not.toContain('low-stakes, casual hangout')
  })

  it('switches to gentler hangout framing when sceneKind is hangout', async () => {
    let sentPrompt = ''
    const outcome = await assessDateOutcome(
      stubClient('{"deltas":{"affection":1,"trust":1,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"recap":"a relaxed afternoon","newFacts":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { transcript: TRANSCRIPT, eventTitle: 'Walk in the park', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'hangout' },
    )
    expect(sentPrompt).toContain('low-stakes, casual hangout')
    expect(sentPrompt).toContain('Full transcript of the hangout')
    expect(sentPrompt).not.toContain('hiddenAgenda')
    expect(outcome.recap).toBe('a relaxed afternoon')
  })
})

describe('suggestDateEvent', () => {
  const baseParams = {
    characterName: 'Sumire',
    personaName: 'Kai',
    availableBackgrounds: ['cafe'],
    affection: 20,
  }

  it('offers hangout as a kind in the prompt', async () => {
    let sentPrompt = ''
    await suggestDateEvent(
      stubClient('{"title":"Walk","objectiveTitle":"Talk","kind":"hangout"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      baseParams,
    )
    expect(sentPrompt).toContain('date|hangout|gift|milestone')
  })

  it('accepts a hangout kind from the model', async () => {
    const event = await suggestDateEvent(stubClient('{"title":"Walk","objectiveTitle":"Talk","kind":"hangout"}'), baseParams)
    expect(event?.kind).toBe('hangout')
  })

  it('falls back to date for an unrecognized kind', async () => {
    const event = await suggestDateEvent(stubClient('{"title":"Walk","objectiveTitle":"Talk","kind":"picnic"}'), baseParams)
    expect(event?.kind).toBe('date')
  })
})
