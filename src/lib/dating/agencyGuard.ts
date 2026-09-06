import { splitSentences } from './boundaryGuard'

// Deterministic, lexical check for a reply narrating the player persona's own climax on their
// behalf. Only flags the persona's name as the clear grammatical subject right before an
// unambiguous climax phrase — never just co-occurring in the sentence, so "Sumire, holding Kai's
// hand, reached her own climax" doesn't false-positive on Kai. False negatives over false positives.
export function detectPersonaClimaxNarration(personaName: string, replyText: string): string | undefined {
  const name = personaName.trim()
  if (!name || !replyText.trim()) return undefined
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const subjectReached = new RegExp(`\\b${escapedName}\\b(?:\\s+\\w+){0,2}\\s+reached (his|her|their) (own )?climax`, 'i')
  const possessiveOwnX = new RegExp(`\\b${escapedName}['’]s\\s+own (climax|orgasm|release)\\b`, 'i')
  const subjectOrgasmed = new RegExp(`\\b${escapedName}\\b(?:\\s+\\w+){0,2}\\s+orgasmed\\b`, 'i')
  const patterns = [subjectReached, possessiveOwnX, subjectOrgasmed]
  for (const sentence of splitSentences(replyText)) {
    if (patterns.some((re) => re.test(sentence))) return sentence.trim()
  }
  return undefined
}
