import { splitSentences } from './boundaryGuard'

// Deterministic, lexical check for a reply narrating the player persona's own agency on their
// behalf — climax, but also feelings, thoughts, realizations, and involuntary physical reactions.
// Only flags the persona's name as the clear grammatical subject directly before an unambiguous
// verb/phrase — never just co-occurring in the sentence, so "Sumire, holding Kai's hand, reached
// her own climax" doesn't false-positive on Kai, and "she turned to Kai and felt relief" doesn't
// false-positive on Kai being the object of "to". False negatives over false positives throughout.

// Feeling/thought/realization verbs — the clearest, least ambiguous shape of the violation:
// asserting what's inside the player's head is almost never legitimate for {{char}}'s own turn.
const INTERNAL_STATE_VERBS = 'felt|feels|realized|realizes|thought|thinks|wondered|wonders|knew|understood|decided|remembered|noticed'

// Bounded, genre-specific involuntary physical reactions — deliberately excludes ordinary social
// actions (smiled, nodded, laughed) which are common enough, and low-severity enough, to risk
// nagging rather than catching a real violation.
const INVOLUNTARY_REACTION_VERBS = 'shivered|gasped|flinched|tensed|trembled|shuddered|ached|melted'

/** Same "0 or 1 filler adverb, then the verb" anchor for every non-climax pattern below — tight enough that an object-of-preposition ("turned to Kai and felt") can't set up a false subject match. */
function subjectVerbPattern(escapedName: string, verbs: string): RegExp {
  return new RegExp(`\\b${escapedName}\\b(?:\\s+\\w+ly)?\\s+(?:${verbs})\\b`, 'i')
}

export function detectPersonaAgencyViolation(personaName: string, replyText: string): string | undefined {
  const name = personaName.trim()
  if (!name || !replyText.trim()) return undefined
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    // Climax — the original, narrower check.
    new RegExp(`\\b${escapedName}\\b(?:\\s+\\w+){0,2}\\s+reached (his|her|their) (own )?climax`, 'i'),
    new RegExp(`\\b${escapedName}['’]s\\s+own (climax|orgasm|release)\\b`, 'i'),
    new RegExp(`\\b${escapedName}\\b(?:\\s+\\w+){0,2}\\s+orgasmed\\b`, 'i'),
    // Broader agency: internal states and involuntary reactions.
    subjectVerbPattern(escapedName, INTERNAL_STATE_VERBS),
    subjectVerbPattern(escapedName, INVOLUNTARY_REACTION_VERBS),
  ]
  for (const sentence of splitSentences(replyText)) {
    if (patterns.some((re) => re.test(sentence))) return sentence.trim()
  }
  return undefined
}
