import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, instructTemplatesApi, worldsApi } from '@/lib/api/client'
import type { BehavioralRule, Character, GalleryEntry, OutreachFrequency, RelationshipStarter, SocialConnection } from '@/lib/characters/cardSpec'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import { type DriveConfig } from '@/lib/persona/drive'
import {
  detectVoiceFingerprint,
  type ReplyLength,
} from '@/lib/characters/voice'
import { fileToDataUrl, importCharacterFile } from '@/lib/characters/importExport'
import { DEFAULT_EXPRESSIONS, slugifyExpressionId, type CustomExpression } from '@/lib/vn/expressions'
import { BASE_OUTFIT_ID, expressionIdsForOutfit, slugifyOutfitId, spriteKey, type Outfit } from '@/lib/vn/outfits'
import { newId } from '@/lib/id'
import { buildCharacterPack, downloadCharacterPack } from '@/lib/characters/pack'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { type TtsProviderId } from '@/lib/voice/ttsProviders'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useOpenMayhemModels } from '@/lib/hooks/useOpenMayhemModels'
import { maximumImmersionSamplerParams, maximumImmersionSystemPrompt } from '@/lib/prompt/immersionPreset'
import {
  type ScheduleEntry,
  type WeatherKind,
  type Weekday,
} from '@/lib/world/calendar'
import { TABS, regionsAt, kinksAt, lines, driveListText, composeTouchProfile, composeKinkProfile } from './helpers'

