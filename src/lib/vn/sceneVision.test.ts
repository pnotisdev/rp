import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import {
  classifyAttachedImageScene,
  detectExpressionFromSprites,
  detectExpressionTextMismatch,
  detectGreetingScene,
  shortlistExpressions,
} from './sceneVision'

/** Never resolves or rejects on its own — only reacts to the caller's abort signal. */
function hangingClient(): KoboldClient {
  return {
    generate: (_p: unknown, signal?: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    getEffectiveMaxContext: async () => 4096,
  } as unknown as KoboldClient
}

/** Minimal stand-in: the two calls sceneVision actually makes on a client. */
function stubClient(reply: string, spy?: (params: Record<string, unknown>) => void): KoboldClient {
  return {
    generate: async (params: Record<string, unknown>) => {
      spy?.(params)
      return reply
    },
    getEffectiveMaxContext: async () => 4096,
  } as unknown as KoboldClient
}

const SPRITES = [
  { id: 'neutral', label: 'Neutral', base64: 'AAAA' },
  { id: 'angry', label: 'Angry', base64: 'BBBB' },
  { id: 'smitten', label: 'Smitten', base64: 'CCCC' },
]

describe('detectExpressionFromSprites', () => {
  it('returns a validated id when the model answers with JSON', async () => {
    const got = await detectExpressionFromSprites(stubClient('{"expression":"angry"}'), {
      charName: 'Sumire',
      replyText: 'Get away from me.',
      sprites: SPRITES,
    })
    expect(got).toBe('angry')
  })

  it('accepts a bare id answer', async () => {
    const got = await detectExpressionFromSprites(stubClient('smitten'), {
      charName: 'Sumire',
      replyText: 'You actually came.',
      sprites: SPRITES,
    })
    expect(got).toBe('smitten')
  })

  it('rejects an id that is not one of the sprites', async () => {
    const got = await detectExpressionFromSprites(stubClient('{"expression":"disgusted"}'), {
      charName: 'Sumire',
      replyText: 'Ugh.',
      sprites: SPRITES,
    })
    expect(got).toBeNull()
  })

  it('maps a 1-based index answer back through sprite order', async () => {
    // Vision models very often answer with the picture number instead of the label.
    expect(
      await detectExpressionFromSprites(stubClient('{"expression":"2"}'), { charName: 'X', replyText: 'No.', sprites: SPRITES }),
    ).toBe('angry')
    expect(
      await detectExpressionFromSprites(stubClient('Image 3'), { charName: 'X', replyText: 'Hi.', sprites: SPRITES }),
    ).toBe('smitten')
  })

  it('ignores an out-of-range index', async () => {
    const got = await detectExpressionFromSprites(stubClient('{"expression":"9"}'), {
      charName: 'X',
      replyText: 'Hm.',
      sprites: SPRITES,
    })
    expect(got).toBeNull()
  })

  it('an exact id match still wins over an index read', async () => {
    const sprites = [
      { id: 'neutral', label: 'Neutral', base64: 'A' },
      { id: '2', label: 'Two', base64: 'B' },
      { id: 'angry', label: 'Angry', base64: 'C' },
    ]
    // "2" is a real id here — must resolve to that sprite, not sprites[1] by index (also "2", so same result),
    // but the point is the id branch runs first.
    expect(await detectExpressionFromSprites(stubClient('{"expression":"2"}'), { charName: 'X', replyText: 'x', sprites })).toBe('2')
  })

  it('does not call the model with fewer than two sprites', async () => {
    let called = false
    const client = stubClient('neutral', () => {
      called = true
    })
    const got = await detectExpressionFromSprites(client, {
      charName: 'Sumire',
      replyText: 'Hi.',
      sprites: [SPRITES[0]],
    })
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('sends one image per sprite', async () => {
    let seen: unknown
    const client = stubClient('angry', (p) => {
      seen = p.images
    })
    await detectExpressionFromSprites(client, { charName: 'X', replyText: 'No.', sprites: SPRITES })
    expect(seen).toEqual(['AAAA', 'BBBB', 'CCCC'])
  })

  it('swallows a thrown client error and returns null', async () => {
    const client = {
      generate: async () => {
        throw new Error('vision offline')
      },
      getEffectiveMaxContext: async () => 4096,
    } as unknown as KoboldClient
    const got = await detectExpressionFromSprites(client, { charName: 'X', replyText: 'Hm.', sprites: SPRITES })
    expect(got).toBeNull()
  })

  it('prefers the longest matching id when several appear', async () => {
    const sprites = [
      { id: 'happy', label: 'Happy', base64: 'A' },
      { id: 'very-happy', label: 'Very happy', base64: 'B' },
    ]
    const got = await detectExpressionFromSprites(stubClient('she looks very-happy, not just happy'), {
      charName: 'X',
      replyText: 'Yes!',
      sprites,
    })
    expect(got).toBe('very-happy')
  })
})

describe('shortlistExpressions', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, label: `Expr ${i}` }))

  it('returns every id untouched when there are already few enough', async () => {
    let called = false
    const got = await shortlistExpressions(
      stubClient('["x"]', () => {
        called = true
      }),
      { charName: 'X', replyText: 'hi', candidates: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], limit: 6 },
    )
    expect(got).toEqual(['a', 'b'])
    expect(called).toBe(false)
  })

  it('narrows a long list to the model-picked ids', async () => {
    const got = await shortlistExpressions(stubClient('["e3","e7","e1","e9","e2","e0"]'), {
      charName: 'X',
      replyText: 'a long emotional line',
      candidates: many,
      limit: 6,
    })
    expect(got).toEqual(['e3', 'e7', 'e1', 'e9', 'e2', 'e0'])
  })

  it('always keeps the tagged guess in the running', async () => {
    const got = await shortlistExpressions(stubClient('["e3","e7","e1","e9","e2","e0"]'), {
      charName: 'X',
      replyText: 'line',
      candidates: many,
      taggedExpression: 'e5',
      limit: 6,
    })
    expect(got).toContain('e5')
    expect(got).toHaveLength(6)
  })

  it('falls back to tagged guess + head of list when the model output is unusable', async () => {
    const got = await shortlistExpressions(stubClient('not json at all'), {
      charName: 'X',
      replyText: 'line',
      candidates: many,
      taggedExpression: 'e8',
      limit: 4,
    })
    expect(got[0]).toBe('e8')
    expect(got).toHaveLength(4)
  })
})

