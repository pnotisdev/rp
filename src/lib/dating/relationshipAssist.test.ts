import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { ChatMessage } from '@/lib/prompt/builder'
import {
  ASSIST_TIMEOUT_MS,
  assessDateOutcome,
  assessIntimacyMilestone,
  assessRelationshipMoment,
  dampenRepeatedDeltas,
  draftHiddenAgenda,
  generateWithTimeout,
  parseRememberedFacts,
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

describe('dampenRepeatedDeltas', () => {
  it('scales positive warmth gains toward nothing', () => {
    const d = dampenRepeatedDeltas(deltas({ affection: 2, trust: 1, comfort: 2 }))
    expect(d.affection).toBe(1) // round(2 * 0.4)
    expect(d.trust).toBe(0) // round(1 * 0.4)
    expect(d.comfort).toBe(1)
  })

  it('leaves negative deltas, tension, and curiosity untouched', () => {
    const d = dampenRepeatedDeltas(deltas({ affection: -2, tension: 2, curiosity: 2, respect: -1 }))
    expect(d.affection).toBe(-2)
    expect(d.tension).toBe(2)
    expect(d.curiosity).toBe(2)
    expect(d.respect).toBe(-1)
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

// Gap 1: `first_kiss` covers a kiss written out in freeform roleplay, not sent through the
// Relationship panel's deterministic kissing_spot button (that path is `useChatSession.ts`'s own
// `sendUserMessage`, not this classifier).
describe('assessRelationshipMoment: first_kiss flag', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'He kissed her, soft and unhurried.', charName: 'Sumire', userName: 'Kai', current: currentStats }

  it('offers first_kiss with a glossary bar to clear, same as every other built-in flag', async () => {
    let sentPrompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      baseParams,
    )
    expect(sentPrompt).toContain('first_kiss')
    // The glossary line, not just the bare name — same bar-to-clear idea as the other 4 flags.
    expect(sentPrompt).toContain('they actually kissed')
  })

  it('accepts first_kiss when the model reports it', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":2,"trust":0,"chemistry":1,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":["first_kiss"],"reason":"Their first kiss","newFacts":[]}',
      ),
      baseParams,
    )
    expect(moment.newFlags).toEqual(['first_kiss'])
  })
})

describe('parseRememberedFacts', () => {
  it('gives a bare string neutral defaults', () => {
    expect(parseRememberedFacts(['Prefers tea over coffee'])).toEqual([
      { text: 'Prefers tea over coffee', importance: 0.5, valence: 0, unresolved: false },
    ])
  })

  it('reads the structured object form and clamps out-of-range numbers', () => {
    expect(
      parseRememberedFacts([{ text: 'Forgot her birthday', importance: 5, valence: -3, unresolved: true }]),
    ).toEqual([{ text: 'Forgot her birthday', importance: 1, valence: -1, unresolved: true }])
  })

  it('only treats unresolved:true as unresolved, and drops entries with no text', () => {
    const out = parseRememberedFacts([
      { text: 'a', unresolved: 'yes' },
      { text: '   ' },
      { importance: 0.9 },
      42,
    ])
    expect(out).toEqual([{ text: 'a', importance: 0.5, valence: 0, unresolved: false }])
  })

  it('returns [] for a non-array', () => {
    expect(parseRememberedFacts('nope')).toEqual([])
    expect(parseRememberedFacts(undefined)).toEqual([])
  })
})

