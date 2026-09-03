import type { WorldInfoBook } from '@/lib/types'

export interface BookScopeContext {
  chatId: string
  /** The chat's primary character id, if it's loaded. */
  characterId?: string
  /** The primary character's world id, if it has one. */
  worldId?: string
}

/**
 * A standalone World Info book with no bindings at all is global — it applies to every chat, which
 * is how every book behaved before scoping existed. Once it has any binding, it applies only to a
 * chat that matches one of them: the chat itself, its primary character, or that character's world.
 */
export function isGlobalBook(book: Pick<WorldInfoBook, 'boundChatIds' | 'boundCharacterIds' | 'boundWorldIds'>): boolean {
  return (
    (book.boundChatIds?.length ?? 0) === 0 &&
    (book.boundCharacterIds?.length ?? 0) === 0 &&
    (book.boundWorldIds?.length ?? 0) === 0
  )
}

export function bookAppliesToChat(
  book: Pick<WorldInfoBook, 'boundChatIds' | 'boundCharacterIds' | 'boundWorldIds'>,
  ctx: BookScopeContext,
): boolean {
  if (isGlobalBook(book)) return true
  if (book.boundChatIds?.includes(ctx.chatId)) return true
  if (ctx.characterId && book.boundCharacterIds?.includes(ctx.characterId)) return true
  if (ctx.worldId && book.boundWorldIds?.includes(ctx.worldId)) return true
  return false
}
