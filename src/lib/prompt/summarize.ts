/**
 * Folds aging messages into a running summary via the connected model itself — the actual
 * long-term memory mechanism: once messages age out of the context window, their substance
 * survives here instead of being silently dropped.
 */

import type { ChatMessage } from './builder'
import type { VoiceFingerprint } from '@/lib/characters/cardSpec'

export type SummaryDetail = 'concise' | 'detailed'

export interface SummarizeInput {
  existingSummary: string
  messages: ChatMessage[]
  charName: string
  userName: string
  detail?: SummaryDetail
  /** When set, asks the summarizer to keep a short verbatim quote whenever new events demonstrate the character's voice, instead of paraphrasing it away. */
  voiceFingerprint?: VoiceFingerprint
  generate: (prompt: string) => Promise<string>
}

/** Picks the single most concrete, quotable example off the fingerprint to name in the instruction. */
function voiceRetentionInstruction(charName: string, fingerprint: VoiceFingerprint | undefined): string {
  if (!fingerprint) return ''
  const example = fingerprint.catchphrases?.[0]?.trim() || fingerprint.verbalTics?.[0]?.trim()
  const hasSignal = !!(
    fingerprint.verbalTics?.length ||
    fingerprint.catchphrases?.length ||
    fingerprint.dialectNotes?.trim() ||
    fingerprint.sentenceRhythm?.trim()
  )
  if (!hasSignal) return ''
  const namedExample = example ? ` (something like "${example}")` : ''
  return `${charName} has a distinctive voice worth protecting${namedExample}. If a line in the new events below clearly demonstrates it — a catchphrase, a verbal tic, their particular register — keep a brief exact quote of it rather than paraphrasing it into flat third-person prose; that quote is what keeps their voice from flattening out once this summary becomes the only record of what happened.`
}

/** Rough max_length to hand the API for each detail level. */
export const SUMMARY_MAX_LENGTH: Record<SummaryDetail, number> = {
  concise: 220,
  detailed: 500,
}

export async function summarizeMessages({
  existingSummary,
  messages,
  charName,
  userName,
  detail = 'concise',
  voiceFingerprint,
  generate,
}: SummarizeInput): Promise<string> {
  const transcript = messages.map((m) => `${m.name}: ${m.text}`).join('\n')
  const lengthInstruction =
    detail === 'detailed'
      ? 'Cover key facts established, relationship or emotional developments, important events, and notable details of setting or dialogue worth remembering. Third person, plain prose, no headers or bullet points, no em dashes, under 450 words.'
      : 'Cover key facts established, relationship or emotional developments, and important events either character would remember. Third person, plain prose, no headers or bullet points, no em dashes, under 200 words.'
  const voiceInstruction = voiceRetentionInstruction(charName, voiceFingerprint)
  const prompt = [
    `Task: maintain a running memory log for a roleplay chat between ${userName} and ${charName}.`,
    existingSummary.trim() ? `Memory so far:\n${existingSummary.trim()}` : '',
    `New events to fold in:\n${transcript}`,
    `Write the updated memory log: merge the new events into the existing memory (don't just append, integrate and drop anything superseded). ${lengthInstruction} Do not invent anything that didn't happen above.${voiceInstruction ? ` ${voiceInstruction}` : ''}\n\nUpdated memory log:`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const result = await generate(prompt)
  return result.trim()
}
