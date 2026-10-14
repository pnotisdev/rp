import { Plus, X } from 'lucide-react'
import type { GiftRarity, ItemEffect } from '@/lib/types'
import { MOOD_VOCAB, type CharacterMood } from '@/lib/prompt/mindGuidance'
import { combinedSceneFlags, COMMITMENT_ORDER, formatCommitmentStatus, formatRelationshipStage } from '@/lib/dating/stage'
import { intimacyArousalWeight, type IntimacyCategory, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'
import { BODY_REGIONS } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS } from '@/lib/dating/kinks'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import { TriggerActionRows, TriggerConditionRows } from '@/components/worlds/TriggerRows'
import { describeAction, describeCondition } from '@/lib/world/triggers'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import { GIFT_RARITIES, RELATIONSHIP_DELTA_DIMENSIONS, EDITABLE_STAGES, DEFAULT_THRESHOLDS, DEFAULT_STAGE_HINT, TokenListField } from './helpers'
import type { EditorState } from './useWorldEditor'

export function DatingTab({ f }: { f: EditorState }) {
  const {
    gifts, items, intimacyOptions, replaceIntimacyCatalog, setReplaceIntimacyCatalog,
    customSceneFlags, thresholds, intimacyLevel, setIntimacyLevel, triggers, setTriggers,
    newTriggerLabel, setNewTriggerLabel, addTrigger, updateTrigger, addGift, updateGift,
    removeGift, addIntimacyOption, updateIntimacyOption, removeIntimacyOption, addItem, updateItem,
    setItemEffectKind, setItemEffectField, removeItem, addCustomSceneFlag, updateCustomSceneFlag,
    removeCustomSceneFlag, setThreshold,
  } = f
  return (
    <div className="space-y-10">
      <Section
        title="Relationship thresholds"
        description={`Warmth needed for each stage, for any character living here. Blank uses the default (${DEFAULT_STAGE_HINT}).`}
        surface="bare"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {EDITABLE_STAGES.map((stage) => (
            <NumberField
              key={stage}
              label={formatRelationshipStage(stage)}
              min={0}
              max={100}
              placeholder={String(DEFAULT_THRESHOLDS[stage])}
              value={thresholds[stage] ?? ''}
              onChange={(e) => setThreshold(stage, e.target.value)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Content rating"
        description="How explicit intimate scenes get written for characters living here, and which intimate actions the Relationship panel offers. Overrides the global Settings value. So a wholesome world and an explicit one can sit side by side without touching Settings between chats."
        surface="bare"
      >
        <SelectField
          label="Rating"
          value={intimacyLevel ?? 'inherit'}
          onChange={(e) => setIntimacyLevel(e.target.value === 'inherit' ? undefined : (e.target.value as IntimacyDetailLevel))}
        >
          <option value="inherit">Use the global setting</option>
          <option value="default">No instruction either way</option>
          <option value="fade_to_black">Fade to black</option>
          <option value="suggestive">Suggestive</option>
          <option value="explicit">Explicit</option>
        </SelectField>
        <p className="mt-2 text-xs text-text-muted">
          {intimacyLevel === undefined
            ? 'Follows whatever Settings → Generation is set to, changing with it.'
            : intimacyLevel === 'default'
              ? 'Pinned: this world sends no instruction either way, even if the global setting changes. Every intimate action stays available in the Relationship panel.'
              : intimacyLevel === 'explicit'
                ? 'Positions, toys, and other explicit beats become available in the Relationship panel once warmth earns them.'
                : 'The model is asked to keep intimate scenes at this register, and only kissing spots are offered in the Relationship panel.'}
        </p>
      </Section>

      <Section
        title="Gift catalog"
        description="Overrides the default gift shop for characters living here. Leave empty to use the built-in catalog."
        surface="bare"
      >
        <ListEditor
          items={gifts}
          getKey={(g) => g.id}
          onAdd={addGift}
          onRemove={(g) => removeGift(g.id)}
          addLabel="Add gift"
          emptyHint="No custom gifts. The built-in catalog is used."
          renderItem={(gift) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_140px_100px]">
              <TextField label="Name" value={gift.name} onChange={(e) => updateGift(gift.id, { name: e.target.value })} />
              <SelectField
                label="Rarity"
                value={gift.rarity}
                onChange={(e) => updateGift(gift.id, { rarity: e.target.value as GiftRarity })}
              >
                {GIFT_RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </SelectField>
              <NumberField
                label="Price"
                value={gift.price}
                onChange={(e) => updateGift(gift.id, { price: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Intimacy catalog"
        description="Kissing spots, positions, toys, and other intimate beats a relationship living here can unlock, beyond the ~37 built-in defaults. Positions/toys/activities only ever surface in the prompt once the user's own Intimacy detail setting is 'Explicit'. Give a toy a price and it has to actually be bought (from the Relationship panel) before it's usable or ever mentioned to the model. Leave it at 0 for no purchase step, same as every non-toy category."
        surface="bare"
      >
        <label
          className="mb-3 flex items-center gap-1.5 text-[11px] text-text-muted"
          title="For a non-humanoid or otherwise very different character/setting the built-in catalog (hands, hips, knees, a back to lie on) doesn't fit. This makes your own additions below the entire catalog instead of a supplement to the defaults."
        >
          <input
            type="checkbox"
            checked={replaceIntimacyCatalog}
            onChange={(e) => setReplaceIntimacyCatalog(e.target.checked)}
            disabled={intimacyOptions.length === 0}
            className="accent-accent"
          />
          Replace the built-in catalog entirely with my own additions below (for a non-humanoid or very different setting)
        </label>
        <ListEditor
          items={intimacyOptions}
          getKey={(o) => o.id}
          onAdd={addIntimacyOption}
          onRemove={(o) => removeIntimacyOption(o.id)}
          addLabel="Add unlockable"
          emptyHint="No custom additions. The built-in catalog of ~37 is used."
          renderItem={(option) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <TextField label="Label" value={option.label} onChange={(e) => updateIntimacyOption(option.id, { label: e.target.value })} />
              <SelectField
                label="Category"
                value={option.category}
                onChange={(e) => updateIntimacyOption(option.id, { category: e.target.value as IntimacyCategory })}
              >
                <option value="affection">Closeness</option>
                <option value="kissing_spot">Kissing spot</option>
                <option value="position">Position</option>
                <option value="toy">Toy</option>
                <option value="activity">Activity</option>
              </SelectField>
              <NumberField
                label="Price"
                min={0}
                value={option.price ?? 0}
                onChange={(e) => updateIntimacyOption(option.id, { price: Math.max(0, Number(e.target.value) || 0) || undefined })}
              />
              <NumberField
                label="Min warmth"
                min={0}
                max={100}
                value={option.minWarmth}
                onChange={(e) => updateIntimacyOption(option.id, { minWarmth: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
              <SelectField
                label="Min commitment"
                value={option.minCommitment ?? 'none'}
                onChange={(e) =>
                  updateIntimacyOption(option.id, {
                    minCommitment: e.target.value === 'none' ? undefined : (e.target.value as IntimacyUnlockable['minCommitment']),
                  })
                }
              >
                {COMMITMENT_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {c === 'none' ? 'No floor' : formatCommitmentStatus(c)}
                  </option>
                ))}
              </SelectField>
              {/* Second row: the fields the engine actually enforces on. */}
              <NumberField
                label="Intensity"
                min={0}
                max={20}
                placeholder={String(intimacyArousalWeight({ ...option, arousalWeight: undefined }))}
                hint="How much this drives a scene per turn. Blank uses the per-category default."
                value={option.arousalWeight ?? ''}
                onChange={(e) =>
                  updateIntimacyOption(option.id, {
                    arousalWeight: e.target.value === '' ? undefined : Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                  })
                }
              />
              <TokenListField
                label="Body regions"
                hint={`Regions this involves. An entry that names none is never filtered by a character's limits. One of: ${BODY_REGIONS.join(', ')}.`}
                value={option.regions}
                allowed={BODY_REGIONS}
                onCommit={(regions) => updateIntimacyOption(option.id, { regions: regions as IntimacyUnlockable['regions'] })}
              />
              <TokenListField
                label="Kinks"
                hint={`Kinks this involves; one hard limit here and the entry is never offered. Built-ins: ${BUILT_IN_KINKS.join(', ')}. Your own names work too.`}
                value={option.kinks}
                onCommit={(kinks) => updateIntimacyOption(option.id, { kinks })}
              />
              <TextAreaField
                label="Player action line"
                rows={2}
                className="sm:col-span-3"
                hint="What lands in the composer when this is clicked. {char} becomes the name. Blank uses a generic line."
                value={option.actionText ?? ''}
                onChange={(e) => updateIntimacyOption(option.id, { actionText: e.target.value || undefined })}
              />
              <TextAreaField
                label="Model-facing note"
                rows={2}
                className="sm:col-span-2"
                hint="How the act is described to the model. {char} becomes the name; the player is always 'you'."
                value={option.promptNote ?? ''}
                onChange={(e) => updateIntimacyOption(option.id, { promptNote: e.target.value || undefined })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Item catalog"
        description="Consumables used from the Bag for an immediate authored effect. Separate from gifts, which are given to a character in a scene."
        surface="bare"
      >
        <ListEditor
          items={items}
          getKey={(i) => i.id}
          onAdd={addItem}
          onRemove={(i) => removeItem(i.id)}
          addLabel="Add item"
          emptyHint="No items yet."
          renderItem={(item) => (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_140px_100px]">
                <TextField label="Name" value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
                <SelectField
                  label="Rarity"
                  value={item.rarity}
                  onChange={(e) => updateItem(item.id, { rarity: e.target.value as GiftRarity })}
                >
                  {GIFT_RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </SelectField>
                <NumberField
                  label="Price"
                  value={item.price}
                  onChange={(e) => updateItem(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SelectField
                  label="Effect"
                  value={item.effect.kind}
                  onChange={(e) => setItemEffectKind(item.id, e.target.value as ItemEffect['kind'])}
                >
                  <option value="relationship">Relationship boost</option>
                  <option value="flag">Set scene flag</option>
                  <option value="currency">Grant coins</option>
                  <option value="mood">Set mood</option>
                </SelectField>
                {item.effect.kind === 'relationship' && (
                  <>
                    <SelectField
                      label="Dimension"
                      value={item.effect.dimension}
                      onChange={(e) =>
                        setItemEffectField(item.id, {
                          dimension: e.target.value as (typeof RELATIONSHIP_DELTA_DIMENSIONS)[number],
                        })
                      }
                    >
                      {RELATIONSHIP_DELTA_DIMENSIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </SelectField>
                    <NumberField
                      label="Amount"
                      value={item.effect.amount}
                      onChange={(e) =>
                        setItemEffectField(item.id, {
                          amount: Math.max(-10, Math.min(10, Math.round(Number(e.target.value) || 0))),
                        })
                      }
                    />
                  </>
                )}
                {item.effect.kind === 'flag' && (
                  <SelectField
                    label="Flag"
                    value={item.effect.flag}
                    onChange={(e) => setItemEffectField(item.id, { flag: e.target.value })}
                  >
                    {combinedSceneFlags(customSceneFlags).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </SelectField>
                )}
                {item.effect.kind === 'mood' && (
                  <SelectField
                    label="Mood"
                    value={item.effect.mood}
                    onChange={(e) => setItemEffectField(item.id, { mood: e.target.value as CharacterMood })}
                  >
                    {MOOD_VOCAB.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </SelectField>
                )}
                {item.effect.kind === 'currency' && (
                  <NumberField
                    label="Coins"
                    value={item.effect.amount}
                    onChange={(e) => setItemEffectField(item.id, { amount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                )}
              </div>
            </div>
          )}
        />
      </Section>

      <Section
        title="Custom scene flags"
        description="Branching-memory beats beyond the built-in four (first date, confession, jealousy, promise). Each needs a description. That's the AI classifier's bar for firing it."
        surface="bare"
      >
        <ListEditor
          items={customSceneFlags}
          getKey={(f) => f.id}
          onAdd={addCustomSceneFlag}
          onRemove={(f) => removeCustomSceneFlag(f.id)}
          addLabel="Add flag"
          emptyHint="Only the built-in four flags exist for this world."
          renderItem={(flag) => (
            <div className="space-y-1">
              <TextField
                label="Label"
                value={flag.label}
                onChange={(e) => updateCustomSceneFlag(flag.id, { label: e.target.value })}
                placeholder="e.g. Moved in together"
              />
              <TextAreaField
                label="When it fires"
                rows={2}
                value={flag.description}
                onChange={(e) => updateCustomSceneFlag(flag.id, { description: e.target.value })}
                placeholder="e.g. They explicitly agreed to share a home, not just spending a lot of time at each other's place"
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Rules"
        description="When every condition holds, the actions run once. The app already produces all of these signals. This is what lets you hang an authored beat off one without writing code."
        surface="bare"
      >
        {triggers.length === 0 && (
          <p className="mb-3 text-xs text-text-muted">
            No rules yet. For example: when <em>trust ≥ 70</em> and the <em>confession</em> flag is set → remember
            "She has told him about her father". Which then rides into every later prompt.
          </p>
        )}
        <div className="space-y-3">
          {triggers.map((t) => (
            <div key={t.id} className="rounded-xl bg-bg-sunken p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input
                  value={t.label}
                  onChange={(e) => updateTrigger(t.id, { label: e.target.value })}
                  aria-label="Rule name"
                  className="flex-1 rounded-lg bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent/70"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Off by default: a repeatable rule that sets a flag or writes a memory would otherwise do it on every single turn.">
                  <input
                    type="checkbox"
                    checked={!!t.repeatable}
                    onChange={(e) => updateTrigger(t.id, { repeatable: e.target.checked })}
                    className="accent-accent"
                  />
                  Repeatable
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <input
                    type="checkbox"
                    checked={t.enabled !== false}
                    onChange={(e) => updateTrigger(t.id, { enabled: e.target.checked })}
                    className="accent-accent"
                  />
                  On
                </label>
                <button
                  type="button"
                  onClick={() => setTriggers((list) => list.filter((x) => x.id !== t.id))}
                  aria-label={`Delete rule ${t.label}`}
                  className="text-text-muted transition-colors hover:text-danger"
                >
                  <X size={13} strokeWidth={2.5} />
                </button>
              </div>

              <TriggerConditionRows
                conditions={t.when}
                knownFlags={combinedSceneFlags(customSceneFlags)}
                knownTriggers={triggers.filter((other) => other.id !== t.id).map((other) => ({ id: other.id, label: other.label }))}
                onChange={(when) => updateTrigger(t.id, { when })}
              />
              <TriggerActionRows
                actions={t.then}
                knownFlags={combinedSceneFlags(customSceneFlags)}
                onChange={(then) => updateTrigger(t.id, { then })}
              />

              <p className="mt-2 text-[11px] text-text-muted">
                When {t.when.map(describeCondition).join(' and ') || '(nothing)'} → {t.then.map(describeAction).join(', ') || '(nothing)'}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newTriggerLabel}
            onChange={(e) => setNewTriggerLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTrigger()}
            placeholder="New rule (e.g. She opens up about her father)"
            className="flex-1 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent/70"
          />
          <Button onClick={addTrigger} disabled={!newTriggerLabel.trim()} className="flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2} />
            Add
          </Button>
        </div>
      </Section>
    </div>
  )
}
