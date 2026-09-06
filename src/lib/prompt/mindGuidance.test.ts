import { describe, expect, it } from 'vitest'
import {
  afterglowGuidance,
  authoredStatePriorityNote,
  characterIntentGuidance,
  desireGuidance,
  fearGuidance,
  MOOD_VOCAB,
  moodGuidance,
  NEED_VOCAB,
  needGuidance,
  stockRomancePhrasingNote,
} from './mindGuidance'

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

describe('fearGuidance', () => {
  it('says nothing with no fear set', () => {
    expect(fearGuidance('Sumire', undefined)).toBe('')
  })

  it('names the character and the fear, without a mandate to announce it', () => {
    const line = fearGuidance('Sumire', 'being seen as too much')
    expect(line).toContain('Sumire')
    expect(line).toContain('being seen as too much')
    expect(line).toMatch(/without.*naming it outright/)
  })

  it('never emits a {{char}}/{{user}} macro', () => {
    expect(fearGuidance('Sumire', 'being left behind')).not.toContain('{{')
  })
})

describe('desireGuidance', () => {
  it('says nothing with no desire set', () => {
    expect(desireGuidance('Sumire', undefined)).toBe('')
  })

  it('names the character and the desire, framed as not needing satisfying or naming', () => {
    const line = desireGuidance('Sumire', 'wants to feel truly seen, not just liked')
    expect(line).toContain('Sumire')
    expect(line).toContain('wants to feel truly seen, not just liked')
    expect(line).toMatch(/doesn't need satisfying or even naming/)
  })

  it('never emits a {{char}}/{{user}} macro', () => {
    expect(desireGuidance('Sumire', 'wants to matter to someone again')).not.toContain('{{')
  })
})

describe('stockRomancePhrasingNote', () => {
  it('says nothing when it is not a romantic moment', () => {
    expect(stockRomancePhrasingNote(false)).toBe('')
  })

  it('names concrete stock phrases to avoid when it is a romantic moment', () => {
    const note = stockRomancePhrasingNote(true)
    expect(note).toMatch(/romantic\/intimate moment/i)
    expect(note).toContain('electricity between them')
    expect(note).toContain('despite herself')
  })

  it('never emits a {{char}}/{{user}} macro', () => {
    expect(stockRomancePhrasingNote(true)).not.toContain('{{')
  })
})

describe('authoredStatePriorityNote', () => {
  it('says nothing when mood is not resistant and the character is not holding back', () => {
    expect(authoredStatePriorityNote('Sumire', 'content', false, false)).toBe('')
    expect(authoredStatePriorityNote('Sumire', undefined, false, false)).toBe('')
    expect(authoredStatePriorityNote('Sumire', 'playful', false, false)).toBe('')
  })

  it('fires on a resistant mood and names it as taking priority over generic romance', () => {
    const note = authoredStatePriorityNote('Sumire', 'guarded', false, false)
    expect(note).toContain('Sumire')
    expect(note).toContain('guarded')
    expect(note).toMatch(/generic romance/i)
    expect(note).toMatch(/wins over generic romantic instinct/i)
  })

  it('fires when the character is deliberately holding back, even with a non-resistant mood', () => {
    const note = authoredStatePriorityNote('Sumire', 'content', true, false)
    expect(note).toContain('holding back')
  })

  it('names both reasons together when a resistant mood and holding-back co-occur', () => {
    const note = authoredStatePriorityNote('Sumire', 'hurt', true, false)
    expect(note).toContain('hurt')
    expect(note).toContain('holding back')
  })

  it('adds an explicit boundaries clause only when the character has authored boundaries', () => {
    const withBoundaries = authoredStatePriorityNote('Sumire', 'anxious', false, true)
    const without = authoredStatePriorityNote('Sumire', 'anxious', false, false)
    expect(withBoundaries).toMatch(/boundaries/i)
    expect(without).not.toMatch(/boundaries/i)
  })

  it('explicitly says warmth/affection does not override the authored state', () => {
    const note = authoredStatePriorityNote('Sumire', 'annoyed', false, false)
    expect(note).toMatch(/warmth or affection/i)
  })

  it('never emits a {{char}}/{{user}} macro — styleGuidance strings are not macro-substituted', () => {
    expect(authoredStatePriorityNote('Sumire', 'tense', true, true)).not.toContain('{{')
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
