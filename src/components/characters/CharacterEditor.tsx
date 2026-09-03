import { useEffect, useState } from 'react'
import { ImagePlus, Plus, Sparkles, X } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, instructTemplatesApi, worldsApi } from '@/lib/api/client'
import type { Character, GalleryEntry, RelationshipStarter, SocialConnection } from '@/lib/characters/cardSpec'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import { downloadJson, downloadPng, fileToDataUrl, importCharacterFile } from '@/lib/characters/importExport'
import { buildCharacterPack, downloadCharacterPack, importCharacterPack, parseCharacterPackFile } from '@/lib/characters/pack'
import { DEFAULT_EXPRESSIONS, slugifyExpressionId, type CustomExpression } from '@/lib/vn/expressions'
import { newId } from '@/lib/id'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Chip } from '@/components/ui/Chip'
import { Section } from '@/components/ui/Section'
import { EditorShell, type EditorTab } from '@/components/ui/EditorShell'
import { ListEditor } from '@/components/ui/ListEditor'
import { FileButton } from '@/components/ui/FileButton'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { GenerateCharacterDialog } from './GenerateCharacterDialog'
import { TemplateGallery } from './TemplateGallery'
import { RegenerateFieldButton } from './RegenerateFieldButton'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'
import { getGiftCatalog } from '@/lib/dating/gifts'
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

