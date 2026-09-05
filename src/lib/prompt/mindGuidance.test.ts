import { describe, expect, it } from 'vitest'
import { characterIntentGuidance, MOOD_VOCAB, moodGuidance, NEED_VOCAB, needGuidance } from './mindGuidance'

describe('moodGuidance', () => {
  it('says nothing with no mood set', () => {
    expect(moodGuidance('Sumire', 'Kai', undefined)).toBe('')
  })

  it('names the mood and the character, separate from their feelings about the user', () => {
    const line = moodGuidance('Sumire', 'Kai', 'anxious')
    expect(line).toContain('Sumire')
    expect(line).toContain('anxious')
    expect(line).toContain('Kai')
    expect(line).toContain('separate from')
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(moodGuidance('Sumire', 'Kai', 'content')).not.toContain('{{')
  })

  it('every mood in the vocab produces a valid line', () => {
    for (const mood of MOOD_VOCAB) {
      expect(moodGuidance('Sumire', 'Kai', mood)).toContain(mood)
    }
  })
})

describe('needGuidance', () => {
  it('says nothing with no need set', () => {
    expect(needGuidance('Sumire', undefined)).toBe('')
  })

  it('names the character and the need', () => {
    const line = needGuidance('Sumire', 'reassurance')
    expect(line).toContain('Sumire')
    expect(line).toContain('reassurance')
  })

  it('never emits a {{char}}/{{user}} macro', () => {
    expect(needGuidance('Sumire', 'stability')).not.toContain('{{')
  })

  it('every need in the vocab produces a valid line', () => {
    for (const need of NEED_VOCAB) {
      expect(needGuidance('Sumire', need)).toContain(need)
    }
  })

  it('reads as steadier than mood, not an urgent crisis', () => {
    expect(needGuidance('Sumire', 'belonging')).toContain('not a crisis')
  })
})

describe('characterIntentGuidance', () => {
  it('says nothing with no intent set', () => {
    expect(characterIntentGuidance('Sumire', undefined)).toBe('')
  })

  it('names the character and the intent, and leaves room for it to not surface this turn', () => {
    const line = characterIntentGuidance('Sumire', 'wants him to apologize first')
    expect(line).toContain('Sumire')
    expect(line).toContain('wants him to apologize first')
    expect(line).toMatch(/don't have to/)
  })

  it('never emits a {{char}}/{{user}} macro', () => {
    expect(characterIntentGuidance('Sumire', 'wants space tonight')).not.toContain('{{')
  })
})