describe('assessRelationshipMoment: unresolved threads', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Sorry about last week.', charName: 'Sumire', userName: 'Kai', current: currentStats }

  it('numbers the open threads in the prompt and asks for resolvedFactIndices only when there are some', async () => {
    let withThreads = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"resolvedFactIndices":[]}', (p) => {
        withThreads = p.prompt as string
      }),
      { ...baseParams, unresolvedFacts: ['Forgot her birthday', 'Never answered why he cancelled'] },
    )
    expect(withThreads).toContain('0: Forgot her birthday')
    expect(withThreads).toContain('1: Never answered why he cancelled')
    expect(withThreads).toContain('resolvedFactIndices')

    let without = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        without = p.prompt as string
      }),
      baseParams,
    )
    expect(without).not.toContain('resolvedFactIndices')
  })

  it('filters resolvedFactIndices to valid in-range integers and dedupes', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":1,"trust":1,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"Apologised for the birthday","newFacts":[],"resolvedFactIndices":[0,0,2,-1,"1"]}',
      ),
      { ...baseParams, unresolvedFacts: ['Forgot her birthday', 'Never answered why he cancelled'] },
    )
    expect(moment.resolvedFactIndices).toEqual([0])
  })

  it('parses structured newFacts with emotional metadata', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":-2,"trust":-1,"chemistry":0,"comfort":-1,"respect":0,"curiosity":0,"tension":2},"newFlags":[],"reason":"Forgot her birthday","newFacts":[{"text":"Forgot Sumire\'s birthday","importance":0.8,"valence":-0.7,"unresolved":true}]}',
      ),
      baseParams,
    )
    expect(moment.newFacts).toEqual([{ text: "Forgot Sumire's birthday", importance: 0.8, valence: -0.7, unresolved: true }])
  })
})

// "Character Mind" scoped slice — mood/currentNeed/characterIntent ride along in this same judge
// call, see `prompt/mindGuidance.ts`.
describe('assessRelationshipMoment: mood, currentNeed, and characterIntent', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Thanks for helping me pack up.', charName: 'Sumire', userName: 'Kai', current: currentStats }
  const NO_MIND_REPLY = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}'

  it('sends the current mood/need/intent as context and asks for all three in the schema', async () => {
    let sentPrompt = ''
    await assessRelationshipMoment(
      stubClient(NO_MIND_REPLY, (p) => {
        sentPrompt = p.prompt as string
      }),
      { ...baseParams, currentMood: 'content', currentNeed: 'stability', currentIntent: 'wants to visit the festival together' },
    )
    expect(sentPrompt).toContain('content')
    expect(sentPrompt).toContain('stability')
    expect(sentPrompt).toContain('wants to visit the festival together')
    expect(sentPrompt).toContain('"mood"')
    expect(sentPrompt).toContain('"currentNeed"')
    expect(sentPrompt).toContain('"characterIntent"')
  })

  it('returns undefined for all three when the model gives no clear read', async () => {
    const moment = await assessRelationshipMoment(stubClient(NO_MIND_REPLY), baseParams)
    expect(moment.mood).toBeUndefined()
    expect(moment.currentNeed).toBeUndefined()
    expect(moment.characterIntent).toBeUndefined()
  })

  it('accepts a currentNeed from the closed vocabulary', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentNeed":"recognition"}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.currentNeed).toBe('recognition')
  })

  it('rejects a currentNeed outside the closed vocabulary rather than passing it through', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentNeed":"world domination"}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.currentNeed).toBeUndefined()
  })

  it('accepts a mood from the closed vocabulary', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"mood":"anxious"}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.mood).toBe('anxious')
  })

  it('rejects a mood outside the closed vocabulary rather than passing it through', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"mood":"murderous"}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.mood).toBeUndefined()
  })

  it('accepts and trims a characterIntent, capped at 160 chars', async () => {
    const longIntent = 'w'.repeat(300)
    const reply = `{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"characterIntent":"  ${longIntent}  "}`
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.characterIntent?.length).toBe(160)
  })

  it('treats an empty-string characterIntent as no change, not a blank value', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"characterIntent":""}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.characterIntent).toBeUndefined()
  })
})

