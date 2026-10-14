// Keeps long conversations coherent: turns that no longer fit the prompt are folded into a short running summary.

import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout, type AssistShaping } from '@/lib/api/generateWithTimeout'
import type { AssistantTurn } from './prompt'

const MAX_TRANSCRIPT_CHARS = 9000
const MAX_SUMMARY_CHARS = 1800

/** The prompt that asks for an updated summary. Exported for tests. */
export function summaryPrompt(previous: string | undefined, turns: readonly AssistantTurn[]): string {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text.trim().slice(0, 1500)}`)
    .join('\n\n')
    .slice(-MAX_TRANSCRIPT_CHARS)
  return [
    'You keep notes on a long conversation between a user and an assistant. Update the notes so the conversation can continue after these turns scroll out of view.',
    'Keep: what the user wants and is working on, decisions made, facts and names that matter, file paths and results of tool use, open questions. Drop: pleasantries and anything already resolved. Write plain sentences or short bullet lines, at most 180 words, no preamble.',
    previous?.trim() ? `Notes so far:\n${previous.trim()}` : 'There are no notes yet.',
    `Turns to fold in:\n\n${transcript}`,
    'Updated notes:',
  ].join('\n\n')
}

export async function summarizeTurns(
  client: ChatBackend,
  previous: string | undefined,
  turns: readonly AssistantTurn[],
  opts: { shaping?: AssistShaping; signal?: AbortSignal; contextLength: number },
): Promise<string> {
  const reply = await generateWithTimeout(
    client,
    { prompt: summaryPrompt(previous, turns), max_length: 380, max_context_length: opts.contextLength, temperature: 0.3, top_p: 0.9, top_k: 0, min_p: 0.05, rep_pen: 1.05, stop_sequence: [], trim_stop: true },
    'Summarising the conversation',
    opts.signal,
    opts.shaping,
  )
  return reply.trim().slice(0, MAX_SUMMARY_CHARS)
}

/** True when `dropped` turns went out of view and the stored summary covers fewer of them. */
export function summaryIsStale(summary: { covers: number } | undefined, dropped: number): boolean {
  return dropped > 0 && (summary?.covers ?? 0) < dropped
}
