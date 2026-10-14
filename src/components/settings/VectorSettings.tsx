import { useState } from 'react'
import { Upload } from 'lucide-react'
import { charactersApi, vectorsApi, type VectorScope } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { newId } from '@/lib/id'
import { embedTexts } from '@/lib/vectors/embeddings'
import { embeddingConfigFrom, indexDocument } from '@/lib/vectors/memory'
import { memoryDeps } from '@/lib/vectors/chatMemory'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Toggle } from '@/components/ui/Toggle'
import { Slider } from '@/components/ui/Slider'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { Section } from '@/components/ui/Section'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'

/** Similarity search: an embeddings server, memory of older chat messages, and documents the model can draw on. */
export function VectorSettings() {
  const s = useSettingsStore()
  const set = s.setVectorSettings
  const cfg = embeddingConfigFrom(s)
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []

  const [target, setTarget] = useState('global')
  const scope: VectorScope = target === 'global' ? 'global' : 'character'
  const scopeId = target === 'global' ? '' : target
  const sources = useApiQuery('vector-sources', () => vectorsApi.sources(scope, scopeId), [scope, scopeId]) ?? []

  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState('')

  const addDocument = async (docName: string, body: string) => {
    setBusy(true)
    try {
      const n = await indexDocument(memoryDeps(cfg), scope, scopeId, `doc:${newId()}`, docName.trim() || 'Untitled', body, s.vectorChunkChars)
      toastSuccess(`Added "${docName.trim() || 'Untitled'}" (${n} passage${n === 1 ? '' : 's'})`)
      setName('')
      setText('')
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const pickFiles = async (files: FileList) => {
    for (const file of Array.from(files)) await addDocument(file.name, await file.text())
  }

  const test = async () => {
    setProbe('Checking...')
    try {
      const [v] = await embedTexts(cfg, ['hello'])
      setProbe(`Works: ${v.length} dimensions.`)
    } catch (e) {
      setProbe(errorMessage(e))
    }
  }

  return (
    <Section
      title="Documents and memory search"
      description="Finds the passages that best match what was just said and adds them to the prompt: old messages that no longer fit, and documents you add here. It needs an embeddings model loaded on a server (KoboldCpp with --embeddingsmodel, llama.cpp, Ollama, LM Studio, or a hosted one)."
    >
      <Toggle
        checked={s.vectorsEnabled}
        onChange={(v) => set({ vectorsEnabled: v })}
        label="Search documents and memory"
        description="One extra request before each reply to embed the latest messages. If the embeddings server is down the reply goes ahead without it."
      />
      {s.vectorsEnabled && (
        <>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
            <TextField
              label="Embeddings server"
              value={s.embeddingsBaseUrl}
              onChange={(e) => set({ embeddingsBaseUrl: e.target.value })}
              placeholder={cfg.baseUrl || 'http://localhost:5001'}
              hint="Blank uses your chat server."
            />
            <TextField label="API key" type="password" value={s.embeddingsApiKey} onChange={(e) => set({ embeddingsApiKey: e.target.value })} placeholder="optional" />
            <TextField label="Model" value={s.embeddingsModel} onChange={(e) => set({ embeddingsModel: e.target.value })} placeholder="optional" />
          </div>
          <div className="mb-3 flex items-center gap-3">
            <Button onClick={test}>Test the connection</Button>
            {probe && <span className="text-xs text-text-muted">{probe}</span>}
          </div>
          <Toggle
            checked={s.vectorChatMemory}
            onChange={(v) => set({ vectorChatMemory: v })}
            label="Remember older messages"
            description="Stores each message as it is written, then brings back the ones that match the moment, beyond what the context window or the summary holds."
          />
          <Slider label="Passages per reply" min={1} max={10} step={1} value={s.vectorTopK} onChange={(v) => set({ vectorTopK: v })} formatValue={(v) => String(v)} description="How many matches at most are added to the prompt." />
          <Slider label="Minimum match" min={0} max={90} step={5} value={Math.round(s.vectorMinScore * 100)} onChange={(v) => set({ vectorMinScore: v / 100 })} formatValue={(v) => `${v}%`} description="Weaker matches are left out. Raise it if unrelated passages show up." />
          <Slider label="Passage size" min={200} max={2000} step={100} value={s.vectorChunkChars} onChange={(v) => set({ vectorChunkChars: v })} formatValue={(v) => `${v} characters`} description="For documents added from now on." />

          <div className="mt-4 border-t border-border pt-4">
            <SelectField label="Documents for" value={target} onChange={(e) => setTarget(e.target.value)} hint="Everywhere, or only chats with one character.">
              <option value="global">Every chat</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.card.name}
                </option>
              ))}
            </SelectField>
            {sources.length > 0 && (
              <div className="mb-3 space-y-1">
                {sources.map((d) => (
                  <div key={d.source} className="flex items-center justify-between gap-3 rounded-xl bg-bg-sunken px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-text">
                      {d.sourceName} <span className="text-xs text-text-muted">{d.chunks} passage{d.chunks === 1 ? '' : 's'}</span>
                    </span>
                    <Button variant="ghost" onClick={() => void vectorsApi.removeSource(scope, scopeId, d.source)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="mb-2 flex items-center gap-2">
              <FileButton onPick={(f) => void pickFiles(f)} accept=".txt,.md,.markdown,.text,.json,.csv" multiple title="Add text files">
                <Upload size={13} strokeWidth={2} />
                Add files
              </FileButton>
              {busy && <span className="text-xs text-text-muted">Embedding...</span>}
            </div>
            <TextField label="Or paste text: name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Notes" />
            <TextAreaField label="Text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void addDocument(name, text)}>
              Add text
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}
