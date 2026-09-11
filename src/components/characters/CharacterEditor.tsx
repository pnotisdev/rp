import { BODY_REGIONS } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS, type KinkProfile } from '@/lib/dating/kinks'
import type { TouchProfile } from '@/lib/dating/touch'
import { useEffect, useState, type ReactNode } from 'react'
import { ImagePlus, Plus, Sparkles, X } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, instructTemplatesApi, worldsApi } from '@/lib/api/client'
import type { BehavioralRule, Character, GalleryEntry, OutreachFrequency, RelationshipStarter, SocialConnection } from '@/lib/characters/cardSpec'
import type { RelationshipStage } from '@/lib/types'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import {
  REPLY_LENGTH_HINTS,
  REPLY_LENGTH_LABELS,
  deriveCardReplyBand,
  detectVoiceFingerprint,
  type ReplyLength,
} from '@/lib/characters/voice'
import { downloadJson, downloadPng, fileToDataUrl, importCharacterFile } from '@/lib/characters/importExport'
import { buildCharacterPack, downloadCharacterPack, importCharacterPack, parseCharacterPackFile } from '@/lib/characters/pack'
import { DEFAULT_EXPRESSIONS, slugifyExpressionId, type CustomExpression } from '@/lib/vn/expressions'
import { BASE_OUTFIT_ID, expressionIdsForOutfit, outfitCoverage, slugifyOutfitId, spriteKey, type Outfit } from '@/lib/vn/outfits'
import { combinedSceneFlags } from '@/lib/dating/stage'
import { getCalendarInfo } from '@/lib/world/calendar'
import { estimateTokens } from '@/lib/tokenEstimate'
import { newId } from '@/lib/id'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Chip } from '@/components/ui/Chip'
import { Section } from '@/components/ui/Section'
import { EditorShell, type EditorTab } from '@/components/ui/EditorShell'
import { ListEditor } from '@/components/ui/ListEditor'
import { FileButton } from '@/components/ui/FileButton'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { GenerateExpressionSetDialog } from './GenerateExpressionSetDialog'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { GenerateCharacterDialog } from './GenerateCharacterDialog'
import { TemplateGallery } from './TemplateGallery'
import { RegenerateFieldButton } from './RegenerateFieldButton'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useOpenMayhemModels } from '@/lib/hooks/useOpenMayhemModels'
import { OpenMayhemVoiceField } from '@/components/settings/OpenMayhemVoiceField'
import { maximumImmersionChecklist, maximumImmersionSamplerParams, maximumImmersionSystemPrompt } from '@/lib/prompt/immersionPreset'
import {
  PHASES,
  WEATHER_KINDS,
  WEEKDAYS,
  describeWeather,
  type DayPhase,
  type PresenceStatus,
  type ScheduleEntry,
  type WeatherKind,
  type Weekday,
} from '@/lib/world/calendar'

/** `description`/`personality`/`scenario`/`mes_example` all sit in the prompt's always-included,
 *  never-trimmed section — past roughly this many tokens a field starts crowding out history and
 *  world info every single turn. Soft, advisory only. */
const FIXED_FIELD_TOKEN_HINT = 400

/** Appends a soft "this field is getting large" note to a fixed-section field's hint. */
function fixedFieldHint(base: ReactNode, value: string): ReactNode {
  const tokens = estimateTokens(value)
  if (tokens <= FIXED_FIELD_TOKEN_HINT) return base
  return (
    <>
      {base}
      {base ? ' ' : null}
      <span className="text-amber-500">
        ~{tokens} tokens. This field is sent in full every turn and never trimmed; consider tightening it or moving
        detail into Character lore.
      </span>
    </>
  )
}

const TABS: EditorTab[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'life', label: 'Life & background' },
  { id: 'vn', label: 'Visual novel' },
  { id: 'dating', label: 'Dating sim' },
  { id: 'worldsim', label: 'World sim' },
  { id: 'voice', label: 'Voice' },
  { id: 'advanced', label: 'Advanced' },
]

/** The regions an authored sensitivity map scores at exactly this value. */
function regionsAt(sensitivity: Partial<Record<string, number>> | undefined, value: number): string {
  return Object.entries(sensitivity ?? {})
    .filter(([, v]) => v === value)
    .map(([region]) => region)
    .join(', ')
}

function kinksAt(valence: Partial<Record<string, number>> | undefined, value: number): string {
  return Object.entries(valence ?? {})
    .filter(([, v]) => v === value)
    .map(([kink]) => kink)
    .join(', ')
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean)
}

/**
 * Only real regions. Applied when the profile is composed rather than as the author types, since
 * validating a half-typed word would eat every keystroke before it could become one.
 */
function parseRegions(raw: string): string[] {
  return parseList(raw).filter((v) => (BODY_REGIONS as readonly string[]).includes(v))
}

/** Kink ids stay open, so a world's own vocabulary survives being typed in here. */
function parseKinks(raw: string): string[] {
  return parseList(raw)
}

/**
 * Rebuilds a profile from the fields above, preserving anything they don't own — a per-region score
 * of 1 or 2, or a warmth gate, set on an imported card stays exactly as authored.
 */
function composeTouchProfile(
  existing: TouchProfile | undefined,
  sensitiveRaw: string,
  unresponsiveRaw: string,
  offLimitsRaw: string,
): TouchProfile | null {
  const sensitive = parseRegions(sensitiveRaw)
  const unresponsive = parseRegions(unresponsiveRaw)
  const offLimits = parseRegions(offLimitsRaw)
  const sensitivity: Record<string, number> = {}
  for (const [region, value] of Object.entries(existing?.sensitivity ?? {})) {
    if (value !== 3 && value !== 0 && value !== undefined) sensitivity[region] = value
  }
  for (const region of sensitive) sensitivity[region] = 3
  for (const region of unresponsive) sensitivity[region] = 0
  const profile: TouchProfile = {
    ...(Object.keys(sensitivity).length ? { sensitivity: sensitivity as TouchProfile['sensitivity'] } : {}),
    ...(offLimits.length ? { offLimits: offLimits as NonNullable<TouchProfile['offLimits']> } : {}),
    ...(existing?.gated ? { gated: existing.gated } : {}),
  }
  return Object.keys(profile).length ? profile : null
}

