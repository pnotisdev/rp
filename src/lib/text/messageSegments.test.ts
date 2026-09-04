import { describe, expect, it } from 'vitest'
import { parseSfxWordList, splitMessageSegments } from '@/lib/text/messageSegments'

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

  describe('markup normalisation (models and players drift between *, **, and <i>)', () => {
    it('treats **bold** narration as an action, with no stray asterisks left over', () => {
      expect(splitMessageSegments('**She narrows her eyes.** "Fine."')).toEqual([
        { type: 'action', content: 'She narrows her eyes.' },
        { type: 'text', content: ' ' },
        { type: 'quote', content: '"Fine."' },
      ])
    })

    it('treats ***both*** the same way', () => {
      expect(splitMessageSegments('***she whispers***')).toEqual([{ type: 'action', content: 'she whispers' }])
    })

    it('converts <i>/<em> action tags to action segments', () => {
      expect(splitMessageSegments('<i>She looks away.</i> "Whatever."')).toEqual([
        { type: 'action', content: 'She looks away.' },
        { type: 'text', content: ' ' },
        { type: 'quote', content: '"Whatever."' },
      ])
    })

    it('converts <b> action tags and strips block/salad tags', () => {
      expect(splitMessageSegments('<b>She freezes.</b>')).toEqual([{ type: 'action', content: 'She freezes.' }])
      expect(splitMessageSegments('"Who?" <b><i><i></b> she asks.')).toEqual([
        { type: 'quote', content: '"Who?"' },
        { type: 'text', content: '  she asks.' },
      ])
    })

    it('leaves a bare less-than in prose alone', () => {
      expect(splitMessageSegments('if x < y then run')).toEqual([{ type: 'text', content: 'if x < y then run' }])
    })
  })

  describe('sfx bursts', () => {
    it('tags a lone onomatopoeia with trailing punctuation', () => {
      expect(splitMessageSegments('BOOM!')).toEqual([{ type: 'sfx', content: 'BOOM!' }])
    })

    it('tags a standalone sound word between two sentences, keeping the surrounding text', () => {
      expect(splitMessageSegments('She turned the key. CLICK. The lock gave way.')).toEqual([
        { type: 'text', content: 'She turned the key. ' },
        { type: 'sfx', content: 'CLICK' },
        { type: 'text', content: '. The lock gave way.' },
      ])
    })

    it('tags a repeated lowercase sound that is the whole action segment', () => {
      expect(splitMessageSegments('*knock knock*')).toEqual([{ type: 'sfx', content: 'knock knock' }])
    })

    it('tags a burst set off by dashes inside an action segment', () => {
      expect(splitMessageSegments('*she froze — THUMP — the lid slammed shut*')).toEqual([
        { type: 'action', content: 'she froze — ' },
        { type: 'sfx', content: 'THUMP' },
        { type: 'action', content: ' — the lid slammed shut' },
      ])
    })

    it('matches an elongated spelling', () => {
      expect(splitMessageSegments('KABOOOOM!')).toEqual([{ type: 'sfx', content: 'KABOOOOM!' }])
    })

    it('does not tag a shouted non-sound word', () => {
      expect(splitMessageSegments('I told him to STOP.')).toEqual([
        { type: 'text', content: 'I told him to STOP.' },
      ])
    })

    it('does not tag a sound word used as a verb mid-sentence', () => {
      expect(splitMessageSegments('The door slams shut behind her.')).toEqual([
        { type: 'text', content: 'The door slams shut behind her.' },
      ])
    })

    it('leaves a "BOOM!" that is spoken dialogue inside quotes alone', () => {
      expect(splitMessageSegments('"BOOM!" she shouted, throwing her arms wide.')).toEqual([
        { type: 'quote', content: '"BOOM!"' },
        { type: 'text', content: ' she shouted, throwing her arms wide.' },
      ])
    })

    it('does not change output shape for a message with no sound effects', () => {
      expect(splitMessageSegments('*grins* "Nice to meet you." She waves.')).toEqual([
        { type: 'action', content: 'grins' },
        { type: 'text', content: ' ' },
        { type: 'quote', content: '"Nice to meet you."' },
        { type: 'text', content: ' She waves.' },
      ])
    })

    it('skips SFX detection entirely when disabled', () => {
      expect(splitMessageSegments('The gate slammed. BANG! *she flinched*', { disabled: true })).toEqual([
        { type: 'text', content: 'The gate slammed. BANG! ' },
        { type: 'action', content: 'she flinched' },
      ])
    })

    it('tags a character-specific sound word passed via extraWords', () => {
      expect(splitMessageSegments('*She tilts her head.* Nyaa~', { extraWords: ['nya'] })).toEqual([
        { type: 'action', content: 'She tilts her head.' },
        { type: 'text', content: ' ' },
        { type: 'sfx', content: 'Nyaa~' },
      ])
    })

    it('still recognizes built-in sounds when extraWords is provided', () => {
      expect(splitMessageSegments('BOOM. mrrp?', { extraWords: ['mrrp'] })).toEqual([
        { type: 'sfx', content: 'BOOM' },
        { type: 'text', content: '. ' },
        { type: 'sfx', content: 'mrrp?' },
      ])
    })

    it('does not tag an extra word that was not configured for this speaker', () => {
      expect(splitMessageSegments('*She tilts her head.* Nyaa~')).toEqual([
        { type: 'action', content: 'She tilts her head.' },
        { type: 'text', content: ' Nyaa~' },
      ])
    })
  })
})

describe('parseSfxWordList', () => {
  it('splits on commas, whitespace and newlines and drops punctuation', () => {
    expect(parseSfxWordList('nya, nyaa~\n mrrp   purr!')).toEqual(['nya', 'nyaa', 'mrrp', 'purr'])
  })

  it('drops fragments shorter than two letters', () => {
    expect(parseSfxWordList('a, of, nya, x')).toEqual(['of', 'nya'])
  })

  it('returns an empty list for blank input', () => {
    expect(parseSfxWordList('   ')).toEqual([])
  })
})