// The persistent agency layer (`dating/plans.ts`) — planUpdates ride along in this same judge call.
describe('assessRelationshipMoment: persistent plans', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Thanks for helping me pack up.', charName: 'Sumire', userName: 'Kai', current: currentStats }
  const NO_PLAN_REPLY = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"planUpdates":[]}'

  it('always asks for planUpdates, and numbers the active plans only when some were passed', async () => {
    let withPlans = ''
    await assessRelationshipMoment(
      stubClient(NO_PLAN_REPLY, (p) => {
        withPlans = p.prompt as string
      }),
      { ...baseParams, activePlans: ['[personal] finish the mural', '[together] visit the coast'] },
    )
    expect(withPlans).toContain('"planUpdates"')
    expect(withPlans).toContain('0: [personal] finish the mural')
    expect(withPlans).toContain('1: [together] visit the coast')

    let without = ''
    await assessRelationshipMoment(
      stubClient(NO_PLAN_REPLY, (p) => {
        without = p.prompt as string
      }),
      baseParams,
    )
    expect(without).toContain('"planUpdates"')
    expect(without).toContain('no standing plans on record yet')
  })

  it('returns a parsed add update', async () => {
    const reply =
      '{"deltas":{"affection":0,"trust":1,"chemistry":0,"comfort":0,"respect":1,"curiosity":0,"tension":0},"newFlags":[],"reason":"Opened up about the deadline","newFacts":[],"planUpdates":[{"action":"add","goal":"finish the mural before the showcase","kind":"personal","note":"behind on it"}]}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.planUpdates).toEqual([
      { action: 'add', goal: 'finish the mural before the showcase', kind: 'personal', note: 'behind on it' },
    ])
  })

  it('drops a note/resolve update whose index is past the plans actually passed in', async () => {
    const reply =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"planUpdates":[{"action":"resolve","index":4},{"action":"note","index":0,"note":"progress"}]}'
    const moment = await assessRelationshipMoment(stubClient(reply), { ...baseParams, activePlans: ['[personal] finish the mural'] })
    expect(moment.planUpdates).toEqual([{ action: 'note', index: 0, note: 'progress' }])
  })

  it('is [] when the model omits planUpdates entirely', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.planUpdates).toEqual([])
  })
})

// Standing impressions of/expectations of the player (`dating/beliefs.ts`/`dating/expectations.ts`)
// plus the character's own private fear (`prompt/mindGuidance.ts`'s fearGuidance) — all three ride
// along in this same judge call, same shape as plans/mood/need/intent above.
describe('assessRelationshipMoment: beliefs, expectations, and fear', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Thanks for helping me pack up.', charName: 'Sumire', userName: 'Kai', current: currentStats }
  const EMPTY_REPLY =
    '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"beliefUpdates":[],"expectationUpdates":[]}'

  it('always asks for beliefUpdates/expectationUpdates, and numbers the active lists only when some were passed', async () => {
    let withLists = ''
    await assessRelationshipMoment(
      stubClient(EMPTY_REPLY, (p) => {
        withLists = p.prompt as string
      }),
      { ...baseParams, activeBeliefs: ['He is unusually patient with me.'], activeExpectations: ['expects a check-in most Sundays'] },
    )
    expect(withLists).toContain('"beliefUpdates"')
    expect(withLists).toContain('"expectationUpdates"')
    expect(withLists).toContain('0: He is unusually patient with me.')
    expect(withLists).toContain('0: expects a check-in most Sundays')

    let without = ''
    await assessRelationshipMoment(
      stubClient(EMPTY_REPLY, (p) => {
        without = p.prompt as string
      }),
      baseParams,
    )
    expect(without).toContain("hasn't formed any standing impressions")
    expect(without).toContain('no standing expectations')
  })

  it('returns a parsed belief add update', async () => {
    const reply =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"beliefUpdates":[{"action":"add","text":"He avoids hard conversations."}]}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.beliefUpdates).toEqual([{ action: 'add', text: 'He avoids hard conversations.' }])
  })

  it('drops a belief revise/drop update whose index is past the beliefs actually passed in', async () => {
    const reply =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"beliefUpdates":[{"action":"drop","index":4},{"action":"revise","index":0,"text":"sharper"}]}'
    const moment = await assessRelationshipMoment(stubClient(reply), { ...baseParams, activeBeliefs: ['He is patient.'] })
    expect(moment.beliefUpdates).toEqual([{ action: 'revise', index: 0, text: 'sharper' }])
  })

  it('returns a parsed expectation resolve update, and drops one with no valid outcome', async () => {
    const reply =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"expectationUpdates":[{"action":"resolve","index":0,"outcome":"violated"},{"action":"resolve","index":5,"outcome":"met"}]}'
    const moment = await assessRelationshipMoment(stubClient(reply), { ...baseParams, activeExpectations: ['expects a Sunday check-in'] })
    expect(moment.expectationUpdates).toEqual([{ action: 'resolve', index: 0, outcome: 'violated' }])
  })

  it('is [] for both when the model omits them entirely', async () => {
    const reply = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}'
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.beliefUpdates).toEqual([])
    expect(moment.expectationUpdates).toEqual([])
  })

  it('accepts and trims a currentFear, capped at 160 chars, and treats an empty string as no change', async () => {
    const longFear = 'w'.repeat(300)
    const reply = `{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentFear":"  ${longFear}  "}`
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.currentFear?.length).toBe(160)

    const blank =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentFear":""}'
    expect((await assessRelationshipMoment(stubClient(blank), baseParams)).currentFear).toBeUndefined()
  })

  it('accepts and trims a currentDesire, capped at 160 chars, and treats an empty string as no change', async () => {
    const longDesire = 'w'.repeat(300)
    const reply = `{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentDesire":"  ${longDesire}  "}`
    const moment = await assessRelationshipMoment(stubClient(reply), baseParams)
    expect(moment.currentDesire?.length).toBe(160)

    const blank =
      '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"currentDesire":""}'
    expect((await assessRelationshipMoment(stubClient(blank), baseParams)).currentDesire).toBeUndefined()
  })

  it('always mentions the current desire going into the exchange, sticky-read style like mood/need/intent/fear', async () => {
    let prompt = ''
    await assessRelationshipMoment(
      stubClient(EMPTY_REPLY, (p) => {
        prompt = p.prompt as string
      }),
      { ...baseParams, currentDesire: 'wants to feel truly seen, not just liked' },
    )
    expect(prompt).toContain('wants to feel truly seen, not just liked')
    expect(prompt).toContain('"currentDesire"')
  })
})

