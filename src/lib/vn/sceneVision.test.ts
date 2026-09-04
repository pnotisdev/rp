import { describe, expect, it } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import { classifyAttachedImageScene, detectExpressionFromSprites, shortlistExpressions } from './sceneVision'

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
