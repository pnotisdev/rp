import { useState } from 'react'
import { Globe, ImagePlus } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldsApi } from '@/lib/api/client'
import type { CustomSceneFlag, GiftItem, GiftRarity, ItemDef, ItemEffect, RelationshipDimension, WorldCard } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { DEFAULT_BACKGROUNDS } from '@/lib/vn/backgrounds'
import { combinedSceneFlags, formatRelationshipStage, RELATIONSHIP_MILESTONES } from '@/lib/dating/stage'
import { advancePhase, getCalendarInfo, getEnergyRemaining, getMaxEnergyForDay, getWeather, describeWeather, PHASES } from '@/lib/world/calendar'
import { newId } from '@/lib/id'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { EditorShell, type EditorTab } from '@/components/ui/EditorShell'
import { ListEditor } from '@/components/ui/ListEditor'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'

const GIFT_RARITIES: GiftRarity[] = ['common', 'uncommon', 'rare', 'epic']
const RELATIONSHIP_DELTA_DIMENSIONS: ('affection' | RelationshipDimension)[] = [
  'affection',
  'trust',
  'chemistry',
  'comfort',
  'respect',
  'curiosity',
  'tension',
]
const EDITABLE_STAGES = ['acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts'] as const
const DEFAULT_THRESHOLDS = Object.fromEntries(RELATIONSHIP_MILESTONES.map((m) => [m.stage, m.at])) as Record<
  (typeof EDITABLE_STAGES)[number] | 'near_strangers',
  number
>
const DEFAULT_STAGE_HINT = EDITABLE_STAGES.map((s) => `${formatRelationshipStage(s)} ${DEFAULT_THRESHOLDS[s]}`).join(', ')

function blankWorld(): Omit<WorldCard, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'New World',
    description: '',
    rules: '',
    lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
  }
}