export function useCharacterEditor({
  character,
  onSaved,
  onDeleted,
  start = 'blank',
}: {
  character: Character | null
  onSaved: (id: string) => void
  onDeleted: () => void
  /** For a new character: open the template gallery or the AI generator straight away. */
  start?: 'blank' | 'template' | 'generate'
}) {
  const [tab, setTab] = useState('identity')
  const [form, setForm] = useState(character?.card ?? blankCharacterData())
  const [avatarDataUrl, setAvatarDataUrl] = useState(character?.avatarDataUrl)
  const [sprites, setSprites] = useState<Record<string, string>>(character?.sprites ?? {})
  const [spriteUnlocks, setSpriteUnlocks] = useState<Record<string, number>>(character?.spriteUnlocks ?? {})
  const [spriteVariants, setSpriteVariants] = useState<Record<string, string[]>>(character?.spriteVariants ?? {})
  const [customExpressions, setCustomExpressions] = useState<CustomExpression[]>(character?.customExpressions ?? [])
  const [newExpressionLabel, setNewExpressionLabel] = useState('')
  const [outfits, setOutfits] = useState<Outfit[]>(character?.outfits ?? [])
  /** Which wardrobe state the sprite grid below is currently editing. Purely editor-local — never saved. */
  const [activeOutfit, setActiveOutfit] = useState<string>(BASE_OUTFIT_ID)
  const [newOutfitLabel, setNewOutfitLabel] = useState('')
  const [showExpressionSetDialog, setShowExpressionSetDialog] = useState(false)
  const [giftPreferences, setGiftPreferences] = useState<Record<string, number>>(character?.giftPreferences ?? {})
  const [giftLikes, setGiftLikes] = useState<string[]>(character?.giftLikes ?? [])
  const [giftDislikes, setGiftDislikes] = useState<string[]>(character?.giftDislikes ?? [])
  const [loveLanguage, setLoveLanguage] = useState(character?.loveLanguage ?? '')
  const [explicitVoiceNote, setExplicitVoiceNote] = useState(character?.explicitVoiceNote ?? '')
  const [gallery, setGallery] = useState<GalleryEntry[]>(character?.gallery ?? [])
  const [relationshipStarters, setRelationshipStarters] = useState<RelationshipStarter[]>(
    character?.relationshipStarters ?? [],
  )
  const [weatherLoves, setWeatherLoves] = useState<WeatherKind[]>(character?.weatherPreferences?.loves ?? [])
  const [weatherHates, setWeatherHates] = useState<WeatherKind[]>(character?.weatherPreferences?.hates ?? [])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(character?.schedule ?? [])
  const [voiceProvider, setVoiceProvider] = useState<TtsProviderId | ''>(character?.voice?.provider ?? '')
  const globalTtsProvider = useSettingsStore((s) => s.ttsProvider)
  const globalTtsModel = useSettingsStore((s) => s.ttsModel)
  const usesOpenMayhemVoice = (voiceProvider || globalTtsProvider) === 'openmayhem'
  const { models: speechModels } = useOpenMayhemModels('AUDIO_SPEECH', tab === 'voice' && usesOpenMayhemVoice)
  const [voiceId, setVoiceId] = useState(character?.voice?.voiceId ?? '')
  const [verbalTics, setVerbalTics] = useState<string[]>(character?.voiceFingerprint?.verbalTics ?? [])
  const [catchphrases, setCatchphrases] = useState<string[]>(character?.voiceFingerprint?.catchphrases ?? [])
  const [dialectNotes, setDialectNotes] = useState(character?.voiceFingerprint?.dialectNotes ?? '')
  const [sentenceRhythm, setSentenceRhythm] = useState(character?.voiceFingerprint?.sentenceRhythm ?? '')
  const [sfxWords, setSfxWords] = useState<string[]>(character?.sfxWords ?? [])
  const [instructTemplateId, setInstructTemplateId] = useState(character?.instructTemplateId ?? '')
  const [replyLength, setReplyLength] = useState<ReplyLength>(character?.replyLength ?? 'auto')
  const [worldId, setWorldId] = useState(character?.worldId ?? '')
  const [occupation, setOccupation] = useState(character?.occupation ?? '')
  const [workplace, setWorkplace] = useState(character?.workplace ?? '')
  const [homeLocation, setHomeLocation] = useState(character?.homeLocation ?? '')
  const [birthday, setBirthday] = useState<number | undefined>(character?.birthday)
  const [frequentedLocations, setFrequentedLocations] = useState<string[]>(character?.frequentedLocations ?? [])
  const [likes, setLikes] = useState<string[]>(character?.likes ?? [])
  const [goals, setGoals] = useState<string[]>(character?.goals ?? [])
  const [boundaries, setBoundaries] = useState<string[]>(character?.boundaries ?? [])
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>(character?.socialConnections ?? [])
  const [behavioralRules, setBehavioralRules] = useState<BehavioralRule[]>(character?.behavioralRules ?? [])
  const [dateModeOptOut, setDateModeOptOut] = useState(character?.dateModeOptOut ?? false)
  // `touchProfile`/`kinkProfile` are richer than these fields can express (a per-region 0-3 scale, and warmth gates).
  const [sensitiveRegions, setSensitiveRegions] = useState(regionsAt(character?.touchProfile?.sensitivity, 3))
  const [unresponsiveRegions, setUnresponsiveRegions] = useState(regionsAt(character?.touchProfile?.sensitivity, 0))
  const [offLimitRegions, setOffLimitRegions] = useState((character?.touchProfile?.offLimits ?? []).join(', '))
  const [likedKinks, setLikedKinks] = useState(kinksAt(character?.kinkProfile?.valence, 2))
  const [dislikedKinks, setDislikedKinks] = useState(kinksAt(character?.kinkProfile?.valence, -1))
  const [hardLimitKinks, setHardLimitKinks] = useState((character?.kinkProfile?.hardLimits ?? []).join(', '))
  const [outreachFrequency, setOutreachFrequency] = useState<OutreachFrequency>(character?.outreach?.frequency ?? 'never')
  const [drive, setDrive] = useState<DriveConfig | undefined>(character?.drive)
  const [driveLists, setDriveLists] = useState(() => driveListText(character?.drive))
  const [showGenerate, setShowGenerate] = useState(!character && start === 'generate')
  const [showTemplates, setShowTemplates] = useState(!character && start === 'template')
  const [saving, setSaving] = useState(false)
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const editingWorld = worlds.find((w) => w.id === worldId)
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Sent as `null`, not `undefined`, when empty
  const voice = voiceProvider || voiceId.trim() ? { provider: voiceProvider || undefined, voiceId: voiceId.trim() || undefined } : null
  const voiceFingerprint =
    verbalTics.length || catchphrases.length || dialectNotes.trim() || sentenceRhythm.trim()
      ? {
          verbalTics: verbalTics.length ? verbalTics : undefined,
          catchphrases: catchphrases.length ? catchphrases : undefined,
          dialectNotes: dialectNotes.trim() || undefined,
          sentenceRhythm: sentenceRhythm.trim() || undefined,
        }
      : null
  const weatherPreferences =
    weatherLoves.length || weatherHates.length ? { loves: weatherLoves, hates: weatherHates } : null

  /** A weather kind can't be loved and hated at once — picking one side clears the other. */
  const toggleWeather = (kind: WeatherKind, side: 'loves' | 'hates') => {
    const setter = side === 'loves' ? setWeatherLoves : setWeatherHates
    const other = side === 'loves' ? setWeatherHates : setWeatherLoves
    setter((list) => (list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]))
    other((list) => list.filter((k) => k !== kind))
  }

  const addScheduleEntry = () =>
    setSchedule((list) => [...list, { id: newId(), phase: 'morning', status: 'busy', activity: '' }])
  const updateScheduleEntry = (id: string, patch: Partial<ScheduleEntry>) =>
    setSchedule((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const removeScheduleEntry = (id: string) => setSchedule((list) => list.filter((e) => e.id !== id))
  const toggleScheduleDay = (id: string, day: Weekday) => {
    setSchedule((list) =>
      list.map((e) => {
        if (e.id !== id) return e
        const days = e.days ?? []
        return { ...e, days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] }
      }),
    )
  }

  /** The "Detect from examples" button — a deterministic, zero-cost heuristic over the card's own `mes_example`/`first_mes`/alternate… */
  const detectVoiceFromExamples = () => {
    const detected = detectVoiceFingerprint(form)
    if (detected.turnsAnalyzed < 2) {
      toastInfo('Not enough example dialogue or greetings to detect a pattern. Write a couple of example turns first.')
      return
    }
    const foundAnything =
      detected.verbalTics.length || detected.catchphrases.length || detected.sentenceRhythm || detected.punctuationNotes
    if (!foundAnything) {
      toastInfo(`Looked at ${detected.turnsAnalyzed} turns but found nothing that clearly recurs. Try adding more example dialogue.`)
      return
    }
    setVerbalTics((cur) => [...new Set([...cur, ...detected.verbalTics])])
    setCatchphrases((cur) => [...new Set([...cur, ...detected.catchphrases])])
    setSentenceRhythm((cur) => cur.trim() || detected.sentenceRhythm || cur)
    setDialectNotes((cur) => (cur.trim() ? cur : detected.punctuationNotes ? detected.punctuationNotes : cur))
    toastSuccess(
      `Detected from ${detected.turnsAnalyzed} turns: ${detected.verbalTics.length} verbal tic(s), ${detected.catchphrases.length} catchphrase(s)${
        detected.sentenceRhythm ? ', sentence rhythm' : ''
      }${detected.punctuationNotes ? ', punctuation habits' : ''}. Review and edit below.`,
    )
  }

  /** The "Maximum Immersion" one-click bundle (`immersionPreset.ts`) */
  const applyMaximumImmersion = () => {
    set('system_prompt', maximumImmersionSystemPrompt())
    const settings = useSettingsStore.getState()
    settings.setSampler(maximumImmersionSamplerParams())
    if (!settings.slowBurnPacing) settings.setSlowBurnPacing(true)
    if (!settings.visualNovelMode) settings.setVisualNovelMode(true)
    toastSuccess(
      'Applied Maximum Immersion: this character\'s system prompt is now "Immersive, no meta", and the global sampler/slow-burn pacing/VN mode settings are updated. Bind this character to a "Dating Sim" world for the full mechanic set.',
    )
  }

  const addSocialConnection = () => setSocialConnections((list) => [...list, { id: newId(), name: '', relation: '' }])
  const updateSocialConnection = (id: string, patch: Partial<SocialConnection>) =>
    setSocialConnections((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const removeSocialConnection = (id: string) => setSocialConnections((list) => list.filter((c) => c.id !== id))

  const addBehavioralRule = () => setBehavioralRules((list) => [...list, { id: newId(), kind: 'when_then', then: '' }])
  const updateBehavioralRule = (id: string, patch: Partial<BehavioralRule>) =>
    setBehavioralRules((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const removeBehavioralRule = (id: string) => setBehavioralRules((list) => list.filter((r) => r.id !== id))

  const save = async () => {
    setSaving(true)
    const payload = {
      card: form,
      avatarDataUrl,
      sprites,
      spriteUnlocks,
      spriteVariants,
      outfits,
      customExpressions: customExpressions.length ? customExpressions : null,
      giftPreferences,
      giftLikes: giftLikes.length ? giftLikes : null,
      giftDislikes: giftDislikes.length ? giftDislikes : null,
      loveLanguage: loveLanguage.trim() || null,
      explicitVoiceNote: explicitVoiceNote.trim() || null,
      gallery,
      relationshipStarters,
      voice,
      voiceFingerprint,
      sfxWords: sfxWords.length ? sfxWords : null,
      instructTemplateId: instructTemplateId || null,
      replyLength: replyLength !== 'auto' ? replyLength : null,
      weatherPreferences,
      schedule: schedule.length ? schedule : null,
      worldId: worldId || null,
      occupation: occupation.trim() || null,
      workplace: workplace.trim() || null,
      homeLocation: homeLocation.trim() || null,
      birthday: birthday ?? null,
      frequentedLocations: frequentedLocations.length ? frequentedLocations : null,
      likes: likes.length ? likes : null,
      goals: goals.length ? goals : null,
      boundaries: boundaries.length ? boundaries : null,
      socialConnections: socialConnections.length ? socialConnections : null,
      behavioralRules: behavioralRules.length ? behavioralRules : null,
      dateModeOptOut,
      touchProfile: composeTouchProfile(character?.touchProfile, sensitiveRegions, unresponsiveRegions, offLimitRegions),
      kinkProfile: composeKinkProfile(character?.kinkProfile, likedKinks, dislikedKinks, hardLimitKinks),
      outreach: outreachFrequency !== 'never' ? { frequency: outreachFrequency } : null,
      drive: drive
        ? {
            ...drive,
            fixations: lines(driveLists.fixations),
            loves: lines(driveLists.loves),
            boredBy: lines(driveLists.boredBy),
            motifs: lines(driveLists.motifs),
          }
        : null,
    }
    try {
      if (character) {
        await charactersApi.update(character.id, payload)
        onSaved(character.id)
      } else {
        const created = await charactersApi.create(payload)
        onSaved(created.id)
      }
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!character) return
    const ok = await confirmDialog({
      title: `Delete ${character.card.name}?`,
      body: 'This also deletes every chat with this character. It cannot be undone.',
      confirmLabel: 'Delete character',
      tone: 'danger',
    })
    if (!ok) return
    await charactersApi.remove(character.id)
    onDeleted()
  }

  const handleAvatarPick = async (file: File) => {
    if (file.type === 'image/png') {
      try {
        applyImport(await importCharacterFile(file))
        return
      } catch {
        // not an embedded card, just use it as a plain avatar image
      }
    }
    setAvatarDataUrl(await fileToDataUrl(file))
  }

  /** Every sprite operation below goes through this rather than the bare expression id */
  const keyFor = (expressionId: string) => spriteKey(activeOutfit, expressionId)

  const handleSpritePick = async (expressionId: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setSprites((s) => ({ ...s, [keyFor(expressionId)]: dataUrl }))
  }

  /** Bulk sprite upload: pick every expression image at once, matched to a slot by filename (`laughing.png` -> the `laughing`… */
  const handleBulkSpritePick = async (files: FileList) => {
    const knownIds = new Set([...DEFAULT_EXPRESSIONS.map((e) => e.id), ...customExpressions.map((e) => e.id)])
    const matched: string[] = []
    const unmatched: string[] = []
    const updates: Record<string, string> = {}
    for (const file of Array.from(files)) {
      const baseName = file.name.replace(/\.[^.]+$/, '').toLowerCase().trim()
      if (knownIds.has(baseName)) {
        updates[keyFor(baseName)] = await fileToDataUrl(file)
        matched.push(baseName)
      } else {
        unmatched.push(file.name)
      }
    }
    if (Object.keys(updates).length > 0) setSprites((s) => ({ ...s, ...updates }))
    if (matched.length > 0) toastSuccess(`Matched ${matched.length} expression${matched.length === 1 ? '' : 's'} into ${activeOutfitLabel}: ${matched.join(', ')}`)
    if (unmatched.length > 0) toastError(`No matching expression for: ${unmatched.join(', ')}. Rename to match an expression id, or add a custom expression with that id first.`)
  }

  /** Drops one expression's art in the outfit currently being edited. */
  const removeSprite = (expressionId: string) => removeSpriteKeys([keyFor(expressionId)])

  const removeSpriteKeys = (keys: string[]) => {
    const doomed = new Set(keys)
    const without = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map).filter(([k]) => !doomed.has(k)))
    setSprites((s) => without(s))
    setSpriteUnlocks((s) => without(s))
    setSpriteVariants((s) => without(s))
  }

  const setSpriteUnlock = (expressionId: string, minAffection: number) =>
    setSpriteUnlocks((s) => ({ ...s, [keyFor(expressionId)]: Math.max(0, Math.min(100, minAffection)) }))

  /** Item 11: an extra alternate image for a sprite slot, added onto whatever's already there. */
  const addSpriteVariant = async (expressionId: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setSpriteVariants((s) => ({ ...s, [keyFor(expressionId)]: [...(s[keyFor(expressionId)] ?? []), dataUrl] }))
  }

  const removeSpriteVariant = (expressionId: string, index: number) =>
    setSpriteVariants((s) => {
      const key = keyFor(expressionId)
      const remaining = (s[key] ?? []).filter((_, i) => i !== index)
      const next = { ...s }
      if (remaining.length) next[key] = remaining
      else delete next[key]
      return next
    })

  const addCustomExpression = () => {
    const label = newExpressionLabel.trim()
    if (!label) return
    const existingIds = [...DEFAULT_EXPRESSIONS.map((e) => e.id), ...customExpressions.map((e) => e.id)]
    setCustomExpressions((list) => [...list, { id: slugifyExpressionId(label, existingIds), label }])
    setNewExpressionLabel('')
  }

  const removeCustomExpression = (expressionId: string) => {
    setCustomExpressions((list) => list.filter((e) => e.id !== expressionId))
    // The slot is gone from every outfit, not just the one on screen
    removeSpriteKeys([BASE_OUTFIT_ID, ...outfits.map((o) => o.id)].map((o) => spriteKey(o, expressionId)))
  }

  const activeOutfitLabel = outfits.find((o) => o.id === activeOutfit)?.label ?? 'Base'

  const addOutfit = () => {
    const label = newOutfitLabel.trim()
    if (!label) return
    const id = slugifyOutfitId(label, outfits.map((o) => o.id))
    setOutfits((list) => [...list, { id, label }])
    setNewOutfitLabel('')
    setActiveOutfit(id)
  }

  const updateOutfit = (id: string, patch: Partial<Outfit>) =>
    setOutfits((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  const removeOutfit = (id: string) => {
    setOutfits((list) => list.filter((o) => o.id !== id))
    removeSpriteKeys(expressionIdsForOutfit(sprites, id).map((e) => spriteKey(id, e)))
    if (activeOutfit === id) setActiveOutfit(BASE_OUTFIT_ID)
  }

  const setGiftPreference = (giftId: string, score: number) =>
    setGiftPreferences((prev) => ({ ...prev, [giftId]: Math.max(-2, Math.min(3, score)) }))

  const addGalleryEntry = () =>
    setGallery((g) => [...g, { id: newId(), title: `CG ${g.length + 1}`, imageUrl: '', unlockAffection: 40, unlockHint: '' }])
  const updateGalleryEntry = (id: string, patch: Partial<GalleryEntry>) =>
    setGallery((g) => g.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const removeGalleryEntry = (id: string) => setGallery((g) => g.filter((item) => item.id !== id))
  const pickGalleryImage = async (id: string, file: File) =>
    updateGalleryEntry(id, { imageUrl: await fileToDataUrl(file) })

  /** Item 11: an extra alternate image for this CG, added onto whatever variants it already has. */
  const addGalleryVariant = async (id: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setGallery((g) => g.map((e) => (e.id === id ? { ...e, variants: [...(e.variants ?? []), dataUrl] } : e)))
  }

  const removeGalleryVariant = (id: string, index: number) =>
    setGallery((g) =>
      g.map((e) => {
        if (e.id !== id) return e
        const remaining = (e.variants ?? []).filter((_, i) => i !== index)
        return { ...e, variants: remaining.length ? remaining : undefined }
      }),
    )

  const addRelationshipStarter = () =>
    setRelationshipStarters((s) => [...s, { id: newId(), label: `Starter ${s.length + 1}`, blurb: '', startingAffection: 0 }])
  const updateRelationshipStarter = (id: string, patch: Partial<RelationshipStarter>) =>
    setRelationshipStarters((s) => s.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const removeRelationshipStarter = (id: string) => setRelationshipStarters((s) => s.filter((item) => item.id !== id))

  /** Applies a parsed card (V1/V2/V3) into the form, including any V3 `emotion`/`icon` assets. */
  const applyImport = (result: Awaited<ReturnType<typeof importCharacterFile>>) => {
    setForm(result.card)
    if (result.avatarDataUrl) setAvatarDataUrl(result.avatarDataUrl)
    if (result.sprites && Object.keys(result.sprites).length) {
      setSprites((s) => ({ ...result.sprites, ...s })) // keep anything already uploaded over an import
    }
    if (result.customExpressions?.length) {
      setCustomExpressions((list) => {
        const known = new Set([...DEFAULT_EXPRESSIONS.map((e) => e.id), ...list.map((e) => e.id)])
        return [...list, ...result.customExpressions!.filter((e) => !known.has(e.id))]
      })
    }
    if (result.sprites && Object.keys(result.sprites).length) {
      toastSuccess(`Imported ${Object.keys(result.sprites).length} expression sprite(s) from the card.`)
    }
  }

  const exportPack = async () => {
    if (!character) return
    try {
      const boundWorld = worlds.find((w) => w.id === character.worldId)
      const pack = await buildCharacterPack(character, boundWorld)
      downloadCharacterPack(pack)
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const allExpressions = [
    ...DEFAULT_EXPRESSIONS.map((e) => ({ id: e.id, label: e.label, emoji: e.emoji, custom: false })),
    ...customExpressions.map((e) => ({ id: e.id, label: e.label, emoji: '', custom: true })),
  ]

  const tabs = TABS.map((t) => {
    if (t.id === 'vn') return { ...t, badge: Object.keys(sprites).length }
    if (t.id === 'advanced') return { ...t, badge: form.character_book?.entries.length ?? 0 }
    return t
  })

  return {
    character,
    onSaved,
    onDeleted,
    tab,
    setTab,
    form,
    setForm,
    avatarDataUrl,
    setAvatarDataUrl,
    sprites,
    setSprites,
    spriteUnlocks,
    setSpriteUnlocks,
    spriteVariants,
    setSpriteVariants,
    customExpressions,
    setCustomExpressions,
    newExpressionLabel,
    setNewExpressionLabel,
    outfits,
    setOutfits,
    activeOutfit,
    setActiveOutfit,
    newOutfitLabel,
    setNewOutfitLabel,
    showExpressionSetDialog,
    setShowExpressionSetDialog,
    giftPreferences,
    setGiftPreferences,
    giftLikes,
    setGiftLikes,
    giftDislikes,
    setGiftDislikes,
    loveLanguage,
    setLoveLanguage,
    explicitVoiceNote,
    setExplicitVoiceNote,
    gallery,
    setGallery,
    relationshipStarters,
    setRelationshipStarters,
    weatherLoves,
    setWeatherLoves,
    weatherHates,
    setWeatherHates,
    schedule,
    setSchedule,
    voiceProvider,
    setVoiceProvider,
    globalTtsProvider,
    globalTtsModel,
    usesOpenMayhemVoice,
    speechModels,
    voiceId,
    setVoiceId,
    verbalTics,
    setVerbalTics,
    catchphrases,
    setCatchphrases,
    dialectNotes,
    setDialectNotes,
    sentenceRhythm,
    setSentenceRhythm,
    sfxWords,
    setSfxWords,
    instructTemplateId,
    setInstructTemplateId,
    replyLength,
    setReplyLength,
    worldId,
    setWorldId,
    occupation,
    setOccupation,
    workplace,
    setWorkplace,
    homeLocation,
    setHomeLocation,
    birthday,
    setBirthday,
    frequentedLocations,
    setFrequentedLocations,
    likes,
    setLikes,
    goals,
    setGoals,
    boundaries,
    setBoundaries,
    socialConnections,
    setSocialConnections,
    behavioralRules,
    setBehavioralRules,
    dateModeOptOut,
    setDateModeOptOut,
    sensitiveRegions,
    setSensitiveRegions,
    unresponsiveRegions,
    setUnresponsiveRegions,
    offLimitRegions,
    setOffLimitRegions,
    likedKinks,
    setLikedKinks,
    dislikedKinks,
    setDislikedKinks,
    hardLimitKinks,
    setHardLimitKinks,
    outreachFrequency,
    setOutreachFrequency,
    drive,
    setDrive,
    driveLists,
    setDriveLists,
    showGenerate,
    setShowGenerate,
    showTemplates,
    setShowTemplates,
    saving,
    setSaving,
    worlds,
    editingWorld,
    customInstructTemplates,
    set,
    voice,
    voiceFingerprint,
    weatherPreferences,
    toggleWeather,
    addScheduleEntry,
    updateScheduleEntry,
    removeScheduleEntry,
    toggleScheduleDay,
    detectVoiceFromExamples,
    applyMaximumImmersion,
    addSocialConnection,
    updateSocialConnection,
    removeSocialConnection,
    addBehavioralRule,
    updateBehavioralRule,
    removeBehavioralRule,
    save,
    remove,
    handleAvatarPick,
    keyFor,
    handleSpritePick,
    handleBulkSpritePick,
    removeSprite,
    removeSpriteKeys,
    setSpriteUnlock,
    addSpriteVariant,
    removeSpriteVariant,
    addCustomExpression,
    removeCustomExpression,
    activeOutfitLabel,
    addOutfit,
    updateOutfit,
    removeOutfit,
    setGiftPreference,
    addGalleryEntry,
    updateGalleryEntry,
    removeGalleryEntry,
    pickGalleryImage,
    addGalleryVariant,
    removeGalleryVariant,
    addRelationshipStarter,
    updateRelationshipStarter,
    removeRelationshipStarter,
    applyImport,
    exportPack,
    allExpressions,
    tabs,
  }
}

export type CharacterEditorState = ReturnType<typeof useCharacterEditor>
