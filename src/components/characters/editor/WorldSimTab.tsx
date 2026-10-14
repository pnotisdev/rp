import type { OutreachFrequency } from '@/lib/characters/cardSpec'
import { DEFAULT_DRIVE_CONFIG } from '@/lib/persona/drive'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { Chip } from '@/components/ui/Chip'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import {
  PHASES,
  WEATHER_KINDS,
  WEEKDAYS,
  describeWeather,
  type DayPhase,
  type PresenceStatus,
} from '@/lib/world/calendar'
import type { CharacterEditorState } from './useCharacterEditor'

export function WorldSimTab({ f }: { f: CharacterEditorState }) {
  const {
    weatherLoves, weatherHates, schedule, outreachFrequency, setOutreachFrequency, drive, setDrive,
    driveLists, setDriveLists, toggleWeather, addScheduleEntry, updateScheduleEntry,
    removeScheduleEntry, toggleScheduleDay,
  } = f
  return (
    <div className="space-y-10">
      <Section
        title="Weather preferences"
        description="Nudges the world-clock line fed into the prompt when today's weather matches. Never dictates the scene. A kind can be loved or hated, not both."
        surface="bare"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">Loves</div>
            <div className="flex flex-wrap gap-1.5">
              {WEATHER_KINDS.map((kind) => (
                <Chip key={kind} on={weatherLoves.includes(kind)} tone="romance" onClick={() => toggleWeather(kind, 'loves')}>
                  {describeWeather(kind)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">Hates</div>
            <div className="flex flex-wrap gap-1.5">
              {WEATHER_KINDS.map((kind) => (
                <Chip key={kind} on={weatherHates.includes(kind)} tone="danger" onClick={() => toggleWeather(kind, 'hates')}>
                  {describeWeather(kind)}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Schedule"
        description="Where this character is and what they're doing at a given time. Reads the world's shared clock, so it only matters for a world-bound character. A day-specific slot beats an 'every day' one."
        surface="bare"
      >
        <ListEditor
          items={schedule}
          getKey={(e) => e.id}
          onAdd={addScheduleEntry}
          onRemove={(e) => removeScheduleEntry(e.id)}
          addLabel="Add slot"
          emptyHint="No schedule. Always shows as available."
          renderItem={(entry) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField label="Time of day" value={entry.phase} onChange={(e) => updateScheduleEntry(entry.id, { phase: e.target.value as DayPhase })}>
                  {PHASES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Status" value={entry.status} onChange={(e) => updateScheduleEntry(entry.id, { status: e.target.value as PresenceStatus })}>
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="sleeping">Sleeping</option>
                  <option value="traveling">Traveling</option>
                </SelectField>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Activity" value={entry.activity} onChange={(e) => updateScheduleEntry(entry.id, { activity: e.target.value })} placeholder="Opening the bakery" />
                <TextField
                  label="Location (optional)"
                  value={entry.location ?? ''}
                  onChange={(e) => updateScheduleEntry(entry.id, { location: e.target.value || undefined })}
                  placeholder="The bakery"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] text-text-muted">Days:</span>
                {WEEKDAYS.map((day) => (
                  <Chip key={day} on={entry.days?.includes(day)} onClick={() => toggleScheduleDay(entry.id, day)}>
                    <span className="capitalize">{day.slice(0, 3)}</span>
                  </Chip>
                ))}
                {!entry.days?.length && <span className="text-[11px] text-text-muted">(every day)</span>}
              </div>
            </div>
          )}
        />
      </Section>

      <Section
        title="Outreach"
        description="How often this character might text you first, unprompted, based on how long it's been and how things are going. Off by default. A character that never reaches out is a valid, intentional choice, not a missing feature."
        surface="bare"
      >
        <SelectField
          label="Frequency"
          value={outreachFrequency}
          onChange={(e) => setOutreachFrequency(e.target.value as OutreachFrequency)}
        >
          <option value="never">Off (never texts first)</option>
          <option value="rare">Rare</option>
          <option value="normal">Normal</option>
          <option value="eager">Eager</option>
        </SelectField>
      </Section>

      <Section
        title="Live persona"
        description="An engine that runs beside the model: it rolls this character's own impulses, tracks energy and boredom, learns which bits land with you, and lets them speak up when you go quiet. Adds a short status note to each reply."
        surface="bare"
      >
        <div className="rounded-xl bg-bg-sunken px-4 py-1">
          <Toggle
            checked={!!drive?.enabled}
            onChange={(on) => setDrive({ ...DEFAULT_DRIVE_CONFIG, ...drive, enabled: on })}
            label="Run the live persona engine"
            description="Best for chaotic, talkative characters. Off by default."
          />
        </div>
        {drive?.enabled && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
              <NumberField
                label="Chaos"
                suffix="%"
                min={0}
                max={40}
                value={Math.round(drive.chaosBase * 100)}
                onChange={(e) => setDrive({ ...drive, chaosBase: Math.max(0, Math.min(40, Number(e.target.value) || 0)) / 100 })}
                hint="Base chance a reply gets a random impulse. 10 to 15 is lively."
              />
              <NumberField
                label="Resting energy"
                min={0}
                max={10}
                value={drive.energyBase}
                onChange={(e) => setDrive({ ...drive, energyBase: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                hint="0 to 10. Drifts with the clock and the conversation."
              />
              <NumberField
                label="Patience"
                suffix="s"
                min={10}
                max={3600}
                value={drive.idle?.patienceSec ?? 60}
                onChange={(e) =>
                  setDrive({
                    ...drive,
                    idle: { enabled: drive.idle?.enabled ?? true, maxInARow: drive.idle?.maxInARow ?? 2, patienceSec: Math.max(10, Number(e.target.value) || 60) },
                  })
                }
                hint="Silence before they speak up on their own."
              />
            </div>
            <div className="rounded-xl bg-bg-sunken px-4 py-1">
              <Toggle
                checked={drive.idle?.enabled ?? false}
                onChange={(on) => setDrive({ ...drive, idle: { patienceSec: 60, maxInARow: 2, ...drive.idle, enabled: on } })}
                label="Speaks up when you go quiet"
                description="Up to two lines in a row, then waits. Typing cuts them off mid-sentence."
              />
              <Toggle
                checked={drive.telemetry !== false}
                onChange={(on) => setDrive({ ...drive, telemetry: on })}
                label="Knows real app facts"
                description="How long you were away, how full the context is, rerolls, GPU speed. Only true facts."
              />
              <Toggle
                checked={drive.moodSampling !== false}
                onChange={(on) => setDrive({ ...drive, moodSampling: on })}
                label="Sampler follows mood"
                description="Hotter on wild turns, cooler on sincere ones."
              />
            </div>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <TextAreaField
                label="Fixations"
                rows={4}
                value={driveLists.fixations}
                onChange={(e) => setDriveLists({ ...driveLists, fixations: e.target.value })}
                placeholder={'the kitchen fridge\na game they cannot stop thinking about'}
                hint="One per line. Their current obsession rotates through these."
              />
              <TextAreaField
                label="Bits to ration"
                rows={4}
                value={driveLists.motifs}
                onChange={(e) => setDriveLists({ ...driveLists, motifs: e.target.value })}
                placeholder={'Anyway\nthe List'}
                hint="Signature lines and running jokes that get skipped once overused."
              />
              <TextAreaField
                label="Topics that light them up"
                rows={3}
                value={driveLists.loves}
                onChange={(e) => setDriveLists({ ...driveLists, loves: e.target.value })}
                placeholder={'horror\nhardware'}
                hint="Raise interest and energy, longer replies."
              />
              <TextAreaField
                label="Topics that bore them"
                rows={3}
                value={driveLists.boredBy}
                onChange={(e) => setDriveLists({ ...driveLists, boredBy: e.target.value })}
                placeholder={'weather\nhomework'}
                hint="Raise boredom, shorter replies, more derails."
              />
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
