import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextRoundRobinSpeaker, parseMention, pickDirectorSpeaker, rosterFrom, type SceneRoster } from './scene'
import type { Character } from '@/lib/characters/cardSpec'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { ChatMessage } from '@/lib/prompt/builder'

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

describe('pickDirectorSpeaker', () => {
  const groupRoster: SceneRoster = [
    { id: 'a', name: 'Aria' },
    { id: 'b', name: 'Kestrel' },
  ]
  const history: ChatMessage[] = [{ id: '1', role: 'user', name: 'Kai', text: 'Hey Kestrel, you there?' }]

  function stubClient(reply: string): ChatBackend {
    return {
      generate: async () => reply,
      generateStream: async () => '',
      getEffectiveMaxContext: async () => 4096,
      tokenCount: async () => ({ count: 0 }),
      abort: async () => {},
      getChatTemplate: async () => null,
    }
  }

  it('returns the sole participant without calling the model when the roster has one or none', async () => {
    let called = false
    const client: ChatBackend = {
      generate: async () => {
        called = true
        return 'Aria'
      },
      generateStream: async () => '',
      getEffectiveMaxContext: async () => 4096,
      tokenCount: async () => ({ count: 0 }),
      abort: async () => {},
      getChatTemplate: async () => null,
    }
    expect(await pickDirectorSpeaker(client, { roster: [{ id: 'a', name: 'Aria' }], history, userName: 'Kai' })).toBe('a')
    expect(await pickDirectorSpeaker(client, { roster: [], history, userName: 'Kai' })).toBeUndefined()
    expect(called).toBe(false)
  })

  it('matches the model\'s exact name answer to the right id', async () => {
    expect(await pickDirectorSpeaker(stubClient('Kestrel'), { roster: groupRoster, history, userName: 'Kai' })).toBe('b')
  })

  it('loosely matches a name embedded in extra text', async () => {
    expect(await pickDirectorSpeaker(stubClient('I think Aria would respond.'), { roster: groupRoster, history, userName: 'Kai' })).toBe(
      'a',
    )
  })

  it('returns undefined when the answer names nobody in the roster', async () => {
    expect(await pickDirectorSpeaker(stubClient('Someone Else'), { roster: groupRoster, history, userName: 'Kai' })).toBeUndefined()
  })

  it('falls back to undefined on a thrown client error, rather than blocking the turn', async () => {
    const throwing: ChatBackend = {
      generate: async () => {
        throw new Error('offline')
      },
      generateStream: async () => '',
      getEffectiveMaxContext: async () => 4096,
      tokenCount: async () => ({ count: 0 }),
      abort: async () => {},
      getChatTemplate: async () => null,
    }
    expect(await pickDirectorSpeaker(throwing, { roster: groupRoster, history, userName: 'Kai' })).toBeUndefined()
  })

  describe('when the backend never responds', () => {
    // A hang here used to block the whole group-scene turn forever — nobody's reply could be
    // generated until this pick landed. `generateWithTimeout` bounds it to 45s, after which this
    // falls back to undefined (primary) the same as any other failure.
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('falls back to undefined after 45s instead of hanging forever', async () => {
      const hanging: ChatBackend = {
        generate: (_p, signal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
        generateStream: async () => '',
        getEffectiveMaxContext: async () => 4096,
        tokenCount: async () => ({ count: 0 }),
        abort: async () => {},
        getChatTemplate: async () => null,
      }
      const pending = pickDirectorSpeaker(hanging, { roster: groupRoster, history, userName: 'Kai' })
      const assertion = expect(pending).resolves.toBeUndefined()
      await vi.advanceTimersByTimeAsync(45_000)
      await assertion
    })
  })
})
