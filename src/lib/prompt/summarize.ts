import type { ChatMessage } from './builder'

export type SummaryDetail = 'concise' | 'detailed'

export interface SummarizeInput {
  existingSummary: string
  messages: ChatMessage[]
  charName: string
  userName: string
  detail?: SummaryDetail
  generate: (prompt: string) => Promise<string>
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
  generate,
}: SummarizeInput): Promise<string> {
  const transcript = messages.map((m) => `${m.name}: ${m.text}`).join('\n')
  const lengthInstruction =
    detail === 'detailed'
      ? 'Cover key facts established, relationship or emotional developments, important events, and notable details of setting or dialogue worth remembering. Third person, plain prose, no headers or bullet points, under 450 words.'
      : 'Cover key facts established, relationship or emotional developments, and important events either character would remember. Third person, plain prose, no headers or bullet points, under 200 words.'
  const prompt = [
    `Task: maintain a running memory log for a roleplay chat between ${userName} and ${charName}.`,
    existingSummary.trim() ? `Memory so far:\n${existingSummary.trim()}` : '',
    `New events to fold in:\n${transcript}`,
    `Write the updated memory log: merge the new events into the existing memory (don't just append, integrate and drop anything superseded). ${lengthInstruction} Do not invent anything that didn't happen above.\n\nUpdated memory log:`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const result = await generate(prompt)
  return result.trim()
}
