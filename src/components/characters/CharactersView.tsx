import { useEffect, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { CharacterList } from './CharacterList'
import { CharacterEditor } from './CharacterEditor'
import type { NewCharacterStart } from './NewCharacterDialog'

export function CharactersView({
  initialCharacterId,
  onConsumedInitial,
}: {
  /** Deep-link into this character's editor on mount (the command palette's "jump to a character"). */
  initialCharacterId?: string | null
  onConsumedInitial?: () => void
} = {}) {
  const [selected, setSelected] = useState<Character | null | 'new'>(null)
  const [start, setStart] = useState<NewCharacterStart>('blank')
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []

  useEffect(() => {
    if (!initialCharacterId) return
    const match = characters.find((c) => c.id === initialCharacterId)
    if (!match) return
    setSelected(match)
    onConsumedInitial?.()
    // Only re-run when the target id changes (or the list finishes loading)
  }, [initialCharacterId, characters.length])

  if (selected === null) {
    return <CharacterList onSelect={(c) => setSelected(c)} onCreateNew={(s) => {
          setStart(s)
          setSelected('new')
        }} />
  }

  return (
    <CharacterEditor
      key={selected === 'new' ? 'new' : selected.id}
      character={selected === 'new' ? null : selected}
      start={start}
      onSaved={() => setSelected(null)}
      onDeleted={() => setSelected(null)}
    />
  )
}