export function WorldsView() {
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [selected, setSelected] = useState<WorldCard | 'new' | null>(null)

  if (selected) {
    return <WorldEditor world={selected === 'new' ? null : selected} onDone={() => setSelected(null)} />
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg text-text">Worlds</h2>
        <Button variant="primary" onClick={() => setSelected('new')}>
          New world
        </Button>
      </div>
      <p className="mb-8 max-w-lg text-sm text-text-muted">
        A world is a shared setting — its tone, its rules, its lore, and its scene backgrounds. Any
        number of characters can live in one; assign a world from the character's editor.
      </p>

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {worlds.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-3 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="portrait-frame mb-3 aspect-[4/3] w-full rounded-xl">
              {w.avatarDataUrl ? (
                <img src={w.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-sunken text-text-muted">
                  <Globe size={26} strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{w.name}</div>
            <div className="truncate px-1 text-xs text-text-muted">
              {w.lorebook.entries.length} {w.lorebook.entries.length === 1 ? 'lore entry' : 'lore entries'}
            </div>
          </button>
        ))}
        {worlds.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <Globe size={28} strokeWidth={1.25} className="mx-auto mb-3 text-text-muted" />
            <p className="mb-4 text-sm text-text-muted">No worlds yet.</p>
            <Button variant="primary" onClick={() => setSelected('new')}>
              Create your first world
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const WORLD_TABS: EditorTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'lore', label: 'Lore' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'dating', label: 'Dating sim' },
  { id: 'clock', label: 'Clock' },
]

function WorldEditor({ world, onDone }: { world: WorldCard | null; onDone: () => void }) {
  const base = world ?? { id: '', createdAt: 0, updatedAt: 0, ...blankWorld() }
  const [tab, setTab] = useState('overview')
  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [rules, setRules] = useState(base.rules ?? '')
  const [lorebook, setLorebook] = useState(base.lorebook)
  const [avatarDataUrl, setAvatarDataUrl] = useState(base.avatarDataUrl)
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>(base.backgrounds ?? {})
  const [backgroundUnlocks, setBackgroundUnlocks] = useState<Record<string, number>>(base.backgroundUnlocks ?? {})
  const [gifts, setGifts] = useState<GiftItem[]>(base.gifts ?? [])
  const [items, setItems] = useState<ItemDef[]>(base.items ?? [])
  const [customSceneFlags, setCustomSceneFlags] = useState<CustomSceneFlag[]>(base.customSceneFlags ?? [])
  const [thresholds, setThresholds] = useState(base.relationshipThresholds ?? {})
  const [currentDay, setCurrentDay] = useState(base.currentDay ?? 0)
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(base.currentPhaseIndex ?? 0)
  const [advancing, setAdvancing] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    // The world clock (currentDay/currentPhaseIndex) is deliberately excluded — this editor only
    // reads it once at mount for display; a live chat advances the real clock independently, and
    // sending the stale mount-time snapshot here would roll it back.
    const payload = {
      name,
      description,
      rules,
      lorebook,
      avatarDataUrl,
      backgrounds,
      backgroundUnlocks,
      gifts,
      items,
      customSceneFlags,
      relationshipThresholds: thresholds,
    }
    try {
      if (world) await worldsApi.update(world.id, payload)
      else await worldsApi.create(payload)
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setSaving(false)
    }
    onDone()
  }

  const addGift = () =>
    setGifts((g) => [...g, { id: newId(), name: `Gift ${g.length + 1}`, rarity: 'common', price: 5, tags: [] }])
  const updateGift = (id: string, patch: Partial<GiftItem>) =>
    setGifts((g) => g.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const removeGift = (id: string) => setGifts((g) => g.filter((item) => item.id !== id))

  const addItem = () =>
    setItems((list) => [
      ...list,
      {
        id: newId(),
        name: `Item ${list.length + 1}`,
        rarity: 'common',
        price: 5,
        tags: [],
        effect: { kind: 'relationship', dimension: 'affection', amount: 1 },
      },
    ])
  const updateItem = (id: string, patch: Partial<ItemDef>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  /** Switching effect kind replaces the effect wholesale so no stale field from the old kind lingers in what's saved. */
  const setItemEffectKind = (id: string, kind: ItemEffect['kind']) => {
    const next: ItemEffect =
      kind === 'flag'
        ? { kind: 'flag', flag: 'first_date' }
        : kind === 'currency'
          ? { kind: 'currency', amount: 5 }
          : { kind: 'relationship', dimension: 'affection', amount: 1 }
    updateItem(id, { effect: next })
  }
  const setItemEffectField = (id: string, patch: Partial<ItemEffect>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, effect: { ...i.effect, ...patch } as ItemEffect } : i)))
  const removeItem = (id: string) => setItems((list) => list.filter((i) => i.id !== id))

  const addCustomSceneFlag = () =>
    setCustomSceneFlags((list) => [...list, { id: newId(), label: `Flag ${list.length + 1}`, description: '' }])
  const updateCustomSceneFlag = (id: string, patch: Partial<CustomSceneFlag>) =>
    setCustomSceneFlags((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const removeCustomSceneFlag = (id: string) => {
    setCustomSceneFlags((list) => list.filter((f) => f.id !== id))
    // Fall any item pointing at the removed flag back to a default, so it isn't left with a dead reference.
    setItems((list) =>
      list.map((i) => (i.effect.kind === 'flag' && i.effect.flag === id ? { ...i, effect: { kind: 'flag', flag: 'first_date' } } : i)),
    )
  }

  const setThreshold = (stage: (typeof EDITABLE_STAGES)[number], value: string) => {
    setThresholds((t) => {
      const next = { ...t }
      if (value.trim() === '') delete next[stage]
      else next[stage] = Math.max(0, Math.min(100, Number(value) || 0))
      return next
    })
  }

  const handleBackgroundPick = async (tagId: string, file: File) => {
    setBackgrounds((b) => ({ ...b, [tagId]: '' }))
    const dataUrl = await fileToDataUrl(file)
    setBackgrounds((b) => ({ ...b, [tagId]: dataUrl }))
  }
  const removeBackground = (tagId: string) => {
    setBackgrounds((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
    setBackgroundUnlocks((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
  }
  const setBackgroundUnlock = (tagId: string, minAffection: number) =>
    setBackgroundUnlocks((b) => ({ ...b, [tagId]: Math.max(0, Math.min(100, minAffection)) }))

  const advanceClock = async () => {
    if (!world || advancing) return
    setAdvancing(true)
    const next = advancePhase(currentDay, currentPhaseIndex)
    try {
      await worldsApi.update(world.id, { currentDay: next.day, currentPhaseIndex: next.phaseIndex })
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setAdvancing(false)
    }
    setCurrentDay(next.day)
    setCurrentPhaseIndex(next.phaseIndex)
  }

  const remove = async () => {
    if (!world) return
    if (!confirm(`Delete ${world.name}? Characters living here will be un-assigned, not deleted.`)) return
    await worldsApi.remove(world.id)
    onDone()
  }

  const tabs = WORLD_TABS.filter((t) => t.id !== 'clock' || world).map((t) =>
    t.id === 'lore' ? { ...t, badge: lorebook.entries.length } : t,
  )

  return (
    <EditorShell
      onBack={onDone}
      backLabel="Worlds"
      eyebrow="World"
      title={name || 'Untitled world'}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          {world ? (
            <Button variant="danger" onClick={remove}>
              Delete world
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : world ? 'Save changes' : 'Create world'}
          </Button>
        </>
      }
    >
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <label
              className="portrait-frame group relative flex h-24 w-32 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
              aria-label="Change cover image"
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="" className="h-full w-full rounded-xl object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
                  <ImagePlus size={18} strokeWidth={1.5} />
                  Cover
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => e.target.files?.[0] && setAvatarDataUrl(await fileToDataUrl(e.target.files[0]))}
              />
            </label>
            <div className="flex-1">
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <TextAreaField
            label="Description"
            hint="Setting, tone, atmosphere — always included for any character living here."
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextAreaField
            label="Rules"
            hint="Hard constraints the model should never contradict — magic system, tech level, taboos."
            rows={3}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
        </div>
      )}

      {tab === 'lore' && (
        <Section
          title="World lore"
          description="Keyword- or always-on entries about this setting, shared by every character living here."
          surface="bare"
        >
          <LorebookEditor
            book={lorebook}
            onChange={setLorebook}
            aiContext={{ name, description, extra: rules ? `World rules: ${rules}` : undefined }}
          />
        </Section>
      )}

      {tab === 'scenes' && (
        <Section
          title="Scene backgrounds"
          description="Art per location for Visual Novel mode. The model tags each reply's setting; anything left blank falls back to a placeholder gradient."
          surface="bare"
        >
          <p className="mb-4 text-xs text-text-muted">
            {Object.keys(backgrounds).length}/{DEFAULT_BACKGROUNDS.length} set. The number under each is
            the warmth needed before that background can appear.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {DEFAULT_BACKGROUNDS.map((bg) => (
              <div key={bg.id} className="space-y-1.5">
                <label className="portrait-frame group relative block aspect-video cursor-pointer overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
                  {backgrounds[bg.id] ? (
                    <img src={backgrounds[bg.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center gap-1 text-[11px] text-text-muted">
                      <ImagePlus size={14} strokeWidth={1.5} />
                      {bg.label}
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleBackgroundPick(bg.id, e.target.files[0])}
                  />
                  {backgrounds[bg.id] && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        removeBackground(bg.id)
                      }}
                      aria-label={`Remove ${bg.label} background`}
                      className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-lg bg-bg-elevated/90 text-text-muted hover:text-danger group-hover:flex"
                    >
                      ✕
                    </button>
                  )}
                </label>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="truncate text-[11px] text-text-muted">{bg.label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Number(backgroundUnlocks[bg.id] ?? 0)}
                    onChange={(e) => setBackgroundUnlock(bg.id, Number(e.target.value) || 0)}
                    className="w-12 rounded-md bg-bg-sunken px-1.5 py-0.5 text-center text-[11px] text-text outline-none"
                    aria-label={`Unlock warmth for ${bg.label}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {tab === 'dating' && (
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
              emptyHint="No custom gifts — the built-in catalog is used."
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
            title="Item catalog"
            description="Consumables used from the Bag for an immediate authored effect — separate from gifts, which are given to a character in a scene."
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
            description="Branching-memory beats beyond the built-in four (first date, confession, jealousy, promise). Each needs a description — that's the AI classifier's bar for firing it."
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
        </div>
      )}

      {tab === 'clock' && world && (
        <Section
          title="World clock"
          description="Shared by every chat in this world. Advancing it moves every character's mood and weather forward — a manual authoring step that doesn't spend an action."
        >
          {(() => {
            const info = getCalendarInfo(currentDay)
            const weather = getWeather(world.id, currentDay)
            return (
              <>
                <div className="mb-1 text-sm text-text">
                  Day {info.day} — {info.weekday}, {info.season} ({info.dayOfSeason}/28)
                  {info.holiday ? <span className="text-romance"> — {info.holiday}</span> : null}
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
      )}
    </EditorShell>
  )
}
