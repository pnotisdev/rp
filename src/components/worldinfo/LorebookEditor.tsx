import { useState } from 'react'
import type { Lorebook, LorebookEntry, WorldInfoActivationMode } from '@/lib/characters/cardSpec'
import { suggestLoreEntries, type AiLoreSubject } from '@/lib/characters/aiAssist'
import { KoboldClient } from '@/lib/api/kobold'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { TextAreaField, TextField } from '@/components/ui/Field'

function nextId(entries: LorebookEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.id ?? 0), 0) + 1
}

export function LorebookEditor({
  book,
  onChange,
  aiContext,
}: {
  book: Lorebook
  onChange: (book: Lorebook) => void
  /** When editing a character's or world's own lore, pass it so "Suggest with AI" can ground its proposals in it. */
  aiContext?: AiLoreSubject
}) {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const [suggesting, setSuggesting] = useState(false)

  const updateEntry = (id: number, patch: Partial<LorebookEntry>) => {
    onChange({
      ...book,
      entries: book.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })
  }

  const addEntry = () => {
    const entry: LorebookEntry = {
      id: nextId(book.entries),
      keys: [],
      content: '',
      constant: false,
      selective: false,
      insertion_order: 100,
      enabled: true,
      position: 'before_char',
      activationMode: 'keyword',
    }
    onChange({ ...book, entries: [...book.entries, entry] })
  }

  const suggestWithAi = async () => {
    if (!aiContext || suggesting) return
    setSuggesting(true)
    try {
      const client = new KoboldClient(baseUrl)
      const suggestions = await suggestLoreEntries(client, aiContext, book.entries)
      if (suggestions.length === 0) throw new Error('The model didn\'t propose any usable entries — try again.')
      let nextBook = book
      for (const s of suggestions) {
        const id = nextId(nextBook.entries)
        nextBook = {
          ...nextBook,
          entries: [
            ...nextBook.entries,
            {
              id,
              keys: s.keys,
              content: s.content,
              constant: false,
              selective: false,
              insertion_order: 100,
              enabled: true,
              position: 'before_char',
              activationMode: 'keyword',
            },
          ],
        }
      }
      onChange(nextBook)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setSuggesting(false)
    }
  }

  const removeEntry = (id: number) => {
    onChange({ ...book, entries: book.entries.filter((e) => e.id !== id) })
  }

  return (
    <div>
      <div className="mb-3 flex gap-3">
        <TextField
          label="Book name"
          value={book.name ?? ''}
          onChange={(e) => onChange({ ...book, name: e.target.value })}
        />
        <TextField
          label="Token budget"
          type="number"
          value={book.token_budget ?? 512}
          onChange={(e) => onChange({ ...book, token_budget: Number(e.target.value) })}
        />
      </div>

      <div className="space-y-4">
        {book.entries.map((entry) => (
          <div key={entry.id} className="rounded-2xl bg-bg-sunken p-6">
            <div className="mb-2 flex items-start justify-between gap-2">
              <TextField
                label="Keys (comma separated)"
                value={entry.keys.join(', ')}
                onChange={(e) =>
                  updateEntry(entry.id!, { keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })
                }
                className="flex-1"
              />
              <Button variant="ghost" onClick={() => removeEntry(entry.id!)} className="mt-5">
                ✕
              </Button>
            </div>
            <TextAreaField
              label="Content"
              rows={2}
              value={entry.content}
              onChange={(e) => updateEntry(entry.id!, { content: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="text-text-muted">Activation:</span>
              {(['always', 'keyword', 'manual'] as WorldInfoActivationMode[]).map((mode) => (
                <label key={mode} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    checked={(entry.activationMode ?? 'keyword') === mode}
                    onChange={() => updateEntry(entry.id!, { activationMode: mode, constant: mode === 'always' })}
                  />
                  <span className="capitalize text-text">
                    {mode === 'keyword' ? 'When relevant' : mode}
                  </span>
                </label>
              ))}
              <Toggle
                checked={entry.enabled}
                onChange={(v) => updateEntry(entry.id!, { enabled: v })}
                label="Enabled"
              />
              <label className="flex items-center gap-1 text-text-muted">
                <span>Unlock @</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Number((entry.extensions as Record<string, unknown> | undefined)?.affectionMin ?? 0)}
                  onChange={(e) =>
                    updateEntry(entry.id!, {
                      extensions: {
                        ...(entry.extensions ?? {}),
                        affectionMin: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      },
                    })
                  }
                  className="w-16 rounded bg-bg-elevated px-2 py-0.5 text-xs text-text outline-none"
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={addEntry}>
          + Add knowledge
        </Button>
        {aiContext && (
          <Button onClick={suggestWithAi} disabled={suggesting}>
            {suggesting ? 'Suggesting…' : 'Suggest lore with AI'}
          </Button>
        )}
      </div>
    </div>
  )
}
