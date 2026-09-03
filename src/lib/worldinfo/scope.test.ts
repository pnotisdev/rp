import { describe, expect, it } from 'vitest'
import { bookAppliesToChat, isGlobalBook } from './scope'

const global = { boundChatIds: [] as string[] }
const toChat = { boundChatIds: ['chat-1'], boundCharacterIds: [], boundWorldIds: [] }
const toChar = { boundChatIds: [], boundCharacterIds: ['char-1'], boundWorldIds: [] }
const toWorld = { boundChatIds: [], boundCharacterIds: [], boundWorldIds: ['world-1'] }

describe('World Info book scoping', () => {
  it('treats a book with no bindings as global', () => {
    expect(isGlobalBook(global)).toBe(true)
    expect(bookAppliesToChat(global, { chatId: 'anything' })).toBe(true)
  })

  it('treats a book with any binding as non-global', () => {
    expect(isGlobalBook(toChat)).toBe(false)
    expect(isGlobalBook(toChar)).toBe(false)
    expect(isGlobalBook(toWorld)).toBe(false)
  })

  it('matches a chat-bound book only for that chat', () => {
    expect(bookAppliesToChat(toChat, { chatId: 'chat-1' })).toBe(true)
    expect(bookAppliesToChat(toChat, { chatId: 'chat-2' })).toBe(false)
  })

  it('matches a character-bound book by the chat\'s primary character', () => {
    expect(bookAppliesToChat(toChar, { chatId: 'c', characterId: 'char-1' })).toBe(true)
    expect(bookAppliesToChat(toChar, { chatId: 'c', characterId: 'char-2' })).toBe(false)
    expect(bookAppliesToChat(toChar, { chatId: 'c' })).toBe(false)
  })

  it('matches a world-bound book by the primary character\'s world', () => {
    expect(bookAppliesToChat(toWorld, { chatId: 'c', worldId: 'world-1' })).toBe(true)
    expect(bookAppliesToChat(toWorld, { chatId: 'c', worldId: 'world-2' })).toBe(false)
    expect(bookAppliesToChat(toWorld, { chatId: 'c' })).toBe(false)
  })

  it('matches if any one of several bindings matches', () => {
    const multi = { boundChatIds: ['chat-9'], boundCharacterIds: ['char-9'], boundWorldIds: ['world-1'] }
    expect(bookAppliesToChat(multi, { chatId: 'chat-1', characterId: 'char-1', worldId: 'world-1' })).toBe(true)
    expect(bookAppliesToChat(multi, { chatId: 'chat-1', characterId: 'char-1', worldId: 'world-2' })).toBe(false)
  })

  it('tolerates the legacy shape (boundChatIds only, other fields undefined)', () => {
    expect(isGlobalBook({ boundChatIds: [] })).toBe(true)
    expect(bookAppliesToChat({ boundChatIds: ['chat-1'] }, { chatId: 'chat-1' })).toBe(true)
    expect(bookAppliesToChat({ boundChatIds: ['chat-1'] }, { chatId: 'chat-2' })).toBe(false)
  })
})
