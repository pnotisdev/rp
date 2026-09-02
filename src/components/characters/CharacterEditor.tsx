import { useEffect, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldsApi } from '@/lib/api/client'
import type { Character, GalleryEntry, RelationshipStarter } from '@/lib/characters/cardSpec'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import { downloadJson, downloadPng, fileToDataUrl, importCharacterFile } from '@/lib/characters/importExport'
import { buildCharacterPack, downloadCharacterPack, importCharacterPack, parseCharacterPackFile } from '@/lib/characters/pack'
import { DEFAULT_EXPRESSIONS, slugifyExpressionId, type CustomExpression } from '@/lib/vn/expressions'
import { newId } from '@/lib/id'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
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

export function CharacterEditor({
  character,
  onSaved,
  onDeleted,
}: {
  character: Character | null
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const [form, setForm] = useState(character?.card ?? blankCharacterData())
  const [avatarDataUrl, setAvatarDataUrl] = useState(character?.avatarDataUrl)
  const [sprites, setSprites] = useState<Record<string, string>>(character?.sprites ?? {})
  const [spriteUnlocks, setSpriteUnlocks] = useState<Record<string, number>>(character?.spriteUnlocks ?? {})
  const [customExpressions, setCustomExpressions] = useState<CustomExpression[]>(character?.customExpressions ?? [])
  const [newExpressionLabel, setNewExpressionLabel] = useState('')
  const [giftPreferences, setGiftPreferences] = useState<Record<string, number>>(character?.giftPreferences ?? {})
  const [gallery, setGallery] = useState<GalleryEntry[]>(character?.gallery ?? [])
  const [relationshipStarters, setRelationshipStarters] = useState<RelationshipStarter[]>(
    character?.relationshipStarters ?? [],
  )
  const [weatherLoves, setWeatherLoves] = useState<WeatherKind[]>(character?.weatherPreferences?.loves ?? [])
  const [weatherHates, setWeatherHates] = useState<WeatherKind[]>(character?.weatherPreferences?.hates ?? [])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(character?.schedule ?? [])
  const [voiceProvider, setVoiceProvider] = useState<TtsProviderId | ''>(character?.voice?.provider ?? '')
  const [voiceId, setVoiceId] = useState(character?.voice?.voiceId ?? '')
  const [worldId, setWorldId] = useState(character?.worldId ?? '')
  const [showGenerate, setShowGenerate] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const editingWorld = worlds.find((w) => w.id === worldId)

  useEffect(() => {
    setForm(character?.card ?? blankCharacterData())
    setAvatarDataUrl(character?.avatarDataUrl)
    setSprites(character?.sprites ?? {})
    setSpriteUnlocks(character?.spriteUnlocks ?? {})
    setCustomExpressions(character?.customExpressions ?? [])
    setNewExpressionLabel('')
    setGiftPreferences(character?.giftPreferences ?? {})
    setGallery(character?.gallery ?? [])
    setRelationshipStarters(character?.relationshipStarters ?? [])
    setVoiceProvider(character?.voice?.provider ?? '')
    setVoiceId(character?.voice?.voiceId ?? '')
    setWeatherLoves(character?.weatherPreferences?.loves ?? [])
    setWeatherHates(character?.weatherPreferences?.hates ?? [])
    setSchedule(character?.schedule ?? [])
    setWorldId(character?.worldId ?? '')
  }, [character?.id])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const voice = voiceProvider || voiceId.trim() ? { provider: voiceProvider || undefined, voiceId: voiceId.trim() || undefined } : undefined
  const weatherPreferences =
    weatherLoves.length || weatherHates.length ? { loves: weatherLoves, hates: weatherHates } : undefined

  /** A weather kind can't be loved and hated at once — picking one side clears the other. */
  const toggleWeather = (kind: WeatherKind, side: 'loves' | 'hates') => {
    const set = side === 'loves' ? setWeatherLoves : setWeatherHates
    const other = side === 'loves' ? setWeatherHates : setWeatherLoves
    set((list) => (list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]))
    other((list) => list.filter((k) => k !== kind))
  }

  const addScheduleEntry = () => {
    setSchedule((list) => [...list, { id: newId(), phase: 'morning', status: 'busy', activity: '' }])
  }
  const updateScheduleEntry = (id: string, patch: Partial<ScheduleEntry>) => {
    setSchedule((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }
  const removeScheduleEntry = (id: string) => {
    setSchedule((list) => list.filter((e) => e.id !== id))
  }
  const toggleScheduleDay = (id: string, day: Weekday) => {
    setSchedule((list) =>
      list.map((e) => {
        if (e.id !== id) return e
        const days = e.days ?? []
        return { ...e, days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] }
      }),
    )
  }

  const save = async () => {
    try {
      if (character) {
        await charactersApi.update(character.id, {
          card: form,
          avatarDataUrl,
          sprites,
          spriteUnlocks,
          customExpressions: customExpressions.length ? customExpressions : undefined,
          giftPreferences,
          gallery,
          relationshipStarters,
          voice,
          weatherPreferences,
          schedule: schedule.length ? schedule : undefined,
          worldId: worldId || undefined,
        })
        onSaved(character.id)
      } else {
        const created = await charactersApi.create({
          card: form,
          avatarDataUrl,
          sprites,
          spriteUnlocks,
          customExpressions: customExpressions.length ? customExpressions : undefined,
          giftPreferences,
          gallery,
          relationshipStarters,
          voice,
          weatherPreferences,
          schedule: schedule.length ? schedule : undefined,
          worldId: worldId || undefined,
        })
        onSaved(created.id)
      }
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const remove = async () => {
    if (!character) return
    if (!confirm(`Delete ${character.card.name} and all of their chats? This cannot be undone.`)) return
    await charactersApi.remove(character.id)
    onDeleted()
  }

  const handleAvatarPick = async (file: File) => {
    if (file.type === 'image/png') {
      try {
        const imported = await importCharacterFile(file)
        setForm(imported.card)
        setAvatarDataUrl(imported.avatarDataUrl)
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

  const setSpriteUnlock = (expressionId: string, minAffection: number) => {
    setSpriteUnlocks((s) => ({ ...s, [expressionId]: Math.max(0, Math.min(100, minAffection)) }))
  }

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

  const setGiftPreference = (giftId: string, score: number) => {
    setGiftPreferences((prev) => ({ ...prev, [giftId]: Math.max(-2, Math.min(3, score)) }))
  }

  const addGalleryEntry = () => {
    setGallery((g) => [
      ...g,
      { id: newId(), title: `CG ${g.length + 1}`, imageUrl: '', unlockAffection: 40, unlockHint: '' },
    ])
  }

  const updateGalleryEntry = (id: string, patch: Partial<GalleryEntry>) => {
    setGallery((g) => g.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeGalleryEntry = (id: string) => {
    setGallery((g) => g.filter((item) => item.id !== id))
  }

  const pickGalleryImage = async (id: string, file: File) => {
    updateGalleryEntry(id, { imageUrl: await fileToDataUrl(file) })
  }

  const addRelationshipStarter = () => {
    setRelationshipStarters((s) => [
      ...s,
      { id: newId(), label: `Starter ${s.length + 1}`, blurb: '', startingAffection: 0 },
    ])
  }

  const updateRelationshipStarter = (id: string, patch: Partial<RelationshipStarter>) => {
    setRelationshipStarters((s) => s.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeRelationshipStarter = (id: string) => {
    setRelationshipStarters((s) => s.filter((item) => item.id !== id))
  }

  const handleImportFile = async (file: File) => {
    setImportError(null)
    try {
      const result = await importCharacterFile(file)
      setForm(result.card)
      if (result.avatarDataUrl) setAvatarDataUrl(result.avatarDataUrl)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
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

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer" aria-label="Change character avatar">
          {avatarDataUrl ? (
            <img src={avatarDataUrl} alt="" className="h-20 w-20 rounded-xl object-cover border border-border" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-muted">
              Avatar
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleAvatarPick(e.target.files[0])}
          />
        </label>
        <div className="flex-1">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">World</span>
            <select
              value={worldId}
              onChange={(e) => setWorldId(e.target.value)}
              className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
            >
              <option value="">No world — standalone</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <label>
          <input
            type="file"
            accept=".json,.png"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
          />
          <span className="inline-block rounded-xl bg-bg-sunken px-3.5 py-1.5 text-sm text-text cursor-pointer hover:opacity-80">
            Import card (.png / .json)
          </span>
        </label>
        <Button onClick={() => setShowGenerate(true)}>Generate with AI</Button>
        {!character && <Button onClick={() => setShowTemplates(true)}>Start from a template</Button>}
        <Button onClick={() => downloadJson(form)}>Export JSON</Button>
        <Button onClick={() => downloadPng(form, avatarDataUrl)}>Export PNG</Button>
        {character && (
          <Button onClick={exportPack} title="Bundles the card, sprites, gallery CGs, gift preferences, and bound world into one file">
            Export pack
          </Button>
        )}
        {!character && (
          <label>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImportPackFile(e.target.files[0])}
            />
            <span
              className="inline-block rounded-xl bg-bg-sunken px-3.5 py-1.5 text-sm text-text cursor-pointer hover:opacity-80"
              title="Restores a character exported with 'Export pack', including sprites, gallery CGs, and its bound world"
            >
              Import pack (.rppack.json)
            </span>
          </label>
        )}
      </div>
      {importError && <p className="mb-3 text-xs text-danger">{importError}</p>}

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
        hint="How they speak, act, and feel — the more specific, the more the model will imitate their voice."
        rows={3}
        value={form.personality}
        onChange={(e) => set('personality', e.target.value)}
        actions={<RegenerateFieldButton character={form} fieldKey="personality" onResult={(t) => set('personality', t)} />}
      />
      <TextAreaField
        label="Scenario"
        hint="The current situation / setting the chat starts in."
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

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">Advanced</summary>
        <div className="mt-3">
          <TextAreaField
            label="System prompt override"
            hint="Replaces the default instruction sent to the model for this character."
            rows={3}
            value={form.system_prompt ?? ''}
            onChange={(e) => set('system_prompt', e.target.value)}
          />
          <TextAreaField
            label="Post-history instructions"
            hint="Injected right before the model's turn — good for reinforcing style/rules."
            rows={2}
            value={form.post_history_instructions ?? ''}
            onChange={(e) => set('post_history_instructions', e.target.value)}
          />
          <TextField
            label="Tags (comma separated)"
            value={(form.tags ?? []).join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
          />
          <TextField label="Creator" value={form.creator ?? ''} onChange={(e) => set('creator', e.target.value)} />
          <TextField
            label="Version"
            value={form.character_version ?? ''}
            onChange={(e) => set('character_version', e.target.value)}
          />
          <TextAreaField
            label="Creator notes"
            rows={2}
            value={form.creator_notes ?? ''}
            onChange={(e) => set('creator_notes', e.target.value)}
          />
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Expressions ({Object.keys(sprites).length}/{DEFAULT_EXPRESSIONS.length + customExpressions.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Upload art per expression so Visual Novel mode can show the right one as the AI tags each
          reply's mood. Anything left blank falls back to the main avatar. Add a custom expression
          for anything the default set doesn't cover — a signature smirk unique to this character,
          say.
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {[...DEFAULT_EXPRESSIONS, ...customExpressions.map((e) => ({ ...e, emoji: '✨' }))].map((exp) => {
            const isCustom = customExpressions.some((c) => c.id === exp.id)
            return (
              <label key={exp.id} className="group relative flex cursor-pointer flex-col items-center gap-1">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken text-xl">
                  {sprites[exp.id] ? (
                    <img src={sprites[exp.id]} className="h-full w-full object-cover" />
                  ) : (
                    <span>{exp.emoji}</span>
                  )}
                </div>
                <span className="text-[11px] text-text-muted">{exp.label}</span>
                {/* Must precede the number input below — a <label> with no htmlFor implicitly
                    activates whichever labelable descendant comes first in the DOM, so clicking
                    the box only opens the file picker if this one is first. */}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleSpritePick(exp.id, e.target.files[0])}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Number(spriteUnlocks[exp.id] ?? 0)}
                  onClick={(e) => e.preventDefault()}
                  onChange={(e) => setSpriteUnlock(exp.id, Number(e.target.value) || 0)}
                  className="w-16 rounded bg-bg-elevated px-2 py-0.5 text-center text-[11px] text-text outline-none"
                  title="Unlock affection"
                />
                {isCustom ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      removeCustomExpression(exp.id)
                    }}
                    title="Remove this custom expression"
                    aria-label={`Remove custom expression ${exp.label}`}
                    className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-[11px] text-text-muted hover:text-danger group-hover:flex"
                  >
                    ✕
                  </button>
                ) : (
                  sprites[exp.id] && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        removeSprite(exp.id)
                      }}
                      aria-label={`Remove ${exp.label} sprite image`}
                      className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-[11px] text-text-muted hover:text-danger group-hover:flex"
                    >
                      ✕
                    </button>
                  )
                )}
              </label>
            )
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newExpressionLabel}
            onChange={(e) => setNewExpressionLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomExpression()}
            placeholder="Custom expression name — e.g. Sly grin"
            className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
          />
          <Button onClick={addCustomExpression} disabled={!newExpressionLabel.trim()}>
            + Add
          </Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          CG Gallery ({gallery.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Unlockable images shown in the Gallery tab. They unlock by affection threshold and/or story beat detection.
        </p>
        <div className="space-y-3">
          {gallery.map((entry) => (
            <div key={entry.id} className="rounded-xl bg-bg-sunken p-3">
              <div className="mb-2 flex items-start gap-3">
                <label className="cursor-pointer" aria-label="Change gallery CG image">
                  {entry.imageUrl ? (
                    <img src={entry.imageUrl} alt="" className="h-16 w-24 rounded object-cover" />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-border text-xs text-text-muted">
                      CG
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && pickGalleryImage(entry.id, e.target.files[0])}
                  />
                </label>
                <div className="flex-1">
                  <TextField
                    label="Title"
                    value={entry.title}
                    onChange={(e) => updateGalleryEntry(entry.id, { title: e.target.value })}
                  />
                </div>
                <Button variant="ghost" onClick={() => removeGalleryEntry(entry.id)}>
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextField
                  label="Unlock hint"
                  value={entry.unlockHint ?? ''}
                  onChange={(e) => updateGalleryEntry(entry.id, { unlockHint: e.target.value })}
                  placeholder="e.g. Confess under the lanterns"
                />
                <TextField
                  label="Unlock affection"
                  type="number"
                  value={entry.unlockAffection}
                  onChange={(e) =>
                    updateGalleryEntry(entry.id, {
                      unlockAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                />
                <TextField
                  label="Required scene flags"
                  value={(entry.requiredFlags ?? []).join(', ')}
                  onChange={(e) =>
                    updateGalleryEntry(entry.id, {
                      requiredFlags: e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="first_date, confession"
                />
              </div>
            </div>
          ))}
          <Button onClick={addGalleryEntry}>+ Add CG entry</Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">Gift preferences</summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Controls how much affection each gift tends to add: -2 disliked, 0 neutral, 3 favorite.
        </p>
        <div className="space-y-2">
          {getGiftCatalog(editingWorld).map((gift) => (
            <div key={gift.id} className="grid grid-cols-1 items-center gap-2 rounded-xl bg-bg-sunken p-3 sm:grid-cols-[1fr_120px]">
              <div>
                <div className="text-sm text-text">{gift.name}</div>
                <div className="text-xs text-text-muted">{gift.rarity}</div>
              </div>
              <input
                type="number"
                min={-2}
                max={3}
                value={Number(giftPreferences[gift.id] ?? 0)}
                onChange={(e) => setGiftPreference(gift.id, Number(e.target.value) || 0)}
                className="w-full rounded-xl bg-bg-elevated px-3 py-2 text-sm text-text outline-none"
              />
            </div>
          ))}
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Relationship starters ({relationshipStarters.length})
        </summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Optional narrative starting points offered when creating a new chat with this character
          (e.g. "Childhood friends" vs. "Just met") — instead of every chat beginning from the
          same blank slate. The blurb seeds the chat's long-term memory, so the model knows the
          backstory from the first reply.
        </p>
        <div className="space-y-3">
          {relationshipStarters.map((starter) => (
            <div key={starter.id} className="rounded-xl bg-bg-sunken p-3">
              <div className="mb-2 flex items-start gap-2">
                <TextField
                  label="Label"
                  value={starter.label}
                  onChange={(e) => updateRelationshipStarter(starter.id, { label: e.target.value })}
                  className="flex-1"
                />
                <TextField
                  label="Starting affection"
                  type="number"
                  value={starter.startingAffection}
                  onChange={(e) =>
                    updateRelationshipStarter(starter.id, {
                      startingAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-36"
                />
                <Button variant="ghost" onClick={() => removeRelationshipStarter(starter.id)} className="mt-5">
                  Remove
                </Button>
              </div>
              <TextAreaField
                label="Blurb"
                rows={2}
                value={starter.blurb}
                onChange={(e) => updateRelationshipStarter(starter.id, { blurb: e.target.value })}
                placeholder="e.g. We grew up next door to each other and have been close ever since."
              />
            </div>
          ))}
          <Button onClick={addRelationshipStarter}>+ Add starter</Button>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">Voice</summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Overrides the global Settings → Voice provider/voice for this character in Companion
          mode. Leave blank to use the global default for everyone.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Provider override</span>
            <select
              value={voiceProvider}
              onChange={(e) => setVoiceProvider(e.target.value as TtsProviderId | '')}
              className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
            >
              <option value="">Use global default</option>
              {Object.entries(TTS_PROVIDER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Voice / speaker ID override"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            placeholder="Leave blank to use the global voice"
          />
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">Weather preferences</summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Nudges the world-clock line fed into the prompt (World editor → World clock) when today's
          weather matches — never dictates the scene. A kind can only be loved or hated, not both.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">Loves</div>
            <div className="flex flex-wrap gap-1.5">
              {WEATHER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleWeather(kind, 'loves')}
                  className={`rounded-full px-3 py-1 text-xs ${weatherLoves.includes(kind) ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'}`}
                >
                  {describeWeather(kind)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-text-muted">Hates</div>
            <div className="flex flex-wrap gap-1.5">
              {WEATHER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleWeather(kind, 'hates')}
                  className={`rounded-full px-3 py-1 text-xs ${weatherHates.includes(kind) ? 'bg-danger/10 text-danger' : 'bg-bg-sunken text-text-muted'}`}
                >
                  {describeWeather(kind)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">Schedule ({schedule.length})</summary>
        <p className="mt-2 mb-3 text-xs text-text-muted">
          Where this character is and what they're doing at a given time — reads the world's shared
          clock (World editor → World clock), so it only does anything for a world-bound character.
          A day-specific slot beats an "every day" one for the same time of day; leave every day
          unselected for a slot that applies daily.
        </p>
        <div className="space-y-3">
          {schedule.map((entry) => (
            <div key={entry.id} className="rounded-xl bg-bg-sunken p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span>Time of day</span>
                    <select
                      value={entry.phase}
                      onChange={(e) => updateScheduleEntry(entry.id, { phase: e.target.value as DayPhase })}
                      className="rounded-lg bg-bg-elevated px-2 py-1 text-xs text-text outline-none"
                    >
                      {PHASES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span>Status</span>
                    <select
                      value={entry.status}
                      onChange={(e) => updateScheduleEntry(entry.id, { status: e.target.value as PresenceStatus })}
                      className="rounded-lg bg-bg-elevated px-2 py-1 text-xs text-text outline-none"
                    >
                      <option value="available">Available</option>
                      <option value="busy">Busy</option>
                      <option value="sleeping">Sleeping</option>
                      <option value="traveling">Traveling</option>
                    </select>
                  </label>
                </div>
                <Button variant="ghost" onClick={() => removeScheduleEntry(entry.id)}>
                  ✕
                </Button>
              </div>
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextField
                  label="Activity"
                  value={entry.activity}
                  onChange={(e) => updateScheduleEntry(entry.id, { activity: e.target.value })}
                  placeholder="Opening the bakery"
                />
                <TextField
                  label="Location (optional)"
                  value={entry.location ?? ''}
                  onChange={(e) => updateScheduleEntry(entry.id, { location: e.target.value || undefined })}
                  placeholder="The bakery"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-text-muted">Days:</span>
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleScheduleDay(entry.id, day)}
                    className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                      entry.days?.includes(day) ? 'bg-accent/10 text-accent' : 'bg-bg-elevated text-text-muted'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
                {!entry.days?.length && <span className="text-xs text-text-muted">(every day)</span>}
              </div>
            </div>
          ))}
          {schedule.length === 0 && <p className="text-xs text-text-muted">No schedule set — always shows as available.</p>}
        </div>
        <Button className="mt-3" onClick={addScheduleEntry}>
          + Add schedule slot
        </Button>
      </details>

      <details className="mb-8 rounded-2xl bg-bg-elevated p-6">
        <summary className="cursor-pointer text-sm font-medium text-text">
          Character lore ({form.character_book?.entries.length ?? 0} entries)
        </summary>
        <div className="mt-3">
          <LorebookEditor
            book={form.character_book ?? { name: `${form.name} Lore`, entries: [], token_budget: 512, scan_depth: 8 }}
            onChange={(book) => set('character_book', book)}
            aiContext={form}
          />
        </div>
      </details>

      <div className="flex items-center justify-between border-t border-border pt-4">
        {character ? (
          <Button variant="danger" onClick={remove}>
            Delete character
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {!form.name.trim() && <span className="text-xs text-danger">Name is required</span>}
          <Button variant="primary" onClick={save} disabled={!form.name.trim()}>
            {character ? 'Save changes' : 'Create character'}
          </Button>
        </div>
      </div>

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
    </div>
  )
}
