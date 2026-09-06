import { describe, expect, it } from 'vitest'
import { boundaryPhraseCrossed, detectAnyBoundaryCrossing, detectBoundaryCrossing, personaBoundaryPhrases } from './boundaryGuard'

describe('boundaryPhraseCrossed', () => {
  it('matches an on-the-nose crossing of a short boundary phrase', () => {
    expect(boundaryPhraseCrossed('no knife play', 'She draws the knife slowly across his skin, playing with the edge.')).toBe(true)
  })

  it('does not match ordinary text unrelated to the boundary', () => {
    expect(boundaryPhraseCrossed('no knife play', 'They share a quiet coffee and talk about her thesis.')).toBe(false)
  })

  it('requires a majority of significant words for a longer phrase, not just any one word', () => {
    // Only "handcuffs" appears; "silk" and "wrists" don't - below the 75% bar for a 3-word phrase.
    expect(boundaryPhraseCrossed('silk wrist restraints', 'He clicks the handcuffs shut around her arms.')).toBe(false)
  })

  it('matches a longer phrase when most of its significant words are present', () => {
    expect(boundaryPhraseCrossed('hates being called cute', 'He knows she hates being called cute, but he does it anyway.')).toBe(true)
  })

  it('treats a boundary with no significant words as never matching', () => {
    expect(boundaryPhraseCrossed('no, not that', 'Anything at all could be written here.')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(boundaryPhraseCrossed('NO KNIFE PLAY', 'the knife traces slowly along the skin, playing')).toBe(true)
  })
})

describe('detectBoundaryCrossing', () => {
  it('returns undefined with no authored boundaries', () => {
    expect(detectBoundaryCrossing(undefined, 'anything goes here')).toBeUndefined()
    expect(detectBoundaryCrossing([], 'anything goes here')).toBeUndefined()
  })

  it('returns undefined for an empty reply', () => {
    expect(detectBoundaryCrossing(['no knife play'], '   ')).toBeUndefined()
  })

  it('returns the first boundary phrase that matches', () => {
    const boundaries = ['no knife play', 'hates being called cute']
    expect(detectBoundaryCrossing(boundaries, 'He knows she hates being called cute, but he does it anyway.')).toBe('hates being called cute')
  })

  it('returns undefined when nothing in the reply crosses any boundary', () => {
    const boundaries = ['no knife play', 'hates being called cute']
    expect(detectBoundaryCrossing(boundaries, 'They walk along the river at sunset, holding hands.')).toBeUndefined()
  })
})

describe('personaBoundaryPhrases', () => {
  it('extracts sentences that read as a stated limit', () => {
    const description = "I'm a grad student who loves hiking. I don't like being called pet names. My favorite color is green."
    expect(personaBoundaryPhrases(description)).toEqual(["I don't like being called pet names."])
  })

  it('extracts more than one limit sentence when several are present', () => {
    const description = "I never talk about my ex. I hate surprise parties. Nice to meet you."
    expect(personaBoundaryPhrases(description)).toEqual(['I never talk about my ex.', 'I hate surprise parties.'])
  })

  it('is empty for an ordinary bio with no stated limit', () => {
    expect(personaBoundaryPhrases('A quiet architecture student who likes tea and old buildings.')).toEqual([])
  })

  it('is empty for no description', () => {
    expect(personaBoundaryPhrases(undefined)).toEqual([])
    expect(personaBoundaryPhrases('   ')).toEqual([])
  })
})

describe('detectAnyBoundaryCrossing', () => {
  it('checks character boundaries first, same result as detectBoundaryCrossing alone', () => {
    const result = detectAnyBoundaryCrossing(['hates being called cute'], undefined, 'He knows she hates being called cute, but does it anyway.')
    expect(result).toBe('hates being called cute')
  })

  it('falls back to a persona-description limit when the character has none crossed', () => {
    const result = detectAnyBoundaryCrossing(
      ['hates being called cute'],
      'I never do knife play.',
      'She grabs a knife and wants to play with it against his skin.',
    )
    expect(result).toBe('I never do knife play.')
  })

  it('is undefined when neither source is crossed', () => {
    expect(
      detectAnyBoundaryCrossing(['hates being called cute'], 'I never do knife play.', 'They walk along the river at sunset.'),
    ).toBeUndefined()
  })
})
