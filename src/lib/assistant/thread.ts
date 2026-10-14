import type { DraftSections } from '@/lib/characters/generateFullCharacter'
import { formatToolResult, type ToolUndo } from './tools'

/** An assistant thread: a plain model conversation, stored whole. */

/** What a turn produced beyond its text, when the assistant was asked to *make* something. */
export interface AssistantAttachment {
  kind: 'character' | 'story'
  /** A generated character, ready to save into the library. */
  character?: GeneratedCharacter
  /** A generated long-form story. */
  story?: GeneratedStory
}

/** A finished character draft, in the shape the character library already accepts. */
export interface GeneratedCharacter extends DraftSections {
  /** Stages that failed, so a partial result says so instead of looking complete. */
  failedStages?: string[]
  /** Stages that left their section blank on purpose, with why. */
  skippedStages?: { stage: string; reason: string }[]
  /** Set once the player has actually saved it, so the button can't create duplicates. */
  savedCharacterId?: string
}

export interface GeneratedStoryChapter {
  title: string
  /** Absent until the chapter has been written. */
  text?: string
}

export interface GeneratedStory {
  title: string
  premise: string
  chapters: GeneratedStoryChapter[]
  /** Index currently being written, for the progress UI. `undefined` once finished or not started. */
  writingIndex?: number
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  attachment?: AssistantAttachment
  /** Set when generation failed, so the turn renders as an error rather than an empty reply. */
  error?: string
  /** A tool the assistant called this turn, with what came back. The message has no text of its own. */
  tool?: { name: string; arguments: Record<string, unknown>; result: string; isError: boolean; images?: string[]; undo?: ToolUndo }
  /** Pictures the user attached to this message (shrunken data URLs). */
  images?: string[]
}

export interface AssistantThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AssistantMessage[]
  /** What the oldest turns said, once they no longer fit in the prompt. `covers` is how many prompt turns it stands in for. */
  summary?: { text: string; covers: number }
}

/** How many characters of the first message become the thread's title. */
const TITLE_LENGTH = 60

/** A thread title from its first user message: the first sentence or line, trimmed. */
export function threadTitleFrom(text: string): string {
  const firstLine = text.trim().split('\n').find((line) => line.trim()) ?? ''
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
  const cleaned = sentence.trim().replace(/\s+/g, ' ')
  if (!cleaned) return 'New conversation'
  return cleaned.length > TITLE_LENGTH ? `${cleaned.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : cleaned
}

/** Tool results older than this many messages are shortened in the prompt. */
const FULL_RESULT_WINDOW = 8

/** The turns to send to the model: text only (pictures become a note), dropping attachments and failed turns. */
export function promptTurnsOf(messages: readonly AssistantMessage[]): { role: 'user' | 'assistant'; text: string }[] {
  return messages.flatMap((m, i) => {
    if (m.tool) {
      const call = JSON.stringify({ name: m.tool.name, arguments: m.tool.arguments })
      const result = { text: m.tool.result, isError: m.tool.isError, images: m.tool.images }
      return [
        { role: 'assistant' as const, text: `<tool_call>${call}</tool_call>` },
        { role: 'user' as const, text: formatToolResult(m.tool.name, result, { short: messages.length - i > FULL_RESULT_WINDOW }) },
      ]
    }
    if (m.error) return []
    const pictures = m.images?.length ? `\n[attached ${m.images.length} picture${m.images.length === 1 ? '' : 's'}]` : ''
    return m.text.trim() || pictures ? [{ role: m.role, text: `${m.text}${pictures}`.trim() }] : []
  })
}
