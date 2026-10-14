import { useRef, useState } from 'react'
import { suggestLoreEntries, type AiLoreSubject } from '@/lib/characters/aiAssist'
import type { LorebookEntry } from '@/lib/characters/cardSpec'
import { isAbortError } from '@/lib/characters/generateFullCharacter'
import { resolveAssistShaping } from '@/lib/api/assistShaping'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { toLorebookEntries } from '@/lib/world/generateWorld'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { LoreReviewList, type ReviewEntry } from './LoreReviewList'

const nextId = (entries: LorebookEntry[]) => entries.reduce((max, e) => Math.max(max, e.id ?? 0), 0) + 1

/** Asks the model for new lore, then lets the user pick which entries to keep before anything is added. */
export function SuggestLoreDialog({
  subject,
  existing,
  onAdd,
  onClose,
}: {
  subject: AiLoreSubject
  existing: LorebookEntry[]
  onAdd: (entries: LorebookEntry[]) => void
  onClose: () => void
}) {
  const client = useChatBackendClient()
  const [focus, setFocus] = useState('')
  const [count, setCount] = useState<'4' | '6' | '10'>('6')
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stop = () => abortRef.current?.abort()

  const suggest = async () => {
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const found = await suggestLoreEntries(client, subject, existing, Number(count), controller.signal, focus, await resolveAssistShaping(120_000))
      if (found.length === 0) throw new Error("The model didn't propose any usable entries. Try again.")
      setEntries(found.map((s) => ({ title: s.title ?? s.keys[0], keys: s.keys, content: s.content, keep: true })))
    } catch (e) {
      if (!isAbortError(e) && !controller.signal.aborted) toastError(errorMessage(e))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const add = () => {
    onAdd(toLorebookEntries((entries ?? []).filter((e) => e.keep), nextId(existing)))
    onClose()
  }
  const kept = entries?.filter((e) => e.keep).length ?? 0

  return (
    <Modal
      onClose={busy ? stop : onClose}
      title="Suggest lore with AI"
      description={entries ? 'Untick anything you do not want, edit the rest, then add it to the book.' : `The model proposes new entries for ${subject.name || 'this book'}, avoiding what is already written.`}
      size="xl"
      scrollable
    >
      <div className="flex-1 overflow-y-auto">
        {entries ? (
          <LoreReviewList entries={entries} onChange={setEntries} />
        ) : (
          <>
            <TextField label="Focus (optional)" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. the rival guilds, or this town's festivals" disabled={busy} />
            <p className="mb-1 text-xs font-medium text-text-muted">How many</p>
            <SegmentedControl
              options={[
                { value: '4', label: '4' },
                { value: '6', label: '6' },
                { value: '10', label: '10' },
              ]}
              value={count}
              onChange={setCount}
            />
            {busy && <p className="mt-4 rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">Writing entries…</p>}
          </>
        )}
      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-2">
        {entries ? (
          <>
            <Button variant="ghost" onClick={() => setEntries(null)}>
              Back
            </Button>
            <Button variant="primary" onClick={add} disabled={kept === 0}>
              Add {kept} {kept === 1 ? 'entry' : 'entries'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={busy ? stop : onClose}>
              {busy ? 'Stop' : 'Cancel'}
            </Button>
            <Button variant="primary" onClick={() => void suggest()} disabled={busy}>
              {busy ? 'Working…' : 'Suggest'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
