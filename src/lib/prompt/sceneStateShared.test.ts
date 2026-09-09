import { describe, expect, it } from 'vitest'
import { AROUSAL_BAND_PHRASE, arousalBandFor, BAND_FLOORS, type ArousalBand } from '@/lib/dating/arousal'
import { sceneStateBlock } from './sceneStateBlock'

// The band wording is shared between the prompt's scene-state block and the panel UI
// (`SceneStateCard`). These pin that: a band the model is told is "close to the edge" has to be
// labelled the same thing on screen, and the phrase table is the only thing keeping the two honest.

describe('AROUSAL_BAND_PHRASE', () => {
  it('covers every band, so no meter reading can render as undefined', () => {
    for (const band of ['baseline', 'warming', 'engaged', 'edge', 'over'] as ArousalBand[]) {
      expect(AROUSAL_BAND_PHRASE[band]).toBeTruthy()
    }
  })

  it('reads as prose rather than as the enum member', () => {
    expect(AROUSAL_BAND_PHRASE.edge).toBe('close to the edge')
    expect(AROUSAL_BAND_PHRASE.baseline).not.toBe('baseline')
  })

  it('is lowercase throughout, so the UI can sentence-case it and the prompt can inline it', () => {
    for (const phrase of Object.values(AROUSAL_BAND_PHRASE)) {
      expect(phrase[0]).toBe(phrase[0].toLowerCase())
    }
  })

  it('is what the prompt block actually renders, not a second copy of the wording', () => {
    const block = sceneStateBlock({ charName: 'Sumire', userName: 'Kai', arousalBand: 'engaged' })
    expect(block).toContain(`Sumire is ${AROUSAL_BAND_PHRASE.engaged}`)
  })

  it('describes a meter value the same way the engine bands it', () => {
    // The panel bands a raw value through `arousalBandFor` and then phrases it; the prompt is handed
    // the band directly. Both paths have to land on the same words for the same number.
    const value = BAND_FLOORS.edge + 1
    const phrase = AROUSAL_BAND_PHRASE[arousalBandFor(value)]
    expect(sceneStateBlock({ charName: 'Sumire', userName: 'Kai', arousalBand: arousalBandFor(value) })).toContain(phrase)
  })
})