function composeKinkProfile(
  existing: KinkProfile | undefined,
  likedRaw: string,
  dislikedRaw: string,
  hardLimitsRaw: string,
): KinkProfile | null {
  const liked = parseKinks(likedRaw)
  const disliked = parseKinks(dislikedRaw)
  const hardLimits = parseKinks(hardLimitsRaw)
  const valence: Record<string, number> = {}
  for (const [kink, value] of Object.entries(existing?.valence ?? {})) {
    if (value !== 2 && value !== -1 && value !== undefined) valence[kink] = value
  }
  for (const kink of liked) valence[kink] = 2
  for (const kink of disliked) valence[kink] = -1
  const profile: KinkProfile = {
    ...(Object.keys(valence).length ? { valence: valence as KinkProfile['valence'] } : {}),
    ...(hardLimits.length ? { hardLimits } : {}),
  }
  return Object.keys(profile).length ? profile : null
}

export function CharacterEditor({
  character,
  onSaved,
  onDeleted,
}: {
  character: Character | null
  onSaved: (id: string) => void
  onDeleted: () => void
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
  // `touchProfile`/`kinkProfile` are richer than these fields can express (a per-region 0-3 scale, and
  // warmth gates). The editor covers the parts that carry weight — what they love, what does nothing
  // for them, and what is off the table — and leaves the rest to an imported card, which round-trips
  // untouched because composing below only overwrites the keys these fields own.
  const [sensitiveRegions, setSensitiveRegions] = useState(regionsAt(character?.touchProfile?.sensitivity, 3))
  const [unresponsiveRegions, setUnresponsiveRegions] = useState(regionsAt(character?.touchProfile?.sensitivity, 0))
  const [offLimitRegions, setOffLimitRegions] = useState((character?.touchProfile?.offLimits ?? []).join(', '))
  const [likedKinks, setLikedKinks] = useState(kinksAt(character?.kinkProfile?.valence, 2))
  const [dislikedKinks, setDislikedKinks] = useState(kinksAt(character?.kinkProfile?.valence, -1))
  const [hardLimitKinks, setHardLimitKinks] = useState((character?.kinkProfile?.hardLimits ?? []).join(', '))
  const [outreachFrequency, setOutreachFrequency] = useState<OutreachFrequency>(character?.outreach?.frequency ?? 'never')
  const [showGenerate, setShowGenerate] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [saving, setSaving] = useState(false)
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const editingWorld = worlds.find((w) => w.id === worldId)
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  useEffect(() => {
    setForm(character?.card ?? blankCharacterData())
    setAvatarDataUrl(character?.avatarDataUrl)
    setSprites(character?.sprites ?? {})
    setSpriteVariants(character?.spriteVariants ?? {})
    setSpriteUnlocks(character?.spriteUnlocks ?? {})
    setCustomExpressions(character?.customExpressions ?? [])
    setNewExpressionLabel('')
    setOutfits(character?.outfits ?? [])
    setActiveOutfit(BASE_OUTFIT_ID)
    setNewOutfitLabel('')
    setGiftPreferences(character?.giftPreferences ?? {})
    setGiftLikes(character?.giftLikes ?? [])
    setGiftDislikes(character?.giftDislikes ?? [])
    setLoveLanguage(character?.loveLanguage ?? '')
    setExplicitVoiceNote(character?.explicitVoiceNote ?? '')
    setGallery(character?.gallery ?? [])
    setRelationshipStarters(character?.relationshipStarters ?? [])
    setVoiceProvider(character?.voice?.provider ?? '')
    setVoiceId(character?.voice?.voiceId ?? '')
    setVerbalTics(character?.voiceFingerprint?.verbalTics ?? [])
    setCatchphrases(character?.voiceFingerprint?.catchphrases ?? [])
    setDialectNotes(character?.voiceFingerprint?.dialectNotes ?? '')
    setSentenceRhythm(character?.voiceFingerprint?.sentenceRhythm ?? '')
    setSfxWords(character?.sfxWords ?? [])
    setInstructTemplateId(character?.instructTemplateId ?? '')
    setReplyLength(character?.replyLength ?? 'auto')
    setWeatherLoves(character?.weatherPreferences?.loves ?? [])
    setWeatherHates(character?.weatherPreferences?.hates ?? [])
    setSchedule(character?.schedule ?? [])
    setWorldId(character?.worldId ?? '')
    setOccupation(character?.occupation ?? '')
    setWorkplace(character?.workplace ?? '')
    setHomeLocation(character?.homeLocation ?? '')
    setBirthday(character?.birthday)
    setFrequentedLocations(character?.frequentedLocations ?? [])
    setLikes(character?.likes ?? [])
    setGoals(character?.goals ?? [])
    setBoundaries(character?.boundaries ?? [])
    setSocialConnections(character?.socialConnections ?? [])
    setBehavioralRules(character?.behavioralRules ?? [])
    setDateModeOptOut(character?.dateModeOptOut ?? false)
    setSensitiveRegions(regionsAt(character?.touchProfile?.sensitivity, 3))
    setUnresponsiveRegions(regionsAt(character?.touchProfile?.sensitivity, 0))
    setOffLimitRegions((character?.touchProfile?.offLimits ?? []).join(', '))
    setLikedKinks(kinksAt(character?.kinkProfile?.valence, 2))
    setDislikedKinks(kinksAt(character?.kinkProfile?.valence, -1))
    setHardLimitKinks((character?.kinkProfile?.hardLimits ?? []).join(', '))
    setOutreachFrequency(character?.outreach?.frequency ?? 'never')
  }, [character?.id])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Sent as `null`, not `undefined`, when empty: JSON.stringify drops `undefined`-valued keys
  // entirely, so an `undefined` here would make the update request omit the field altogether and
  // silently leave the character's previous value in place instead of actually clearing it.
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

  /**
   * The "Detect from examples" button — a deterministic, zero-cost heuristic over the card's own
   * `mes_example`/`first_mes`/alternate greetings (`detectVoiceFingerprint`, `voice.ts`), not a model
   * call: repeated words/phrases, sentence length, and punctuation habits are exactly the kind of
   * mechanical property a `String.split` measures perfectly and a small local model counts
   * unreliably, so there's nothing to await, nothing to fail, and nothing to mock in a test. Merges
   * into whatever's already authored rather than overwriting it — new tics/catchphrases are added
   * (deduped), and prose fields are only filled when empty, so re-running this after hand-editing
   * never clobbers a deliberate edit.
   */
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

  /**
   * The "Maximum Immersion" one-click bundle (`immersionPreset.ts`) — curation over invention: every
   * piece here already exists (a system-prompt preset, a sampler preset, two global toggles). This
   * character's own `system_prompt` override is the one piece that lives on the card; the sampler
   * and the two global toggles only exist in Settings (`useSettingsStore`), so this reaches into its
   * already-exported setters directly rather than duplicating them here or asking the user to hunt
   * them down one at a time. World template is deliberately only *recommended* (see the checklist),
   * not applied: `WorldTemplateId` is a closed enum threaded through `WorldCard`/`types.ts`, a
   * reserved file this pass doesn't touch, and silently rewriting an unrelated World record as a
   * side effect of a character-editor button would be a bigger, riskier change than this one click
   * should make.
   */
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

  /**
   * Every sprite operation below goes through this rather than the bare expression id: art is
   * stored per outfit (`outfits.ts`), and the base outfit's key is the bare id — so an ordinary
   * character with no outfits reads and writes exactly the keys it always did.
   */
  const keyFor = (expressionId: string) => spriteKey(activeOutfit, expressionId)

  const handleSpritePick = async (expressionId: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setSprites((s) => ({ ...s, [keyFor(expressionId)]: dataUrl }))
  }

  /**
   * Bulk sprite upload: pick every expression image at once, matched to a slot by filename
   * (`laughing.png` -> the `laughing` expression) instead of one at a time per slot.
   */
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
    // The slot is gone from every outfit, not just the one on screen — otherwise its art in the
    // other outfits would be orphaned, with no grid cell left to reach or delete it from.
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

  const handleImportFile = async (file: File) => {
    try {
      applyImport(await importCharacterFile(file))
    } catch (e) {
      toastError(errorMessage(e))
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

  const handleImportPackFile = async (file: File) => {
    try {
      const pack = await parseCharacterPackFile(file)
      const { character: created, rejectedScenarios } = await importCharacterPack(pack)
      toastSuccess(`Imported "${created.card.name}"${pack.world ? ' with its world' : ''}.`)
      // A dropped scene shape has to be said out loud: the import otherwise reports success and the
      // world quietly cannot run a scenario its author wrote.
      if (rejectedScenarios.length) {
        toastError(
          `${rejectedScenarios.length === 1 ? 'One scene shape was' : `${rejectedScenarios.length} scene shapes were`} ` +
            `left out as malformed and won't be available in this world. ${rejectedScenarios.join(' | ')}`,
        )
      }
      onSaved(created.id)
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

  return (
    <EditorShell
      onBack={onDeleted}
      backLabel="Characters"
      eyebrow={character ? 'Character' : 'New character'}
      title={form.name || 'Unnamed character'}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          {character ? (
            <Button variant="danger" onClick={remove}>
              Delete character
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {!form.name.trim() && <span className="text-xs text-danger">Name is required</span>}
            <Button variant="primary" onClick={save} disabled={!form.name.trim() || saving}>
              {saving ? 'Saving…' : character ? 'Save changes' : 'Create character'}
            </Button>
          </div>
        </>
      }
    >
      {tab === 'identity' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <FileButton onPick={(f) => handleImportFile(f[0])} accept=".json,.png">
              Import card
            </FileButton>
            {!character && (
              <FileButton
                onPick={(f) => handleImportPackFile(f[0])}
                accept=".json"
                title="Restore a character exported with 'Export pack': sprites, gallery, and bound world included"
              >
                Import pack
              </FileButton>
            )}
            <Button onClick={() => setShowGenerate(true)} className="flex items-center gap-1.5">
              <Sparkles size={14} strokeWidth={2} />
              Generate with AI
            </Button>
            {!character && <Button onClick={() => setShowTemplates(true)}>Start from a template</Button>}
            <Button
              variant="secondary"
              onClick={() => {
                applyMaximumImmersion()
                setTab('advanced')
              }}
              className="flex items-center gap-1.5"
              title={
                'One click: sets this character\'s system prompt to "Immersive, no meta", switches the global sampler to "Creative", and turns on slow-burn pacing + visual novel mode. See the Advanced tab for the full checklist and a recommendation to bind a "Dating Sim" world.'
              }
            >
              <Sparkles size={14} strokeWidth={2} />
              Maximum Immersion
            </Button>
            {character && (
              <>
                <Button variant="ghost" onClick={() => downloadJson(form)}>
                  Export JSON
                </Button>
                <Button variant="ghost" onClick={() => downloadPng(form, avatarDataUrl)}>
                  Export PNG
                </Button>
                <Button variant="ghost" onClick={exportPack} title="Bundle the card, sprites, gallery, gift preferences, and bound world into one file">
                  Export pack
                </Button>
              </>
            )}
          </div>

          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <label
                className="portrait-frame group relative flex h-24 w-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
                aria-label="Change character avatar"
              >
                {avatarDataUrl ? (
                  <img src={avatarDataUrl} alt="" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
                    <ImagePlus size={18} strokeWidth={1.5} />
                    Avatar
                  </span>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleAvatarPick(e.target.files[0])}
                />
              </label>
              <div className="absolute -bottom-1.5 -right-1.5">
                <GenerateImageButton
                  label="Generate avatar with AI"
                  initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}`.slice(0, 300) : ''}
                  onGenerated={setAvatarDataUrl}
                />
              </div>
            </div>
            <div className="flex-1 space-y-0">
              <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              <SelectField label="World" value={worldId} onChange={(e) => setWorldId(e.target.value)}>
                <option value="">No world (standalone)</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <TextAreaField
            label="Description"
            hint={fixedFieldHint('Appearance, background, core facts. Supports {{char}} / {{user}}.', form.description)}
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            actions={<RegenerateFieldButton character={form} fieldKey="description" onResult={(t) => set('description', t)} />}
          />
          <TextAreaField
            label="Personality"
            hint={fixedFieldHint(
              'How they speak, act, and feel. The more specific, the more the model imitates their voice.',
              form.personality,
            )}
            rows={3}
            value={form.personality}
            onChange={(e) => set('personality', e.target.value)}
            actions={<RegenerateFieldButton character={form} fieldKey="personality" onResult={(t) => set('personality', t)} />}
          />
          <TextAreaField
            label="Scenario"
            hint={fixedFieldHint('The situation the chat starts in.', form.scenario)}
            rows={2}
            value={form.scenario}
            onChange={(e) => set('scenario', e.target.value)}
            actions={<RegenerateFieldButton character={form} fieldKey="scenario" onResult={(t) => set('scenario', t)} />}
          />
          <TextAreaField
            label="First message"
            rows={3}
            value={form.first_mes}
            onChange={(e) => set('first_mes', e.target.value)}
          />
          <TextAreaField
            label="Alternate greetings"
            hint="One per line. Optional gate prefix: [affection>=40] Your line"
            rows={3}
            value={(form.alternate_greetings ?? []).join('\n')}
            onChange={(e) => set('alternate_greetings', e.target.value.split('\n').filter(Boolean))}
          />
          <TextAreaField
            label="Example messages"
            hint={fixedFieldHint(
              'Few-shot dialogue examples, e.g. <START>\\n{{user}}: ...\\n{{char}}: ...',
              form.mes_example,
            )}
            rows={4}
            value={form.mes_example}
            onChange={(e) => set('mes_example', e.target.value)}
          />
        </div>
      )}

      {tab === 'life' && (
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
      )}

      {tab === 'vn' && (
        <div className="space-y-10">
        {!worldId && (
          <p className="rounded-xl bg-bg-sunken px-4 py-3 text-xs text-text-muted">
            Sprites show in Visual Novel mode, but scene <em>backgrounds</em> come from a world. This character isn't
            bound to one, so VN scenes will fall back to a placeholder gradient. Pick a world in the{' '}
            <button type="button" onClick={() => setTab('identity')} className="text-accent hover:underline">
              Identity tab
            </button>
            .
          </p>
        )}
        <Section
          title="Expressions"
          description="Art per expression so Visual Novel mode shows the right one as the model tags each reply's mood. Blank falls back to the avatar. The small number is the warmth needed to unlock it."
          surface="bare"
        >
          {/* Outfits (`outfits.ts`): a second axis on this grid. The grid below always edits ONE
              outfit at a time — switching chips swaps which art the same 21 slots are showing,
              rather than making the page 21×N cells long. "Base" is the character's original art
              and always exists; it's what a partially-drawn outfit falls back to at render time. */}
          <div className="mb-4 rounded-xl bg-bg-sunken/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium text-text-muted">Outfit</span>
              {[{ id: BASE_OUTFIT_ID, label: 'Base' }, ...outfits].map((o) => {
                const cov = outfitCoverage(sprites, o.id, allExpressions.map((e) => e.id))
                const active = activeOutfit === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setActiveOutfit(o.id)}
                    aria-pressed={active}
                    title={`${cov.drawn} of ${cov.total} expressions drawn`}
                    className={`rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors ${
                      active ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-bg-elevated hover:text-text'
                    }`}
                  >
                    {o.label}
                    <span className={active ? 'ml-1 opacity-70' : 'ml-1 opacity-50'}>{cov.drawn}</span>
                  </button>
                )
              })}
              <input
                value={newOutfitLabel}
                onChange={(e) => setNewOutfitLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addOutfit()}
                placeholder="New outfit (e.g. Swimsuit)"
                aria-label="New outfit name"
                className="ml-1 w-44 rounded-full bg-bg px-2.5 py-1 text-[11px] text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
              />
              <Button onClick={addOutfit} disabled={!newOutfitLabel.trim()} variant="ghost" className="!px-2 !py-1 !text-[11px]">
                <Plus size={12} strokeWidth={2} />
              </Button>
            </div>

            {activeOutfit === BASE_OUTFIT_ID ? (
              <p className="text-[11px] text-text-muted">
                The character's default art. Add an outfit to give them a second look the model can switch to mid-scene. Any expression you don't draw for it falls back to this one.
              </p>
            ) : (
              (() => {
                const outfit = outfits.find((o) => o.id === activeOutfit)
                if (!outfit) return null
                const knownFlags = combinedSceneFlags(editingWorld?.customSceneFlags)
                return (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      Name
                      <input
                        value={outfit.label}
                        onChange={(e) => updateOutfit(outfit.id, { label: e.target.value })}
                        className="w-32 rounded-md bg-bg px-2 py-1 text-[11px] text-text outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      Unlocks at warmth
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Number(outfit.unlockAffection ?? 0)}
                        onChange={(e) => updateOutfit(outfit.id, { unlockAffection: Number(e.target.value) || 0 })}
                        className="w-12 rounded-md bg-bg px-1 py-1 text-center text-[11px] text-text outline-none"
                      />
                    </label>
                    <label
                      className="flex items-center gap-1.5 text-[11px] text-text-muted"
                      title="Coins this outfit has to be bought for in the Relationship panel's Shop before it unlocks, on top of any warmth gate. 0 means it is earned rather than sold. Only outfits with art drawn for them are ever offered for sale."
                    >
                      Price
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={Number(outfit.price ?? 0)}
                        onChange={(e) => updateOutfit(outfit.id, { price: Number(e.target.value) || 0 })}
                        className="w-14 rounded-md bg-bg px-1 py-1 text-center text-[11px] text-text outline-none"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="The model is never offered this outfit. It only appears if the story unlocks it another way. For a state you don't want picked just because a reply read as suggestive.">
                      <input
                        type="checkbox"
                        checked={!!outfit.manualOnly}
                        onChange={(e) => updateOutfit(outfit.id, { manualOnly: e.target.checked })}
                        className="accent-accent"
                      />
                      Never chosen by the model
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Using an explicit action from the Relationship panel (a position, toy, or activity, not a kissing spot) switches to this outfit automatically. The story tags its own way back out afterwards.">
                      <input
                        type="checkbox"
                        checked={!!outfit.intimate}
                        onChange={(e) => updateOutfit(outfit.id, { intimate: e.target.checked })}
                        className="accent-accent"
                      />
                      Used for intimate scenes
                    </label>
                    {knownFlags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-text-muted">Also needs</span>
                        {knownFlags.map((f) => {
                          const on = (outfit.requiredFlags ?? []).includes(f.id)
                          return (
                            <button
                              key={f.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                updateOutfit(outfit.id, {
                                  requiredFlags: on
                                    ? (outfit.requiredFlags ?? []).filter((x) => x !== f.id)
                                    : [...(outfit.requiredFlags ?? []), f.id],
                                })
                              }
                              className={`rounded-full px-2 py-0.5 text-[10px] leading-none transition-colors ${
                                on ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'text-text-muted hover:bg-bg-elevated'
                              }`}
                            >
                              {f.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeOutfit(outfit.id)}
                      className="ml-auto flex items-center gap-1 text-[11px] text-text-muted hover:text-danger"
                    >
                      <X size={11} strokeWidth={2.5} />
                      Delete outfit
                    </button>
                  </div>
                )
              })()
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FileButton onPick={handleBulkSpritePick} accept="image/png,image/jpeg,image/webp" multiple>
              <Plus size={14} strokeWidth={2} />
              Bulk upload by filename
            </FileButton>
            <span className="text-[11px] text-text-muted">e.g. laughing.png → Laughing</span>
            <Button onClick={() => setShowExpressionSetDialog(true)} className="flex items-center gap-1.5">
              <Sparkles size={14} strokeWidth={2} />
              Generate expression set with AI
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {allExpressions.map((exp) => (
              <div key={exp.id} className="group relative flex flex-col items-center gap-1">
                <label className="portrait-frame relative flex h-20 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
                  {sprites[keyFor(exp.id)] ? (
                    <img src={sprites[keyFor(exp.id)]} alt="" className="h-full w-full object-cover" />
                  ) : exp.emoji ? (
                    <span className="text-xl opacity-60">{exp.emoji}</span>
                  ) : (
                    <ImagePlus size={16} strokeWidth={1.5} className="text-text-muted" />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleSpritePick(exp.id, e.target.files[0])}
                  />
                </label>
                <div className="flex w-full items-center justify-between gap-1 px-0.5">
                  <span className="truncate text-[11px] text-text-muted">{exp.label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Number(spriteUnlocks[keyFor(exp.id)] ?? 0)}
                    onChange={(e) => setSpriteUnlock(exp.id, Number(e.target.value) || 0)}
                    className="w-9 rounded-md bg-bg-sunken px-1 py-0.5 text-center text-[11px] text-text outline-none"
                    aria-label={`Unlock warmth for ${exp.label}`}
                  />
                </div>
                {/* Item 11: extra alternates for this slot — hidden entirely until there's a primary sprite to vary. */}
                {sprites[keyFor(exp.id)] && (
                  <div className="flex w-full flex-wrap items-center gap-1 px-0.5">
                    {(spriteVariants[keyFor(exp.id)] ?? []).map((url, i) => (
                      <div key={i} className="group/variant relative h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeSpriteVariant(exp.id, i)}
                          aria-label={`Remove variant ${i + 1} of ${exp.label}`}
                          className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover/variant:flex"
                        >
                          <X size={11} strokeWidth={2.5} />
                        </button>
                      </div>
                    ))}
                    <label
                      title={`Add a variant for ${exp.label}. Shown alongside the primary art for visual variety`}
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:text-text"
                    >
                      <Plus size={12} strokeWidth={2} />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && addSpriteVariant(exp.id, e.target.files[0])}
                      />
                    </label>
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 hidden group-hover:block">
                  <GenerateImageButton
                    label={`Generate ${exp.label} with AI`}
                    initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}, ${exp.label.toLowerCase()} expression${activeOutfit === BASE_OUTFIT_ID ? '' : `, wearing ${activeOutfitLabel.toLowerCase()}`}`.slice(0, 300) : ''}
                    onGenerated={(dataUrl) => setSprites((s) => ({ ...s, [keyFor(exp.id)]: dataUrl }))}
                  />
                </div>
                {(exp.custom || sprites[keyFor(exp.id)]) && (
                  <button
                    type="button"
                    onClick={() => (exp.custom ? removeCustomExpression(exp.id) : removeSprite(exp.id))}
                    aria-label={exp.custom ? `Remove custom expression ${exp.label}` : `Remove ${exp.label} sprite`}
                    className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-text-muted hover:text-danger group-hover:flex"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input
              value={newExpressionLabel}
              onChange={(e) => setNewExpressionLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomExpression()}
              placeholder="Custom expression name (e.g. Sly grin)"
              className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
            />
            <Button onClick={addCustomExpression} disabled={!newExpressionLabel.trim()} className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2} />
              Add
            </Button>
          </div>
        </Section>

        <Section
          title="Sound effects"
          description="This character's own comic sound words, on top of the built-in list and any global ones. A catgirl's “nya, nyaa, mrrp”, an imouto's tics. They get the manga-style burst styling in her messages. Display-only; the model never sees this. Turn the whole feature on/off in Settings → Appearance."
          surface="bare"
        >
          <TextField
            label="Extra sound words"
            hint="Comma separated. Punctuation and length variants are handled automatically (“nya” also matches “Nyaa~”)."
            value={sfxWords.join(', ')}
            onChange={(e) => setSfxWords(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="nya, nyaa, mrrp, purr"
          />
        </Section>
        </div>
      )}

      {tab === 'dating' && (
        <div className="space-y-10">
          <Section
            title="CG gallery"
            description="Unlockable images shown in the Gallery tab. By warmth threshold, story beat, or (for endings) reaching Sweethearts."
            surface="bare"
          >
            <ListEditor
              items={gallery}
              getKey={(g) => g.id}
              onAdd={addGalleryEntry}
              onRemove={(g) => removeGalleryEntry(g.id)}
              addLabel="Add CG"
              emptyHint="No gallery images yet."
              renderItem={(entry) => (
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <label className="portrait-frame relative block h-16 w-24 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-dashed border-border bg-bg-elevated" aria-label="Change CG image">
                      {entry.imageUrl ? (
                        <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <ImagePlus size={14} strokeWidth={1.5} className="text-text-muted" />
                        </span>
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && pickGalleryImage(entry.id, e.target.files[0])}
                      />
                    </label>
                    <div className="relative shrink-0 self-center">
                      <GenerateImageButton
                        label={`Generate "${entry.title}" with AI`}
                        initialPrompt={[
                          form.description ? `${form.name || 'a character'}, ${form.description}` : form.name,
                          entry.unlockHint,
                          entry.title,
                        ]
                          .filter(Boolean)
                          .join(', ')
                          .slice(0, 300)}
                        width={1216}
                        height={832}
                        onGenerated={(dataUrl) => updateGalleryEntry(entry.id, { imageUrl: dataUrl })}
                      />
                    </div>
                    <div className="flex-1">
                      <TextField label="Title" value={entry.title} onChange={(e) => updateGalleryEntry(entry.id, { title: e.target.value })} />
                    </div>
                  </div>
                  {/* Item 11: extra alternates for this same CG — hidden until there's a primary image to vary. */}
                  {entry.imageUrl && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[11px] text-text-muted">Variants</span>
                      {(entry.variants ?? []).map((url, i) => (
                        <div key={i} className="group/variant relative h-10 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeGalleryVariant(entry.id, i)}
                            aria-label={`Remove variant ${i + 1} of ${entry.title}`}
                            className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover/variant:flex"
                          >
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </div>
                      ))}
                      <label
                        title={`Add a variant for "${entry.title}". Picked alongside the primary image for visual variety`}
                        className="flex h-10 w-14 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:text-text"
                      >
                        <Plus size={13} strokeWidth={2} />
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && addGalleryVariant(entry.id, e.target.files[0])}
                        />
                      </label>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                    <TextField
                      label="Unlock hint"
                      value={entry.unlockHint ?? ''}
                      onChange={(e) => updateGalleryEntry(entry.id, { unlockHint: e.target.value })}
                      placeholder="Confess under the lanterns"
                    />
                    <NumberField
                      label="Unlock warmth"
                      value={entry.unlockAffection}
                      onChange={(e) => updateGalleryEntry(entry.id, { unlockAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    />
                    <TextField
                      label="Required scene flags"
                      value={(entry.requiredFlags ?? []).join(', ')}
                      onChange={(e) => updateGalleryEntry(entry.id, { requiredFlags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                      placeholder="first_date, confession"
                      className="sm:col-span-2"
                    />
                  </div>
                  <Toggle
                    checked={entry.isEnding ?? false}
                    onChange={(v) => updateGalleryEntry(entry.id, { isEnding: v || undefined })}
                    label="Ending"
                    description="Unlocks the moment the relationship reaches Sweethearts, ignoring the fields above. A once-per-relationship epilogue."
                  />
                  {!entry.isEnding && (
                    <div className="grid grid-cols-1 gap-x-3 gap-y-2 rounded-lg bg-bg-sunken p-3 sm:grid-cols-2">
                      <SelectField
                        label="Auto-show full-bleed when…"
                        hint="Once unlocked (above), swaps this in for the ordinary sprite/background live on the VN stage. No need to browse the Gallery to see it."
                        value={entry.autoTrigger?.kind ?? 'none'}
                        onChange={(e) => {
                          const kind = e.target.value
                          if (kind === 'none') return updateGalleryEntry(entry.id, { autoTrigger: undefined })
                          if (kind === 'intimacyPhase') return updateGalleryEntry(entry.id, { autoTrigger: { kind, phase: 'peak' } })
                          if (kind === 'catalogAction') return updateGalleryEntry(entry.id, { autoTrigger: { kind, optionId: '' } })
                          if (kind === 'sceneFlag') return updateGalleryEntry(entry.id, { autoTrigger: { kind, flag: '' } })
                          return updateGalleryEntry(entry.id, { autoTrigger: { kind: 'relationshipStage', stage: 'sweethearts' } })
                        }}
                      >
                        <option value="none">Never (Gallery only)</option>
                        <option value="intimacyPhase">An intimacy phase</option>
                        <option value="catalogAction">A specific catalog action</option>
                        <option value="sceneFlag">A scene flag</option>
                        <option value="relationshipStage">Reaching a relationship stage</option>
                      </SelectField>
                      {entry.autoTrigger?.kind === 'intimacyPhase' && (
                        <SelectField
                          label="Phase"
                          value={entry.autoTrigger.phase}
                          onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'intimacyPhase', phase: e.target.value as 'building' | 'peak' } })}
                        >
                          <option value="building">Building</option>
                          <option value="peak">Peak</option>
                        </SelectField>
                      )}
                      {entry.autoTrigger?.kind === 'catalogAction' && (
                        <TextField
                          label="Catalog action id"
                          value={entry.autoTrigger.optionId}
                          onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'catalogAction', optionId: e.target.value.trim() } })}
                          placeholder="toy-vibrator"
                          hint="The unlockable's id, e.g. from the Dating sim tab's intimacy catalog."
                        />
                      )}
                      {entry.autoTrigger?.kind === 'sceneFlag' && (
                        <TextField
                          label="Scene flag"
                          value={entry.autoTrigger.flag}
                          onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'sceneFlag', flag: e.target.value.trim() } })}
                          placeholder="first_kiss"
                        />
                      )}
                      {entry.autoTrigger?.kind === 'relationshipStage' && (
                        <SelectField
                          label="Stage"
                          value={entry.autoTrigger.stage}
                          onChange={(e) =>
                            updateGalleryEntry(entry.id, { autoTrigger: { kind: 'relationshipStage', stage: e.target.value as RelationshipStage } })
                          }
                        >
                          <option value="near_strangers">Near strangers</option>
                          <option value="acquaintances">Acquaintances</option>
                          <option value="warming_up">Warming up</option>
                          <option value="getting_close">Getting close</option>
                          <option value="close">Close</option>
                          <option value="sweethearts">Sweethearts</option>
                        </SelectField>
                      )}
                    </div>
                  )}
                </div>
              )}
            />
          </Section>

          <Section
            title="Gift preferences"
            description="The free-text fields feed the model so it can react in character; the numeric scores (−2 disliked … 3 favorite) drive the mechanical warmth gain."
            surface="bare"
          >
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <TextField
                label="Loves gifts like"
                value={giftLikes.join(', ')}
                onChange={(e) => setGiftLikes(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                placeholder="thoughtful books, anything handmade"
              />
              <TextField
                label="Not moved by gifts like"
                value={giftDislikes.join(', ')}
                onChange={(e) => setGiftDislikes(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                placeholder="anything flashy or impersonal"
              />
              <TextField
                label="Love language"
                value={loveLanguage}
                onChange={(e) => setLoveLanguage(e.target.value)}
                placeholder="quality time, acts of service"
                className="sm:col-span-2"
              />
            </div>
            <div className="mt-2 space-y-1.5">
              {getGiftCatalog(editingWorld).map((gift) => (
                <div key={gift.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg-sunken px-3 py-2">
                  <div>
                    <div className="text-sm text-text">{gift.name}</div>
                    <div className="text-[11px] text-text-muted">{gift.rarity}</div>
                  </div>
                  <input
                    type="number"
                    min={-2}
                    max={3}
                    value={Number(giftPreferences[gift.id] ?? 0)}
                    onChange={(e) => setGiftPreference(gift.id, Number(e.target.value) || 0)}
                    className="w-16 rounded-lg bg-bg-elevated px-2 py-1.5 text-center text-sm text-text outline-none"
                    aria-label={`Preference score for ${gift.name}`}
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Relationship starters"
            description="Narrative starting points offered when creating a new chat (e.g. 'Childhood friends' vs 'Just met'). The blurb seeds the chat's memory so the model knows the backstory."
            surface="bare"
          >
            <ListEditor
              items={relationshipStarters}
              getKey={(s) => s.id}
              onAdd={addRelationshipStarter}
              onRemove={(s) => removeRelationshipStarter(s.id)}
              addLabel="Add starter"
              emptyHint="Every chat starts from a blank slate."
              renderItem={(starter) => (
                <div className="space-y-1">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                    <TextField label="Label" value={starter.label} onChange={(e) => updateRelationshipStarter(starter.id, { label: e.target.value })} />
                    <NumberField
                      label="Starting warmth"
                      value={starter.startingAffection}
                      onChange={(e) => updateRelationshipStarter(starter.id, { startingAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    />
                  </div>
                  <TextAreaField
                    label="Blurb"
                    rows={2}
                    value={starter.blurb}
                    onChange={(e) => updateRelationshipStarter(starter.id, { blurb: e.target.value })}
                    placeholder="We grew up next door to each other and have been close ever since."
                  />
                </div>
              )}
            />
          </Section>

          <Section
            title="Touch & limits"
            description="Where this character responds, and what is off the table. The limits here are enforced by removing content from the action set — never offered, never described, never routed to — unlike free-text boundaries, which only reach the model as prose."
            surface="bare"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Especially sensitive"
                value={sensitiveRegions}
                onChange={(e) => setSensitiveRegions(e.target.value)}
                placeholder="neck, ears, inner_thigh"
                hint={`Where this character responds most. Anything not listed sits at the default. Regions: ${BODY_REGIONS.join(', ')}.`}
              />
              <TextField
                label="Does nothing for them"
                value={unresponsiveRegions}
                onChange={(e) => setUnresponsiveRegions(e.target.value)}
                placeholder="feet"
                hint="Touched there, nothing happens — arousal simply doesn't move."
              />
              <TextField
                label="Off-limits (regions)"
                value={offLimitRegions}
                onChange={(e) => setOffLimitRegions(e.target.value)}
                placeholder="feet"
                hint="Enforced, not suggested: any action involving these is removed from the panel and never reaches the prompt."
              />
              <TextField
                label="Into (kinks)"
                value={likedKinks}
                onChange={(e) => setLikedKinks(e.target.value)}
                placeholder="praise, gentle"
                hint={`Speeds a scene involving these up. Built-ins: ${BUILT_IN_KINKS.join(', ')}. Your own names work too.`}
              />
              <TextField
                label="Not into (kinks)"
                value={dislikedKinks}
                onChange={(e) => setDislikedKinks(e.target.value)}
                placeholder="rough"
                hint="Still available, but it slows the scene and reads as reluctance rather than enthusiasm."
              />
              <TextField
                label="Hard limits (kinks)"
                value={hardLimitKinks}
                onChange={(e) => setHardLimitKinks(e.target.value)}
                placeholder="bondage"
                hint="Enforced the same way as off-limits regions — the content is never offered, never described, never routed to."
              />
            </div>
          </Section>

          <Section title="Content & features" description="An authorial opt-out. Unlike every warmth gate elsewhere, this doesn't unlock with progress." surface="bare">
            <div className="rounded-xl bg-bg-sunken px-4 py-1">
              <Toggle
                checked={dateModeOptOut}
                onChange={setDateModeOptOut}
                label="Opt out of date / event mode"
                description="Hides the date button for this character entirely. For one better suited to lore, reference, or plain-assistant use."
              />
            </div>
          </Section>
        </div>
      )}

      {tab === 'worldsim' && (
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
        </div>
      )}

      {tab === 'voice' && (
        <Section
          title="Voice"
          description="Leave blank to use the global voice. A provider override must match Settings → Voice, where its key and model are configured. OpenMayhem voices use that speech model."
          surface="bare"
        >
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <SelectField label="Provider override" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value as TtsProviderId | '')}>
              <option value="">Use global default</option>
              {Object.entries(TTS_PROVIDER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            {usesOpenMayhemVoice ? <OpenMayhemVoiceField model={speechModels?.find((m) => m.id === globalTtsModel)} value={voiceId} onChange={setVoiceId} label="Voice / speaker ID override" placeholder="Use global voice" /> : <TextField
              label="Voice / speaker ID override"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="Leave blank to use the global voice"
            />}
          </div>
        </Section>
      )}

      {tab === 'voice' && (
        <Section
          title="Voice fingerprint"
          description="Concrete, recurring speech patterns. Not a general impression like personality, but the actual repeatable tells that make a line unmistakably theirs. Reaches the model every turn alongside their description and personality, plus a short standalone reminder of the single most important catchphrase/tic/register so it doesn't get diluted once a chat runs long."
          surface="bare"
          action={
            <Button variant="ghost" onClick={detectVoiceFromExamples} className="inline-flex items-center">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Detect from examples
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <TextField
              label="Verbal tics / filler words"
              value={verbalTics.join(', ')}
              onChange={(e) => setVerbalTics(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
              placeholder="well,, I mean, you know?"
              hint="Words or short phrases they lean on, comma separated."
            />
            <TextField
              label="Catchphrases"
              value={catchphrases.join(', ')}
              onChange={(e) => setCatchphrases(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
              placeholder="you're impossible, don't push it"
              hint="Signature phrases they reuse across scenes, not just once."
            />
            <TextAreaField
              label="Dialect / register notes"
              rows={2}
              value={dialectNotes}
              onChange={(e) => setDialectNotes(e.target.value)}
              placeholder="Clipped and formal, never contracts a verb. Or: Kansai-ben, drops word endings. Or: never swears, even when hurt."
              hint="Formality, slang density, sentence complexity, and how they handle taboo language all belong here too. Your own words, not a fixed list."
              className="sm:col-span-2"
            />
            <TextField
              label="Sentence rhythm"
              value={sentenceRhythm}
              onChange={(e) => setSentenceRhythm(e.target.value)}
              placeholder="Short and clipped. Or: long, winding, rarely a full stop."
              className="sm:col-span-2"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            "Detect from examples" reads this card's own example dialogue and greetings for patterns that actually recur. It never calls the model, so it's instant and never wrong about what's on the page, but it can only find what's
            already written. It adds to what's here rather than replacing it; edit or remove anything it gets wrong.
          </p>
          <div className="mt-4">
            <TextAreaField
              label="Explicit-scene voice note"
              rows={2}
              value={explicitVoiceNote}
              onChange={(e) => setExplicitVoiceNote(e.target.value)}
              placeholder="Goes quieter and shorter, not louder. Full sentences stop happening. Or: gets mouthier and more in control, not less."
              hint="1-2 lines on how this specific voice holds up, cracks, or changes under strain during an explicit scene. Only used while the explicit content rating is on; leave blank to fall back to a generic stay-in-character instruction."
            />
          </div>
        </Section>
      )}

      {tab === 'advanced' && (
        <div className="space-y-10">
          <Section
            title="Maximum Immersion"
            description="One-click bundle for an author who wants the deepest, most immersive setup this app can offer, curated from settings that already exist rather than new mechanics."
            surface="bare"
            action={
              <Button variant="secondary" onClick={applyMaximumImmersion} className="inline-flex items-center">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Apply Maximum Immersion
              </Button>
            }
          >
            <ul className="space-y-1.5 rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">
              {maximumImmersionChecklist().applied.map((item) => (
                <li key={item.label}>
                  <span className="font-medium text-text">{item.label}:</span> {item.detail}
                </li>
              ))}
              {maximumImmersionChecklist().recommended.map((item) => (
                <li key={item.label} className="opacity-80">
                  <span className="font-medium text-text">{item.label} (not applied for you):</span> {item.detail}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Prompt overrides" description="Replaces or reinforces the default instruction sent to the model for this character." surface="bare">
            <TextAreaField
              label="System prompt override"
              hint="Replaces the default instruction entirely."
              rows={3}
              value={form.system_prompt ?? ''}
              onChange={(e) => set('system_prompt', e.target.value)}
            />
            <TextAreaField
              label="Post-history instructions"
              hint="Injected right before the model's turn. Good for reinforcing style or rules."
              rows={2}
              value={form.post_history_instructions ?? ''}
              onChange={(e) => set('post_history_instructions', e.target.value)}
            />
            <SelectField
              label="Instruct template override"
              hint="Overrides the global Settings → Generation default for chats with this character. Useful for a character you always run against a specific model."
              value={instructTemplateId}
              onChange={(e) => setInstructTemplateId(e.target.value)}
            >
              <option value="">Use global default</option>
              <optgroup label="Builtin">
                {BUILTIN_INSTRUCT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              {customInstructTemplates.length > 0 && (
                <optgroup label="Custom">
                  {customInstructTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </SelectField>
            <SelectField
              label="Reply length"
              hint={
                replyLength === 'auto'
                  ? (() => {
                      const d = deriveCardReplyBand(form)
                      const from =
                        d.source === 'examples'
                          ? 'measured from this card’s example dialogue'
                          : d.source === 'greeting'
                            ? 'estimated from the greeting (no example dialogue to measure)'
                            : 'default. This card has no example dialogue or greeting to measure'
                      return `${REPLY_LENGTH_HINTS.auto} Currently resolves to "${REPLY_LENGTH_LABELS[d.band]}"${
                        d.measuredWords ? ` (~${d.measuredWords} words/turn)` : ''
                      }, ${from}.`
                    })()
                  : REPLY_LENGTH_HINTS[replyLength]
              }
              value={replyLength}
              onChange={(e) => setReplyLength(e.target.value as ReplyLength)}
            >
              {(['auto', 'brief', 'moderate', 'detailed'] as const).map((v) => (
                <option key={v} value={v}>
                  {REPLY_LENGTH_LABELS[v]}
                </option>
              ))}
            </SelectField>
          </Section>

          <Section title="Metadata" surface="bare">
            <TextField
              label="Tags (comma separated)"
              value={(form.tags ?? []).join(', ')}
              onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            />
            <div className="grid grid-cols-2 gap-x-3">
              <TextField label="Creator" value={form.creator ?? ''} onChange={(e) => set('creator', e.target.value)} />
              <TextField label="Version" value={form.character_version ?? ''} onChange={(e) => set('character_version', e.target.value)} />
            </div>
            <TextAreaField label="Creator notes" rows={2} value={form.creator_notes ?? ''} onChange={(e) => set('creator_notes', e.target.value)} />
          </Section>

          <Section title="Character lore" description="Lore that belongs to this character specifically. Travels with the card, unlike a standalone World Info book." surface="bare">
            <LorebookEditor
              book={form.character_book ?? { name: `${form.name} Lore`, entries: [], token_budget: 512, scan_depth: 8 }}
              onChange={(book) => set('character_book', book)}
              aiContext={form}
            />
          </Section>
        </div>
      )}

      {showGenerate && (
        <GenerateCharacterDialog
          onClose={() => setShowGenerate(false)}
          onGenerated={({ card, profile, bonds, outfits: draftedOutfits, characterBook }) => {
            setForm(characterBook ? { ...card, character_book: characterBook } : card)
            if (draftedOutfits?.length) setOutfits(draftedOutfits)
            if (profile) {
              setOccupation(profile.occupation)
              setWorkplace(profile.workplace)
              setHomeLocation(profile.homeLocation)
              setFrequentedLocations(profile.frequentedLocations)
              setLikes(profile.likes)
              setGoals(profile.goals)
              setBoundaries(profile.boundaries)
              setLoveLanguage(profile.loveLanguage)
            }
            if (bonds) {
              setGiftLikes(bonds.giftLikes)
              setGiftDislikes(bonds.giftDislikes)
              setWeatherLoves(bonds.weatherLoves)
              setWeatherHates(bonds.weatherHates)
              setRelationshipStarters(bonds.relationshipStarters)
            }
            setShowGenerate(false)
          }}
          worldTone={editingWorld?.description}
        />
      )}
      {showTemplates && (
        <TemplateGallery
          onClose={() => setShowTemplates(false)}
          onChoose={(card) => {
            setForm(card)
            setShowTemplates(false)
          }}
        />
      )}
      {showExpressionSetDialog && (
        <GenerateExpressionSetDialog
          expressions={allExpressions.map((exp) => ({ id: exp.id, label: exp.label, hasSprite: !!sprites[exp.id] }))}
          initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}`.slice(0, 300) : ''}
          onGenerated={(expressionId, dataUrl) => setSprites((s) => ({ ...s, [expressionId]: dataUrl }))}
          onClose={() => setShowExpressionSetDialog(false)}
        />
      )}
    </EditorShell>
  )
}
