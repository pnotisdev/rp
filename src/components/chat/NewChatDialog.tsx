import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, personasApi, worldsApi } from '@/lib/api/client'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { availableGreetings, createChat } from '@/lib/chat/createChat'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export function NewChatDialog({
  onCreated,
  onClose,
  initialCharacterId = '',
}: {
  onCreated: (chatId: string) => void
  onClose: () => void
  /** Pre-select this character (from the Welcome screen's "Chat with …" shortcut). */
  initialCharacterId?: string
}) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const client = useChatBackendClient()
  const [characterId, setCharacterId] = useState<string>(initialCharacterId)
  const [personaId, setPersonaId] = useState<string>('')
  const [personaName, setPersonaName] = useState('')
  const [personaDescription, setPersonaDescription] = useState('')
  const [greetingIndex, setGreetingIndex] = useState(0)
  const [starterId, setStarterId] = useState<string>('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // A first-ever chat has no personas to pick from — offer a one-line "who you are" inline instead
  // of sending the model a bare hardcoded "You" (see ROADMAP §13 / the persona-get-route bug, #41).
  const noPersonas = personas.length === 0

  const toggleParticipant = (id: string) => {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const character = characters.find((c) => c.id === characterId)
  const world = worlds.find((w) => w.id === character?.worldId)
  const starters = character?.relationshipStarters ?? []
  const starter = starters.find((s) => s.id === starterId)
  const greetingOptions = character ? availableGreetings(character) : []

  const create = async () => {
    if (!character || busy) return
    setBusy(true)
    try {
      await doCreate()
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async () => {
    if (!character) return
    // Resolve the persona: an existing pick, or a fresh one minted from the inline name/description.
    let resolvedPersonaId = personaId
    let persona = personas.find((p) => p.id === personaId)
    if (noPersonas && personaName.trim()) {
      persona = await personasApi.create({
        name: personaName.trim(),
        description: personaDescription.trim(),
      })
      resolvedPersonaId = persona.id
    }
    const chat = await createChat({
      character,
      world,
      personaId: resolvedPersonaId || '',
      personaName: persona?.name,
      participantIds,
      startingAffection: starter?.startingAffection ?? 0,
      summary: starter?.blurb || undefined,
      greetingIndex: greetingOptions.length > 0 ? greetingIndex : -1,
      client,
    })
    onCreated(chat.id)
  }

  return (
    <Modal onClose={onClose} title="New chat" size="sm" hideHeaderClose scrollable>
      <div className="flex-1 overflow-y-auto">
        <label className="mb-1 block text-xs text-text-muted">Character</label>
        <select
          value={characterId}
          onChange={(e) => {
            setCharacterId(e.target.value)
            setGreetingIndex(0)
            setStarterId('')
            setParticipantIds((prev) => prev.filter((id) => id !== e.target.value))
          }}
          className="mb-3 w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
        >
          <option value="">Select a character…</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.card.name}
            </option>
          ))}
        </select>

        {characters.length > 1 && (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-text-muted">
              Other characters in this scene (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {characters
                .filter((c) => c.id !== characterId)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleParticipant(c.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      participantIds.includes(c.id) ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'
                    }`}
                  >
                    {c.card.name}
                  </button>
                ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {participantIds.length > 0
                ? "They'll be able to speak, but relationship tracking/gifts/gallery stay with the character above."
                : 'A group scene — pick who else can speak besides the character above.'}
            </p>
          </div>
        )}

        {noPersonas ? (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-text-muted">Chatting as</label>
            <input
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="Your name (optional)"
              className="mb-2 w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
            />
            <input
              value={personaDescription}
              onChange={(e) => setPersonaDescription(e.target.value)}
              placeholder="A line about who you are (optional)"
              className="w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
            />
            <p className="mt-1.5 text-[11px] text-text-muted">
              {personaName.trim()
                ? 'Saved as a reusable persona — the model addresses you by this.'
                : "Leave blank and you're just “You”. Even a name gives the model something to work with."}
            </p>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs text-text-muted">Persona</label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="mb-4 w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
            >
              <option value="">Default (You)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}

        {starters.length > 0 && (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-text-muted">How you know each other</label>
            <select
              value={starterId}
              onChange={(e) => setStarterId(e.target.value)}
              className="w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
            >
              <option value="">Blank slate — near strangers, 0 affection</option>
              {starters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.startingAffection} affection)
                </option>
              ))}
            </select>
            {starter?.blurb && <p className="mt-1.5 text-xs text-text-muted">{starter.blurb}</p>}
          </div>
        )}

        {greetingOptions.length > 1 && (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-text-muted">Opening line</label>
            <div className="flex flex-wrap gap-1.5">
              {greetingOptions.map((g, i) => (
                <button
                  key={i}
                  type="button"
                  title={g}
                  onClick={() => setGreetingIndex(i)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    greetingIndex === i ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <p className="mt-1.5 truncate text-xs text-text-muted">{greetingOptions[greetingIndex]}</p>
          </div>
        )}

      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={create} disabled={!characterId || busy}>
          {busy ? 'Starting…' : 'Start chat'}
        </Button>
      </div>
    </Modal>
  )
}