// Item 2(b)'s "earned vs. rushed" read (`dating/aftercare.ts`'s `aftercarePaceContext`) — extra
// context for the aftercare verdict only, never a replacement for the judge's own read of the turns
// since.
describe('assessRelationshipMoment: aftercare pace context', () => {
  const baseParams = { history: TRANSCRIPT, latestReply: 'Thanks for helping me pack up.', charName: 'Sumire', userName: 'Kai', current: currentStats }
  const AFTERCARE_TURNS = [{ id: 'a1', role: 'user' as const, name: 'Kai', text: 'Hey, you okay?' }]

  it('mentions a sudden spike as context only when aftercare is actually due', async () => {
    let prompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        prompt = p.prompt as string
      }),
      { ...baseParams, aftercareTurns: AFTERCARE_TURNS, aftercarePaceContext: 'rushed' },
    )
    expect(prompt).toMatch(/built up very suddenly/)
  })

  it('mentions a gradual build differently', async () => {
    let prompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        prompt = p.prompt as string
      }),
      { ...baseParams, aftercareTurns: AFTERCARE_TURNS, aftercarePaceContext: 'earned' },
    )
    expect(prompt).toMatch(/built up gradually/)
  })

  it('says nothing about pace when there is no snapshot to read, even with aftercare due', async () => {
    let prompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        prompt = p.prompt as string
      }),
      { ...baseParams, aftercareTurns: AFTERCARE_TURNS },
    )
    expect(prompt).not.toMatch(/built up (very suddenly|gradually)/)
  })

  it('says nothing about pace when aftercare is not due, even if a pace value is somehow passed', async () => {
    let prompt = ''
    await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[]}', (p) => {
        prompt = p.prompt as string
      }),
      { ...baseParams, aftercarePaceContext: 'rushed' },
    )
    expect(prompt).not.toMatch(/built up (very suddenly|gradually)/)
  })
})

