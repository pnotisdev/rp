import { useEffect, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldsApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import { downloadJson, downloadPng, fileToDataUrl, importCharacterFile } from '@/lib/characters/importExport'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { GenerateCharacterDialog } from './GenerateCharacterDialog'
import { TemplateGallery } from './TemplateGallery'
import { RegenerateFieldButton } from './RegenerateFieldButton'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'

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
  const [worldId, setWorldId] = useState(character?.worldId ?? '')
  const [showGenerate, setShowGenerate] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []

  useEffect(() => {
    setForm(character?.card ?? blankCharacterData())
    setAvatarDataUrl(character?.avatarDataUrl)
    setWorldId(character?.worldId ?? '')
  }, [character?.id])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    if (character) {
      await charactersApi.update(character.id, { card: form, avatarDataUrl, worldId: worldId || undefined })
      onSaved(character.id)
    } else {
      const created = await charactersApi.create({ card: form, avatarDataUrl, worldId: worldId || undefined })
      onSaved(created.id)
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

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer">
          {avatarDataUrl ? (
            <img src={avatarDataUrl} className="h-20 w-20 rounded-xl object-cover border border-border" />
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
        hint="One per line — offered as swipes on the opening message."
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
