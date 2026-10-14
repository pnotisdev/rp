import { describe, expect, it } from 'vitest'
import { INSIGHT_LIB } from './storyInsights'
import { loadLib } from './harness'

const I = loadLib<any>(INSIGHT_LIB, 'Insights')
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const msg = (role: string, text: string, createdAt = 1_700_000_000_000) => ({ role, text, createdAt })

describe('story insights', () => {
  it('counts messages, words and shares', () => {
    const s = plain(I.analyze([msg('user', 'one two three four'), msg('char', 'a b c d e f g h')]))
    expect(s).toMatchObject({ total: 2, userCount: 1, charCount: 1, userWords: 4, charWords: 8, avgReply: 8, avgUser: 4, share: 67, longest: 8 })
  })

  it('splits character words into dialogue, action and narration', () => {
    const s = plain(I.analyze([msg('char', '*She smiles warmly.* "Come on in, friend." The door creaks open.')]))
    // action 3, dialogue 4, total 11 -> narration 4
    expect(s).toMatchObject({ action: 27, dialogue: 36, narration: 36 })
    expect(plain(I.analyze([msg('char', 'He said “hello there”')])).dialogue).toBe(50)
  })

  it('finds the character\'s favourite words and ignores filler', () => {
    const replies = Array.from({ length: 4 }, () => msg('char', 'The lantern glows. The lantern flickers.'))
    const s = plain(I.analyze(replies))
    expect(s.favourites[0]).toEqual({ text: 'lantern', n: 8 })
    expect(s.favourites.map((f: { text: string }) => f.text)).not.toContain('the')
  })

  it('needs enough replies before judging repetition', () => {
    expect(plain(I.repetition(['a b c d e f'])).level).toBe('n/a')
  })

  it('flags repeated phrases and openers', () => {
    const varied = ['Rain fell over the quiet harbor tonight.', 'Nobody expected the captain to return so soon.', 'A distant bell rang somewhere beyond the hills.', 'She counted the coins twice before speaking.', 'The map showed a river that no one had named.', 'Smoke curled from the chimney of the old mill.']
    expect(plain(I.repetition(varied)).level).toBe('Low')
    const stuck = Array.from({ length: 8 }, (_, i) => `Her eyes sparkled with mischief as she said something new number ${i} today.`)
    const r = plain(I.repetition(stuck))
    expect(r.level).toBe('High')
    expect(r.phrases[0].text).toContain('eyes sparkled with')
    expect(r.openers[0]).toEqual({ text: 'her eyes sparkled', n: 8 })
  })

  it('groups activity by day', () => {
    const day = 86_400_000
    const s = plain(I.analyze([msg('user', 'a', 1_700_000_000_000), msg('char', 'b', 1_700_000_000_000 + 1000), msg('user', 'c', 1_700_000_000_000 + 3 * day)]))
    expect(s.days.map((d: { n: number }) => d.n)).toEqual([2, 1])
    expect(s.span.to).toBeGreaterThan(s.span.from)
  })
})
