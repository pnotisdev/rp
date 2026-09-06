import type { ChatMessage } from './builder'
import type { VoiceFingerprint } from '@/lib/characters/cardSpec'

export type SummaryDetail = 'concise' | 'detailed'

export interface SummarizeInput {
  existingSummary: string
  messages: ChatMessage[]
  charName: string
  userName: string
  detail?: SummaryDetail
  /**
   * The character's authored/detected voice fingerprint (`cardSpec.ts`), when there is one worth
   * protecting through compression. The problem this fixes: a rolling summary only ever preserves
   * *facts* ("she agreed to meet him"), never the specific lines that demonstrated a character's
   * voice, and this summary is exactly what replaces the original turns in every later prompt. Once
   * a chat is long enough that most of its history is summary rather than live messages, the
   * fingerprint reminder in `buildCharacterProfileNote` (`profile.ts`) is left with nothing nearby
   * in context to anchor it to — everything around it reads as flat third-person narration. Passing
   * this in adds one instruction asking the summarizer to keep a short verbatim quote whenever the
   * new batch actually demonstrates the voice, instead of paraphrasing every line away. Omitted
   * (or a fingerprint with nothing set) adds nothing to the prompt, same as every other optional
   * field here.
   */
  voiceFingerprint?: VoiceFingerprint
  generate: (prompt: string) => Promise<string>
}

/** The single most concrete, quotable example available on the fingerprint, so the instruction to
 *  the summarizer names an actual pattern to watch for rather than speaking only in the abstract. */
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

/** Rough max_length to hand the API for each detail level — kept alongside the wording so callers can't drift out of sync. */
export const SUMMARY_MAX_LENGTH: Record<SummaryDetail, number> = {
  concise: 220,
  detailed: 500,
}

/**
 * Folds a batch of older messages into a running summary via the connected
 * model itself — this is the actual long-term memory mechanism: once
 * messages age out of the context window, their substance survives here
 * instead of being silently dropped.
 */
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
