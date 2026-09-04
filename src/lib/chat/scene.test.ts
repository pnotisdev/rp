import { describe, expect, it } from 'vitest'
import { nextRoundRobinSpeaker, parseMention, rosterFrom, type SceneRoster } from './scene'
import type { Character } from '@/lib/characters/cardSpec'

const roster: SceneRoster = [
  { id: 'a', name: 'Aria' },
  { id: 'b', name: 'Kestrel' },
  { id: 'c', name: 'Aria Kestrel' },
]

describe('nextRoundRobinSpeaker', () => {
  it('starts at index 0 when no index is stored yet', () => {
    expect(nextRoundRobinSpeaker(roster, undefined)).toEqual({ id: 'a', nextIndex: 1 })
  })

  it('advances one at a time and wraps back to 0', () => {
    expect(nextRoundRobinSpeaker(roster, 1)).toEqual({ id: 'b', nextIndex: 2 })
    expect(nextRoundRobinSpeaker(roster, 2)).toEqual({ id: 'c', nextIndex: 0 })
  })

  it('clamps a stale index the roster has since outgrown (a participant removed)', () => {
    // Index 5 no longer exists in a 3-person roster — modulo, not a crash or an undefined pick.
    expect(nextRoundRobinSpeaker(roster, 5)).toEqual({ id: 'c', nextIndex: 0 })
  })

  it('returns undefined for an empty roster rather than throwing', () => {
    expect(nextRoundRobinSpeaker([], 0)).toBeUndefined()
  })
})

describe('parseMention', () => {
  it('finds a plain @Name mention', () => {
    expect(parseMention('Hey @Kestrel, what do you think?', roster)).toEqual({ id: 'b', name: 'Kestrel' })
  })

  it('prefers the longer name when one is a prefix of another', () => {
    expect(parseMention('@Aria Kestrel, over here', roster)).toEqual({ id: 'c', name: 'Aria Kestrel' })
    expect(parseMention('@Aria, over here', roster)).toEqual({ id: 'a', name: 'Aria' })
  })

  it('is case-insensitive', () => {
    expect(parseMention('@ARIA hello', roster)).toEqual({ id: 'a', name: 'Aria' })
  })

  it('does not match a name embedded in a longer word', () => {
    expect(parseMention('@Ariadne is not here', roster)).toBeUndefined()
  })

  it('returns undefined when nothing is mentioned', () => {
    expect(parseMention('just talking to everyone', roster)).toBeUndefined()
  })
})

describe('rosterFrom', () => {
  const char = (id: string, name: string) => ({ id, card: { name } }) as Character

  it('puts the primary first, then participants in order', () => {
    expect(rosterFrom(char('p', 'Primary'), [char('x', 'X'), char('y', 'Y')])).toEqual([
      { id: 'p', name: 'Primary' },
      { id: 'x', name: 'X' },
      { id: 'y', name: 'Y' },
    ])
  })

  it('handles no primary (falls back to just participants)', () => {
    expect(rosterFrom(undefined, [char('x', 'X')])).toEqual([{ id: 'x', name: 'X' }])
  })
})