describe('classifyAttachedImageScene', () => {
  it('returns validated background and mood', async () => {
    const got = await classifyAttachedImageScene(stubClient('{"background":"beach","mood":"cheerful"}'), {
      images: ['IMG'],
      backgroundIds: ['beach', 'cafe'],
      moodIds: ['cheerful', 'tense'],
    })
    expect(got).toEqual({ background: 'beach', mood: 'cheerful' })
  })

  it('drops values not in the allowed sets', async () => {
    const got = await classifyAttachedImageScene(stubClient('{"background":"mountain","mood":"cheerful"}'), {
      images: ['IMG'],
      backgroundIds: ['beach'],
      moodIds: ['cheerful'],
    })
    expect(got).toEqual({ mood: 'cheerful' })
  })

  it('returns empty when the model gives empty strings', async () => {
    const got = await classifyAttachedImageScene(stubClient('{"background":"","mood":""}'), {
      images: ['IMG'],
      backgroundIds: ['beach'],
      moodIds: ['cheerful'],
    })
    expect(got).toEqual({})
  })

  it('returns empty with no images and never calls the model', async () => {
    let called = false
    const got = await classifyAttachedImageScene(
      stubClient('{"background":"beach"}', () => {
        called = true
      }),
      { images: [], backgroundIds: ['beach'], moodIds: [] },
    )
    expect(got).toEqual({})
    expect(called).toBe(false)
  })

  it('caps at three images', async () => {
    let seen: string[] = []
    const client = stubClient('{"background":"","mood":""}', (p) => {
      seen = p.images as string[]
    })
    await classifyAttachedImageScene(client, {
      images: ['a', 'b', 'c', 'd', 'e'],
      backgroundIds: ['x'],
      moodIds: [],
    })
    expect(seen).toHaveLength(3)
  })
})

