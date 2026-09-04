import { describe, expect, it } from 'vitest'
import { resolveBgmTrack } from '@/lib/audio/bgm'
import type { WorldCard } from '@/lib/types'

const world = (music?: Record<string, string>): WorldCard =>
  ({ id: 'w', name: 'W', description: '', lorebook: { entries: [] }, music, createdAt: 0, updatedAt: 0 }) as WorldCard

describe('resolveBgmTrack', () => {
  it('returns undefined when the world has no music at all', () => {
    expect(resolveBgmTrack(world(), { mood: 'tender' })).toBeUndefined()
    expect(resolveBgmTrack(undefined, { mood: 'tender' })).toBeUndefined()
    expect(resolveBgmTrack(world({}), { mood: 'tender' })).toBeUndefined()
  })

  it('prefers a track for the exact mood the model tagged', () => {
    const w = world({ tender: '/t.mp3', default: '/d.mp3' })
    expect(resolveBgmTrack(w, { mood: 'tender' })).toBe('/t.mp3')
  })

  it('falls back to the location-implied mood when no mood was tagged', () => {
    const w = world({ tender: '/t.mp3', default: '/d.mp3' })
    // bedroom -> tender in the fallback map
    expect(resolveBgmTrack(w, { background: 'bedroom' })).toBe('/t.mp3')
  })

  it('falls back to the default track when the tagged mood has no track', () => {
    const w = world({ default: '/d.mp3' })
    expect(resolveBgmTrack(w, { mood: 'tense' })).toBe('/d.mp3')
  })

  it('falls back to the default track when there is no scene at all', () => {
    expect(resolveBgmTrack(world({ default: '/d.mp3' }), undefined)).toBe('/d.mp3')
  })

  it('ignores an unknown mood string and uses the default', () => {
    const w = world({ default: '/d.mp3', tender: '/t.mp3' })
    expect(resolveBgmTrack(w, { mood: 'apocalyptic' })).toBe('/d.mp3')
  })

  it('returns undefined when only mood-specific tracks exist and none match', () => {
    const w = world({ tense: '/x.mp3' })
    expect(resolveBgmTrack(w, { mood: 'tender', background: 'classroom' })).toBeUndefined()
  })
})
