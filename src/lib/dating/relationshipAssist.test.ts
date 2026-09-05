import { describe, expect, it } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import type { ChatMessage } from '@/lib/prompt/builder'
import {
  assessDateOutcome,
  assessIntimacyMilestone,
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
