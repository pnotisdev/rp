import { useState } from 'react'
import type { DateEventCard } from '@/lib/types'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { isLiveScene } from '@/lib/dating/stage'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface DateEventPanelProps {
  currentEvent?: DateEventCard
  /** Actions left today in this character's world, per 10a's energy economy — undefined when there's no world (unlimited). */
  energyRemaining?: number
  onClose: () => void
  onSuggest: () => Promise<DateEventCard | null>
  onStart: (event: DateEventCard) => Promise<void>
  onEnd: () => Promise<void>
}

export function DateEventPanel({ currentEvent, energyRemaining, onClose, onSuggest, onStart, onEnd }: DateEventPanelProps) {
  const [event, setEvent] = useState<DateEventCard | null>(currentEvent ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const isLiveDate = isLiveScene(currentEvent)
  const isHangout = event?.kind === 'hangout'
  const spendsEnergy = event?.kind === 'date' || event?.kind === 'hangout'
  const outOfEnergy = spendsEnergy && energyRemaining === 0

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
    const liveIsHangout = currentEvent.kind === 'hangout'
    return (
      <Modal
        onClose={onClose}
        title={liveIsHangout ? 'Live hangout in progress' : 'Live date in progress'}
        description={
          liveIsHangout
            ? "Relationship movement is scored once, gently, when the hangout ends — not turn by turn while it's happening. This is low-stakes: no hidden agenda, no risk of it ending badly."
            : "Relationship movement is scored once, honestly, when the date ends — not turn by turn while it's happening. A flat or awkward date won't quietly move things forward."
        }
        size="lg"
      >
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
            {busy === 'end' ? 'Ending…' : liveIsHangout ? 'End hangout' : 'End date'}
          </Button>
      </Modal>
    )
  }

  return (
    <Modal
      onClose={onClose}
      title="Date / Event"
      description={
        'Generate a scene event card and start it as the active objective. This also biases VN backgrounds to the event location. Starting a "date" or "hangout" card begins a live, end-of-scene-scored scene — a hangout is the lower-stakes version, with no hidden agenda and no risk of it going badly.'
      }
      size="lg"
    >
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
                {event.kind && <span className="rounded-md bg-bg-elevated px-2 py-0.5 uppercase">{event.kind}</span>}
                {event.backgroundId && <span className="rounded-md bg-bg-elevated px-2 py-0.5">bg: {event.backgroundId}</span>}
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
            disabled={busy !== null || !event || outOfEnergy}
          >
            {busy === 'start' ? 'Starting…' : 'Start this event'}
          </Button>
        </div>
        {spendsEnergy && energyRemaining !== undefined && (
          <p className="mt-2 text-[11px] text-text-muted">
            {outOfEnergy
              ? `No energy left today — get some rest before starting another ${isHangout ? 'hangout' : 'date'}.`
              : `Uses 1 of your ${energyRemaining} remaining actions today.`}
          </p>
        )}
    </Modal>
  )
}
