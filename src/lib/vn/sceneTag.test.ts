import { describe, expect, it } from 'vitest'
import { buildSceneInstruction, extractSceneTag } from '@/lib/vn/sceneTag'

describe('extractSceneTag', () => {
  it('parses expression, background and mood from a complete tag', () => {
    const { text, scene } = extractSceneTag('Hello there.\n<<scene:expression=happy,background=cafe,mood=cheerful>>')
    expect(text).toBe('Hello there.')
    expect(scene).toEqual({ expression: 'happy', background: 'cafe', mood: 'cheerful' })
  })

  it('still parses a legacy tag with no mood', () => {
    const { scene } = extractSceneTag('Hi.\n<<scene:expression=sad,background=park>>')
    expect(scene).toEqual({ expression: 'sad', background: 'park' })
  })

  it('parses a mood-only tag', () => {
    const { text, scene } = extractSceneTag('The room goes quiet.\n<<scene:mood=somber>>')
    expect(text).toBe('The room goes quiet.')
    expect(scene).toEqual({ mood: 'somber' })
  })

  it('lower-cases tag values', () => {
    expect(extractSceneTag('X\n<<scene:mood=Tender>>').scene).toEqual({ mood: 'tender' })
  })

  // `useChatSession.ts`'s `runGeneration` treats an empty `text` here (once `cleanModelOutput`,
  // itself a no-op on '', runs over it too) as a real generation failure rather than a successful
  // empty reply — see its `isUsableReply` check. A model occasionally emits nothing but the tag
  // with no dialogue at all; this is the exact shape that scenario reduces to.
  it('returns empty text when the model emits nothing but the scene tag', () => {
    const { text, scene } = extractSceneTag('<<scene:expression=blush,background=school-hallway>>')
    expect(text).toBe('')
    expect(scene).toEqual({ expression: 'blush', background: 'school-hallway' })
  })

  // Seen live: a model emitting one tag mid-reply (still followed by real dialogue) and a second
  // one at the very end, rather than exactly one trailing tag as `buildSceneInstruction` asks for.
  // Before this was handled, the mid-reply tag survived `extractSceneTag` untouched (its own match
  // is anchored to end-of-string) and `cleanModelOutput`'s later HTML-tag cleanup then mangled it —
  // stripping the inside but leaving the outer angle brackets, reducing a real reply to literally
  // `"<>"`. Both tags must come out, and the LAST one's values are what actually get used, on the
  // reasoning that a tag the model updates partway through is meant to reflect its final state.
  it('strips every scene tag when the model emits more than one, using the last for the actual scene', () => {
    const { text, scene } = extractSceneTag(
      '<<scene:expression=neutral,background=living-room>>\n' +
        'Sumire: "Five minutes." Her voice is flat.\n' +
        '<<scene:expression=annoyed,background=kitchen>>\n' +
        'Sumire: She goes to put the kettle on.',
    )
    expect(text).not.toContain('<')
    expect(text).not.toContain('>')
    expect(text).toContain('Five minutes')
    expect(text).toContain('kettle')
    expect(scene).toEqual({ expression: 'annoyed', background: 'kitchen' })
  })

  it('still returns the single tag correctly when there is only one, even mid-text rather than trailing', () => {
    const { text, scene } = extractSceneTag('<<scene:expression=happy,background=cafe>>\nShe smiles.')
    expect(text).toBe('She smiles.')
    expect(scene).toEqual({ expression: 'happy', background: 'cafe' })
  })
})

describe('buildSceneInstruction', () => {
  it('returns nothing when there are no expressions or backgrounds', () => {
    expect(buildSceneInstruction({ expressionIds: [], backgroundIds: [] })).toBe('')
  })

  it('omits the mood field entirely when no moodIds are passed', () => {
    const out = buildSceneInstruction({ expressionIds: ['happy'], backgroundIds: ['cafe'] })
    expect(out).toContain('<<scene:expression=ID,background=ID>>')
    expect(out).not.toContain('mood')
  })

  it('adds the mood field and its valid-id list when moodIds are passed', () => {
    const out = buildSceneInstruction({
      expressionIds: ['happy'],
      backgroundIds: ['cafe'],
      moodIds: ['tender', 'tense'],
    })
    expect(out).toContain('<<scene:expression=ID,background=ID,mood=ID>>')
    expect(out).toContain('Valid mood IDs: tender, tense')
  })

  it('does not add the mood field for an empty moodIds array', () => {
    const out = buildSceneInstruction({ expressionIds: ['happy'], backgroundIds: [], moodIds: [] })
    expect(out).not.toContain('mood')
  })
})

describe('scene tag — outfits', () => {
  it('parses an outfit field', () => {
    const { scene } = extractSceneTag('Hey.\n<<scene:expression=blush,background=beach,outfit=swimsuit>>')
    expect(scene?.outfit).toBe('swimsuit')
    expect(scene?.expression).toBe('blush')
  })

  it('leaves outfit unset when the tag omits it, so nothing changes by default', () => {
    const { scene } = extractSceneTag('Hey.\n<<scene:expression=blush,background=beach>>')
    expect(scene?.outfit).toBeUndefined()
  })

  it('still strips the tag from the text when an outfit is present', () => {
    const { text } = extractSceneTag('Hey.\n<<scene:expression=blush,outfit=swimsuit>>')
    expect(text).toBe('Hey.')
  })

  it('omits the outfit field entirely for a character with only base art', () => {
    const out = buildSceneInstruction({ expressionIds: ['neutral'], backgroundIds: ['cafe'] })
    expect(out).not.toContain('outfit')
    expect(out).toContain('<<scene:expression=ID,background=ID>>')
  })

  it('omits the outfit field when base is the only selectable outfit', () => {
    // One id is no choice at all — not worth the prompt tokens.
    const out = buildSceneInstruction({ expressionIds: ['neutral'], backgroundIds: ['cafe'], outfitIds: ['base'] })
    expect(out).not.toContain('outfit')
  })

  it('offers the outfit field once there is a real choice', () => {
    const out = buildSceneInstruction({
      expressionIds: ['neutral'],
      backgroundIds: ['cafe'],
      outfitIds: ['base', 'swimsuit'],
      currentOutfitId: 'base',
    })
    expect(out).toContain('<<scene:expression=ID,background=ID,outfit=ID>>')
    expect(out).toContain('Valid outfit IDs: base, swimsuit')
    expect(out).toContain('currently wearing "base"')
  })

  it('composes correctly with mood', () => {
    const out = buildSceneInstruction({
      expressionIds: ['neutral'],
      backgroundIds: ['cafe'],
      moodIds: ['calm'],
      outfitIds: ['base', 'swimsuit'],
      currentOutfitId: 'swimsuit',
    })
    expect(out).toContain('<<scene:expression=ID,background=ID,mood=ID,outfit=ID>>')
    expect(out).toContain('currently wearing "swimsuit"')
  })
})
