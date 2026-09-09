import { describe, expect, it } from 'vitest'
import { sceneStateBlock, type SceneStateFacts } from './sceneStateBlock'

const facts = (overrides: Partial<SceneStateFacts> = {}): SceneStateFacts => ({
  charName: 'Sumire',
  userName: 'Kai',
  ...overrides,
})

describe('sceneStateBlock', () => {
  it('contributes nothing when no concrete fact is known', () => {
    expect(sceneStateBlock(facts())).toBe('')
  })

  it('renders where and when on one line', () => {
    const block = sceneStateBlock(facts({ location: 'Bedroom', timePhase: 'Sunday night', day: 34 }))
    expect(block).toContain('Location: Bedroom, Sunday night, Day 34')
  })

  it('states what is physically happening, with how long it has been going', () => {
    const block = sceneStateBlock(facts({ activity: 'spooning, both on your sides', sceneTurns: 3 }))
    expect(block).toContain('Physically: spooning, both on your sides (turn 3 of this scene)')
  })

  it('leaves the turn count off a scene that just started', () => {
    expect(sceneStateBlock(facts({ activity: 'a slow kiss', sceneTurns: 0 }))).toContain('Physically: a slow kiss\n')
  })

  it('names both sides of the clothing state once anything has come off', () => {
    const block = sceneStateBlock(facts({ clothing: { char: ['outerwear', 'top', 'bottoms'] } }))
    expect(block).toContain('Clothing — Sumire: underwear only. Kai: dressed.')
  })

  it('says nothing about clothing while everyone is still dressed', () => {
    expect(sceneStateBlock(facts({ clothing: {}, activity: 'a slow kiss' }))).not.toContain('Clothing')
  })

  it('anchors what is in contact, in prose rather than enum spelling', () => {
    expect(sceneStateBlock(facts({ contactRegions: ['hips', 'inner_thigh'] }))).toContain('In contact: hips, inner thigh')
  })

  it('states the arousal band in words, and only for the character', () => {
    const block = sceneStateBlock(facts({ arousalBand: 'edge' }))
    expect(block).toContain('Sumire is close to the edge')
    expect(block).not.toContain('Kai is')
  })

  it('is headed and closes by telling the model not to contradict it', () => {
    const block = sceneStateBlock(facts({ location: 'Bedroom' }))
    expect(block.startsWith('[SCENE STATE]')).toBe(true)
    expect(block).toMatch(/Don't contradict any line above/)
  })

  it('never emits a macro — style guidance is not macro-substituted', () => {
    const block = sceneStateBlock(facts({ location: 'Bedroom', activity: 'a slow kiss', clothing: { char: ['top'] }, arousalBand: 'warming' }))
    expect(block).not.toContain('{{')
  })
})

describe('sceneStateBlock — a shared scene', () => {
  const base = { charName: 'Sumire', userName: 'You', activity: 'kissing her neck', turnNow: 9 }

  it('names who is actually in the room, so the per-person lines below mean something', () => {
    const block = sceneStateBlock({
      ...base,
      participants: [{ id: 'aoi', name: 'Aoi' }],
    })
    expect(block).toContain('Present: Sumire, Aoi, You')
  })

  it("states every participant's own clothing, so no side is left to guess at", () => {
    const block = sceneStateBlock({
      ...base,
      clothing: { char: ['top'] },
      participants: [{ id: 'aoi', name: 'Aoi', clothing: { char: ['bottoms'] } }],
    })
    expect(block).toContain('Sumire: top off')
    expect(block).toContain('Aoi: bottoms off')
  })

  it("states every participant's own band — asymmetry is a scene beat, not a rounding error", () => {
    const block = sceneStateBlock({
      ...base,
      arousalBand: 'edge',
      participants: [{ id: 'aoi', name: 'Aoi', arousalBand: 'warming' }],
    })
    expect(block).toContain('Sumire is close to the edge')
    expect(block).toContain('Aoi is warming up')
  })

  it('renders the contact graph, naming whose body each contact is on', () => {
    const block = sceneStateBlock({
      ...base,
      participants: [{ id: 'aoi', name: 'Aoi' }],
      contact: [
        { actor: 'player', target: 'aoi', region: 'hips', sinceTurn: 6 },
        { actor: 'aoi', target: 'sumire', region: 'chest', sinceTurn: 9 },
      ],
    })
    expect(block).toContain("In contact: You touching Aoi's hips (3 turns), Aoi touching Sumire's chest")
  })

  it('prefers the graph over the flat region list, which cannot say whose body it means', () => {
    const block = sceneStateBlock({
      ...base,
      contactRegions: ['neck'],
      contact: [{ actor: 'player', target: 'sumire', region: 'hips', sinceTurn: 9 }],
    })
    expect(block).toContain("You touching Sumire's hips")
    expect(block).not.toContain('In contact: neck')
  })

  it('still renders the two-party form with no participants, unchanged', () => {
    const block = sceneStateBlock({ ...base, clothing: { char: ['top'] }, contactRegions: ['neck'], arousalBand: 'warming' })
    expect(block).not.toContain('Present:')
    expect(block).toContain('In contact: neck')
    expect(block).toContain('Sumire is warming up')
  })
})
