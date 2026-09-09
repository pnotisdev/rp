import { describe, expect, it } from 'vitest'
import {
  vnDialogueBalanceGuidance,
  vnExpressionGuidance,
  vnInteriorityGuidance,
  vnProseGuidance,
  vnProseNote,
  vnSoundGuidance,
} from './vnProse'

describe('vnProseNote', () => {
  it('contributes nothing at all when the scene is not being presented as a visual novel', () => {
    expect(vnProseNote(false, 'Sumire', 'Kai')).toBe('')
  })

  it('carries every craft note once VN mode is presenting the scene', () => {
    const note = vnProseNote(true, 'Sumire', 'Kai')
    expect(note).toContain('dialogue box')
    expect(note).toContain('largest thing on screen')
    expect(note).toContain('Lead with what Sumire actually says')
    expect(note).toContain('Sound carries')
    expect(note).toContain('reading')
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(vnProseNote(true, 'Sumire', 'Kai')).not.toContain('{{')
  })

  it('names both the character and the player throughout', () => {
    const note = vnProseNote(true, 'Sumire', 'Kai')
    expect(note).toContain('Sumire')
    expect(note).toContain('Kai')
  })

  it('folds the mood into the expression note when one is known', () => {
    expect(vnProseNote(true, 'Sumire', 'Kai', 'guarded')).toContain('guarded')
    expect(vnProseNote(true, 'Sumire', 'Kai')).not.toContain('underneath this')
  })
})

describe('vnProseGuidance', () => {
  it('asks for one beat and a stopping point, not a paragraph', () => {
    const line = vnProseGuidance('Sumire', 'Kai')
    expect(line).toContain('one beat')
    expect(line).toContain('4 sentences or fewer')
    expect(line).toContain('still has something to answer')
  })

  it('holds the camera still, which is the constraint a fixed background actually imposes', () => {
    const line = vnProseGuidance('Sumire', 'Kai')
    expect(line).toContain('camera does not move')
    expect(line).toContain('establishing shot')
  })

  it('tells it to stop re-describing a room the background already shows', () => {
    expect(vnProseGuidance('Sumire', 'Kai')).toContain('background already says where this is')
  })
})

describe('vnExpressionGuidance', () => {
  it('asks for a change of expression rather than a named feeling', () => {
    const line = vnExpressionGuidance('Sumire')
    expect(line).toContain('Let it move')
    expect(line).toContain('naming the feeling behind it')
  })

  it('warns against holding one look for a whole conversation', () => {
    expect(vnExpressionGuidance('Sumire')).toContain('static image')
  })

  it('adds nothing about mood when none is known', () => {
    expect(vnExpressionGuidance('Sumire')).not.toContain('underneath this')
  })
})

describe('the remaining craft notes', () => {
  it('weights dialogue over narration, and allows a deliberate silence', () => {
    const line = vnDialogueBalanceGuidance('Sumire')
    expect(line).toContain('Lead with what Sumire actually says')
    expect(line).toContain('deliberately said nothing')
  })

  it('asks for a specific sound rather than an adjective about atmosphere', () => {
    expect(vnSoundGuidance()).toContain('adjective about atmosphere')
  })

  it("keeps interiority on the character's side and leaves the player's to the player", () => {
    const line = vnInteriorityGuidance('Sumire', 'Kai')
    expect(line).toContain("Sumire's inner life is on the page")
    // The genuinely useful instruction here, and better than "add inner thoughts".
    expect(line).toContain('Being wrong about Kai')
  })
})
