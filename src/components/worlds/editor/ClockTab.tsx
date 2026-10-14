import { getCalendarInfo, getEnergyRemaining, getMaxEnergyForDay, getWeather, describeWeather, PHASES } from '@/lib/world/calendar'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import type { EditorState } from './useWorldEditor'

export function ClockTab({ f }: { f: EditorState }) {
  const { world, currentDay, currentPhaseIndex, advancing, advanceClock } = f
  if (!world) return null
  return (
    <Section
      title="World clock"
      description="Shared by every chat in this world. Advancing it moves every character's mood and weather forward. A manual authoring step that doesn't spend an action."
    >
      {(() => {
        const info = getCalendarInfo(currentDay)
        const weather = getWeather(world.id, currentDay)
        return (
          <>
            <div className="mb-1 text-sm text-text">
              Day {info.day} · {info.weekday}, {info.season} ({info.dayOfSeason}/28)
              {info.holiday ? <span className="text-romance"> · {info.holiday}</span> : null}
            </div>
            <div className="mb-4 text-xs text-text-muted">
              {PHASES[currentPhaseIndex]}, {describeWeather(weather)} ·{' '}
              {getEnergyRemaining(currentDay, currentPhaseIndex)}/{getMaxEnergyForDay(currentDay)} actions left today
            </div>
            <Button variant="secondary" onClick={advanceClock} disabled={advancing}>
              {advancing
                ? 'Advancing…'
                : `Advance to ${PHASES[(currentPhaseIndex + 1) % PHASES.length]}${
                    currentPhaseIndex === PHASES.length - 1 ? ' (next day)' : ''
                  }`}
            </Button>
          </>
        )
      })()}
    </Section>
  )
}