describe('detectGreetingScene', () => {
  const GREETING = 'She is at the usual table, second floor of the library, half behind a book.'

  it('returns validated expression and background', async () => {
    const got = await detectGreetingScene(stubClient('{"expression":"neutral","background":"classroom"}'), {
      text: GREETING,
      expressionIds: ['neutral', 'happy'],
      backgroundIds: ['classroom', 'cafe'],
    })
    expect(got).toEqual({ expression: 'neutral', background: 'classroom' })
  })

  it('drops values not in the allowed sets', async () => {
    const got = await detectGreetingScene(stubClient('{"expression":"smug","background":"library"}'), {
      text: GREETING,
      expressionIds: ['neutral'],
      backgroundIds: ['classroom'],
    })
    expect(got).toBeNull()
  })

  it('keeps whichever half validates when the other does not', async () => {
    const got = await detectGreetingScene(stubClient('{"expression":"neutral","background":"library"}'), {
      text: GREETING,
      expressionIds: ['neutral'],
      backgroundIds: ['classroom'],
    })
    expect(got).toEqual({ expression: 'neutral' })
  })

  it('returns null for empty greeting text and never calls the model', async () => {
    let called = false
    const got = await detectGreetingScene(
      stubClient('{"expression":"neutral"}', () => {
        called = true
      }),
      { text: '   ', expressionIds: ['neutral'], backgroundIds: ['classroom'] },
    )
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null with no expression or background ids offered and never calls the model', async () => {
    let called = false
    const got = await detectGreetingScene(
      stubClient('{"expression":"neutral"}', () => {
        called = true
      }),
      { text: GREETING, expressionIds: [], backgroundIds: [] },
    )
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null on unparseable output and on a thrown client error', async () => {
    expect(
      await detectGreetingScene(stubClient('just vibes, no json'), {
        text: GREETING,
        expressionIds: ['neutral'],
        backgroundIds: ['classroom'],
      }),
    ).toBeNull()
    const throwing = {
      generate: async () => {
        throw new Error('offline')
      },
      getEffectiveMaxContext: async () => 4096,
    } as unknown as KoboldClient
    expect(
      await detectGreetingScene(throwing, { text: GREETING, expressionIds: ['neutral'], backgroundIds: ['classroom'] }),
    ).toBeNull()
  })
})

