import { useState } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import { CharacterList } from './CharacterList'
import { CharacterEditor } from './CharacterEditor'
import { Button } from '@/components/ui/Button'

export function CharactersView() {
  const [selected, setSelected] = useState<Character | null | 'new'>(null)

  if (selected === null) {
    return (
      <CharacterList onSelect={(c) => setSelected(c)} onCreateNew={() => setSelected('new')} />
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="bg-bg-elevated px-6 py-3">
        <Button variant="ghost" onClick={() => setSelected(null)}>
          ← Back to characters
        </Button>
      </div>
      <CharacterEditor
        character={selected === 'new' ? null : selected}
        onSaved={() => setSelected(null)}
        onDeleted={() => setSelected(null)}
      />
    </div>
  )
}