// The user's own direct follow-up to the intimacy catalog: a deliberate "first time together" ask,
// same three-outcome shape as assessCommitmentAsk (untested itself, so this establishes the
// pattern for both).
describe('assessIntimacyMilestone', () => {
  const baseParams = { history: TRANSCRIPT, charName: 'Sumire', userName: 'Kai', current: currentStats }

  it('defaults to "deflect" when the model gives an unrecognized decision', async () => {
    const outcome = await assessIntimacyMilestone(stubClient('{"decision":"maybe later","reason":"","deltas":{}}'), baseParams)
    expect(outcome.decision).toBe('deflect')
    expect(outcome.reason.length).toBeGreaterThan(0)
  })

  it('accepts a well-formed "accept" outcome with its deltas', async () => {
    const reply = '{"decision":"accept","reason":"She pulls you closer instead of pulling away.","deltas":{"affection":3,"trust":2,"chemistry":3,"comfort":1,"respect":0,"curiosity":0,"tension":-1}}'
    const outcome = await assessIntimacyMilestone(stubClient(reply), baseParams)
    expect(outcome.decision).toBe('accept')
    expect(outcome.reason).toBe('She pulls you closer instead of pulling away.')
    expect(outcome.deltas.chemistry).toBe(3)
    expect(outcome.deltas.tension).toBe(-1)
  })

  it('accepts a well-formed "backfire" outcome', async () => {
    const reply = '{"decision":"backfire","reason":"That landed all wrong, mid-argument.","deltas":{"affection":-2,"trust":-2,"chemistry":-1,"comfort":-2,"respect":-1,"curiosity":0,"tension":3}}'
    const outcome = await assessIntimacyMilestone(stubClient(reply), baseParams)
    expect(outcome.decision).toBe('backfire')
    expect(outcome.deltas.tension).toBe(3)
  })

  it('clamps an out-of-range delta rather than passing it through', async () => {
    const reply = '{"decision":"accept","reason":"Yes.","deltas":{"affection":99,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0}}'
    const outcome = await assessIntimacyMilestone(stubClient(reply), baseParams)
    expect(outcome.deltas.affection).toBe(3)
  })

  it('mentions the character by name and the recent conversation in the prompt', async () => {
    let sentPrompt = ''
    await assessIntimacyMilestone(
      stubClient('{"decision":"deflect","reason":"Not tonight.","deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0}}', (p) => {
        sentPrompt = p.prompt as string
      }),
      baseParams,
    )
    expect(sentPrompt).toContain('Sumire')
    expect(sentPrompt).toContain('first time together')
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

  it('offers first_date to a date', async () => {
    let sentPrompt = ''
    await assessDateOutcome(
      stubClient('{"deltas":{"affection":2,"trust":0,"chemistry":1,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"recap":"nice","newFacts":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { transcript: TRANSCRIPT, eventTitle: 'Dinner', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'date' },
    )
    expect(sentPrompt).toContain('first_date')
  })

  it('withholds first_date from a hangout, but keeps every other flag on offer', async () => {
    let sentPrompt = ''
    await assessDateOutcome(
      stubClient('{"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"recap":"nice","newFacts":[]}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { transcript: TRANSCRIPT, eventTitle: 'Walk', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'hangout' },
    )
    expect(sentPrompt).not.toContain('first_date')
    expect(sentPrompt).toContain('confession')
    expect(sentPrompt).toContain('jealousy')
    expect(sentPrompt).toContain('promise')
    // Unlike `first_date`, a kiss isn't structurally date-only — a hangout can still establish it.
    expect(sentPrompt).toContain('first_kiss')
  })

  it('allows a hangout to establish first_kiss (kissing is not date-only)', async () => {
    const outcome = await assessDateOutcome(
      stubClient(
        '{"deltas":{"affection":2,"trust":0,"chemistry":1,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":["first_kiss"],"recap":"nice","newFacts":[]}',
      ),
      { transcript: TRANSCRIPT, eventTitle: 'Walk', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'hangout' },
    )
    expect(outcome.newFlags).toEqual(['first_kiss'])
  })

  it('drops a first_date a hangout returned anyway, and keeps its other flags', async () => {
    // The live failure this gate exists for: `first_date` fired on a scene explicitly started and
    // scored as a hangout, against a glossary line that already said a hangout doesn't qualify.
    const outcome = await assessDateOutcome(
      stubClient(
        '{"deltas":{"affection":1,"trust":1,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":["first_date","promise"],"recap":"nice","newFacts":[]}',
      ),
      { transcript: TRANSCRIPT, eventTitle: 'Walk', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'hangout' },
    )
    expect(outcome.newFlags).toEqual(['promise'])
  })

  it('keeps a first_date a real date returned', async () => {
    const outcome = await assessDateOutcome(
      stubClient(
        '{"deltas":{"affection":3,"trust":1,"chemistry":2,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":["first_date"],"recap":"nice","newFacts":[]}',
      ),
      { transcript: TRANSCRIPT, eventTitle: 'Dinner', charName: 'Sumire', userName: 'Kai', current: currentStats, sceneKind: 'date' },
    )
    expect(outcome.newFlags).toEqual(['first_date'])
  })

  it('still allows a world-authored flag inside a hangout', async () => {
    const outcome = await assessDateOutcome(
      stubClient(
        '{"deltas":{"affection":1,"trust":0,"chemistry":0,"comfort":1,"respect":0,"curiosity":0,"tension":0},"newFlags":["shared_umbrella"],"recap":"nice","newFacts":[]}',
      ),
      {
        transcript: TRANSCRIPT,
        eventTitle: 'Walk',
        charName: 'Sumire',
        userName: 'Kai',
        current: currentStats,
        sceneKind: 'hangout',
        customFlags: [{ id: 'shared_umbrella', label: 'Shared an umbrella', description: 'they walked home under one umbrella' }],
      },
    )
    expect(outcome.newFlags).toEqual(['shared_umbrella'])
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

  it('tells the model when the two are officially together', async () => {
    // Before this, the call only ever saw `affection` — so an established couple kept being
    // handed tentative "hangout" cards long after "ask to be dating" was accepted.
    let sentPrompt = ''
    await suggestDateEvent(
      stubClient('{"title":"Dinner","objectiveTitle":"Celebrate","kind":"date"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { ...baseParams, affection: 80, commitmentStatus: 'dating' },
    )
    expect(sentPrompt).toContain('already officially dating')
    expect(sentPrompt).not.toContain('not officially together')
  })

  it('names the actual rung of the ladder, not just "together"', async () => {
    let sentPrompt = ''
    await suggestDateEvent(
      stubClient('{"title":"Dinner","objectiveTitle":"Celebrate","kind":"date"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { ...baseParams, affection: 95, commitmentStatus: 'living_together' },
    )
    expect(sentPrompt).toContain('already officially living together')
  })

  it("says they aren't together when the status is none", async () => {
    let sentPrompt = ''
    await suggestDateEvent(
      stubClient('{"title":"Walk","objectiveTitle":"Talk","kind":"hangout"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { ...baseParams, commitmentStatus: 'none' },
    )
    expect(sentPrompt).toContain('not officially together')
    expect(sentPrompt).not.toContain('already officially')
  })

  it('treats an omitted status the same as none', async () => {
    let sentPrompt = ''
    await suggestDateEvent(
      stubClient('{"title":"Walk","objectiveTitle":"Talk","kind":"hangout"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      baseParams,
    )
    expect(sentPrompt).toContain('not officially together')
  })

  // Gap 2's "auto-draft a real milestone event" ask: `askForCommitment` (`useChatSession.ts`) calls
  // this with `milestoneOccasion` set right after a married/living_together accept, wanting an
  // actual wedding-day/moving-in-day scene rather than a generic date the commitment-status framing
  // alone would produce.
  describe('milestoneOccasion', () => {
    it('asks specifically for a wedding, not the generic officially-together framing', async () => {
      let sentPrompt = ''
      await suggestDateEvent(
        stubClient('{"title":"The Wedding","objectiveTitle":"Say I do","kind":"hangout"}', (p) => {
          sentPrompt = p.prompt as string
        }),
        { ...baseParams, affection: 95, commitmentStatus: 'married', milestoneOccasion: 'married' },
      )
      expect(sentPrompt).toContain('day they get married')
      expect(sentPrompt).toContain('their actual wedding')
      expect(sentPrompt).not.toContain('already officially married')
      expect(sentPrompt).not.toContain('not officially together')
    })

    it('asks specifically for a moving-in day for living_together', async () => {
      let sentPrompt = ''
      await suggestDateEvent(
        stubClient('{"title":"Moving Day","objectiveTitle":"Unpack the boxes","kind":"gift"}', (p) => {
          sentPrompt = p.prompt as string
        }),
        { ...baseParams, affection: 90, commitmentStatus: 'living_together', milestoneOccasion: 'living_together' },
      )
      expect(sentPrompt).toContain('day they move in together')
      expect(sentPrompt).toContain('actual moving-in day')
    })

    it('forces kind to date even when the model answers something else', async () => {
      const marriedEvent = await suggestDateEvent(
        stubClient('{"title":"The Wedding","objectiveTitle":"Say I do","kind":"hangout"}'),
        { ...baseParams, milestoneOccasion: 'married' },
      )
      expect(marriedEvent?.kind).toBe('date')

      const movingInEvent = await suggestDateEvent(
        stubClient('{"title":"Moving Day","objectiveTitle":"Unpack the boxes","kind":"gift"}'),
        { ...baseParams, milestoneOccasion: 'living_together' },
      )
      expect(movingInEvent?.kind).toBe('date')
    })

    it('still returns null when the model gives no usable title, milestone or not', async () => {
      const event = await suggestDateEvent(stubClient('{"title":"","objectiveTitle":""}'), { ...baseParams, milestoneOccasion: 'married' })
      expect(event).toBeNull()
    })
  })
})

describe('assessRelationshipMoment — aftercare', () => {
  const HISTORY: ChatMessage[] = [
    { id: '1', role: 'user', name: 'Kai', text: 'Morning.' },
    { id: '2', role: 'char', name: 'Sumire', text: 'You stayed.' },
  ]
  const base = {
    history: HISTORY,
    latestReply: 'You stayed.',
    charName: 'Sumire',
    userName: 'Kai',
    current: deltas({}),
  }
  const REPLY = '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"aftercareVerdict":"tender"}'

  it('never mentions aftercare on an ordinary turn', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(stubClient(REPLY, (p) => { sent = p.prompt as string }), base)
    expect(sent).not.toContain('aftercareVerdict')
    expect(sent).not.toContain('were intimate a few turns ago')
    // ...and a verdict volunteered anyway is ignored, since no window is open to apply it to.
    expect(moment.aftercareVerdict).toBeUndefined()
  })

  it('asks for a verdict, with its rubric, only when the window is closing', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(stubClient(REPLY, (p) => { sent = p.prompt as string }), {
      ...base,
      aftercareTurns: HISTORY,
    })
    expect(sent).toContain('aftercareVerdict')
    expect(sent).toContain('tender, awkward, cold')
    expect(sent).toContain("Judge Kai's behaviour, not Sumire's")
    expect(moment.aftercareVerdict).toBe('tender')
  })

  it('rides along in the same call as task detection rather than replacing it', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"completedTaskIndices":[0],"aftercareVerdict":"cold"}',
        (p) => { sent = p.prompt as string },
      ),
      { ...base, aftercareTurns: HISTORY, pendingTasks: ['Ask about her mother'] },
    )
    expect(sent).toContain('completedTaskIndices')
    expect(sent).toContain('aftercareVerdict')
    expect(moment.completedTaskIndices).toEqual([0])
    expect(moment.aftercareVerdict).toBe('cold')
  })

  it('rejects a verdict outside the vocabulary', async () => {
    const moment = await assessRelationshipMoment(
      stubClient(
        '{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"aftercareVerdict":"lukewarm"}',
      ),
      { ...base, aftercareTurns: HISTORY },
    )
    // The caller reads undefined as "awkward" and closes the window regardless, rather than
    // leaving the aftermath running forever waiting for a usable answer.
    expect(moment.aftercareVerdict).toBeUndefined()
  })

  it('includes the window transcript so the verdict judges the aftermath, not just the last line', async () => {
    let sent = ''
    await assessRelationshipMoment(stubClient(REPLY, (p) => { sent = p.prompt as string }), {
      ...base,
      aftercareTurns: [
        { id: 'a', role: 'user', name: 'Kai', text: 'I have to run.' },
        { id: 'b', role: 'char', name: 'Sumire', text: 'Oh. Right.' },
      ],
    })
    expect(sent).toContain('I have to run.')
    expect(sent).toContain('Oh. Right.')
  })
})

describe('assessRelationshipMoment — intimacy scene phase (item 1)', () => {
  const HISTORY: ChatMessage[] = [
    { id: '1', role: 'user', name: 'Kai', text: '*pulls her close*' },
    { id: '2', role: 'char', name: 'Sumire', text: 'She leans in.' },
  ]
  const base = {
    history: HISTORY,
    latestReply: 'She leans in.',
    charName: 'Sumire',
    userName: 'Kai',
    current: deltas({}),
  }

  it('never asks for a phase read on an ordinary turn', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"intimacyPhase":"peak"}', (p) => { sent = p.prompt as string }),
      base,
    )
    expect(sent).not.toContain('intimacyPhase')
    // ...and a phase volunteered anyway is ignored, since no scene is tracked as active.
    expect(moment.intimacyPhase).toBeUndefined()
  })

  it('asks for a phase read, with its rubric, only while a scene is active', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"intimacyPhase":"peak"}', (p) => { sent = p.prompt as string }),
      { ...base, currentIntimacyPhase: 'building' },
    )
    expect(sent).toContain('intimacyPhase')
    expect(sent).toContain('building, peak, resolved')
    expect(moment.intimacyPhase).toBe('peak')
  })

  it('accepts a "resolved" read, meaning the scene has concluded', async () => {
    const moment = await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"intimacyPhase":"resolved"}'),
      { ...base, currentIntimacyPhase: 'peak' },
    )
    expect(moment.intimacyPhase).toBe('resolved')
  })

  it('rejects a phase outside the vocabulary', async () => {
    const moment = await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"intimacyPhase":"climax"}'),
      { ...base, currentIntimacyPhase: 'building' },
    )
    expect(moment.intimacyPhase).toBeUndefined()
  })

  it('rides along with aftercare scoring in the same call rather than replacing it', async () => {
    let sent = ''
    const moment = await assessRelationshipMoment(
      stubClient('{"deltas":{"affection":0,"trust":0,"chemistry":0,"comfort":0,"respect":0,"curiosity":0,"tension":0},"newFlags":[],"reason":"","newFacts":[],"aftercareVerdict":"tender","intimacyPhase":"resolved"}', (p) => { sent = p.prompt as string }),
      { ...base, aftercareTurns: HISTORY, currentIntimacyPhase: 'peak' },
    )
    expect(sent).toContain('aftercareVerdict')
    expect(sent).toContain('intimacyPhase')
    expect(moment.aftercareVerdict).toBe('tender')
    expect(moment.intimacyPhase).toBe('resolved')
  })
})

