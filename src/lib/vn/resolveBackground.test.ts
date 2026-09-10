import { describe, expect, it } from 'vitest'
import { resolveSceneBackground } from './resolveBackground'
import type { Chat, WorldCard } from '@/lib/types'

const chat = (patch: Partial<Chat> = {}): Chat => ({ id: 'c1', characterId: 'ch1', personaId: 'p1', title: 'T', ...patch }) as Chat
const world = (patch: Partial<WorldCard> = {}): WorldCard => ({ id: 'w1', name: 'W', ...patch }) as WorldCard

describe('resolveSceneBackground', () => {
  it('uses the tagged background first, with its uploaded art', () => {
    const out = resolveSceneBackground({
      taggedBackground: 'cafe',
      chat: chat(),
      world: world({ backgrounds: { cafe: 'blob:cafe.png' } }),
      affection: 0,
    })
    expect(out).toEqual({ id: 'cafe', url: 'blob:cafe.png', source: 'tag' })
  })

  it('prefers night art when the world clock is dark', () => {
    const out = resolveSceneBackground({
      taggedBackground: 'park',
      chat: chat(),
      world: world({ backgrounds: { park: 'day.png' }, backgroundsNight: { park: 'night.png' } }),
      affection: 0,
      night: true,
    })
    expect(out.url).toBe('night.png')
  })

  it("falls back to an active event's own location when nothing is tagged", () => {
    const out = resolveSceneBackground({
      chat: chat({ activeEvent: { id: 'e', kind: 'date', title: 'Aquarium', backgroundId: 'beach' } as Chat['activeEvent'] }),
      world: world(),
      affection: 0,
    })
    expect(out).toMatchObject({ id: 'beach', source: 'event' })
  })

  it("reads the chat's established scene location before guessing from prose", () => {
    const out = resolveSceneBackground({
      chat: chat({ scene: { turnPolicy: 'manual', location: 'Library' } as Chat['scene'] }),
      world: world(),
      affection: 0,
      narration: 'She is standing on the beach.',
    })
    expect(out).toMatchObject({ id: 'library', source: 'location' })
  })

  // The bug this whole module exists for: an opening greeting carries no scene tag at all, so
  // before this the stage rendered an unplaced void on a chat's first messages.
  it('reads the narration itself when there is no tag, event or established location', () => {
    const out = resolveSceneBackground({
      chat: chat(),
      world: world(),
      affection: 0,
      narration: 'The classroom is empty by the time you get there, the last of the light going orange.',
    })
    expect(out).toMatchObject({ id: 'classroom', source: 'text' })
  })

  it('recognises a place by an alias the prose actually uses, not just its formal label', () => {
    const out = resolveSceneBackground({
      chat: chat(),
      world: world(),
      affection: 0,
      narration: 'She is waiting by the lockers, bag over one shoulder.',
    })
    expect(out).toMatchObject({ id: 'school-hallway', source: 'text' })
  })

  it("uses the world's own opening shot when the prose places nothing", () => {
    const out = resolveSceneBackground({
      chat: chat(),
      world: world({ defaultBackgroundId: 'shrine', backgrounds: { shrine: 'shrine.png' } }),
      affection: 0,
      narration: 'A spaceship drifts silently through the void.',
    })
    expect(out).toEqual({ id: 'shrine', url: 'shrine.png', source: 'world-default' })
  })

  it('paints a still-locked tag as a place but never hands over its art', () => {
    const out = resolveSceneBackground({
      taggedBackground: 'bedroom',
      chat: chat(),
      world: world({ backgrounds: { bedroom: 'secret.png' }, backgroundUnlocks: { bedroom: 60 } }),
      affection: 10,
    })
    expect(out).toEqual({ id: 'bedroom', source: 'locked-tag' })
  })

  it('reports no place at all rather than guessing when nothing anywhere suggests one', () => {
    const out = resolveSceneBackground({ chat: chat(), world: world(), affection: 0, narration: 'Nothing here.' })
    expect(out).toEqual({ source: 'none' })
  })

  // `getUnlockedBackgroundIds` narrows to a world's own uploaded ids, but the built-in locations are
  // still real places to recognise in prose — they just render as lighting rather than a photo.
  it('still recognises a built-in location in a world that has uploaded art of its own', () => {
    const out = resolveSceneBackground({
      chat: chat(),
      world: world({ backgrounds: { 'her-bookshop': 'shop.png' } }),
      affection: 0,
      narration: 'They sit together in the park at dusk.',
    })
    expect(out).toMatchObject({ id: 'park', source: 'text' })
    expect(out.url).toBeUndefined()
  })
})
