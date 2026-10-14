import { useEffect, useState } from 'react'
import { worldsApi } from '@/lib/api/client'
import type { CustomSceneFlag, GiftItem, ItemDef, ItemEffect, WorldCard } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { DEFAULT_BACKGROUNDS, DEFAULT_BACKGROUND_IDS, slugifyBackgroundId, type CustomBackground } from '@/lib/vn/backgrounds'
import { type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'
import { advancePhase } from '@/lib/world/calendar'
import { hiddenWorldTabs, normalizeWorldTemplateId, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { newId } from '@/lib/id'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import { slugifyTriggerId, type Trigger } from '@/lib/world/triggers'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { EDITABLE_STAGES, blankWorld, WORLD_TABS } from './helpers'

export function useWorldEditor({
  world,
  initialTemplate,
  initialTab,
  onDone,
}: {
  world: WorldCard | null
  initialTemplate?: WorldTemplateId
  /** Deep-link straight to one tab on mount (the Relationship panel's "Customize" link). */
  initialTab?: string | null
  onDone: () => void
}) {
  const base = world ?? { id: '', createdAt: 0, updatedAt: 0, ...blankWorld(initialTemplate) }
  const [tab, setTab] = useState(initialTab ?? 'overview')
  const [name, setName] = useState(base.name)
  const [description, setDescription] = useState(base.description)
  const [rules, setRules] = useState(base.rules ?? '')
  const [template, setTemplate] = useState<WorldTemplateId>(normalizeWorldTemplateId(base.template))
  const [lorebook, setLorebook] = useState(base.lorebook)
  const [avatarDataUrl, setAvatarDataUrl] = useState(base.avatarDataUrl)
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>(base.backgrounds ?? {})
  const [backgroundsNight, setBackgroundsNight] = useState<Record<string, string>>(base.backgroundsNight ?? {})
  const [backgroundUnlocks, setBackgroundUnlocks] = useState<Record<string, number>>(base.backgroundUnlocks ?? {})
  const [customBackgrounds, setCustomBackgrounds] = useState<CustomBackground[]>(base.customBackgrounds ?? [])
  /** The opening shot VN mode falls back to whenever a scene has no valid tag of its own. */
  const [defaultBackgroundId, setDefaultBackgroundId] = useState<string | undefined>(base.defaultBackgroundId)
  const [newBackgroundLabel, setNewBackgroundLabel] = useState('')
  const [music, setMusic] = useState<Record<string, string>>(base.music ?? {})
  const [gifts, setGifts] = useState<GiftItem[]>(base.gifts ?? [])
  const [items, setItems] = useState<ItemDef[]>(base.items ?? [])
  const [intimacyOptions, setIntimacyOptions] = useState<IntimacyUnlockable[]>(base.customIntimacyOptions ?? [])
  const [replaceIntimacyCatalog, setReplaceIntimacyCatalog] = useState(base.replaceIntimacyCatalog ?? false)
  const [customSceneFlags, setCustomSceneFlags] = useState<CustomSceneFlag[]>(base.customSceneFlags ?? [])
  const [thresholds, setThresholds] = useState(base.relationshipThresholds ?? {})
  /** `undefined` = inherit the global Settings value; a set value overrides it for every chat in this world. */
  const [intimacyLevel, setIntimacyLevel] = useState<IntimacyDetailLevel | undefined>(base.intimacyLevel ?? undefined)
  const [triggers, setTriggers] = useState<Trigger[]>(base.triggers ?? [])
  const [newTriggerLabel, setNewTriggerLabel] = useState('')
  const [currentDay, setCurrentDay] = useState(base.currentDay ?? 0)
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(base.currentPhaseIndex ?? 0)
  const [advancing, setAdvancing] = useState(false)
  const [saving, setSaving] = useState(false)

  const addTrigger = () => {
    const label = newTriggerLabel.trim()
    if (!label) return
    setTriggers((list) => [
      ...list,
      {
        // The id is what "already fired" is remembered by
        id: slugifyTriggerId(label, list.map((t) => t.id)),
        label,
        when: [{ kind: 'stat_at_least', stat: 'affection', value: 50 }],
        then: [{ kind: 'notify', text: '' }],
      },
    ])
    setNewTriggerLabel('')
  }

  const updateTrigger = (id: string, patch: Partial<Trigger>) =>
    setTriggers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const save = async () => {
    setSaving(true)
    // The world clock (currentDay/currentPhaseIndex) is deliberately excluded
    const payload = {
      name,
      description,
      rules,
      template,
      lorebook,
      avatarDataUrl,
      backgrounds,
      backgroundsNight,
      backgroundUnlocks,
      customBackgrounds,
      // `null`, not `undefined` — see the `intimacyLevel` comment below on why a cleared nullable
      // field has to be sent explicitly rather than just omitted.
      defaultBackgroundId: defaultBackgroundId ?? null,
      music,
      gifts,
      items,
      customIntimacyOptions: intimacyOptions,
      replaceIntimacyCatalog,
      customSceneFlags,
      relationshipThresholds: thresholds,
      // `null`, not `undefined`, for "inherit the global setting"
      intimacyLevel: intimacyLevel ?? null,
      triggers,
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

  const addIntimacyOption = () =>
    setIntimacyOptions((list) => [...list, { id: newId(), category: 'activity', label: 'New idea', minWarmth: 50 }])
  const updateIntimacyOption = (id: string, patch: Partial<IntimacyUnlockable>) =>
    setIntimacyOptions((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  const removeIntimacyOption = (id: string) => setIntimacyOptions((list) => list.filter((o) => o.id !== id))

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
          : kind === 'mood'
            ? { kind: 'mood', mood: 'content' }
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
  const handleBackgroundNightPick = async (tagId: string, file: File) => {
    setBackgroundsNight((b) => ({ ...b, [tagId]: '' }))
    const dataUrl = await fileToDataUrl(file)
    setBackgroundsNight((b) => ({ ...b, [tagId]: dataUrl }))
  }
  const removeBackgroundNight = (tagId: string) =>
    setBackgroundsNight((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
  /** Bulk background upload: pick every location's day/night art at once, matched to a slot by filename */
  const handleBulkBackgroundPick = async (files: FileList) => {
    const knownIds = new Set([...DEFAULT_BACKGROUND_IDS, ...customBackgrounds.map((b) => b.id)])
    const matched: string[] = []
    const unmatched: string[] = []
    const dayUpdates: Record<string, string> = {}
    const nightUpdates: Record<string, string> = {}
    for (const file of Array.from(files)) {
      const baseName = file.name.replace(/\.[^.]+$/, '').toLowerCase().trim()
      const nightMatch = baseName.match(/^(.+)_night$/)
      const dayMatch = baseName.match(/^(.+)_day$/)
      const id = nightMatch?.[1] ?? dayMatch?.[1] ?? baseName
      if (!knownIds.has(id)) {
        unmatched.push(file.name)
        continue
      }
      const dataUrl = await fileToDataUrl(file)
      if (nightMatch) nightUpdates[id] = dataUrl
      else dayUpdates[id] = dataUrl
      matched.push(file.name)
    }
    if (Object.keys(dayUpdates).length > 0) setBackgrounds((b) => ({ ...b, ...dayUpdates }))
    if (Object.keys(nightUpdates).length > 0) setBackgroundsNight((b) => ({ ...b, ...nightUpdates }))
    if (matched.length > 0) toastSuccess(`Matched ${matched.length} background image${matched.length === 1 ? '' : 's'}`)
    if (unmatched.length > 0) toastError(`No matching location for: ${unmatched.join(', ')}. Rename to "<id>_day.png"/"<id>_night.png", or add a custom location with that id first.`)
  }
  const handleMusicPick = async (key: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setMusic((m) => ({ ...m, [key]: dataUrl }))
  }
  const removeMusic = (key: string) =>
    setMusic((m) => {
      const next = { ...m }
      delete next[key]
      return next
    })
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
    removeBackgroundNight(tagId)
  }
  const setDefaultBackground = (tagId: string) => setDefaultBackgroundId((cur) => (cur === tagId ? undefined : tagId))
  const setBackgroundUnlock = (tagId: string, minAffection: number) =>
    setBackgroundUnlocks((b) => ({ ...b, [tagId]: Math.max(0, Math.min(100, minAffection)) }))

  /** World-authored scene locations beyond the 12 defaults — same "author extends a fixed set" pattern as `addCustomExpression` in `CharacterEditor.tsx`. */
  const addCustomBackground = () => {
    const label = newBackgroundLabel.trim()
    if (!label) return
    const existingIds = [...DEFAULT_BACKGROUND_IDS, ...customBackgrounds.map((b) => b.id)]
    setCustomBackgrounds((list) => [...list, { id: slugifyBackgroundId(label, existingIds), label }])
    setNewBackgroundLabel('')
  }
  const removeCustomBackground = (backgroundId: string) => {
    setCustomBackgrounds((list) => list.filter((b) => b.id !== backgroundId))
    removeBackground(backgroundId)
    setDefaultBackgroundId((cur) => (cur === backgroundId ? undefined : cur))
  }

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
    const ok = await confirmDialog({
      title: `Delete "${world.name}"?`,
      body: 'Characters living here are un-assigned, not deleted. This cannot be undone.',
      confirmLabel: 'Delete world',
      tone: 'danger',
    })
    if (!ok) return
    await worldsApi.remove(world.id)
    onDone()
  }

  const hidden = hiddenWorldTabs(template)
  const tabs = WORLD_TABS.filter((t) => (t.id !== 'clock' || world) && !hidden.includes(t.id)).map((t) =>
    t.id === 'lore' ? { ...t, badge: lorebook.entries.length } : t,
  )

  // Switching to a narrower template can hide the tab currently open (e.g. away from "Dating sim")
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('overview')
  }, [hidden.join(','), tab])

  const allBackgrounds = [
    ...DEFAULT_BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, custom: false })),
    ...customBackgrounds.map((b) => ({ id: b.id, label: b.label, custom: true })),
  ]

  return {
    world,
    initialTemplate,
    initialTab,
    onDone,
    base,
    tab,
    setTab,
    name,
    setName,
    description,
    setDescription,
    rules,
    setRules,
    template,
    setTemplate,
    lorebook,
    setLorebook,
    avatarDataUrl,
    setAvatarDataUrl,
    backgrounds,
    setBackgrounds,
    backgroundsNight,
    setBackgroundsNight,
    backgroundUnlocks,
    setBackgroundUnlocks,
    customBackgrounds,
    setCustomBackgrounds,
    defaultBackgroundId,
    setDefaultBackgroundId,
    newBackgroundLabel,
    setNewBackgroundLabel,
    music,
    setMusic,
    gifts,
    setGifts,
    items,
    setItems,
    intimacyOptions,
    setIntimacyOptions,
    replaceIntimacyCatalog,
    setReplaceIntimacyCatalog,
    customSceneFlags,
    setCustomSceneFlags,
    thresholds,
    setThresholds,
    intimacyLevel,
    setIntimacyLevel,
    triggers,
    setTriggers,
    newTriggerLabel,
    setNewTriggerLabel,
    currentDay,
    setCurrentDay,
    currentPhaseIndex,
    setCurrentPhaseIndex,
    advancing,
    setAdvancing,
    saving,
    setSaving,
    addTrigger,
    updateTrigger,
    save,
    addGift,
    updateGift,
    removeGift,
    addIntimacyOption,
    updateIntimacyOption,
    removeIntimacyOption,
    addItem,
    updateItem,
    setItemEffectKind,
    setItemEffectField,
    removeItem,
    addCustomSceneFlag,
    updateCustomSceneFlag,
    removeCustomSceneFlag,
    setThreshold,
    handleBackgroundPick,
    handleBackgroundNightPick,
    removeBackgroundNight,
    handleBulkBackgroundPick,
    handleMusicPick,
    removeMusic,
    removeBackground,
    setDefaultBackground,
    setBackgroundUnlock,
    addCustomBackground,
    removeCustomBackground,
    advanceClock,
    remove,
    hidden,
    tabs,
    allBackgrounds,
  }
}

export type EditorState = ReturnType<typeof useWorldEditor>
