import { describe, expect, it } from 'vitest'
import { speakableBubble, splitBubbles, toTextingReply, typingDelayMs } from './texting'

describe('splitBubbles', () => {
  it('makes one bubble per line and skips blanks', () => {
    expect(splitBubbles('haha first week is always like that\n\nthey expect you to know everything').bubbles).toEqual([
      { text: 'haha first week is always like that', block: false },
      { text: 'they expect you to know everything', block: false },
    ])
  })

  it('keeps fenced long-form content together as one bubble', () => {
    const text = 'ugh fine\n```\nSubject: Extension\n\nDear Professor,\nI was sick.\n```\nsend that'
    expect(splitBubbles(text).bubbles).toEqual([
      { text: 'ugh fine', block: false },
      { text: 'Subject: Extension\n\nDear Professor,\nI was sick.', block: true },
      { text: 'send that', block: false },
    ])
  })

  it('holds back the unfinished line and an open fence while streaming', () => {
    expect(splitBubbles('wait\nhow was i', true)).toEqual({ bubbles: [{ text: 'wait', block: false }], pending: true })
    expect(splitBubbles('ok\n```\nDear Prof', true)).toEqual({ bubbles: [{ text: 'ok', block: false }], pending: true })
    expect(splitBubbles('wait\n', true)).toEqual({ bubbles: [{ text: 'wait', block: false }], pending: false })
  })
})

describe('toTextingReply', () => {
  it('drops action beats, speaker prefixes and wrapping quotes', () => {
    const raw = '*She leans back.* "wait what"\nTess: how was it\n"full report pls"'
    expect(toTextingReply(raw, { charName: 'Tess', personaName: 'Kai' })).toBe('wait what\nhow was it\nfull report pls')
  })

  it('keeps fences intact and merges bubbles past the cap', () => {
    expect(toTextingReply('a\n```\nDear X,\n\nHi.\n```\nb', { charName: 'Tess' })).toBe('a\n```\nDear X,\n\nHi.\n```\nb')
    expect(toTextingReply('1\n2\n3\n4', { charName: 'Tess', maxBubbles: 3 })).toBe('1\n2\n3 4')
  })

  it('closes a fence the model left open', () => {
    expect(toTextingReply('ok\n```\nDear X,', { charName: 'Tess' })).toBe('ok\n```\nDear X,\n```')
  })
})

describe('speech', () => {
  it('spells out shorthand and voices laughs', () => {
    expect(speakableBubble('lmao ngl that was good')).toBe('haha not gonna lie that was good')
    expect(speakableBubble('lol ok', { audioTags: true })).toBe('[laughs] ok')
    expect(speakableBubble('`tess.log: hi` sure 😭')).toBe('sure')
  })

  it('paces longer texts more slowly, within bounds', () => {
    const short = typingDelayMs({ text: 'ok', block: false }, () => 0.5)
    const long = typingDelayMs({ text: 'x'.repeat(120), block: false }, () => 0.5)
    expect(short).toBeGreaterThanOrEqual(650)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(2400)
  })
})
