import { describe, expect, it } from 'vitest'
import {
  applyClothingRemovals,
  CLOTHING_LAYERS,
  describeClothingSide,
  isRemoved,
  LAYER_WORDS,
  parseClothingRemovals,
  removedLayers,
} from './clothing'

describe('parseClothingRemovals', () => {
  it('accepts well-formed entries for either side', () => {
    expect(parseClothingRemovals([{ who: 'char', layer: 'top' }, { who: 'user', layer: 'shoes' }])).toEqual([
      { who: 'char', layer: 'top' },
      { who: 'user', layer: 'shoes' },
    ])
  })

  it('drops an unknown side, an unknown layer, and anything that is not an object', () => {
    expect(
      parseClothingRemovals([
        { who: 'someone', layer: 'top' },
        { who: 'char', layer: 'cape' },
        'top',
        null,
        { who: 'char' },
      ]),
    ).toEqual([])
  })

  it('de-duplicates the same side-and-layer named twice', () => {
    expect(parseClothingRemovals([{ who: 'char', layer: 'top' }, { who: 'char', layer: 'top' }])).toHaveLength(1)
  })

  it('returns [] for a non-array, rather than throwing', () => {
    expect(parseClothingRemovals(undefined)).toEqual([])
    expect(parseClothingRemovals('top')).toEqual([])
  })
})

describe('applyClothingRemovals', () => {
  it('accumulates across turns without duplicating a layer already off', () => {
    const first = applyClothingRemovals(undefined, [{ who: 'char', layer: 'top' }])
    const second = applyClothingRemovals(first, [{ who: 'char', layer: 'top' }, { who: 'char', layer: 'bottoms' }])
    expect(removedLayers(second, 'char')).toEqual(['top', 'bottoms'])
  })

  it('keeps the two sides independent', () => {
    const state = applyClothingRemovals(undefined, [{ who: 'user', layer: 'top' }])
    expect(isRemoved(state, 'user', 'top')).toBe(true)
    expect(isRemoved(state, 'char', 'top')).toBe(false)
  })

  it('returns the state untouched when nothing came off', () => {
    const state = applyClothingRemovals(undefined, [{ who: 'char', layer: 'top' }])
    expect(applyClothingRemovals(state, [])).toBe(state)
  })
})

describe('describeClothingSide', () => {
  it('reads as dressed before anything comes off', () => {
    expect(describeClothingSide(undefined, 'char')).toBe('dressed')
  })

  it('names what is off partway through', () => {
    expect(describeClothingSide({ char: ['top'] }, 'char')).toBe('top off')
  })

  it('collapses to "underwear only" when that is all that is left', () => {
    expect(describeClothingSide({ char: ['outerwear', 'top', 'bottoms'] }, 'char')).toBe('underwear only')
  })

  it('collapses to "undressed" once everything that matters is off, shoes or not', () => {
    expect(describeClothingSide({ char: ['outerwear', 'top', 'bottoms', 'underwear'] }, 'char')).toBe('undressed')
  })
})

describe('LAYER_WORDS', () => {
  it('gives every layer at least one word the judge and the guard can both match on', () => {
    expect(CLOTHING_LAYERS.every((layer) => LAYER_WORDS[layer].length > 0)).toBe(true)
  })
})
