import { describe, expect, it } from 'vitest'
import {
  buildSlopAvoidanceNote,
  cleanModelOutput,
  EXPLICIT_ANTI_PATTERN_ENTRIES,
  findRepeatedPhrases,
  balanceTrailingMarkup,
  endsCleanly,
  findSlop,
  findSlopAcross,
  isDuplicateOfRecentText,
  isVerbatimEcho,
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

  it('scrubs an impersonation suggestion: names swapped, so a leading persona label goes and a run-on into the character is cut', () => {
    // `impersonate()` in useChatSession calls it this way — persona is the expected speaker here.
    const raw = 'Kai: *I lean over and kiss her cheek.* "I\'ll be right back."\nSumire: *She catches his hand.*'
    expect(cleanModelOutput(raw, { charName: 'Kai', personaName: 'Sumire' })).toBe(
      '*I lean over and kiss her cheek.* "I\'ll be right back."',
    )
  })

  it('drops a lone unclosed trailing asterisk', () => {
    expect(cleanModelOutput('"Whatever," she mutters. *')).toBe('"Whatever," she mutters.')
  })

  it('converts <i>/<b> action formatting to a single-asterisk action', () => {
    expect(cleanModelOutput('<i>She looks up.</i> "What?"')).toBe('*She looks up.* "What?"')
    expect(cleanModelOutput('<b>No.</b>')).toBe('*No.*')
  })

  it('collapses **bold** / ***both*** action runs to a single asterisk', () => {
    expect(cleanModelOutput('**She narrows her eyes.** "Fine."')).toBe('*She narrows her eyes.* "Fine."')
    expect(cleanModelOutput('***she whispers***')).toBe('*she whispers*')
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

  it("strips a leaked relationship-guidance block (FIXES_TODO.md's live-reproduced bug), leaving real dialogue around it intact", () => {
    const leaked =
      '*She glances up.* "Hey."\n' +
      'Relationship: Kai and Sumire are at the "near strangers" stage.\n' +
      '(Let this colour tone, warmth, and what feels earned right now. Never state a number, "affection", or "stage" out loud.)\n' +
      '"Took you long enough."'
    expect(cleanModelOutput(leaked)).toBe('*She glances up.* "Hey."\n"Took you long enough."')
  })

  it('strips the leaked block even when it is the ENTIRE reply, leaving nothing behind (so the existing empty-reply check catches it)', () => {
    const onlyLeak =
      'Relationship: Kai and Sumire are at the "near strangers" stage.\n' +
      '(Let this colour tone, warmth, and what feels earned right now. Never state a number, "affection", or "stage" out loud.)'
    expect(cleanModelOutput(onlyLeak)).toBe('')
  })

  it("does NOT catch every possible line of the leaked block on its own (e.g. the pacing/gift-taste notes) — that broader case is `useChatSession.ts`'s job via `isDuplicateOfRecentText` against the reconstructed relationshipDescription text, not this function's", () => {
    const partialSurvivor =
      'Relationship: Kai and Sumire are at the "near strangers" stage.\n' +
      '(Let this colour tone, warmth, and what feels earned right now. Never state a number, "affection", or "stage" out loud.)\n' +
      "Sumire feels most loved through Quality time."
    expect(cleanModelOutput(partialSurvivor)).toBe('Sumire feels most loved through Quality time.')
  })

  it('straightens curly quotes to plain ASCII ones', () => {
    expect(cleanModelOutput('“You’re impossible,” she said.')).toBe('"You\'re impossible," she said.')
  })

  it('strips italics wrapping an entire quoted line, whether the asterisks sit outside or inside the quotes', () => {
    expect(cleanModelOutput('*"I don\'t know why."*')).toBe('"I don\'t know why."')
    expect(cleanModelOutput('"*I don\'t know why.*"')).toBe('"I don\'t know why."')
  })

  it('leaves partial emphasis on a single word inside otherwise-plain dialogue alone', () => {
    expect(cleanModelOutput('"I *really* mean it."')).toBe('"I *really* mean it."')
  })

  it('only strips the italicized quote, leaving a genuine action beat next to it untouched', () => {
    expect(cleanModelOutput('"*Hey.*" *She turns.* "*Bye.*"')).toBe('"Hey." *She turns.* "Bye."')
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

  it('scans extraPatterns alongside the base corpus, but only when passed', () => {
    const withExtra = findSlopAcross(['He entered her, slow at first.'], EXPLICIT_ANTI_PATTERN_ENTRIES)
    expect(withExtra.map((h) => h.label)).toContain('he entered her')
    expect(findSlopAcross(['He entered her, slow at first.'])).toEqual([])
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

  it('names a peak-phase anti-pattern already used, when extraPatterns is passed (explicit-rated chats only)', () => {
    const note = buildSlopAvoidanceNote(['*She gasped as he entered her, slow at first.*'], {
      extraPatterns: EXPLICIT_ANTI_PATTERN_ENTRIES,
    })
    expect(note).toContain('he entered her')
  })

  it('never surfaces an explicit anti-pattern without extraPatterns — the caller gates this to explicit-rated chats', () => {
    expect(buildSlopAvoidanceNote(['*She gasped as he entered her, slow at first.*'])).toBeUndefined()
  })
})

describe('endsCleanly', () => {
  it('accepts a finished sentence, with or without a trailing quote/asterisk/bracket', () => {
    expect(endsCleanly('She looks up. "What do you want?"')).toBe(true)
    expect(endsCleanly('*She turns away.*')).toBe(true)
    expect(endsCleanly('Ask her yourself (if you dare).')).toBe(true)
    expect(endsCleanly('"I already told you"')).toBe(true) // bare closing quote, unpunctuated dialogue
    expect(endsCleanly('It trails off...')).toBe(true)
    expect(endsCleanly('')).toBe(true)
  })

  it('rejects a reply cut off mid-sentence', () => {
    expect(endsCleanly('She reaches for the')).toBe(false)
    expect(endsCleanly('"Fine, but only if you promise to')).toBe(false)
    expect(endsCleanly('He steps closer,')).toBe(false)
  })

  it('rejects a reply that ends on a period but left an action beat or quote open', () => {
    // The screenshot case: sentence-final punctuation, but the closing `*` never came.
    expect(endsCleanly('"Don\'t watch me waste it."\n\n*She says it like a warning.')).toBe(false)
    expect(endsCleanly('She looks up. "I already said no.')).toBe(false)
  })
})

describe('balanceTrailingMarkup', () => {
  it('closes an action beat a stop sequence cut off mid-mark', () => {
    expect(balanceTrailingMarkup('*She says it like a warning.')).toBe('*She says it like a warning.*')
  })

  it('closes an open line of dialogue', () => {
    expect(balanceTrailingMarkup('"The paper is expensive. Don\'t watch me waste it.')).toBe(
      '"The paper is expensive. Don\'t watch me waste it."',
    )
  })

  it('closes a quote nested inside an action beat, quote first', () => {
    expect(balanceTrailingMarkup('*She mutters, "not again.')).toBe('*She mutters, "not again."*')
  })

  it('drops a bare trailing mark with nothing inside it', () => {
    expect(balanceTrailingMarkup('She turns away. *')).toBe('She turns away.')
  })

  it('leaves balanced text alone', () => {
    const t = '*She turns away.* "Goodnight."'
    expect(balanceTrailingMarkup(t)).toBe(t)
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

describe('isVerbatimEcho', () => {
  const priorText = "I keep thinking about how much of my week is just built around when I get to see you next."

  it('catches a bare echo of the immediately-preceding message', () => {
    expect(isVerbatimEcho(priorText, priorText)).toBe(true)
  })

  it('catches the same echo with a stray one-word speaker label glued on the front', () => {
    expect(isVerbatimEcho(`Kai: ${priorText}`, priorText)).toBe(true)
  })

  it('catches it with a two-word speaker label too', () => {
    expect(isVerbatimEcho(`Kai Tanaka: ${priorText}`, priorText)).toBe(true)
  })

  it('is insensitive to surrounding whitespace on either side', () => {
    expect(isVerbatimEcho(`  ${priorText}  \n`, `\n${priorText}  `)).toBe(true)
  })

  it('does not flag a genuinely new reply', () => {
    expect(isVerbatimEcho('"You can\'t just say that." Her voice cracks once before she steadies it.', priorText)).toBe(false)
  })

  it('does not flag a short reply that legitimately starts with a capitalized clause before a colon', () => {
    // The exact failure mode this is narrow on purpose to avoid: stripping the opening clause of a
    // real sentence that happens to contain an early colon, rather than an actual speaker label.
    expect(isVerbatimEcho('Chapter One: this is not an echo at all.', priorText)).toBe(false)
  })

  it('returns false with no prior message to compare against (e.g. the very first line of a chat)', () => {
    expect(isVerbatimEcho(priorText, undefined)).toBe(false)
    expect(isVerbatimEcho(priorText, '')).toBe(false)
  })

  it('does not flag a reply that merely starts the same way as the prior message but genuinely continues differently', () => {
    expect(isVerbatimEcho(`${priorText} That's not a complaint.`, priorText)).toBe(false)
  })
})

describe('isDuplicateOfRecentText', () => {
  const oldCharTurn =
    "Her grip tightens on the paperback. She turns a page she hasn't read, the sound of paper louder than it needs to be. \"...Fine.\" Flat. Final. \"Then sit across from the door. Quietly.\""
  const nextCharTurn =
    "She doesn't look up from the book for a long time. When she finally speaks, her voice is flat. \"...It's not raining yet.\" She turns a page."
  const oldUserTurn =
    "I don't push it, just smile and go back to unpacking the last of her boxes into the shelf we built together. \"Okay. Whenever. This is already more than I used to let myself want.\""

  it("live shape 1: catches a reply that's just the tail end of an earlier message", () => {
    expect(isDuplicateOfRecentText(oldCharTurn.slice(-50), [oldCharTurn])).toBe(true)
  })

  it('live shape 2: catches a reply that concatenates the last two char turns with nothing new written', () => {
    const concatenated = oldCharTurn + '\n' + nextCharTurn.slice(0, 60)
    expect(isDuplicateOfRecentText(concatenated, [oldCharTurn, nextCharTurn])).toBe(true)
  })

  it("live shape 3: catches an exact copy of the PLAYER's own earlier line presented as the character's turn", () => {
    expect(isDuplicateOfRecentText(oldUserTurn, [oldUserTurn])).toBe(true)
  })

  it('does not flag a genuinely new reply that merely continues the same scene', () => {
    const genuinelyNew =
      "Sumire's fingers tightened in his, once. Just once. Her shoulders dropped a little, like something she'd been holding unclenched. \"...All right.\""
    expect(isDuplicateOfRecentText(genuinelyNew, [oldCharTurn, nextCharTurn, oldUserTurn])).toBe(false)
  })

  it('never flags a short reply, even one that legitimately recurs verbatim ("...Fine." twice in one chat is normal)', () => {
    expect(isDuplicateOfRecentText('...Fine.', ['...Fine.', oldCharTurn])).toBe(false)
  })

  it('ignores undefined/empty entries in the comparison list', () => {
    expect(isDuplicateOfRecentText(oldCharTurn, [undefined, '', oldCharTurn])).toBe(true)
    expect(isDuplicateOfRecentText('a genuinely fresh reply, long enough to be checked at all here', [undefined, ''])).toBe(false)
  })

  it('is insensitive to whitespace differences between what was stored and what was just produced', () => {
    const withDifferentSpacing = oldCharTurn.replace(/\s+/g, '\n')
    expect(isDuplicateOfRecentText(withDifferentSpacing, [oldCharTurn])).toBe(true)
  })
})
