import { splitSentences } from './boundaryGuard'

// Deterministic, lexical check for a reply narrating the player persona's own agency on their behalf

// Feeling/thought/realization verbs — the clearest, least ambiguous shape of the violation
const INTERNAL_STATE_VERBS = 'felt|feels|realized|realizes|thought|thinks|wondered|wonders|knew|understood|decided|remembered|noticed'

// Bounded, genre-specific involuntary physical reactions
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
