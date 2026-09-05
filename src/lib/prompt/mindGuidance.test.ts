import { describe, expect, it } from 'vitest'
import { afterglowGuidance, characterIntentGuidance, MOOD_VOCAB, moodGuidance, NEED_VOCAB, needGuidance } from './mindGuidance'

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

describe('afterglowGuidance', () => {
  it('uses a different register for the immediate beat than for the hours after', () => {
    const immediate = afterglowGuidance('Sumire', 'Kai', 0)
    const later = afterglowGuidance('Sumire', 'Kai', 2)
    expect(immediate).not.toBe(later)
    expect(immediate).toContain('immediately after')
    expect(later).toContain('a short while ago')
  })

  it('interpolates real names, since styleGuidance is never macro-substituted', () => {
    const out = afterglowGuidance('Sumire', 'Kai', 1)
    expect(out).toContain('Sumire')
    expect(out).toContain('Kai')
    expect(out).not.toContain('{{char}}')
    expect(out).not.toContain('{{user}}')
  })

  it('weaves in the source label when there is one, and reads fine without', () => {
    expect(afterglowGuidance('Sumire', 'Kai', 0, 'their first time together')).toContain('their first time together')
    expect(afterglowGuidance('Sumire', 'Kai', 0)).not.toContain('(after')
  })

  it("steers emotional aftermath only - explicitness stays the content dial's job", () => {
    for (const turns of [0, 1, 3]) {
      const out = afterglowGuidance('Sumire', 'Kai', turns).toLowerCase()
      for (const word of ['naked', 'undress', 'body', 'sex', 'explicit']) {
        expect(out).not.toContain(word)
      }
    }
  })

  it('treats a negative turn count as the immediate beat rather than producing nothing', () => {
    expect(afterglowGuidance('Sumire', 'Kai', -1)).toBe(afterglowGuidance('Sumire', 'Kai', 0))
  })
})
