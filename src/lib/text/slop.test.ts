import { describe, expect, it } from 'vitest'
import {
  buildSlopAvoidanceNote,
  cleanModelOutput,
  findRepeatedPhrases,
  findSlop,
  findSlopAcross,
  trimToLastSentence,
} from './slop'

describe('cleanModelOutput — meta/preamble removal', () => {
  it('returns ordinary prose untouched', () => {
    const text = '*She leans against the doorframe.* "You\'re late again."'
    expect(cleanModelOutput(text)).toBe(text)
  })

  it('strips a leading affirmation line', () => {
    expect(cleanModelOutput('Certainly! Here is the scene:\n\n*She turns.* "Hi."')).toBe('*She turns.* "Hi."')
  })

  it('strips an echoed speaker prefix for the actual speaker only', () => {
    expect(cleanModelOutput('Sumire: "What do you want?"', { charName: 'Sumire' })).toBe('"What do you want?"')
    // A different name mid-dialogue is one character addressing another, not an echo.
    expect(cleanModelOutput('"Kai, wait." *She grabs his sleeve.*', { charName: 'Sumire' })).toBe(
      '"Kai, wait." *She grabs his sleeve.*',
    )
  })

  it('drops OOC asides and assistant chatter anywhere in the reply', () => {
    const raw = '"Fine, come in."\n(OOC: let me know if you want a different tone)\nLet me know if this works for you!'
    expect(cleanModelOutput(raw)).toBe('"Fine, come in."')
  })

  it('removes markdown heading markers and collapses blank runs', () => {
    expect(cleanModelOutput('# Scene\n\n\n\n"Sit."')).toBe('Scene\n\n"Sit."')
  })

  it('cuts a fabricated next turn at a stray name prefix', () => {
    const raw = '"See you tomorrow."\nKai: "Wait, one more thing."'
    expect(cleanModelOutput(raw, { charName: 'Sumire', personaName: 'Kai' })).toBe('"See you tomorrow."')
  })

  it('drops a lone unclosed trailing asterisk', () => {
    expect(cleanModelOutput('"Whatever," she mutters. *')).toBe('"Whatever," she mutters.')
  })

  it('converts well-formed <i>/<b> action formatting to markdown', () => {
    expect(cleanModelOutput('<i>She looks up.</i> "What?"')).toBe('*She looks up.* "What?"')
    expect(cleanModelOutput('<b>No.</b>')).toBe('**No.**')
  })

  it('strips stray tags and broken tag salad', () => {
    expect(cleanModelOutput('"Who are you?" <b><i><i></b> she asks.')).toBe('"Who are you?"  she asks.')
    expect(cleanModelOutput('Text with <p>a block tag</p> in it')).toBe('Text with a block tag in it')
  })

  it('leaves a bare less-than in prose alone', () => {
    expect(cleanModelOutput('He muttered that x < y was obvious.')).toBe('He muttered that x < y was obvious.')
  })

  it('is idempotent', () => {
    const raw = 'Sumire: Certainly!\n\n## Scene\n"Hello."\n(OOC: note)'
    const once = cleanModelOutput(raw, { charName: 'Sumire' })
    expect(cleanModelOutput(once, { charName: 'Sumire' })).toBe(once)
  })
})

describe('findSlop', () => {
  it('flags a recognised tell', () => {
    expect(findSlop("She couldn't help but smile.").map((h) => h.id)).toContain('couldnt-help')
  })

  it('does not flag plain prose', () => {
    expect(findSlop('She smiled and said nothing for a while.')).toEqual([])
  })

  it('counts across several turns and sorts by frequency', () => {
    const hits = findSlopAcross([
      'The air was thick with tension.',
      "He couldn't help but stare.",
      "She couldn't help but laugh.",
    ])
    expect(hits[0].id).toBe('couldnt-help')
    expect(hits[0].count).toBe(2)
  })
})

describe('findRepeatedPhrases', () => {
  it('names a verbatim phrase repeated across turns', () => {
    const repeats = findRepeatedPhrases([
      'She tilts her head to the side and studies you.',
      'Later, she tilts her head to the side again.',
    ])
    expect(repeats[0].phrase).toContain('tilts her head to the side')
    expect(repeats[0].count).toBe(2)
  })

  it('ignores a phrase used only once', () => {
    expect(findRepeatedPhrases(['A completely unique sentence here.', 'Another unrelated line of text.'])).toEqual([])
  })
})

describe('buildSlopAvoidanceNote', () => {
  it('returns undefined when recent turns are clean', () => {
    expect(buildSlopAvoidanceNote(['"Hey." *She waves.*', '"Sit down, then."'])).toBeUndefined()
  })

  it('names the specific tells the character has used', () => {
    const note = buildSlopAvoidanceNote([
      "She couldn't help but grin.",
      'A ghost of a smile crossed her lips.',
    ])
    expect(note).toContain("couldn't help but")
    expect(note).toContain('ghost of a smile')
  })

  it('ignores the player-supplied turns (caller passes char turns only)', () => {
    expect(buildSlopAvoidanceNote([])).toBeUndefined()
  })
})

describe('trimToLastSentence', () => {
  it('leaves a cleanly-ended reply alone', () => {
    expect(trimToLastSentence('"I said no." *She crosses her arms.*')).toBe('"I said no." *She crosses her arms.*')
  })

  it('trims a dangling half-sentence back to the last full one', () => {
    expect(trimToLastSentence('"Fine, come with me, we do not have the whole night to stand here." She grabbed')).toBe(
      '"Fine, come with me, we do not have the whole night to stand here."',
    )
  })

  it('bails rather than gut a reply that is one long unpunctuated run', () => {
    const text = 'she kept walking and did not look back even once as the rain started to come down harder'
    expect(trimToLastSentence(text)).toBe(text)
  })
})
