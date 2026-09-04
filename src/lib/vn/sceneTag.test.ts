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
