import { describe, expect, it } from 'vitest'
import {
  RELATIONSHIP_ARCHETYPES,
  archetypeGuidance,
  classifyArchetype,
  findArchetypeMatch,
  participantRelationshipGuidance,
  rivalCommitmentFraming,
  rivalJealousyIntensifier,
  type ArchetypeMatch,
} from './participantArchetype'

describe('classifyArchetype', () => {
  it('classifies each known bucket from natural authored phrasing', () => {
    expect(classifyArchetype('childhood rival, competitive about everything')).toBe('rival')
    expect(classifyArchetype('older sister, practically raised her')).toBe('found_family')
    expect(classifyArchetype('her mentor from architecture school')).toBe('mentor_mentee')
    expect(classifyArchetype('his student, still rough around the edges')).toBe('mentor_mentee')
    expect(classifyArchetype('his boss at the firm')).toBe('power_imbalanced')
  })

  it('returns undefined for ordinary connections that are not any of the archetypes', () => {
    expect(classifyArchetype('old friend from high school')).toBeUndefined()
    expect(classifyArchetype('neighbor, waters her plants sometimes')).toBeUndefined()
    expect(classifyArchetype('')).toBeUndefined()
  })

  it('is case-insensitive', () => {
    expect(classifyArchetype('HER RIVAL since middle school')).toBe('rival')
  })
})

describe('findArchetypeMatch', () => {
  it('finds a connection naming the target and classifies it', () => {
    const match = findArchetypeMatch(['Aiko'], [{ connections: [{ name: 'Aiko', relation: 'childhood rival' }] }])
    expect(match?.archetype).toBe('rival')
    expect(match?.sourceText).toBe('childhood rival')
  })

  it('matches case-insensitively and trims whitespace', () => {
    const match = findArchetypeMatch([' aiko '], [{ connections: [{ name: 'Aiko ', relation: 'childhood rival' }] }])
    expect(match?.archetype).toBe('rival')
  })

  it('folds relation and notes together into the quoted source text', () => {
    const match = findArchetypeMatch(['Aiko'], [{ connections: [{ name: 'Aiko', relation: 'rival', notes: 'from the debate club' }] }])
    expect(match?.sourceText).toBe('rival — from the debate club')
  })

  it('returns undefined when no connection names any target', () => {
    expect(findArchetypeMatch(['Aiko'], [{ connections: [{ name: 'Ren', relation: 'rival' }] }])).toBeUndefined()
  })

  it('returns undefined when a matching connection does not classify into any archetype', () => {
    expect(findArchetypeMatch(['Aiko'], [{ connections: [{ name: 'Aiko', relation: 'old friend from school' }] }])).toBeUndefined()
  })

  it('returns undefined with no target names or no sources at all', () => {
    expect(findArchetypeMatch([], [{ connections: [{ name: 'Aiko', relation: 'rival' }] }])).toBeUndefined()
    expect(findArchetypeMatch(['Aiko'], [])).toBeUndefined()
    expect(findArchetypeMatch(['Aiko'], [{ connections: undefined }])).toBeUndefined()
  })

  it('checks sources in the given order, stopping at the first classifiable hit', () => {
    const match = findArchetypeMatch(
      ['Aiko'],
      [
        { connections: [{ name: 'Aiko', relation: 'unclassifiable old friend' }] },
        { connections: [{ name: 'Aiko', relation: 'her mentor' }] },
      ],
    )
    // The first source's entry names Aiko but doesn't classify, so it must fall through to the
    // second source rather than stopping cold at the first name match.
    expect(match?.archetype).toBe('mentor_mentee')
  })

  it('matches any of several target names (e.g. persona OR primary)', () => {
    const match = findArchetypeMatch(['Kai', 'Sumire'], [{ connections: [{ name: 'Sumire', relation: 'her rival' }] }])
    expect(match?.archetype).toBe('rival')
  })
})

describe('archetypeGuidance', () => {
  it('names both parties and quotes the authored source text, for every archetype', () => {
    for (const archetype of RELATIONSHIP_ARCHETYPES) {
      const match: ArchetypeMatch = { archetype, sourceText: 'a specific authored detail' }
      const line = archetypeGuidance(match, 'Aiko', 'Sumire')
      expect(line).toContain('Aiko')
      expect(line).toContain('Sumire')
      expect(line).toContain('a specific authored detail')
    }
  })

  it('the rival line explicitly disclaims romantic framing', () => {
    const line = archetypeGuidance({ archetype: 'rival', sourceText: 'x' }, 'Aiko', 'Sumire')
    expect(line.toLowerCase()).toContain('not a stand-in for romantic interest')
  })
})

