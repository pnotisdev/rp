// Carries a drive persona's learned humor and a few notes from the previous chat into a new one.

import { chatFactsApi, chatsApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { inheritDriveState } from '@/lib/persona/drive'

export async function seedDriveFromPreviousChat(character: Character, newChatId: string): Promise<void> {
  if (!character.drive?.enabled) return
  const prev = (await chatsApi.list())
    .filter((c) => c.characterId === character.id && c.id !== newChatId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const facts = prev
    ? (await chatFactsApi.listByChat(prev.id))
        .filter((f) => f.active)
        .sort((a, b) => (b.importance ?? 0.5) - (a.importance ?? 0.5))
        .map((f) => f.text)
    : []
  // Too few remembered facts: the start of the rolling summary stands in.
  const summaryNote = facts.length < 3 && prev?.summary ? prev.summary.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 240) : ''
  const notes = [...facts, summaryNote].filter(Boolean)
  if (!prev?.driveStates?.[character.id] && notes.length === 0) return
  const state = inheritDriveState(prev?.driveStates?.[character.id], character.drive, notes)
  await chatsApi.update(newChatId, { driveStates: { [character.id]: state }, skipTouch: true })
}
