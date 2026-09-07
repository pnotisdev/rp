import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { getRelationshipTrack } from '@/lib/dating/stage'
import { ALL_HOLIDAYS, daysUntilAnnualDate, getCalendarInfo } from '@/lib/world/calendar'
import { Modal } from '@/components/ui/Modal'

interface KeyDate {
  emoji: string
  label: string
  dayOfYear: number
}

interface CalendarPanelProps {
  world: WorldCard
  character: Character
  participantCharacters: Character[]
  chat: Chat
  onClose: () => void
}

/** Birthdays, relationship anniversaries, and the world's fixed holidays, sorted by how soon each
 *  comes around again — a small, flat "key dates" list rather than a full month-grid calendar,
 *  since that's genuinely all there is to show today. See `daysUntilAnnualDate`'s own doc comment:
 *  every one of these is just "a day-of-year to count down to." */
export function CalendarPanel({ world, character, participantCharacters, chat, onClose }: CalendarPanelProps) {
  const day = world.currentDay ?? 0
  const info = getCalendarInfo(day)

  const dates: KeyDate[] = []
  for (const c of [character, ...participantCharacters]) {
    if (c.birthday === undefined) continue
    dates.push({ emoji: '🎂', label: `${c.card.name}'s birthday`, dayOfYear: c.birthday })
  }
  for (const c of [character, ...participantCharacters]) {
    const track = getRelationshipTrack(chat, c.id)
    if (!track.commitmentStatus || track.commitmentStatus === 'none' || track.commitmentStartedDay === undefined) continue
    dates.push({ emoji: '💞', label: `Anniversary with ${c.card.name}`, dayOfYear: track.commitmentStartedDay })
  }
  for (const holiday of ALL_HOLIDAYS) {
    dates.push({ emoji: '✨', label: holiday.name, dayOfYear: holiday.dayOfYear })
  }

  const sorted = dates
    .map((d) => ({ ...d, daysUntil: daysUntilAnnualDate(day, d.dayOfYear) }))
    .sort((a, b) => a.daysUntil - b.daysUntil)

  return (
    <Modal
      onClose={onClose}
      title="Key dates"
      description={`Day ${info.day} — ${info.weekday}, ${info.season} (${info.dayOfSeason}/28)`}
      size="lg"
      scrollable
    >
      <div className="flex flex-col gap-2">
        {sorted.map((d) => (
          <div key={`${d.label}-${d.dayOfYear}`} className="flex items-center justify-between rounded-xl bg-bg-sunken px-3 py-2.5">
            <span className="text-sm text-text">
              {d.emoji} {d.label}
            </span>
            <span className="text-xs text-text-muted">
              {d.daysUntil === 0 ? 'Today!' : `in ${d.daysUntil} day${d.daysUntil === 1 ? '' : 's'}`}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
