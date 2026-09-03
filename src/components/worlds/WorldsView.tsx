import { useState } from 'react'
import { Globe } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldsApi } from '@/lib/api/client'
import type { CustomSceneFlag, GiftItem, GiftRarity, ItemDef, ItemEffect, RelationshipDimension, WorldCard } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { DEFAULT_BACKGROUNDS } from '@/lib/vn/backgrounds'
import { combinedSceneFlags, formatRelationshipStage, RELATIONSHIP_MILESTONES } from '@/lib/dating/stage'
import { advancePhase, getCalendarInfo, getEnergyRemaining, getMaxEnergyForDay, getWeather, describeWeather, PHASES } from '@/lib/world/calendar'
import { newId } from '@/lib/id'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
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
const DEFAULT_STAGE_HINT = EDITABLE_STAGES.map((s) => `${formatRelationshipStage(s)} ${DEFAULT_THRESHOLDS[s]}`).join(
  ', ',
)

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
    return (
      <WorldEditor
        world={selected === 'new' ? null : selected}
        onDone={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Worlds</h2>
        <Button variant="primary" onClick={() => setSelected('new')}>
          + New world
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {worlds.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="portrait-frame mb-3 aspect-[3/4] w-full rounded-xl">
              {w.avatarDataUrl ? (
                <img src={w.avatarDataUrl} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-sunken text-text-muted">
                  <Globe size={28} strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="truncate text-sm font-medium text-text">{w.name}</div>
            <div className="truncate text-xs text-text-muted">{w.lorebook.entries.length} lore entries</div>
          </button>
        ))}
        {worlds.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-text-muted">
            No worlds yet. A world holds the setting and shared lore that any number of characters can
            live in — create one, then assign it to a character from that character's editor.
          </p>
        )}
      </div>
    </div>
  )
}