const TABS: EditorTab[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'life', label: 'Life & background' },
  { id: 'vn', label: 'Visual novel' },
  { id: 'dating', label: 'Dating sim' },
  { id: 'worldsim', label: 'World sim' },
  { id: 'voice', label: 'Voice' },
  { id: 'advanced', label: 'Advanced' },
]

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
  const [customExpressions, setCustomExpressions] = useState<CustomExpression[]>(character?.customExpressions ?? [])
  const [newExpressionLabel, setNewExpressionLabel] = useState('')
  const [giftPreferences, setGiftPreferences] = useState<Record<string, number>>(character?.giftPreferences ?? {})
  const [giftLikes, setGiftLikes] = useState<string[]>(character?.giftLikes ?? [])
  const [giftDislikes, setGiftDislikes] = useState<string[]>(character?.giftDislikes ?? [])
  const [loveLanguage, setLoveLanguage] = useState(character?.loveLanguage ?? '')
  const [gallery, setGallery] = useState<GalleryEntry[]>(character?.gallery ?? [])
  const [relationshipStarters, setRelationshipStarters] = useState<RelationshipStarter[]>(
    character?.relationshipStarters ?? [],
  )
  const [weatherLoves, setWeatherLoves] = useState<WeatherKind[]>(character?.weatherPreferences?.loves ?? [])
  const [weatherHates, setWeatherHates] = useState<WeatherKind[]>(character?.weatherPreferences?.hates ?? [])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(character?.schedule ?? [])
  const [voiceProvider, setVoiceProvider] = useState<TtsProviderId | ''>(character?.voice?.provider ?? '')
  const [voiceId, setVoiceId] = useState(character?.voice?.voiceId ?? '')
  const [instructTemplateId, setInstructTemplateId] = useState(character?.instructTemplateId ?? '')
  const [worldId, setWorldId] = useState(character?.worldId ?? '')
  const [occupation, setOccupation] = useState(character?.occupation ?? '')
  const [workplace, setWorkplace] = useState(character?.workplace ?? '')
  const [homeLocation, setHomeLocation] = useState(character?.homeLocation ?? '')
  const [frequentedLocations, setFrequentedLocations] = useState<string[]>(character?.frequentedLocations ?? [])
  const [likes, setLikes] = useState<string[]>(character?.likes ?? [])
  const [goals, setGoals] = useState<string[]>(character?.goals ?? [])
  const [boundaries, setBoundaries] = useState<string[]>(character?.boundaries ?? [])
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>(character?.socialConnections ?? [])
  const [dateModeOptOut, setDateModeOptOut] = useState(character?.dateModeOptOut ?? false)
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
    setSpriteUnlocks(character?.spriteUnlocks ?? {})
    setCustomExpressions(character?.customExpressions ?? [])
    setNewExpressionLabel('')
    setGiftPreferences(character?.giftPreferences ?? {})
    setGiftLikes(character?.giftLikes ?? [])
    setGiftDislikes(character?.giftDislikes ?? [])
    setLoveLanguage(character?.loveLanguage ?? '')
    setGallery(character?.gallery ?? [])
    setRelationshipStarters(character?.relationshipStarters ?? [])
    setVoiceProvider(character?.voice?.provider ?? '')
    setVoiceId(character?.voice?.voiceId ?? '')
    setInstructTemplateId(character?.instructTemplateId ?? '')
    setWeatherLoves(character?.weatherPreferences?.loves ?? [])
    setWeatherHates(character?.weatherPreferences?.hates ?? [])
    setSchedule(character?.schedule ?? [])
    setWorldId(character?.worldId ?? '')
    setOccupation(character?.occupation ?? '')
    setWorkplace(character?.workplace ?? '')
    setHomeLocation(character?.homeLocation ?? '')
    setFrequentedLocations(character?.frequentedLocations ?? [])
    setLikes(character?.likes ?? [])
    setGoals(character?.goals ?? [])
    setBoundaries(character?.boundaries ?? [])
    setSocialConnections(character?.socialConnections ?? [])
    setDateModeOptOut(character?.dateModeOptOut ?? false)
  }, [character?.id])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Sent as `null`, not `undefined`, when empty: JSON.stringify drops `undefined`-valued keys
  // entirely, so an `undefined` here would make the update request omit the field altogether and
  // silently leave the character's previous value in place instead of actually clearing it.
  const voice = voiceProvider || voiceId.trim() ? { provider: voiceProvider || undefined, voiceId: voiceId.trim() || undefined } : null
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

  const addSocialConnection = () => setSocialConnections((list) => [...list, { id: newId(), name: '', relation: '' }])
  const updateSocialConnection = (id: string, patch: Partial<SocialConnection>) =>
    setSocialConnections((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const removeSocialConnection = (id: string) => setSocialConnections((list) => list.filter((c) => c.id !== id))

  const save = async () => {
    setSaving(true)
    const payload = {
      card: form,
      avatarDataUrl,
      sprites,
      spriteUnlocks,
      customExpressions: customExpressions.length ? customExpressions : null,
      giftPreferences,
      giftLikes: giftLikes.length ? giftLikes : null,
      giftDislikes: giftDislikes.length ? giftDislikes : null,
      loveLanguage: loveLanguage.trim() || null,
      gallery,
      relationshipStarters,
      voice,
      instructTemplateId: instructTemplateId || null,
      weatherPreferences,
      schedule: schedule.length ? schedule : null,
      worldId: worldId || null,
      occupation: occupation.trim() || null,
      workplace: workplace.trim() || null,
      homeLocation: homeLocation.trim() || null,
      frequentedLocations: frequentedLocations.length ? frequentedLocations : null,
      likes: likes.length ? likes : null,
      goals: goals.length ? goals : null,
      boundaries: boundaries.length ? boundaries : null,
      socialConnections: socialConnections.length ? socialConnections : null,
      dateModeOptOut,
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

  const handleSpritePick = async (expressionId: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setSprites((s) => ({ ...s, [expressionId]: dataUrl }))
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
        updates[baseName] = await fileToDataUrl(file)
        matched.push(baseName)
      } else {
        unmatched.push(file.name)
      }
    }
    if (Object.keys(updates).length > 0) setSprites((s) => ({ ...s, ...updates }))
    if (matched.length > 0) toastSuccess(`Matched ${matched.length} expression${matched.length === 1 ? '' : 's'}: ${matched.join(', ')}`)
    if (unmatched.length > 0) toastError(`No matching expression for: ${unmatched.join(', ')} — rename to match an expression id, or add a custom expression with that id first.`)
  }

  const removeSprite = (expressionId: string) => {
    setSprites((s) => {
      const next = { ...s }
      delete next[expressionId]
      return next
    })
    setSpriteUnlocks((s) => {
      const next = { ...s }
      delete next[expressionId]
      return next
    })
  }

  const setSpriteUnlock = (expressionId: string, minAffection: number) =>
    setSpriteUnlocks((s) => ({ ...s, [expressionId]: Math.max(0, Math.min(100, minAffection)) }))

  const addCustomExpression = () => {
    const label = newExpressionLabel.trim()
    if (!label) return
    const existingIds = [...DEFAULT_EXPRESSIONS.map((e) => e.id), ...customExpressions.map((e) => e.id)]
    setCustomExpressions((list) => [...list, { id: slugifyExpressionId(label, existingIds), label }])
    setNewExpressionLabel('')
  }

  const removeCustomExpression = (expressionId: string) => {
    setCustomExpressions((list) => list.filter((e) => e.id !== expressionId))
    removeSprite(expressionId)
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
      const { character: created } = await importCharacterPack(pack)
      toastSuccess(`Imported "${created.card.name}"${pack.world ? ' with its world' : ''}.`)
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
                title="Restore a character exported with 'Export pack' — sprites, gallery, and bound world included"
              >
                Import pack
              </FileButton>
            )}
            <Button onClick={() => setShowGenerate(true)} className="flex items-center gap-1.5">
              <Sparkles size={14} strokeWidth={2} />
              Generate with AI
            </Button>
            {!character && <Button onClick={() => setShowTemplates(true)}>Start from a template</Button>}
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
            <label
              className="portrait-frame group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
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
            <div className="flex-1 space-y-0">
              <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              <SelectField label="World" value={worldId} onChange={(e) => setWorldId(e.target.value)}>
                <option value="">No world — standalone</option>
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
            hint="Appearance, background, core facts. Supports {{char}} / {{user}}."
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            actions={<RegenerateFieldButton character={form} fieldKey="description" onResult={(t) => set('description', t)} />}
          />
          <TextAreaField
            label="Personality"
            hint="How they speak, act, and feel — the more specific, the more the model imitates their voice."
            rows={3}
            value={form.personality}
            onChange={(e) => set('personality', e.target.value)}
            actions={<RegenerateFieldButton character={form} fieldKey="personality" onResult={(t) => set('personality', t)} />}
          />
          <TextAreaField
            label="Scenario"
            hint="The situation the chat starts in."
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
            hint={'Few-shot dialogue examples, e.g. <START>\\n{{user}}: ...\\n{{char}}: ...'}
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
            description="Reaches the model as part of this character's identity — so it applies to any use of them, not just dating-sim chats. Comma-separated where it's a list."
            surface="bare"
          >
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <TextField label="Occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="second-year architecture student" />
              <TextField label="Workplace / school" value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="Sakura Hill University" />
              <TextField label="Home" value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} placeholder="a small apartment near the station" />
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
            description="Who this character knows and how — reaches the model so it can reference them naturally in conversation."
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
                  <div className="grid grid-cols-2 gap-3">
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
        </div>
      )}

      {tab === 'vn' && (
        <Section
          title="Expressions"
          description="Art per expression so Visual Novel mode shows the right one as the model tags each reply's mood. Blank falls back to the avatar. The small number is the warmth needed to unlock it."
          surface="bare"
        >
          <div className="mb-4">
            <FileButton onPick={handleBulkSpritePick} accept="image/png,image/jpeg,image/webp" multiple>
              <Plus size={14} strokeWidth={2} />
              Bulk upload by filename
            </FileButton>
            <span className="ml-2 text-[11px] text-text-muted">e.g. laughing.png → Laughing</span>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {allExpressions.map((exp) => (
              <div key={exp.id} className="group relative flex flex-col items-center gap-1">
                <label className="portrait-frame relative flex h-20 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
                  {sprites[exp.id] ? (
                    <img src={sprites[exp.id]} alt="" className="h-full w-full object-cover" />
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
                    value={Number(spriteUnlocks[exp.id] ?? 0)}
                    onChange={(e) => setSpriteUnlock(exp.id, Number(e.target.value) || 0)}
                    className="w-9 rounded-md bg-bg-sunken px-1 py-0.5 text-center text-[11px] text-text outline-none"
                    aria-label={`Unlock warmth for ${exp.label}`}
                  />
                </div>
                {(exp.custom || sprites[exp.id]) && (
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
              placeholder="Custom expression name — e.g. Sly grin"
              className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
            />
            <Button onClick={addCustomExpression} disabled={!newExpressionLabel.trim()} className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2} />
              Add
            </Button>
          </div>
        </Section>
      )}

      {tab === 'dating' && (
        <div className="space-y-10">
          <Section
            title="CG gallery"
            description="Unlockable images shown in the Gallery tab — by warmth threshold, story beat, or (for endings) reaching Sweethearts."
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
                    <div className="flex-1">
                      <TextField label="Title" value={entry.title} onChange={(e) => updateGalleryEntry(entry.id, { title: e.target.value })} />
                    </div>
                  </div>
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
                    description="Unlocks the moment the relationship reaches Sweethearts, ignoring the fields above — a once-per-relationship epilogue."
                  />
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
                  <div className="grid grid-cols-[1fr_140px] gap-3">
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

          <Section title="Content & features" description="An authorial opt-out — unlike every warmth gate elsewhere, this doesn't unlock with progress." surface="bare">
            <div className="rounded-xl bg-bg-sunken px-4 py-1">
              <Toggle
                checked={dateModeOptOut}
                onChange={setDateModeOptOut}
                label="Opt out of date / event mode"
                description="Hides the date button for this character entirely — for one better suited to lore, reference, or plain-assistant use."
              />
            </div>
          </Section>
        </div>
      )}

      {tab === 'worldsim' && (
        <div className="space-y-10">
          <Section
            title="Weather preferences"
            description="Nudges the world-clock line fed into the prompt when today's weather matches — never dictates the scene. A kind can be loved or hated, not both."
            surface="bare"
          >
            <div className="grid grid-cols-2 gap-6">
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
            description="Where this character is and what they're doing at a given time — reads the world's shared clock, so it only matters for a world-bound character. A day-specific slot beats an 'every day' one."
            surface="bare"
          >
            <ListEditor
              items={schedule}
              getKey={(e) => e.id}
              onAdd={addScheduleEntry}
              onRemove={(e) => removeScheduleEntry(e.id)}
              addLabel="Add slot"
              emptyHint="No schedule — always shows as available."
              renderItem={(entry) => (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-2 gap-3">
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
        </div>
      )}

      {tab === 'voice' && (
        <Section
          title="Voice"
          description="Overrides the global Settings → Voice provider/voice for this character in Companion mode. Leave blank to use the global default."
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
            <TextField
              label="Voice / speaker ID override"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="Leave blank to use the global voice"
            />
          </div>
        </Section>
      )}

      {tab === 'advanced' && (
        <div className="space-y-10">
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
              hint="Injected right before the model's turn — good for reinforcing style or rules."
              rows={2}
              value={form.post_history_instructions ?? ''}
              onChange={(e) => set('post_history_instructions', e.target.value)}
            />
            <SelectField
              label="Instruct template override"
              hint="Overrides the global Settings → Generation default for chats with this character — useful for a character you always run against a specific model."
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

          <Section title="Character lore" description="Lore that belongs to this character specifically — travels with the card, unlike a standalone World Info book." surface="bare">
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
          onGenerated={(card) => {
            setForm(card)
            setShowGenerate(false)
          }}
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
    </EditorShell>
  )
}
