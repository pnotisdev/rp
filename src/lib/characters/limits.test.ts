import { describe, expect, it } from 'vitest'
import { statedLimits } from './limits'

describe('statedLimits', () => {
  it('reads a list of hard limits', () => {
    expect(statedLimits('Hard limits: bondage, anal and bodily fluids.').kinks).toEqual(['bondage', 'anal', 'bodily_fluids'])
    expect(statedLimits('Off-limits: degradation').kinks).toEqual(['degradation'])
  })

  it('reads a plain refusal', () => {
    expect(statedLimits('She is shy. No anal. Likes praise.').kinks).toEqual(['anal'])
    expect(statedLimits("He won't do exhibitionism and refuses voyeurism.").kinks).toEqual(['exhibitionism', 'voyeurism'])
    expect(statedLimits('She absolutely will not do dirty talk').kinks).toEqual(['dirty_talk'])
  })

  it('does not invent a limit from a like, a mention or a word inside another word', () => {
    expect(statedLimits('She enjoys praise and gentle teasing, and likes roleplay.').kinks).toEqual([])
    expect(statedLimits('A moral person with an oral history project, never rough about it.').kinks).toEqual([])
    expect(statedLimits('').kinks).toEqual([])
  })

  it('does not carry a limit across a sentence', () => {
    expect(statedLimits('She has no patience. Bondage is fine.').kinks).toEqual([])
  })

  it('reads regions that are off limits to touch', () => {
    expect(statedLimits('Please, no touching her feet.').regions).toEqual(['feet'])
    expect(statedLimits('Her hands are off limits.').regions).toEqual(['hands'])
    expect(statedLimits('Off-limits: neck, hips').regions).toEqual(['neck', 'hips'])
    expect(statedLimits('never touch the inner thigh').regions).toEqual(['inner_thigh'])
  })

  it('does not read a body word used in another way', () => {
    expect(statedLimits('She never looks back and has no face for poker.').regions).toEqual([])
    expect(statedLimits('Likes having her hair played with.').regions).toEqual([])
    expect(statedLimits('no other plans').regions).toEqual([])
  })
})
