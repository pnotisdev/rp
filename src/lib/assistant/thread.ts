import type { CharacterCardData, Lorebook } from '@/lib/characters/cardSpec'
import type { Outfit } from '@/lib/vn/outfits'
import type { DraftedBonds, DraftedProfile } from '@/lib/characters/aiAssist'

/**
 * An assistant thread: a plain model conversation, stored whole. Deliberately not a `Chat` — that
 * type requires a `characterId` and carries the entire relationship track, and an assistant thread
 * has neither a character nor a relationship.
 *
 * Messages live inside the thread record rather than in their own table. Assistant threads are read
 * front to back, never searched per-message or forked mid-way (the two things that earn `messages`
 * its own table), so one row per thread keeps the whole feature to a single resource.
 */

/** What a turn produced beyond its text, when the assistant was asked to *make* something. */
export interface AssistantAttachment {
  kind: 'character' | 'story'
  /** A generated character, ready to save into the library. */
  character?: GeneratedCharacter
  /** A generated long-form story. */
  story?: GeneratedStory
}

/** A finished character draft, in the shape the character library already accepts. */
export interface GeneratedCharacter {
  card: CharacterCardData
  profile?: DraftedProfile | null
  bonds?: DraftedBonds | null
  outfits?: Outfit[] | null
  characterBook?: Lorebook | null
  /** Stages that failed, so a partial result says so instead of looking complete. */
  failedStages?: string[]
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
}

export interface AssistantThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AssistantMessage[]
}

/** How many characters of the first message become the thread's title. */
const TITLE_LENGTH = 60

/**
 * A thread title from its first user message: the first sentence or line, trimmed. Threads are
 * listed by title, and "New conversation" repeated twelve times is a useless list.
 */
export function threadTitleFrom(text: string): string {
  const firstLine = text.trim().split('\n').find((line) => line.trim()) ?? ''
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
  const cleaned = sentence.trim().replace(/\s+/g, ' ')
  if (!cleaned) return 'New conversation'
  return cleaned.length > TITLE_LENGTH ? `${cleaned.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : cleaned
}

/** The turns to send to the model — text only, dropping attachments and failed turns. */
export function promptTurnsOf(messages: readonly AssistantMessage[]): { role: 'user' | 'assistant'; text: string }[] {
  return messages
    .filter((m) => !m.error && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text }))
}
