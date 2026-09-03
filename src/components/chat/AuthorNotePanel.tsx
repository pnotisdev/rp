import { useState } from 'react'
import type { AuthorNote } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'

const POSITIONS: { id: AuthorNote['position']; label: string; hint: string }[] = [
  {
    id: 'at_depth',
    label: 'In the conversation, near the end',
    hint: "Strongest. Sits a few messages up from the latest — like a note the character just read.",
  },
  {
    id: 'after_char',
    label: 'Right after the character card',
    hint: 'Medium. Between the character definition and the conversation history.',
  },
  {
    id: 'before_char',
    label: 'Before the character card',
    hint: 'Lightest. Setting-level framing the rest of the prompt builds on.',
  },
]

export function AuthorNotePanel({
  note,
  onClose,
  onSave,
}: {
  note: AuthorNote | undefined
  onClose: () => void
  onSave: (note: AuthorNote | null) => Promise<void>
}) {
  const [text, setText] = useState(note?.text ?? '')
  const [position, setPosition] = useState<AuthorNote['position']>(note?.position ?? 'at_depth')
  const [depth, setDepth] = useState(note?.depth ?? 2)
  const [busy, setBusy] = useState(false)

  const save = async (payload: AuthorNote | null) => {
    setBusy(true)
    try {
      await onSave(payload)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Author's note"
      description={
        'A steering note for this chat only — folded into every prompt without ever becoming something a character "said". Good for tone ("keep replies short and tense"), a detail the model keeps forgetting, or a scene direction. It travels with this conversation, not the character card. Clear the text to turn it off.'
      }
      size="lg"
      scrollable
    >
      <div className="flex-1 overflow-y-auto">
        <TextAreaField
          label="Note"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Keep {{char}}'s replies to two or three sentences. The mood is quiet and a little sad."
          hint="Supports {{char}} / {{user}}."
        />

        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium text-text-muted">Where it goes</span>
          <div className="flex flex-col gap-1.5">
            {POSITIONS.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-bg-sunken px-3 py-2.5 text-sm"
              >
                <input
                  type="radio"
                  name="author-note-position"
                  className="mt-0.5"
                  checked={position === p.id}
                  onChange={() => setPosition(p.id)}
                />
                <span>
                  <span className="block text-text">{p.label}</span>
                  <span className="block text-[11px] text-text-muted">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {position === 'at_depth' && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              Depth: {depth} message{depth === 1 ? '' : 's'} from the end
            </span>
            <input
              type="range"
              min={0}
              max={8}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <span className="mt-1 block text-[11px] text-text-muted">
              0 = immediately before the model replies. Higher = further back in the conversation, so
              it blends in more and steers a little less sharply.
            </span>
          </label>
        )}
      </div>

      <div className="mt-5 flex shrink-0 items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => save(null)} disabled={busy || !note}>
          Clear note
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => save(text.trim() ? { text: text.trim(), position, depth } : null)}
            disabled={busy}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
