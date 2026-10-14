import { useState } from 'react'
import { importLorebookFile, downloadLorebook } from '@/lib/worldinfo/lorebookIo'
import { FileButton } from '@/components/ui/FileButton'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { ChevronDown, Plus, X } from 'lucide-react'
import type { Lorebook, LorebookEntry, WorldInfoActivationMode } from '@/lib/characters/cardSpec'
import type { AiLoreSubject } from '@/lib/characters/aiAssist'
import { anyKeyIsRisky } from '@/lib/text/regexSafety'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { SuggestLoreDialog } from './SuggestLoreDialog'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'

function nextId(entries: LorebookEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.id ?? 0), 0) + 1
}

const ACTIVATION_MODES: { id: WorldInfoActivationMode; label: string }[] = [
  { id: 'always', label: 'Always' },
  { id: 'keyword', label: 'When relevant' },
  { id: 'manual', label: 'Manual' },
]

const BLANK_ENTRY = (id: number): LorebookEntry => ({
  id,
  keys: [],
  content: '',
  constant: false,
  selective: false,
  insertion_order: 100,
  enabled: true,
  position: 'before_char',
  activationMode: 'keyword',
})

export function LorebookEditor({
  book,
  onChange,
  aiContext,
}: {
  book: Lorebook
  onChange: (book: Lorebook) => void
  /** When editing a character's or world's own lore, pass it so "Suggest with AI" can ground its proposals. */
  aiContext?: AiLoreSubject
}) {
  const [suggesting, setSuggesting] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const updateEntry = (id: number, patch: Partial<LorebookEntry>) => {
    onChange({ ...book, entries: book.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }
  const importEntries = async (file: File) => {
    try {
      const incoming = await importLorebookFile(file)
      let id = nextId(book.entries)
      onChange({ ...book, name: book.name || incoming.name, entries: [...book.entries, ...incoming.entries.map((e) => ({ ...e, id: id++ }))] })
      toastSuccess(`Added ${incoming.entries.length} entries from ${file.name}.`)
    } catch (e) {
      toastError(errorMessage(e))
    }
  }
  const addEntry = () => onChange({ ...book, entries: [...book.entries, BLANK_ENTRY(nextId(book.entries))] })
  const removeEntry = (id: number) => onChange({ ...book, entries: book.entries.filter((e) => e.id !== id) })
  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div>
      <div className="mb-5 grid grid-cols-1 gap-x-3 sm:grid-cols-[1fr_140px]">
        <TextField label="Book name" value={book.name ?? ''} onChange={(e) => onChange({ ...book, name: e.target.value })} />
        <NumberField
          label="Token budget"
          value={book.token_budget ?? 512}
          onChange={(e) => onChange({ ...book, token_budget: Number(e.target.value) })}
        />
        <div className="sm:col-span-2 rounded-xl bg-bg-sunken px-4 py-0.5">
          <Toggle
            checked={book.recursive_scanning ?? false}
            onChange={(v) => onChange({ ...book, recursive_scanning: v })}
            label="Recursive scanning"
            description="Activated entries are re-scanned for further keyword matches, so one entry can pull in another it mentions."
          />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <FileButton onPick={(f) => importEntries(f[0])} accept=".json,.png" title="Add entries from a SillyTavern World Info file, a lorebook JSON, or a card PNG">
          Import entries
        </FileButton>
        <Button onClick={() => downloadLorebook(book)} disabled={book.entries.length === 0}>
          Export
        </Button>
      </div>

      <div className="space-y-3">
        {book.entries.map((entry) => {
          const mode = entry.activationMode ?? (entry.constant ? 'always' : 'keyword')
          const isOpen = expanded.has(entry.id!)
          return (
            <div key={entry.id} className="rounded-xl bg-bg-sunken p-4">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <TextField
                    label="Keys"
                    hint="Comma separated. Wrap one in /slashes/ for a regex."
                    value={entry.keys.join(', ')}
                    onChange={(e) =>
                      updateEntry(entry.id!, { keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })
                    }
                  />
                  {anyKeyIsRisky(entry.keys) && (
                    <p className="-mt-2 mb-3 text-[11px] text-warning">
                      One of these regex keys has a nested-quantifier shape that can run catastrophically slowly on
                      the wrong input. Worth double-checking, though plenty of legitimate patterns look like this too.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id!)}
                  aria-label="Remove entry"
                  className="mt-6 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <X size={15} strokeWidth={2} />
                </button>
              </div>

              <TextAreaField
                label="Content"
                rows={2}
                value={entry.content}
                onChange={(e) => updateEntry(entry.id!, { content: e.target.value })}
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="inline-flex rounded-lg border border-border bg-bg-elevated p-0.5">
                  {ACTIVATION_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => updateEntry(entry.id!, { activationMode: m.id, constant: m.id === 'always' })}
                      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                        mode === m.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateEntry(entry.id!, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => toggleExpanded(entry.id!)}
                  className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-text"
                >
                  Options
                  <ChevronDown size={13} strokeWidth={2} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-4">
                    <NumberField
                      label="Order"
                      value={entry.insertion_order}
                      onChange={(e) => updateEntry(entry.id!, { insertion_order: Number(e.target.value) || 0 })}
                    />
                    <SelectField
                      label="Position"
                      value={entry.position ?? 'before_char'}
                      onChange={(e) =>
                        updateEntry(entry.id!, { position: e.target.value as NonNullable<LorebookEntry['position']> })
                      }
                    >
                      <option value="before_char">Before card</option>
                      <option value="after_char">After card</option>
                      <option value="at_depth">At depth</option>
                      <option value="outlet">Outlet (macro)</option>
                    </SelectField>
                    {entry.position === 'outlet' && (
                      <TextField
                        label="Outlet name"
                        hint="Placed with {{outlet::name}}"
                        value={entry.outletName ?? ''}
                        onChange={(e) => updateEntry(entry.id!, { outletName: e.target.value.trim() || undefined })}
                      />
                    )}
                    {entry.position === 'at_depth' && (
                      <NumberField
                        label="Depth"
                        min={0}
                        hint="Messages up from the latest"
                        value={entry.depth ?? 2}
                        onChange={(e) => updateEntry(entry.id!, { depth: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    )}
                    <NumberField
                      label="Unlock warmth"
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
                    />
                    {mode === 'keyword' && (
                      <NumberField
                        label="Chance %"
                        min={0}
                        max={100}
                        value={entry.probability ?? 100}
                        onChange={(e) =>
                          updateEntry(entry.id!, { probability: Math.max(0, Math.min(100, Number(e.target.value))) || 0 })
                        }
                      />
                    )}
                    <NumberField
                      label="Scan depth"
                      min={0}
                      hint="Messages to scan for this entry; empty uses the book's."
                      value={entry.scanDepth ?? ''}
                      onChange={(e) =>
                        updateEntry(entry.id!, {
                          scanDepth: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0),
                        })
                      }
                      placeholder="book"
                    />
                    <NumberField
                      label="Delay"
                      min={0}
                      hint="Won't activate until the chat has this many messages."
                      value={entry.delay ?? ''}
                      onChange={(e) =>
                        updateEntry(entry.id!, {
                          delay: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0),
                        })
                      }
                      placeholder="off"
                    />
                  </div>

                  {mode === 'keyword' && (
                    <>
                      <div className="grid grid-cols-2 gap-x-3">
                        <NumberField
                          label="Sticky"
                          min={0}
                          hint="Stays active this many turns after the keyword stops matching."
                          value={entry.sticky ?? ''}
                          onChange={(e) =>
                            updateEntry(entry.id!, {
                              sticky: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0),
                            })
                          }
                          placeholder="off"
                        />
                        <NumberField
                          label="Cooldown"
                          min={0}
                          hint="Can't re-fire by keyword for this many turns after it deactivates."
                          value={entry.cooldown ?? ''}
                          onChange={(e) =>
                            updateEntry(entry.id!, {
                              cooldown:
                                e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)) || 0),
                            })
                          }
                          placeholder="off"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[1fr_120px]">
                        <TextField
                          label="Inclusion group"
                          hint="Entries sharing a group are mutually exclusive: only one fires."
                          value={entry.group ?? ''}
                          onChange={(e) => updateEntry(entry.id!, { group: e.target.value || undefined })}
                          placeholder="none"
                        />
                        {entry.group && (
                          <NumberField
                            label="Weight"
                            min={0}
                            hint="Set on any member for a weighted random pick"
                            value={entry.groupWeight ?? ''}
                            onChange={(e) =>
                              updateEntry(entry.id!, {
                                groupWeight: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            placeholder="order wins"
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                          <input
                            type="checkbox"
                            checked={!!entry.case_sensitive}
                            onChange={(e) => updateEntry(entry.id!, { case_sensitive: e.target.checked })}
                          />
                          Case sensitive
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                          <input
                            type="checkbox"
                            checked={!!entry.selective}
                            onChange={(e) => updateEntry(entry.id!, { selective: e.target.checked })}
                          />
                          Also require a secondary key
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                          <input
                            type="checkbox"
                            checked={!!entry.matchWholeWords}
                            onChange={(e) => updateEntry(entry.id!, { matchWholeWords: e.target.checked || undefined })}
                          />
                          Whole words only
                        </label>
                      </div>
                      {entry.group && (
                        <div className="flex flex-wrap items-center gap-x-4">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                            <input
                              type="checkbox"
                              checked={!!entry.groupOverride}
                              onChange={(e) => updateEntry(entry.id!, { groupOverride: e.target.checked || undefined })}
                            />
                            Beats the rest of its group
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                            <input
                              type="checkbox"
                              checked={!!entry.useGroupScoring}
                              onChange={(e) => updateEntry(entry.id!, { useGroupScoring: e.target.checked || undefined })}
                            />
                            Most keys found wins
                          </label>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4">
                        {(
                          [
                            ['excludeRecursion', 'Not triggered by other entries'],
                            ['preventRecursion', "Does not trigger other entries"],
                            ['delayUntilRecursion', 'Only triggered by other entries'],
                            ['ignoreBudget', 'Ignore the token budget'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                            <input
                              type="checkbox"
                              checked={!!entry[key]}
                              onChange={(e) => updateEntry(entry.id!, { [key]: e.target.checked || undefined })}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {entry.selective && (
                        <>
                          <TextField
                            label="Secondary keys"
                            hint="Comma separated. Any one is enough, alongside a primary key match."
                            value={(entry.secondary_keys ?? []).join(', ')}
                            onChange={(e) =>
                              updateEntry(entry.id!, {
                                secondary_keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                              })
                            }
                          />
                          <SelectField
                            label="Secondary key logic"
                            value={entry.selectiveLogic ?? 'and_any'}
                            onChange={(e) =>
                              updateEntry(entry.id!, { selectiveLogic: e.target.value === 'and_any' ? undefined : (e.target.value as NonNullable<LorebookEntry['selectiveLogic']>) })
                            }
                          >
                            <option value="and_any">Any secondary key</option>
                            <option value="and_all">Every secondary key</option>
                            <option value="not_any">No secondary key</option>
                            <option value="not_all">Not every secondary key</option>
                          </SelectField>
                          {anyKeyIsRisky(entry.secondary_keys ?? []) && (
                            <p className="-mt-2 mb-3 text-[11px] text-warning">
                              One of these regex keys has a nested-quantifier shape that can run catastrophically
                              slowly on the wrong input. Worth double-checking, though plenty of legitimate patterns
                              look like this too.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {book.entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
            No entries yet.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={addEntry} className="flex items-center gap-1.5">
          <Plus size={15} strokeWidth={2} />
          Add entry
        </Button>
        {aiContext && (
          <Button onClick={() => setSuggesting(true)} className="flex items-center gap-1.5">
            Suggest with AI
          </Button>
        )}
      </div>
      {suggesting && aiContext && (
        <SuggestLoreDialog
          subject={aiContext}
          existing={book.entries}
          onAdd={(added) => onChange({ ...book, entries: [...book.entries, ...added] })}
          onClose={() => setSuggesting(false)}
        />
      )}
    </div>
  )
}
