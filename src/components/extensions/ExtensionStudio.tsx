// The Studio: edit an extension's files, preview the unsaved draft in the real sandbox, and save.

import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, RotateCw, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { extensionsApi } from '@/lib/api/client'
import { loadBundle } from '@/lib/extensions/bundleCache'
import { lintBundle } from '@/lib/extensions/lint'
import { isSafePath, isTextPath, validateBundle, validateManifest, type BundleFile, type ExtensionRecord } from '@/lib/extensions/manifest'
import { useExtensionLogs } from '@/lib/extensions/logStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { ConsoleView } from './LogsDialog'
import { StudioAiBar } from './StudioAiBar'
import type { StudioChanges } from '@/lib/extensions/studioAssist'
import { ExtensionFrame } from './ExtensionFrame'

const MANIFEST = 'manifest.json'

type Draft = { files: Record<string, string>; binary: Record<string, BundleFile>; manifest: string }

function explain(e: unknown): string {
  const text = errorMessage(e)
  const json = /\{[\s\S]*\}$/.exec(text)?.[0]
  if (json) {
    try {
      const body = JSON.parse(json) as { error?: string; details?: string[] }
      return [body.error, ...(body.details ?? [])].filter(Boolean).join('\n')
    } catch {
      /* fall through */
    }
  }
  return text
}

