import type { Lorebook } from '@/lib/characters/cardSpec'
import type { ChatMessage } from '@/lib/prompt/builder'

export interface Persona {
  id: string
  name: string
  description: string
  avatarDataUrl?: string
  createdAt: number
}

export interface StoredMessage extends ChatMessage {
  chatId: string
  createdAt: number
  swipes?: string[]
  activeSwipe?: number
  tokenCount?: number
}

export interface Chat {
  id: string
  characterId: string
  personaId: string
  title: string
  createdAt: number
  updatedAt: number
  /** Running long-term memory log covering everything older than summaryUpToTimestamp. */
  summary?: string
  /** Messages with createdAt <= this are represented by `summary`, not sent verbatim. */
  summaryUpToTimestamp?: number
}

export interface WorldInfoBook {
  id: string
  name: string
  book: Lorebook
  /** Chat ids this global book is bound to; empty = available to all chats. */
  boundChatIds: string[]
  createdAt: number
}

export interface WorldCard {
  id: string
  name: string
  /** Setting, tone, general facts — always included in the prompt for any character in this world. */
  description: string
  /** Hard constraints: magic system, tech level, taboos — things the model should never contradict. */
  rules?: string
  lorebook: Lorebook
  avatarDataUrl?: string
  createdAt: number
  updatedAt: number
}

export interface ObjectiveTask {
  id: string
  description: string
  status: 'pending' | 'done'
  completedAt?: number
}

export interface Objective {
  id: string
  chatId: string
  title: string
  description?: string
  tasks: ObjectiveTask[]
  status: 'active' | 'completed' | 'abandoned'
  createdBy: 'user' | 'ai'
  createdAt: number
  updatedAt: number
}

export interface SamplerPreset {
  id: string
  name: string
  params: Record<string, unknown>
  createdAt: number
}

export interface Theme {
  id: string
  name: string
  tokens: Record<string, string>
  createdAt: number
}
