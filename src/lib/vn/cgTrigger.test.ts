import { describe, expect, it } from 'vitest'
import { triggeredCg } from './cgTrigger'
import type { GalleryEntry } from '@/lib/characters/cardSpec'

function entry(overrides: Partial<GalleryEntry> = {}): GalleryEntry {
  return { id: 'cg1', title: 'Test CG', imageUrl: 'x.png', unlockAffection: 0, ...overrides }
}

describe('triggeredCg', () => {
  it('returns undefined with no gallery', () => {
    expect(triggeredCg(undefined, { affection: 100, sceneFlags: [] })).toBeUndefined()
  })

  it('returns undefined when nothing has an autoTrigger', () => {
    expect(triggeredCg([entry()], { affection: 100, sceneFlags: [] })).toBeUndefined()
  })

  it('fires an intimacyPhase trigger only on the matching phase', () => {
    const gallery = [entry({ autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], intimacyPhase: 'peak' })?.id).toBe('cg1')
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], intimacyPhase: 'building' })).toBeUndefined()
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [] })).toBeUndefined()
  })

  it('fires a catalogAction trigger only on the matching option id', () => {
    const gallery = [entry({ autoTrigger: { kind: 'catalogAction', optionId: 'toy-vibrator' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], lastCatalogActionId: 'toy-vibrator' })?.id).toBe('cg1')
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], lastCatalogActionId: 'toy-ice' })).toBeUndefined()
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [] })).toBeUndefined()
  })

  it('fires a sceneFlag trigger only when the flag is present', () => {
    const gallery = [entry({ autoTrigger: { kind: 'sceneFlag', flag: 'first_kiss' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: ['first_kiss'] })?.id).toBe('cg1')
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [] })).toBeUndefined()
  })

  it('fires a relationshipStage trigger only on the matching stage', () => {
    const gallery = [entry({ autoTrigger: { kind: 'relationshipStage', stage: 'sweethearts' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], relationshipStage: 'sweethearts' })?.id).toBe('cg1')
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], relationshipStage: 'close' })).toBeUndefined()
  })

  it('still gates on unlockAffection even when the trigger condition fires', () => {
    const gallery = [entry({ unlockAffection: 80, autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } })]
    expect(triggeredCg(gallery, { affection: 50, sceneFlags: [], intimacyPhase: 'peak' })).toBeUndefined()
    expect(triggeredCg(gallery, { affection: 80, sceneFlags: [], intimacyPhase: 'peak' })).toBeDefined()
  })

  it('still gates on requiredFlags even when the trigger condition fires', () => {
    const gallery = [entry({ requiredFlags: ['exclusive'], autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], intimacyPhase: 'peak' })).toBeUndefined()
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: ['exclusive'], intimacyPhase: 'peak' })).toBeDefined()
  })

  it('never auto-triggers an isEnding entry, even with a firing condition', () => {
    const gallery = [entry({ isEnding: true, autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } })]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], intimacyPhase: 'peak' })).toBeUndefined()
  })

  it('picks the first firing entry in authored order when more than one would match', () => {
    const gallery = [
      entry({ id: 'first', autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } }),
      entry({ id: 'second', autoTrigger: { kind: 'intimacyPhase', phase: 'peak' } }),
    ]
    expect(triggeredCg(gallery, { affection: 0, sceneFlags: [], intimacyPhase: 'peak' })?.id).toBe('first')
  })
})
