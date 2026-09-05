import { describe, expect, it } from 'vitest'
import {
  MESSAGE_INTENTS,
  availableIntents,
  describeIntentForJudge,
  describeIntentsForDate,
  intentSpec,
  isMessageIntent,
  repeatedIntentNudge,
  trailingIntentRun,
} from './intent'

describe('intent specs', () => {
  it('every spec has the fields the judge and UI need', () => {
    for (const spec of MESSAGE_INTENTS) {
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.hint.length).toBeGreaterThan(0)
      expect(spec.judgeLine.length).toBeGreaterThan(0)
    }
  })

  it('isMessageIntent / intentSpec round-trip on real ids and reject junk', () => {
    expect(isMessageIntent('flirt')).toBe(true)
    expect(isMessageIntent('smoulder')).toBe(false)
    expect(isMessageIntent(undefined)).toBe(false)
    expect(intentSpec('tease')?.label).toBe('Tease')
    expect(intentSpec('nope')).toBeUndefined()
  })
})

describe('availableIntents', () => {
  it('offers the three base intents with no friction', () => {
    expect(availableIntents({}).map((i) => i.id)).toEqual(['flirt', 'tease', 'open_up'])
  })

  it('adds reassure and apologize once tension is elevated', () => {
    expect(availableIntents({ tension: 20 }).map((i) => i.id)).toEqual([
      'flirt',
      'tease',
      'open_up',
      'reassure',
      'apologize',
    ])
  })

  it('does not add them just below the threshold', () => {
    expect(availableIntents({ tension: 5 }).map((i) => i.id)).toHaveLength(3)
  })
})

describe('describeIntentForJudge', () => {
  it('names the intent and warns the judge not to just reward the attempt', () => {
    const line = describeIntentForJudge('flirt')
    expect(line).toContain('flirt')
    expect(line).toMatch(/do not just reward the attempt/i)
  })

  it('returns undefined for an untagged or unknown line', () => {
    expect(describeIntentForJudge(undefined)).toBeUndefined()
    expect(describeIntentForJudge('bogus')).toBeUndefined()
  })
})

describe('trailingIntentRun', () => {
  it('counts the run of identical values at the end', () => {
    expect(trailingIntentRun(['tease', 'flirt', 'flirt', 'flirt'])).toBe(3)
    expect(trailingIntentRun(['flirt', 'flirt'])).toBe(2)
  })

  it('is 0 when the newest entry is untagged', () => {
    expect(trailingIntentRun(['flirt', 'flirt', undefined])).toBe(0)
    expect(trailingIntentRun([])).toBe(0)
  })

  it("stops at the first entry that doesn't match the newest", () => {
    expect(trailingIntentRun(['flirt', 'tease', 'flirt'])).toBe(1)
  })
})

describe('repeatedIntentNudge', () => {
  it('fires at a streak of 3+, naming both parties and telling the character to notice', () => {
    const line = repeatedIntentNudge(3, 'Sumire', 'Kai')!
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line).toMatch(/novelty has worn off|less weight|repetition/i)
  })

  it('stays quiet below the threshold', () => {
    expect(repeatedIntentNudge(2, 'Sumire', 'Kai')).toBeUndefined()
    expect(repeatedIntentNudge(0, 'Sumire', 'Kai')).toBeUndefined()
  })
})

describe('describeIntentsForDate', () => {
  it('summarises with counts and drops unknowns', () => {
    const line = describeIntentsForDate(['flirt', 'flirt', 'open_up', 'bogus'])
    expect(line).toContain('Flirt ×2')
    expect(line).toContain('Open up')
    expect(line).not.toContain('bogus')
  })

  it('returns undefined when nothing was tagged', () => {
    expect(describeIntentsForDate([])).toBeUndefined()
    expect(describeIntentsForDate(['bogus'])).toBeUndefined()
  })
})
