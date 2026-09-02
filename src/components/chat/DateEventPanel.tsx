import { useState } from 'react'
import type { DateEventCard } from '@/lib/types'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'

interface DateEventPanelProps {
  currentEvent?: DateEventCard
  onClose: () => void
  onSuggest: () => Promise<DateEventCard | null>
  onStart: (event: DateEventCard) => Promise<void>
  onEnd: () => Promise<void>
}

export function DateEventPanel({ currentEvent, onClose, onSuggest, onStart, onEnd }: DateEventPanelProps) {
  const [event, setEvent] = useState<DateEventCard | null>(currentEvent ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const isLiveDate = currentEvent?.kind === 'date' && !!currentEvent.startedAt

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (isLiveDate && currentEvent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Live date in progress</h2>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
          <p className="mb-3 text-xs text-text-muted">
            Relationship movement is scored once, honestly, when the date ends — not turn by turn
            while it's happening. A flat or awkward date won't quietly move things forward.
          </p>
          <div className="mb-4 rounded-xl bg-bg-sunken p-4">
            <div className="text-sm font-semibold text-text">{currentEvent.title}</div>
            {currentEvent.description && <p className="mt-1 text-xs text-text-muted">{currentEvent.description}</p>}
          </div>
          <Button
            variant="primary"
            onClick={() =>
              run('end', async () => {
                await onEnd()
                onClose()
              })
            }
            disabled={busy !== null}
          >
            {busy === 'end' ? 'Ending…' : 'End date'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Date / Event</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <p className="mb-3 text-xs text-text-muted">
          Generate a scene event card and start it as the active objective. This also biases VN backgrounds to the event location.
          Starting a "date" card begins a live, end-of-scene-scored date.
        </p>

        <div className="mb-4 rounded-xl bg-bg-sunken p-4">
          {event ? (
            <>
              <div className="text-sm font-semibold text-text">{event.title}</div>
              {event.description && <p className="mt-1 text-xs text-text-muted">{event.description}</p>}
              <div className="mt-2 text-xs text-text-muted">
                Objective: <span className="text-text">{event.objectiveTitle}</span>
              </div>
              {event.objectiveDescription && <p className="mt-1 text-xs text-text-muted">{event.objectiveDescription}</p>}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
                {event.kind && <span className="rounded bg-bg-elevated px-2 py-0.5 uppercase">{event.kind}</span>}
                {event.backgroundId && <span className="rounded bg-bg-elevated px-2 py-0.5">bg: {event.backgroundId}</span>}
              </div>
            </>
          ) : (
            <p className="text-xs text-text-muted">No event drafted yet.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              run('suggest', async () => {
                const suggested = await onSuggest()
                setEvent(suggested)
              })
            }
            disabled={busy !== null}
          >
            {busy === 'suggest' ? 'Thinking…' : 'Suggest event with AI'}
          </Button>
          <Button
            variant="primary"
            onClick={() => event && run('start', async () => onStart(event))}
            disabled={busy !== null || !event}
          >
            {busy === 'start' ? 'Starting…' : 'Start this event'}
          </Button>
        </div>
      </div>
    </div>
  )
}