describe('detectExpressionTextMismatch', () => {
  const CANDIDATES = [
    { id: 'blush', label: 'Blush' },
    { id: 'angry', label: 'Angry' },
    { id: 'happy', label: 'Happy' },
  ]

  it('a stale tag against clearly conflicting text: the classifier corrects it', async () => {
    // The exact scenario item 2 describes: the model wrote a scowl/slam-the-door beat but the tag
    // still says "blush" from an earlier, unrelated turn.
    const got = await detectExpressionTextMismatch(stubClient('{"expression":"angry"}'), {
      charName: 'Sumire',
      replyText: '*She scowls and slams the door behind her.* "Get out. Now."',
      taggedExpression: 'blush',
      candidates: CANDIDATES,
    })
    expect(got).toBe('angry')
  })

  it('text that genuinely matches the tag: no correction, even though the model was asked', async () => {
    const got = await detectExpressionTextMismatch(stubClient('{"expression":"blush"}'), {
      charName: 'Sumire',
      replyText: '*Her cheeks go pink.* "I-it\'s not like I was waiting for you."',
      taggedExpression: 'blush',
      candidates: CANDIDATES,
    })
    expect(got).toBeNull()
  })

  it('an id outside the candidate set is rejected, not passed through as a correction', async () => {
    const got = await detectExpressionTextMismatch(stubClient('{"expression":"disgusted"}'), {
      charName: 'X',
      replyText: 'Ugh, that smell.',
      taggedExpression: 'blush',
      candidates: CANDIDATES,
    })
    expect(got).toBeNull()
  })

  it('unparseable model output: fails open to no correction', async () => {
    const got = await detectExpressionTextMismatch(stubClient('just vibes, no json'), {
      charName: 'X',
      replyText: 'She looks away.',
      taggedExpression: 'blush',
      candidates: CANDIDATES,
    })
    expect(got).toBeNull()
  })

  it('a thrown client error fails open to no correction', async () => {
    const client = {
      generate: async () => {
        throw new Error('offline')
      },
      getEffectiveMaxContext: async () => 4096,
    } as unknown as KoboldClient
    expect(
      await detectExpressionTextMismatch(client, {
        charName: 'X',
        replyText: 'She looks away.',
        taggedExpression: 'blush',
        candidates: CANDIDATES,
      }),
    ).toBeNull()
  })

  it('does not call the model with fewer than two candidates — nothing to choose between', async () => {
    let called = false
    const got = await detectExpressionTextMismatch(
      stubClient('{"expression":"angry"}', () => {
        called = true
      }),
      { charName: 'X', replyText: 'She scowls.', taggedExpression: 'blush', candidates: [CANDIDATES[0]] },
    )
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('does not call the model with no tagged expression to check against', async () => {
    let called = false
    const got = await detectExpressionTextMismatch(
      stubClient('{"expression":"angry"}', () => {
        called = true
      }),
      { charName: 'X', replyText: 'She scowls.', taggedExpression: '', candidates: CANDIDATES },
    )
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('does not call the model with empty reply text', async () => {
    let called = false
    const got = await detectExpressionTextMismatch(
      stubClient('{"expression":"angry"}', () => {
        called = true
      }),
      { charName: 'X', replyText: '   ', taggedExpression: 'blush', candidates: CANDIDATES },
    )
    expect(got).toBeNull()
    expect(called).toBe(false)
  })

  it('falls back to null after 45s when the backend never responds', async () => {
    vi.useFakeTimers()
    try {
      const pending = detectExpressionTextMismatch(hangingClient(), {
        charName: 'X',
        replyText: 'She scowls and slams the door.',
        taggedExpression: 'blush',
        candidates: CANDIDATES,
      })
      const assertion = expect(pending).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(45_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('when the backend never responds', () => {
  // Every pass in this file is documented as a non-blocking backup (see the file header) — before
  // `generateWithTimeout` was wired in, a hang here meant the caller waited forever for what was
  // supposed to be a cheap, best-effort assist. Each one now falls back the same as any other
  // read/parse failure after 45s instead of hanging indefinitely.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('detectExpressionFromSprites falls back to null after 45s', async () => {
    const pending = detectExpressionFromSprites(hangingClient(), { charName: 'X', replyText: 'hi', sprites: SPRITES })
    const assertion = expect(pending).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('shortlistExpressions falls back to the head of the list after 45s', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, label: `Expr ${i}` }))
    const pending = shortlistExpressions(hangingClient(), { charName: 'X', replyText: 'a long line', candidates: many, limit: 6 })
    const assertion = expect(pending).resolves.toEqual(many.slice(0, 6).map((c) => c.id))
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('classifyAttachedImageScene falls back to {} after 45s', async () => {
    const pending = classifyAttachedImageScene(hangingClient(), { images: ['AAAA'], backgroundIds: ['beach'], moodIds: ['cheerful'] })
    const assertion = expect(pending).resolves.toEqual({})
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('detectGreetingScene falls back to null after 45s', async () => {
    const greeting = 'She is at the usual table, second floor of the library, half behind a book.'
    const pending = detectGreetingScene(hangingClient(), { text: greeting, expressionIds: ['neutral'], backgroundIds: ['classroom'] })
    const assertion = expect(pending).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })
})