describe('participantRelationshipGuidance', () => {
  it('gives a non-empty baseline even with no archetype authored — closing the "zero guidance" gap', () => {
    const line = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', primaryName: 'Sumire', warmth: 20 })
    expect(line.length).toBeGreaterThan(0)
    expect(line).toContain('Aiko')
    expect(line).not.toContain('{{')
  })

  it('never claims romantic warmth by default — explicitly steers away from it', () => {
    const line = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', primaryName: 'Sumire', warmth: 90 })
    expect(line.toLowerCase()).toContain("don't default to the same romantic warmth")
  })

  it('reflects the warmth tier in the baseline wording', () => {
    const low = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', warmth: 5 })
    const high = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', warmth: 95 })
    expect(low).toContain('still-forming')
    expect(high).toContain('comfortable closeness')
  })

  it('appends archetype-specific tone when a match is provided', () => {
    const withArchetype = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'rival', sourceText: 'childhood rival' },
      archetypeOtherName: 'Sumire',
    })
    const withoutArchetype = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', primaryName: 'Sumire', warmth: 40 })
    expect(withArchetype).toContain('rivalry')
    expect(withArchetype.length).toBeGreaterThan(withoutArchetype.length)
  })

  it('falls back to generic wording with no primaryName (a plain group chat with no bound primary)', () => {
    const line = participantRelationshipGuidance({ speakerName: 'Aiko', personaName: 'Kai', warmth: 50 })
    expect(line).toContain('the rest of the group')
  })

  it('never applies the rival commitment/jealousy deepening to a non-rival archetype', () => {
    const line = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'mentor_mentee', sourceText: 'her mentor' },
      primaryCommitmentStatus: 'married',
      jealousyFlagActive: true,
    })
    expect(line.toLowerCase()).not.toContain('exclusive')
    expect(line.toLowerCase()).not.toContain('genuinely standing right here')
  })

  it('layers the commitment framing onto a rival match when primaryCommitmentStatus is given', () => {
    const line = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'rival', sourceText: 'childhood rival' },
      primaryCommitmentStatus: 'exclusive',
    })
    expect(line).toContain('exclusive')
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
  })

  it('layers the jealousy intensifier onto a rival match when jealousyFlagActive is true', () => {
    const line = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'rival', sourceText: 'childhood rival' },
      jealousyFlagActive: true,
    })
    expect(line.toLowerCase()).toContain('genuinely standing right here')
    expect(line).toContain('Aiko')
  })

  it('rival deepening is additive: both fields present layers both lines', () => {
    const both = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'rival', sourceText: 'childhood rival' },
      primaryCommitmentStatus: 'married',
      jealousyFlagActive: true,
    })
    const neither = participantRelationshipGuidance({
      speakerName: 'Aiko',
      personaName: 'Kai',
      primaryName: 'Sumire',
      warmth: 40,
      archetype: { archetype: 'rival', sourceText: 'childhood rival' },
    })
    expect(both.length).toBeGreaterThan(neither.length)
    expect(both.toLowerCase()).toContain('married')
    expect(both.toLowerCase()).toContain('genuinely standing right here')
  })
})

describe('rivalCommitmentFraming', () => {
  it('returns empty for "none" or undefined — the base rival line already covers it', () => {
    expect(rivalCommitmentFraming('none', 'Sumire', 'Kai')).toBe('')
    expect(rivalCommitmentFraming(undefined, 'Sumire', 'Kai')).toBe('')
  })

  it('reads as still-open competition while merely dating', () => {
    const line = rivalCommitmentFraming('dating', 'Sumire', 'Kai')
    expect(line).toContain('Sumire')
    expect(line).toContain('Kai')
    expect(line.toLowerCase()).toContain('still-competing')
  })

  it('reads as a real boundary once exclusive', () => {
    const line = rivalCommitmentFraming('exclusive', 'Sumire', 'Kai')
    expect(line.toLowerCase()).toContain('exclusive')
    expect(line.toLowerCase()).toContain('boundary')
  })

  it('reads as history/begrudging respect once living together or married, naming which', () => {
    const livingTogether = rivalCommitmentFraming('living_together', 'Sumire', 'Kai')
    expect(livingTogether).toContain('living together')
    const married = rivalCommitmentFraming('married', 'Sumire', 'Kai')
    expect(married).toContain('married')
    expect(married.toLowerCase()).toContain('history')
  })

  it('is progressively different across the commitment ladder, not one static line', () => {
    const lines = new Set(
      (['dating', 'exclusive', 'living_together', 'married'] as const).map((s) => rivalCommitmentFraming(s, 'Sumire', 'Kai')),
    )
    expect(lines.size).toBe(4)
  })
})

describe('rivalJealousyIntensifier', () => {
  it('returns empty when the jealousy flag is not active', () => {
    expect(rivalJealousyIntensifier('Aiko', false)).toBe('')
    expect(rivalJealousyIntensifier('Aiko', undefined)).toBe('')
  })

  it('names the rival and emphasizes their live presence when the flag is active', () => {
    const line = rivalJealousyIntensifier('Aiko', true)
    expect(line).toContain('Aiko')
    expect(line.toLowerCase()).toContain('presence')
  })
})
