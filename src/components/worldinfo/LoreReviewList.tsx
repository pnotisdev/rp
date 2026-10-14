import { useState } from 'react'
import type { DraftLoreEntry } from '@/lib/world/generateWorld'

export interface ReviewEntry extends DraftLoreEntry {
  keep: boolean
}

/** Keys are edited as plain text and parsed when the field is left, so a trailing comma does not vanish mid-typing. */
function KeysInput({ keys, onCommit }: { keys: string[]; onCommit: (next: string[]) => void }) {
  const [raw, setRaw] = useState(keys.join(', '))
  const commit = () => {
    const next = raw.split(',').map((k) => k.trim()).filter(Boolean)
    onCommit(next)
    setRaw(next.join(', '))
  }
  return (
    <input
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      aria-label="Trigger words"
      placeholder="Trigger words, separated by commas"
      className="w-full rounded-lg bg-bg-elevated px-2.5 py-1.5 text-xs text-text-muted outline-none focus:border-accent/70"
    />
  )
}

/** AI-drafted lore entries to review before saving: tick to keep, edit title, trigger words and text in place. */
export function LoreReviewList({ entries, onChange }: { entries: ReviewEntry[]; onChange: (next: ReviewEntry[]) => void }) {
  const kept = entries.filter((e) => e.keep).length
  const patch = (index: number, change: Partial<ReviewEntry>) => onChange(entries.map((e, i) => (i === index ? { ...e, ...change } : e)))
  const setAll = (keep: boolean) => onChange(entries.map((e) => ({ ...e, keep })))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
        <span>
          {kept} of {entries.length} selected
        </span>
        <span className="flex gap-1">
          <button type="button" onClick={() => setAll(true)} className="rounded-lg px-2 py-1 transition-colors hover:text-text">
            All
          </button>
          <button type="button" onClick={() => setAll(false)} className="rounded-lg px-2 py-1 transition-colors hover:text-text">
            None
          </button>
        </span>
      </div>
      <ul className="space-y-2">
        {entries.map((entry, i) => (
          <li key={i} className={`rounded-xl bg-bg-sunken p-3 transition-opacity ${entry.keep ? '' : 'opacity-50'}`}>
            <div className="mb-2 flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={entry.keep}
                onChange={(e) => patch(i, { keep: e.target.checked })}
                aria-label={`Keep ${entry.title}`}
                className="h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--c-accent))]"
              />
              <input
                value={entry.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                aria-label="Title"
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-text outline-none"
              />
            </div>
            <KeysInput keys={entry.keys} onCommit={(keys) => patch(i, { keys })} />
            <textarea
              rows={3}
              value={entry.content}
              onChange={(e) => patch(i, { content: e.target.value })}
              aria-label="Entry text"
              className="mt-2 w-full resize-y rounded-lg bg-bg-elevated px-2.5 py-2 text-[13px] leading-relaxed text-text outline-none focus:border-accent/70"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
