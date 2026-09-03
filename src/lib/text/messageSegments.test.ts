import { describe, expect, it } from 'vitest'
import { splitMessageSegments } from '@/lib/text/messageSegments'

describe('splitMessageSegments', () => {
  it('returns a single text segment for plain text', () => {
    expect(splitMessageSegments('Hello there.')).toEqual([{ type: 'text', content: 'Hello there.' }])
  })

  it('extracts an asterisk-wrapped action, stripping the asterisks', () => {
    expect(splitMessageSegments('*smiles warmly*')).toEqual([{ type: 'action', content: 'smiles warmly' }])
  })

  it('extracts a quoted line, keeping the quote marks', () => {
    expect(splitMessageSegments('"Hello there."')).toEqual([{ type: 'quote', content: '"Hello there."' }])
  })

  it('splits mixed action/quote/plain text into the correct ordered segments', () => {
    expect(splitMessageSegments('*grins* "Nice to meet you." She waves.')).toEqual([
      { type: 'action', content: 'grins' },
      { type: 'text', content: ' ' },
      { type: 'quote', content: '"Nice to meet you."' },
      { type: 'text', content: ' She waves.' },
    ])
  })

  it('leaves an unterminated trailing asterisk as literal text', () => {
    expect(splitMessageSegments('She smiles *and leans in')).toEqual([
      { type: 'text', content: 'She smiles *and leans in' },
    ])
  })

  it('leaves a lone asterisk with no pair as literal text', () => {
    expect(splitMessageSegments('3 * 4 = 12')).toEqual([{ type: 'text', content: '3 * 4 = 12' }])
  })

  it('does not match across newlines', () => {
    expect(splitMessageSegments('*starts a line\nand never closes*')).toEqual([
      { type: 'text', content: '*starts a line\nand never closes*' },
    ])
  })

  it('returns no segments for an empty string', () => {
    expect(splitMessageSegments('')).toEqual([])
  })
})
