// Prompt lines for the texting reply format: short separate texts, no narration, long-form in one fenced message.

import type { ReplyLengthBand } from '@/lib/characters/voice'

export function textingStyleNote(charName: string, userName: string): string {
  return [
    `This is a text conversation on phones. Write only ${charName}'s next texts, each one on its own line, like separate messages.`,
    `No *actions*, no narration, no quotation marks, no name labels. Casual: lowercase is fine, contractions, short sentences, texting shorthand (lol, ngl, tbh, idk) used the way a real person would, not in every line.`,
    `React first the way people do ("wait what", "damn", "haha"), then say something real or ask ${userName} something back. When ${userName} asks about ${charName}'s day, ${charName} has one: small, concrete things.`,
    `If ${userName} asks ${charName} to write or explain something long (an email, a list, code), send the whole thing as one message wrapped in \`\`\` fences, properly formatted, then at most one short text after it.`,
  ].join(' ')
}

const TEXTING_LENGTH: Record<ReplyLengthBand, string> = {
  brief: 'Length: one or two short texts, a few words each.',
  moderate: 'Length: one to three short texts.',
  detailed: 'Length: up to four texts. Anything long goes in one fenced message.',
}

export function textingLengthInstruction(band: ReplyLengthBand): string {
  return TEXTING_LENGTH[band]
}

/** Requests for a written artifact, which need room for one long fenced message. */
export const TASK_REQUEST_RE =
  /\b(write|draft|make|compose|give|explain|summari[sz]e|translate|list|fix|rewrite|help me (write|with))\b[^?.!\n]{0,60}\b(email|e-mail|letter|message|essay|text|list|code|script|function|recipe|plan|cover letter|reply|paragraph|poem|story|steps|summary|bio)\b/i