export function ExtensionStudio({ ext, onClose, onGrant }: { ext: ExtensionRecord; onClose: () => void; onGrant: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const savedRef = useRef<Draft | null>(null)
  const [selected, setSelected] = useState(MANIFEST)
  const [newPath, setNewPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const [previewDraft, setPreviewDraft] = useState<Draft | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [pane, setPane] = useState<'code' | 'preview'>('code')
  const clearLogs = useExtensionLogs((s) => s.clear)
  const undoRef = useRef<Draft | null>(null)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadBundle(ext).then((bundle) => {
      if (cancelled) return
      const files: Record<string, string> = {}
      const binary: Record<string, BundleFile> = {}
      for (const [path, f] of Object.entries(bundle.files)) {
        if (typeof f === 'string') files[path] = f
        else binary[path] = f
      }
      const loaded: Draft = { files, binary, manifest: JSON.stringify(bundle.manifest, null, 2) }
      savedRef.current = loaded
      setDraft(loaded)
      setPreviewDraft(loaded)
      if (!files[selected] && selected !== MANIFEST) setSelected(MANIFEST)
    })
    return () => {
      cancelled = true
    }
    // Loads once per open; saving updates `savedRef` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.id])

  // Refresh the preview shortly after typing stops.
  useEffect(() => {
    if (!draft) return
    const t = setTimeout(() => setPreviewDraft(draft), 700)
    return () => clearTimeout(t)
  }, [draft])

  const parsed = useMemo(() => {
    if (!draft) return null
    try {
      return validateManifest(JSON.parse(draft.manifest))
    } catch (e) {
      return { ok: false as const, value: undefined, errors: [`manifest.json is not valid JSON: ${errorMessage(e)}`], warnings: [] as string[] }
    }
  }, [draft?.manifest])

  const bundleReport = useMemo(() => {
    if (!draft || !parsed?.ok || !parsed.value) return null
    return validateBundle({ format: 'rp-extension', version: 1, manifest: parsed.value, files: { ...draft.files, ...draft.binary } })
  }, [draft, parsed])

  const findings = useMemo(() => {
    const out: { level: 'error' | 'warning'; text: string }[] = []
    if (parsed && !parsed.ok) for (const e of parsed.errors) out.push({ level: 'error', text: e })
    if (bundleReport) {
      for (const e of bundleReport.errors) out.push({ level: 'error', text: e })
      for (const w of bundleReport.warnings) out.push({ level: 'warning', text: w })
      if (bundleReport.value) for (const f of lintBundle(bundleReport.value)) out.push({ level: f.level, text: `${f.file ? `${f.file}: ` : ''}${f.message}` })
    }
    return out
  }, [parsed, bundleReport])

  const dirty = !!draft && !!savedRef.current && (draft.manifest !== savedRef.current.manifest || JSON.stringify(draft.files) !== JSON.stringify(savedRef.current.files))
  const draftManifest = parsed?.ok && parsed.value ? parsed.value : ext.manifest
  const previewFiles = useMemo(() => (previewDraft ? { ...previewDraft.files, ...previewDraft.binary } : undefined), [previewDraft])
  const previewExt = useMemo(() => ({ ...ext, manifest: draftManifest }), [ext, draftManifest])
  const panel = draftManifest.panels.find((p) => p.id === panelId) ?? draftManifest.panels[0]

  async function save() {
    if (!draft || !savedRef.current || saving) return
    if (parsed && !parsed.ok) return toastError('Fix the manifest errors before saving.')
    setSaving(true)
    try {
      const before = savedRef.current
      for (const [path, content] of Object.entries(draft.files)) {
        if (before.files[path] !== content) await extensionsApi.writeFile(ext.id, path, content)
      }
      if (draft.manifest !== before.manifest) await extensionsApi.setManifest(ext.id, JSON.parse(draft.manifest))
      for (const path of Object.keys(before.files)) {
        if (!(path in draft.files)) await extensionsApi.deleteFile(ext.id, path)
      }
      savedRef.current = draft
      setPreviewDraft(draft)
      setReload((n) => n + 1)
      toastSuccess('Saved')
    } catch (e) {
      toastError(explain(e))
    } finally {
      setSaving(false)
    }
  }

  async function close() {
    if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', body: 'Your edits to this extension have not been saved.', confirmLabel: 'Discard', tone: 'danger' }))) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function edit(value: string) {
    setDraft((d) => (d ? (selected === MANIFEST ? { ...d, manifest: value } : { ...d, files: { ...d.files, [selected]: value } }) : d))
  }

  function applyAi(changes: StudioChanges) {
    if (!draft) return
    undoRef.current = draft
    setCanUndo(true)
    setDraft({ ...draft, manifest: changes.manifest ?? draft.manifest, files: { ...draft.files, ...changes.files } })
    const first = Object.keys(changes.files)[0]
    setSelected(first ?? MANIFEST)
  }

  function undoAi() {
    if (!undoRef.current) return
    setDraft(undoRef.current)
    undoRef.current = null
    setCanUndo(false)
  }

  function addFile() {
    const path = newPath.trim()
    if (!draft || !path) return
    if (!isSafePath(path) || !isTextPath(path)) return toastError('Use a relative path ending in .html, .js, .css, .json, .svg, .md or .txt.')
    if (path in draft.files || path in draft.binary || path === MANIFEST) return toastError('That file already exists.')
    setDraft({ ...draft, files: { ...draft.files, [path]: '' } })
    setSelected(path)
    setNewPath('')
  }

  async function removeFile(path: string) {
    if (!draft) return
    if (!(await confirmDialog({ title: `Delete ${path}?`, confirmLabel: 'Delete', tone: 'danger' }))) return
    const { [path]: _gone, ...rest } = draft.files
    setDraft({ ...draft, files: rest })
    if (selected === path) setSelected(MANIFEST)
  }

  const text = !draft ? '' : selected === MANIFEST ? draft.manifest : (draft.files[selected] ?? '')
  const fileNames = draft ? [MANIFEST, ...Object.keys(draft.files).sort(), ...Object.keys(draft.binary).sort()] : []
  const grantedCount = ext.grants.length
  const errors = findings.filter((f) => f.level === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <span className="text-lg text-accent">{draftManifest.glyph}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-text">
            {draftManifest.name} <span className="text-xs font-normal text-text-muted">Studio{dirty ? ' · unsaved changes' : ''}</span>
          </h2>
        </div>
        <div className="flex rounded-xl bg-bg-sunken p-0.5 lg:hidden">
          {(['code', 'preview'] as const).map((p) => (
            <button key={p} onClick={() => setPane(p)} className={`rounded-lg px-3 py-1 text-xs capitalize ${pane === p ? 'bg-bg-elevated text-text' : 'text-text-muted'}`}>
              {p}
            </button>
          ))}
        </div>
        <Button variant="primary" disabled={!dirty || saving || errors > 0} onClick={save} title="Save (Ctrl+S)">
          <Save size={13} className="mr-1.5 inline" />
          Save
        </Button>
        <Button variant="ghost" onClick={close}>
          <X size={15} />
        </Button>
      </header>

      {!draft ? (
        <div className="flex-1 animate-pulse" />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 px-4 pb-4 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)_minmax(0,26rem)]">
          <nav className={`${pane === 'code' ? 'flex' : 'hidden'} min-h-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-2 lg:flex`}>
            {fileNames.map((path) => (
              <div key={path} className="group flex items-center">
                <button
                  onClick={() => setSelected(path)}
                  disabled={path in draft.binary}
                  className={`min-w-0 flex-1 truncate rounded-lg px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                    selected === path ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'
                  } ${path in draft.binary ? 'opacity-50' : ''}`}
                >
                  {path}
                </button>
                {path !== MANIFEST && path in draft.files && (
                  <button onClick={() => removeFile(path)} title="Delete file" className="mr-1 hidden rounded p-1 text-text-muted hover:text-danger group-hover:block">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            <div className="mt-auto flex items-center gap-1 pt-2">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFile()}
                placeholder="new-file.js"
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent/70"
              />
              <button onClick={addFile} title="Add file" className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken hover:text-text">
                <FilePlus size={15} />
              </button>
            </div>
          </nav>

          <section className={`${pane === 'code' ? 'flex' : 'hidden'} min-h-0 flex-col gap-2 lg:flex`}>
            <textarea
              value={text}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: s, selectionEnd: end } = el
                edit(`${text.slice(0, s)}  ${text.slice(end)}`)
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
              }}
              spellCheck={false}
              wrap="off"
              aria-label={`Editing ${selected}`}
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-bg-elevated p-4 font-mono text-[12.5px] leading-relaxed text-text outline-none ring-1 ring-transparent focus:ring-accent/30"
            />
            <StudioAiBar snapshot={{ manifest: draft.manifest, files: draft.files }} onApply={applyAi} onUndo={undoAi} canUndo={canUndo} />
            {findings.length > 0 && (
              <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs">
                {findings.map((f, i) => (
                  <li key={i} className={f.level === 'error' ? 'text-danger' : 'text-warning'}>
                    {f.level === 'error' ? '✕' : '!'} {f.text}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className={`${pane === 'preview' ? 'flex' : 'hidden'} min-h-0 flex-col gap-2 lg:flex`}>
            <div className="flex items-center gap-1.5">
              {draftManifest.panels.length > 1 &&
                draftManifest.panels.map((p) => (
                  <button key={p.id} onClick={() => setPanelId(p.id)} className={`rounded-lg px-2.5 py-1 text-xs ${panel?.id === p.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-bg-sunken'}`}>
                    {p.title}
                  </button>
                ))}
              <span className="flex-1" />
              <button onClick={onGrant} className="rounded-lg px-2 py-1 text-[11px] text-text-muted hover:bg-bg-sunken hover:text-text" title="Review what this extension is allowed to do">
                {grantedCount}/{draftManifest.permissions.length} permissions
              </button>
              <button onClick={() => setReload((n) => n + 1)} title="Reload preview" className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken hover:text-text">
                <RotateCw size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg-elevated">
              {panel && previewFiles ? (
                <ExtensionFrame ext={previewExt} panel={panel} surface="preview" files={previewFiles} reloadKey={reload} />
              ) : (
                <p className="p-5 text-sm leading-relaxed text-text-muted">
                  {draftManifest.script
                    ? 'This extension has no panel. Its script runs in the background once saved and turned on. Watch the console below.'
                    : draftManifest.theme
                      ? 'A theme restyles the whole app once it is saved and turned on.'
                      : 'Add a panel to the manifest to see it here.'}
                </p>
              )}
            </div>
            <div className="flex h-36 shrink-0 flex-col rounded-lg border border-border bg-bg-elevated p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Console</span>
                <button onClick={() => clearLogs(ext.id)} className="text-[11px] text-text-muted hover:text-text">
                  Clear
                </button>
              </div>
              <ConsoleView extId={ext.id} className="min-h-0 flex-1" />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
