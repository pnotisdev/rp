import { describe, expect, it } from 'vitest'
import { expressionRepeatNote } from './expressionRepeat'

describe('expressionRepeatNote', () => {
  it('says nothing when there is not enough tagged history yet', () => {
    expect(expressionRepeatNote('Aria', [])).toBeUndefined()
    expect(expressionRepeatNote('Aria', ['happy'])).toBeUndefined()
    expect(expressionRepeatNote('Aria', ['happy', 'happy'])).toBeUndefined()
  })

  it('says nothing while the expression is still changing turn to turn', () => {
    expect(expressionRepeatNote('Aria', ['happy', 'sad', 'happy', 'annoyed'])).toBeUndefined()
  })

  it('says nothing for a short hold — two turns in a row is normal pacing, not staleness', () => {
    expect(expressionRepeatNote('Aria', ['sad', 'happy', 'happy'])).toBeUndefined()
  })

  it('names the expression and the exact run length once it has genuinely gone stale', () => {
    const note = expressionRepeatNote('Aria', ['sad', 'happy', 'happy', 'happy'])
    expect(note).toContain('Aria')
    expect(note).toContain('"happy"')
    expect(note).toContain('3 replies in a row')
  })

  it('counts the TRAILING run, not the longest run anywhere in the window — a face that moved and came back to rest is not stale', () => {
    // "annoyed" repeats 3x earlier but the two most recent turns are "sad" then "happy" — nothing
    // is currently held, so this must not fire.
    expect(expressionRepeatNote('Aria', ['annoyed', 'annoyed', 'annoyed', 'sad', 'happy'])).toBeUndefined()
  })

  it('ignores an untagged (undefined) turn rather than treating it as a break or a match', () => {
    // Three real "happy" tags with a gap where no tag was set (e.g. a greeting) in between still
    // reads as three genuine repeats once the untagged gaps are filtered out.
    const note = expressionRepeatNote('Aria', ['happy', undefined, 'happy', undefined, 'happy'])
    expect(note).toContain('3 replies in a row')
  })

  it('a change after a long hold reads as clean again — only the trailing turns matter', () => {
    const note = expressionRepeatNote('Aria', ['happy', 'happy', 'happy', 'happy', 'sad', 'annoyed'])
    expect(note).toBeUndefined()
  })

  it('a run exactly at the lookback window reports its real length', () => {
    const note = expressionRepeatNote('Aria', ['happy', 'happy', 'happy', 'happy', 'happy'])
    expect(note).toContain('5 replies in a row')
  })

  it('caps the reported run at the lookback window, even when the real streak runs longer', () => {
    // Eight turns of the same tag in a row — only the most recent EXPRESSION_LOOKBACK are ever
    // looked at, so this must report 5, not 8.
    const note = expressionRepeatNote('Aria', Array(8).fill('happy'))
    expect(note).toContain('5 replies in a row')
    expect(note).not.toContain('8 replies')
  })
})
