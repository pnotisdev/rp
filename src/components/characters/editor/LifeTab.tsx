import type { BehavioralRule } from '@/lib/characters/cardSpec'
import { getCalendarInfo } from '@/lib/world/calendar'
import { NumberField, SelectField, TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import type { CharacterEditorState } from './useCharacterEditor'

export function LifeTab({ f }: { f: CharacterEditorState }) {
  const {
    occupation, setOccupation, workplace, setWorkplace, homeLocation, setHomeLocation, birthday,
    setBirthday, frequentedLocations, setFrequentedLocations, likes, setLikes, goals, setGoals,
    boundaries, setBoundaries, socialConnections, behavioralRules, addSocialConnection,
    updateSocialConnection, removeSocialConnection, addBehavioralRule, updateBehavioralRule,
    removeBehavioralRule,
  } = f
  return (
    <div className="space-y-10">
      <Section
        title="Life & background"
        description="Reaches the model as part of this character's identity. So it applies to any use of them, not just dating-sim chats. Comma-separated where it's a list."
        surface="bare"
      >
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <TextField label="Occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="second-year architecture student" />
          <TextField label="Workplace / school" value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="Sakura Hill University" />
          <TextField label="Home" value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} placeholder="a small apartment near the station" />
          <NumberField
            label="Birthday (day of year)"
            min={0}
            max={111}
            value={birthday ?? ''}
            onChange={(e) => setBirthday(e.target.value === '' ? undefined : Math.max(0, Math.min(111, Math.round(Number(e.target.value)))))}
            placeholder="0-111"
            hint={
              birthday !== undefined
                ? (() => {
                    const info = getCalendarInfo(birthday)
                    return `→ ${info.season.charAt(0).toUpperCase() + info.season.slice(1)}, day ${info.dayOfSeason}/28`
                  })()
                : 'An 8x gift bonus on the day, plus a nudge that it’s coming up. Day 0 is the first day of Spring, wrapping every 112 days.'
            }
          />
          <TextField
            label="Frequented locations"
            value={frequentedLocations.join(', ')}
            onChange={(e) => setFrequentedLocations(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="the campus café, the riverside park"
          />
          <TextField
            label="Likes / interests"
            value={likes.join(', ')}
            onChange={(e) => setLikes(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="Gothic architecture, secondhand books"
          />
          <TextField
            label="Goals"
            value={goals.join(', ')}
            onChange={(e) => setGoals(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="finish her thesis, open a bookshop"
          />
          <TextField
            label="Boundaries"
            value={boundaries.join(', ')}
            onChange={(e) => setBoundaries(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="won't tolerate being lied to"
            hint="Informational for the model, not enforced. The one enforced opt-out is on the Dating sim tab."
            className="sm:col-span-2"
          />
        </div>
      </Section>

      <Section
        title="Social connections"
        description="Who this character knows and how. Reaches the model so it can reference them naturally in conversation."
        surface="bare"
      >
        <ListEditor
          items={socialConnections}
          getKey={(c) => c.id}
          onAdd={addSocialConnection}
          onRemove={(c) => removeSocialConnection(c.id)}
          addLabel="Add connection"
          emptyHint="No connections yet."
          renderItem={(conn) => (
            <div className="space-y-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Name" value={conn.name} onChange={(e) => updateSocialConnection(conn.id, { name: e.target.value })} />
                <TextField
                  label="Relation"
                  value={conn.relation}
                  onChange={(e) => updateSocialConnection(conn.id, { relation: e.target.value })}
                  placeholder="childhood friend, older sister"
                />
              </div>
              <TextField
                label="Notes (optional)"
                value={conn.notes ?? ''}
                onChange={(e) => updateSocialConnection(conn.id, { notes: e.target.value || undefined })}
                placeholder="hasn't spoken to her in years"
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Behavioral rules"
        description={'Structured "when X, she Y" / "never Z" contracts. Followed exactly as written, more precise than free-text personality. Good for desire, hesitation, and aftercare.'}
        surface="bare"
      >
        <ListEditor
          items={behavioralRules}
          getKey={(r) => r.id}
          onAdd={addBehavioralRule}
          onRemove={(r) => removeBehavioralRule(r.id)}
          addLabel="Add rule"
          emptyHint="No behavioral rules yet."
          renderItem={(rule) => (
            <div className="space-y-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                <SelectField
                  label="Kind"
                  value={rule.kind}
                  onChange={(e) => updateBehavioralRule(rule.id, { kind: e.target.value as BehavioralRule['kind'] })}
                >
                  <option value="when_then">When / then</option>
                  <option value="never">Never</option>
                </SelectField>
                {rule.kind === 'when_then' && (
                  <TextField
                    label="When"
                    value={rule.when ?? ''}
                    onChange={(e) => updateBehavioralRule(rule.id, { when: e.target.value })}
                    placeholder="he brings up her sister"
                  />
                )}
              </div>
              <TextField
                label={rule.kind === 'never' ? "What she never does" : 'Then'}
                value={rule.then}
                onChange={(e) => updateBehavioralRule(rule.id, { then: e.target.value })}
                placeholder={rule.kind === 'never' ? 'initiate a kiss first' : 'she deflects with a joke'}
              />
            </div>
          )}
        />
      </Section>
    </div>
  )
}
