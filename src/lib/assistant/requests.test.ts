import { describe, expect, it } from 'vitest'
import { detectProducer } from './requests'

describe('detectProducer — character requests', () => {
  it('catches the request shape from the brief that prompted this feature', () => {
    expect(
      detectProducer('Generate a 3000 year old white hair elf for me, who wears a sundress and is capable of dark magic'),
    ).toBe('character')
  })

  it('catches an explicit character ask, however it is phrased', () => {
    for (const text of [
      'make me a character',
      'create a new OC please',
      'design an NPC for a tavern',
      'come up with a companion for my playthrough',
      'give me a character card for a grumpy blacksmith',
      'build a villain who used to be the hero',
    ]) {
      expect(detectProducer(text), text).toBe('character')
    }
  })

  it('catches an archetype noun with no word "character" in sight', () => {
    for (const text of ['make a catgirl assassin', 'generate a vampire priestess', 'invent an android detective']) {
      expect(detectProducer(text), text).toBe('character')
    }
  })
})

describe('detectProducer — story requests', () => {
  it('catches a request for a whole story', () => {
    for (const text of [
      'write me a complete story about a lighthouse keeper',
      'generate a novel set in a drowned city',
      'write a story with chapters about two rival chefs',
      'can you draft a novella chapter by chapter',
    ]) {
      expect(detectProducer(text), text).toBe('story')
    }
  })

  it('reads a story about a character as a story, not a character card', () => {
    // The compound case: prose with an elf in it, not an elf to roleplay.
    expect(detectProducer('write a full story about a 3000 year old elf who wears a sundress')).toBe('story')
  })
})

describe('detectProducer — what it must leave alone', () => {
  it('ignores questions about the subject rather than requests to make one', () => {
    for (const text of [
      'what makes a good character?',
      'how would you write a story like that?',
      'why do so many characters have tragic backstories?',
      'is it hard to write a novel?',
      'tell me about character design',
      'do you think a villain needs a redemption arc?',
    ]) {
      expect(detectProducer(text), text).toBeUndefined()
    }
  })

  it('ignores ordinary conversation entirely', () => {
    for (const text of [
      'hello',
      'what is the capital of Peru?',
      'summarise this email for me',
      'my printer keeps jamming',
      'write a bash script that renames files by date',
      'fix the type error in this snippet',
    ]) {
      expect(detectProducer(text), text).toBeUndefined()
    }
  })

  it('is undefined for empty or whitespace input', () => {
    expect(detectProducer('')).toBeUndefined()
    expect(detectProducer('   \n ')).toBeUndefined()
  })

  it('does not fire on a bare mention with no making verb', () => {
    expect(detectProducer('the elf in chapter two felt underwritten')).toBeUndefined()
    // "chapters" alone is not a commission; it needs a making verb in front of it.
    expect(detectProducer('I like stories with chapters')).toBeUndefined()
    expect(detectProducer('write it chapter by chapter')).toBe('story')
  })
})
