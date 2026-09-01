import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, messagesApi, personasApi } from '@/lib/api/client'
import { substituteMacros } from '@/lib/characters/macros'
import { Button } from '@/components/ui/Button'

export function NewChatDialog({
  onCreated,
  onClose,
}: {
  onCreated: (chatId: string) => void
  onClose: () => void
}) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const [characterId, setCharacterId] = useState<string>('')
  const [personaId, setPersonaId] = useState<string>('')

  const create = async () => {
    const character = characters.find((c) => c.id === characterId)
    const persona = personas.find((p) => p.id === personaId)
    if (!character) return
    const chat = await chatsApi.create({
      characterId,
      personaId: personaId || '',
      title: character.card.name,
    })
    const greeting = character.card.first_mes?.trim()
    if (greeting) {
      const macroCtx = { charName: character.card.name, userName: persona?.name || 'You' }
      const greetings = [greeting, ...(character.card.alternate_greetings ?? [])].map((g) =>
        substituteMacros(g, macroCtx),
      )
      await messagesApi.create({
        chatId: chat.id,
        role: 'char',
        name: character.card.name,
        text: greetings[0],
        swipes: greetings,
        activeSwipe: 0,
      })
    }
    onCreated(chat.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <h2 className="mb-3 text-sm font-semibold text-text">New chat</h2>

        <label className="mb-1 block text-xs text-text-muted">Character</label>
        <select
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
          className="mb-3 w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
        >
          <option value="">Select a character…</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.card.name}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs text-text-muted">Persona</label>
        <select
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          className="mb-4 w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
        >
          <option value="">Default (You)</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!characterId}>
            Start chat
          </Button>
        </div>
      </div>
    </div>
  )
}