function WorldEditor({ world, onDone }: { world: WorldCard | null; onDone: () => void }) {
  const base = world ?? { id: '', createdAt: 0, updatedAt: 0, ...blankWorld() }
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

  const save = async () => {
    try {
      if (world) {
        // Deliberately does NOT send currentDay/currentPhaseIndex: this editor only ever reads
        // them into local state once, at mount, for display — a live chat's own actions (dates,
        // energy spend) advance the world's real clock independently via `advanceClock` below and
        // its own narrowly-scoped PUT. Including the stale mount-time snapshot here would silently
        // roll the clock back to whatever it was when this editor happened to be opened, discarding
        // any progress made elsewhere in the meantime.
        await worldsApi.update(world.id, {
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
        })
      } else {
        await worldsApi.create({
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
        })
      }
    } catch (e) {
      toastError(errorMessage(e))
      return
    }
    onDone()
  }

  const addGift = () => {
    setGifts((g) => [...g, { id: newId(), name: `Gift ${g.length + 1}`, rarity: 'common', price: 5, tags: [] }])
  }

  const updateGift = (id: string, patch: Partial<GiftItem>) => {
    setGifts((g) => g.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeGift = (id: string) => {
    setGifts((g) => g.filter((item) => item.id !== id))
  }

  const addItem = () => {
    setItems((list) => [
      ...list,
      { id: newId(), name: `Item ${list.length + 1}`, rarity: 'common', price: 5, tags: [], effect: { kind: 'relationship', dimension: 'affection', amount: 1 } },
    ])
  }

  const updateItem = (id: string, patch: Partial<ItemDef>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  /** Switching effect kind replaces the effect with clean defaults, rather than merging, so a leftover `dimension`/`flag`/`amount` from the previous kind never lingers unseen in what gets saved. */
  const setItemEffectKind = (id: string, kind: ItemEffect['kind']) => {
    const next: ItemEffect =
      kind === 'flag'
        ? { kind: 'flag', flag: 'first_date' }
        : kind === 'currency'
          ? { kind: 'currency', amount: 5 }
          : { kind: 'relationship', dimension: 'affection', amount: 1 }
    updateItem(id, { effect: next })
  }

  const setItemEffectField = (id: string, patch: Partial<ItemEffect>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, effect: { ...i.effect, ...patch } as ItemEffect } : i)))
  }

  const removeItem = (id: string) => {
    setItems((list) => list.filter((i) => i.id !== id))
  }

  const addCustomSceneFlag = () => {
    setCustomSceneFlags((list) => [...list, { id: newId(), label: `Flag ${list.length + 1}`, description: '' }])
  }

  const updateCustomSceneFlag = (id: string, patch: Partial<CustomSceneFlag>) => {
    setCustomSceneFlags((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  const removeCustomSceneFlag = (id: string) => {
    setCustomSceneFlags((list) => list.filter((f) => f.id !== id))
    // An item's "Set scene flag" effect referencing the removed flag would otherwise silently
    // keep pointing at a dead id — fall it back to the always-available default the same way
    // `setItemEffectKind` seeds a fresh flag effect, rather than leaving an item that can never
    // actually fire (the server would reject the unrecognized id and coerce it to a different
    // effect kind entirely on next save, which is far more surprising than this).
    setItems((list) =>
      list.map((i) => (i.effect.kind === 'flag' && i.effect.flag === id ? { ...i, effect: { kind: 'flag', flag: 'first_date' } } : i)),
    )
  }

  const setThreshold = (stage: (typeof EDITABLE_STAGES)[number], value: string) => {
    setThresholds((t) => {
      const next = { ...t }
      if (value.trim() === '') {
        delete next[stage]
      } else {
        next[stage] = Math.max(0, Math.min(100, Number(value) || 0))
      }
      return next
    })
  }

  const handleBackgroundPick = async (tagId: string, file: File) => {
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

  const setBackgroundUnlock = (tagId: string, minAffection: number) => {
    setBackgroundUnlocks((b) => ({ ...b, [tagId]: Math.max(0, Math.min(100, minAffection)) }))
  }

  const advanceClock = async () => {
    // Guards against a fast double-click firing two requests off the same stale closed-over
    // currentDay/currentPhaseIndex (state only updates after the await below) — without this the
    // second click silently computed and requested the identical "next phase" as the first
    // instead of actually advancing an extra step.
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

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Button variant="ghost" onClick={onDone} className="mb-6">
        ← Back to worlds
      </Button>

      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer" aria-label="Change cover image">
          {avatarDataUrl ? (
            <img src={avatarDataUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-muted">
              Cover
            </div>
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
        rows={4}
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

      {world && (
        <div className="mb-8 rounded-2xl bg-bg-elevated p-6">
          <div className="mb-1 text-sm font-medium text-text">World clock</div>
          {(() => {
            const info = getCalendarInfo(currentDay)
            const weather = getWeather(world.id, currentDay)
            return (
              <p className="mb-3 text-xs text-text-muted">
                Day {info.day} — {info.weekday}, {info.season} ({info.dayOfSeason}/28)
                {info.holiday ? <> — <span className="text-accent">{info.holiday}</span></> : null}
                {' · '}
                {PHASES[currentPhaseIndex]}, {describeWeather(weather)}. Shared by every chat in this world;
                advancing it moves every character's mood/weather forward with it.
                <br />
                {getEnergyRemaining(currentDay, currentPhaseIndex)}/{getMaxEnergyForDay(currentDay)} actions left
                today — starting a date spends one; running out ends the day.
              </p>
            )
          })()}
          <Button variant="ghost" onClick={advanceClock} disabled={advancing}>
            → Advance to {PHASES[(currentPhaseIndex + 1) % PHASES.length]}
            {currentPhaseIndex === PHASES.length - 1 ? ' (next day)' : ''}
          </Button>
          <p className="mt-1.5 text-[11px] text-text-muted">
            This button is a manual authoring/testing step — it doesn't spend an action.
          </p>
        </div>
      )}

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Scene backgrounds ({Object.keys(backgrounds).length}/{DEFAULT_BACKGROUNDS.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Upload art per location so Visual Novel mode can show the right one as the AI tags each
          reply's setting. Anything left blank falls back to a placeholder gradient.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {DEFAULT_BACKGROUNDS.map((bg) => (
            <label key={bg.id} className="group relative flex cursor-pointer flex-col items-center gap-1">
              <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken text-xs text-text-muted">
                {backgrounds[bg.id] ? (
                  <img src={backgrounds[bg.id]} className="h-full w-full object-cover" />
                ) : (
                  <span>{bg.label}</span>
                )}
              </div>
              <span className="text-[11px] text-text-muted">{bg.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Number(backgroundUnlocks[bg.id] ?? 0)}
                onClick={(e) => e.preventDefault()}
                onChange={(e) => setBackgroundUnlock(bg.id, Number(e.target.value) || 0)}
                className="w-16 rounded bg-bg-elevated px-2 py-0.5 text-center text-[11px] text-text outline-none"
                title="Unlock affection"
              />
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
                  aria-label={`Remove ${bg.label} background image`}
                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-[11px] text-text-muted hover:text-danger group-hover:flex"
                >
                  ✕
                </button>
              )}
            </label>
          ))}
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Relationship thresholds
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Warmth needed for each stage, for any character living here. Leave a field blank to use
          the default ({DEFAULT_STAGE_HINT}).
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {EDITABLE_STAGES.map((stage) => (
            <label key={stage} className="block">
              <span className="mb-1 block text-xs font-medium capitalize text-text-muted">
                {formatRelationshipStage(stage)}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                placeholder={String(DEFAULT_THRESHOLDS[stage])}
                value={thresholds[stage] ?? ''}
                onChange={(e) => setThreshold(stage, e.target.value)}
                className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
              />
            </label>
          ))}
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Gift catalog ({gifts.length === 0 ? 'default' : gifts.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Overrides the default gift shop for any character living here. Leave empty to use the
          built-in default catalog.
        </p>
        <div className="space-y-2">
          {gifts.map((gift) => (
            <div key={gift.id} className="grid grid-cols-1 items-end gap-2 rounded-xl bg-bg-sunken p-3 sm:grid-cols-[1fr_120px_90px_auto]">
              <TextField
                label="Name"
                value={gift.name}
                onChange={(e) => updateGift(gift.id, { name: e.target.value })}
              />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">Rarity</span>
                <select
                  value={gift.rarity}
                  onChange={(e) => updateGift(gift.id, { rarity: e.target.value as GiftRarity })}
                  className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
                >
                  {GIFT_RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label="Price"
                type="number"
                value={gift.price}
                onChange={(e) => updateGift(gift.id, { price: Math.max(0, Number(e.target.value) || 0) })}
              />
              <Button variant="ghost" onClick={() => removeGift(gift.id)}>
                Remove
              </Button>
            </div>
          ))}
          <Button onClick={addGift}>+ Add gift</Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Item catalog ({items.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Consumables and trinkets, separate from gifts — used from the Bag for an immediate,
          authored effect (a relationship nudge, a scene flag, or coins) rather than given to a
          character in a scene. No built-in default catalog; leave empty for no items at all.
        </p>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded-xl bg-bg-sunken p-3">
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_120px_90px_auto]">
                <TextField label="Name" value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">Rarity</span>
                  <select
                    value={item.rarity}
                    onChange={(e) => updateItem(item.id, { rarity: e.target.value as GiftRarity })}
                    className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
                  >
                    {GIFT_RARITIES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField
                  label="Price"
                  type="number"
                  value={item.price}
                  onChange={(e) => updateItem(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                />
                <Button variant="ghost" onClick={() => removeItem(item.id)}>
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">Effect</span>
                  <select
                    value={item.effect.kind}
                    onChange={(e) => setItemEffectKind(item.id, e.target.value as ItemEffect['kind'])}
                    className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
                  >
                    <option value="relationship">Relationship boost</option>
                    <option value="flag">Set scene flag</option>
                    <option value="currency">Grant coins</option>
                  </select>
                </label>
                {item.effect.kind === 'relationship' && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-text-muted">Dimension</span>
                      <select
                        value={item.effect.dimension}
                        onChange={(e) => setItemEffectField(item.id, { dimension: e.target.value as (typeof RELATIONSHIP_DELTA_DIMENSIONS)[number] })}
                        className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
                      >
                        {RELATIONSHIP_DELTA_DIMENSIONS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextField
                      label="Amount"
                      type="number"
                      step={1}
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
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-text-muted">Flag</span>
                    <select
                      value={item.effect.flag}
                      onChange={(e) => setItemEffectField(item.id, { flag: e.target.value })}
                      className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
                    >
                      {combinedSceneFlags(customSceneFlags).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {item.effect.kind === 'currency' && (
                  <TextField
                    label="Coins"
                    type="number"
                    value={item.effect.amount}
                    onChange={(e) => setItemEffectField(item.id, { amount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                )}
              </div>
            </div>
          ))}
          <Button onClick={addItem}>+ Add item</Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Custom scene flags ({customSceneFlags.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Beyond the 4 built-in flags (first date, confession, jealousy, promise) that always
          exist — a world can add its own branching-memory flags for beats specific to its own
          story. Each needs a description so the AI classifier has an actual bar for when it
          should fire, the same way the built-in 4 do; a vague one invites false positives.
        </p>
        <div className="space-y-3">
          {customSceneFlags.map((flag) => (
            <div key={flag.id} className="rounded-xl bg-bg-sunken p-3">
              <div className="mb-2 flex items-start gap-2">
                <TextField
                  label="Label"
                  value={flag.label}
                  onChange={(e) => updateCustomSceneFlag(flag.id, { label: e.target.value })}
                  placeholder="e.g. Moved in together"
                  className="flex-1"
                />
                <Button variant="ghost" onClick={() => removeCustomSceneFlag(flag.id)} className="mt-5">
                  Remove
                </Button>
              </div>
              <TextAreaField
                label="Description (the classifier's bar for firing)"
                rows={2}
                value={flag.description}
                onChange={(e) => updateCustomSceneFlag(flag.id, { description: e.target.value })}
                placeholder="e.g. They explicitly agreed to share a home, not just spending a lot of time at each other's place"
              />
            </div>
          ))}
          <Button onClick={addCustomSceneFlag}>+ Add custom flag</Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6" open>
        <summary className="cursor-pointer text-sm font-medium text-text">
          World lore ({lorebook.entries.length} entries)
        </summary>
        <div className="mt-3">
          <LorebookEditor
            book={lorebook}
            onChange={setLorebook}
            aiContext={{ name, description, extra: rules ? `World rules: ${rules}` : undefined }}
          />
        </div>
      </details>

      <div className="flex items-center justify-between border-t border-border pt-4">
        {world ? (
          <Button variant="danger" onClick={remove}>
            Delete world
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          {world ? 'Save changes' : 'Create world'}
        </Button>
      </div>
    </div>
  )
}
