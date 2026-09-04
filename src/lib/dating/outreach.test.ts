import { describe, expect, it } from 'vitest'
import { evaluateOutreach, truncateAtStrayTurnMarker, type EvaluateOutreachOptions } from './outreach'

const HOUR_MS = 3_600_000
const NOW = 1_000_000_000_000

function baseOpts(overrides: Partial<EvaluateOutreachOptions> = {}): EvaluateOutreachOptions {
  return {
    character: { id: 'char-1', outreach: { frequency: 'eager' }, schedule: undefined },
    chat: { id: 'chat-1', affection: 50, relationshipStats: {}, activeEvent: undefined, participants: undefined, lastOutreachCheckedAt: undefined },
    lastMessage: { createdAt: NOW - 10 * HOUR_MS },
    world: { currentDay: 0, currentPhaseIndex: 0 },
    now: NOW,
    ...overrides,
  }
}

describe('evaluateOutreach — skip gates', () => {
  it('skips when outreach is unset (default off, no retroactive behavior change)', () => {
    const result = evaluateOutreach(baseOpts({ character: { id: 'char-1', outreach: undefined, schedule: undefined } }))
    expect(result).toEqual({ status: 'skip', eligible: false })
  })

  it('skips when frequency is explicitly "never"', () => {
    const result = evaluateOutreach(baseOpts({ character: { id: 'char-1', outreach: { frequency: 'never' }, schedule: undefined } }))
    expect(result).toEqual({ status: 'skip', eligible: false })
  })

  it('skips group chats (any participants)', () => {
    const result = evaluateOutreach(baseOpts({ chat: { id: 'chat-1', affection: 50, relationshipStats: {}, participants: ['char-2'] } }))
    expect(result.status).toBe('skip')
  })

  it('skips a chat with no prior message', () => {
    const result = evaluateOutreach(baseOpts({ lastMessage: undefined }))
    expect(result).toEqual({ status: 'skip', eligible: false })
  })

  it('skips a chat with a live activeEvent (never interrupt a date)', () => {
    const result = evaluateOutreach(
      baseOpts({ chat: { id: 'chat-1', affection: 50, relationshipStats: {}, activeEvent: { id: 'e1', title: 'Date' } as never } }),
    )
    expect(result.status).toBe('skip')
  })

  it('skips when the character is currently asleep per their schedule', () => {
    const result = evaluateOutreach(
      baseOpts({
        character: {
          id: 'char-1',
          outreach: { frequency: 'eager' },
          schedule: [{ id: 's1', phase: 'morning', status: 'sleeping', activity: 'Asleep' }],
        },
        world: { currentDay: 0, currentPhaseIndex: 0 },
      }),
    )
    expect(result.status).toBe('skip')
  })

  it('skips when the check-cooldown floor has not cleared, even past the silence threshold', () => {
    const result = evaluateOutreach(baseOpts({ chat: { id: 'chat-1', affection: 50, relationshipStats: {}, lastOutreachCheckedAt: NOW - 60_000 } }))
    expect(result.status).toBe('skip')
  })
})

describe('evaluateOutreach — per-frequency silence thresholds', () => {
  it('rare (48h threshold) skips at 40h and can roll at 49h', () => {
    const character = { id: 'char-1', outreach: { frequency: 'rare' as const }, schedule: undefined }
    const skipped = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 40 * HOUR_MS } }))
    expect(skipped.status).toBe('skip')
    const rolled = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 49 * HOUR_MS } }))
    expect(rolled.status).toBe('rolled')
  })

  it('normal (20h threshold) skips at 15h and can roll at 21h', () => {
    const character = { id: 'char-1', outreach: { frequency: 'normal' as const }, schedule: undefined }
    const skipped = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 15 * HOUR_MS } }))
    expect(skipped.status).toBe('skip')
    const rolled = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 21 * HOUR_MS } }))
    expect(rolled.status).toBe('rolled')
  })

  it('eager (8h threshold) skips at 5h and can roll at 9h', () => {
    const character = { id: 'char-1', outreach: { frequency: 'eager' as const }, schedule: undefined }
    const skipped = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 5 * HOUR_MS } }))
    expect(skipped.status).toBe('skip')
    const rolled = evaluateOutreach(baseOpts({ character, lastMessage: { createdAt: NOW - 9 * HOUR_MS } }))
    expect(rolled.status).toBe('rolled')
  })
})