describe('generateWithTimeout', () => {
  // The live repro this exists for: "End hangout"/"End date" awaits `assessDateOutcome` (which
  // calls this) directly, with no timeout of its own — a provider response that simply never
  // resolves (confirmed against a rate-limited free OpenRouter model) left the button reading
  // "Ending…" forever, with no error and no way to retry, because the awaited promise never
  // settled either way.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves normally when the backend answers before the timeout', async () => {
    const client = { generate: async () => 'real answer', getEffectiveMaxContext: async () => 4096 } as unknown as ChatBackend
    await expect(generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')).resolves.toBe('real answer')
  })

  it('aborts the request and rejects with a clear message once the backend never responds', async () => {
    let sawAbort = false
    const client = {
      generate: (_p: unknown, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            sawAbort = true
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
      getEffectiveMaxContext: async () => 4096,
    } as unknown as ChatBackend

    const pending = generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')
    // Attach the rejection assertion before advancing any timers, so the promise never has a tick
    // where it's rejected but nothing is listening yet (fake timers otherwise make that window
    // land as a real unhandled-rejection warning even though the test itself is correct).
    const assertion = expect(pending).rejects.toThrow(/Test call timed out after 45s/)

    // Nothing has happened yet — still well within the timeout window.
    await vi.advanceTimersByTimeAsync(ASSIST_TIMEOUT_MS - 1000)
    expect(sawAbort).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(sawAbort).toBe(true)
  })

  it('still surfaces a real (non-timeout) error as itself, not a misleading timeout message', async () => {
    const client = {
      generate: async () => {
        throw new Error('Chat completion failed (429): Provider returned error')
      },
      getEffectiveMaxContext: async () => 4096,
    } as unknown as ChatBackend
    await expect(generateWithTimeout(client, { prompt: 'x' } as never, 'Test call')).rejects.toThrow(/429/)
  })
})
