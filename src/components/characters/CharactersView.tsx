import { useState } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import { CharacterList } from './CharacterList'
import { CharacterEditor } from './CharacterEditor'

export function CharactersView() {
  const [selected, setSelected] = useState<Character | null | 'new'>(null)

  if (selected === null) {
    return <CharacterList onSelect={(c) => setSelected(c)} onCreateNew={() => setSelected('new')} />
  }

  return (
    <CharacterEditor
      character={selected === 'new' ? null : selected}
      onSaved={() => setSelected(null)}
      onDeleted={() => setSelected(null)}
    />
  )
}