describe('evaluateOutreach — probability roll', () => {
  it('is deterministic: identical inputs produce identical output', () => {
    const opts = baseOpts()
    expect(evaluateOutreach(opts)).toEqual(evaluateOutreach(opts))
  })

  it('higher relationship warmth never lowers the chance of an eligible roll (same silence hour bucket)', () => {
    // Sweep enough character ids to find at least one hour bucket where the roll sits strictly
    // between the low-warmth and high-warmth chance — proving the warmth bonus actually shifts
    // eligibility for some seed, without depending on any single seed's exact roll value.
    let sawEligibleFlip = false
    for (let i = 0; i < 200; i++) {
      const character = { id: `char-${i}`, outreach: { frequency: 'eager' as const }, schedule: undefined }
      const low = evaluateOutreach(baseOpts({ character, chat: { id: 'chat-1', affection: 0, relationshipStats: {} } }))
      const high = evaluateOutreach(baseOpts({ character, chat: { id: 'chat-1', affection: 100, relationshipStats: {} } }))
      if (low.status === 'rolled' && high.status === 'rolled' && !low.eligible && high.eligible) sawEligibleFlip = true
      // Never the other direction: warmth should never turn an eligible roll ineligible.
      if (low.status === 'rolled' && high.status === 'rolled') expect(low.eligible ? high.eligible : true).toBe(true)
    }
    expect(sawEligibleFlip).toBe(true)
  })

  it('rolled-but-ineligible still reports status "rolled" (caller must persist lastOutreachCheckedAt)', () => {
    // Find a seed that rolls but comes up ineligible, to exercise that branch explicitly.
    let found = false
    for (let i = 0; i < 200; i++) {
      const character = { id: `char-${i}`, outreach: { frequency: 'rare' as const }, schedule: undefined }
      const result = evaluateOutreach(
        baseOpts({ character, lastMessage: { createdAt: NOW - 49 * HOUR_MS }, chat: { id: 'chat-1', affection: 0, relationshipStats: {} } }),
      )
      if (result.status === 'rolled' && !result.eligible) {
        expect(result.reason).toBeUndefined()
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})

describe('evaluateOutreach — reason categorization', () => {
  it('reports "schedule" when the character has a current scheduled activity', () => {
    let found = false
    for (let i = 0; i < 200; i++) {
      const character = {
        id: `char-${i}`,
        outreach: { frequency: 'eager' as const },
        schedule: [{ id: 's1', phase: 'morning' as const, status: 'available' as const, activity: 'Opening the bakery' }],
      }
      const result = evaluateOutreach(baseOpts({ character, chat: { id: 'chat-1', affection: 30, relationshipStats: {} } }))
      if (result.status === 'rolled' && result.eligible) {
        expect(result.reason).toBe('schedule')
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('reports "warmth" when no schedule activity is set, elapsed time is under the silence-doubling, and warmth is high', () => {
    let found = false
    for (let i = 0; i < 200; i++) {
      const character = { id: `char-${i}`, outreach: { frequency: 'eager' as const }, schedule: undefined }
      const result = evaluateOutreach(
        baseOpts({
          character,
          lastMessage: { createdAt: NOW - 9 * HOUR_MS },
          chat: { id: 'chat-1', affection: 100, relationshipStats: { trust: 100, chemistry: 100, comfort: 100, respect: 100 } },
        }),
      )
      if (result.status === 'rolled' && result.eligible) {
        expect(result.reason).toBe('warmth')
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('reports "silence" once elapsed time clears double the frequency threshold, regardless of schedule/warmth', () => {
    let found = false
    for (let i = 0; i < 200; i++) {
      const character = {
        id: `char-${i}`,
        outreach: { frequency: 'eager' as const },
        schedule: [{ id: 's1', phase: 'morning' as const, status: 'available' as const, activity: 'Opening the bakery' }],
      }
      const result = evaluateOutreach(
        baseOpts({ character, lastMessage: { createdAt: NOW - 20 * HOUR_MS }, chat: { id: 'chat-1', affection: 90, relationshipStats: {} } }),
      )
      if (result.status === 'rolled' && result.eligible) {
        expect(result.reason).toBe('silence')
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})

describe('truncateAtStrayTurnMarker', () => {
  // Regression coverage for a real bug caught during live verification: a local model, when
  // uncertain about turn boundaries, imitated the SillyTavern `<START>`/name-prefix example-
  // dialogue delimiters from the character card's `mes_example` instead of stopping after one
  // message — producing a reply that trailed into a fabricated persona turn.

  it('returns clean text unchanged when there is no stray marker', () => {
    expect(truncateAtStrayTurnMarker('Hey, are you free later?', 'Sumire', 'You')).toBe('Hey, are you free later?')
  })

  it('cuts at a literal <START> marker', () => {
    const raw = 'Hey, are you free later?\n<START>\nYou: Sure, what did you have in mind?\nSumire: Let'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe('Hey, are you free later?')
  })

  it('cuts at a fabricated persona turn ("You:")', () => {
    const raw = 'Hey, are you free later?\nYou: Yeah, what\'s up?\nSumire: Nothing, just wondering.'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe('Hey, are you free later?')
  })

  it('cuts at the character restating its own name-prefix as a new turn', () => {
    const raw = '*Text Message*\n\nSumire: \n<START>\nSumire: Hey, are you around?'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe('*Text Message*')
  })

  it('uses whichever marker occurs earliest when several are present', () => {
    const raw = 'Hi\nSumire: fake continuation\n<START>\nYou: also fake'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe('Hi')
  })

  it('is case-insensitive on the marker itself', () => {
    const raw = 'Hi there\n<start>\nmore junk'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe('Hi there')
  })

  it('does not false-positive on a name that merely appears mid-sentence without a trailing colon', () => {
    const raw = 'Sumire here, just checking in on you.'
    expect(truncateAtStrayTurnMarker(raw, 'Sumire', 'You')).toBe(raw)
  })

  it('safely escapes regex-special characters in names', () => {
    const raw = 'Hey!\nMr. O\'Brien (Jr.): fake turn'
    expect(truncateAtStrayTurnMarker(raw, "Mr. O'Brien (Jr.)", 'You')).toBe('Hey!')
  })
})
