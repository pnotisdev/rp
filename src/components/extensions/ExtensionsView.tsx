// The Extensions screen: installed apps, bundled examples, import/new, and a full-page launcher.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, MoreHorizontal, Pencil, Plus, RotateCw, ScrollText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileButton } from '@/components/ui/FileButton'
import { Toggle } from '@/components/ui/Toggle'
import { ViewShell } from '@/components/ui/ViewShell'
import { extensionsApi } from '@/lib/api/client'
import { downloadText } from '@/lib/extensions/download'
import { EXAMPLE_BUNDLES } from '@/lib/extensions/examples'
import { PERMISSION_INFO, ungrantedPermissions, type ExtensionBundle, type ExtensionRecord, type Permission } from '@/lib/extensions/manifest'
import { useExtensions } from '@/lib/extensions/useExtensions'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { ExtensionFrame } from './ExtensionFrame'
import { ExtensionSettingsForm } from './ExtensionSettingsForm'
import { ExtensionStudio } from './ExtensionStudio'
import { LogsDialog } from './LogsDialog'
import { NewExtensionDialog } from './NewExtensionDialog'
import { PermissionsDialog, RISK_STYLE } from './PermissionsDialog'

/** The API rejects with the response body in the message; pull the readable parts back out. */
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

function where(ext: ExtensionRecord): string[] {
  const m = ext.manifest
  const out: string[] = []
  const slots = new Set(m.panels.flatMap((p) => p.slots))
  if (slots.has('view')) out.push('own screen')
  if (slots.has('chat')) out.push('chat dock')
  if (slots.has('hud')) out.push('chat overlay')
  if (m.script) out.push(m.hooks.length ? `script, ${m.hooks.join('/')} hooks` : 'background script')
  if (m.theme) out.push('theme')
  return out
}

/** A small overflow menu for the less-used card actions. */
function CardMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="animate-panel-in absolute right-0 top-full z-20 mt-1 w-44 rounded-xl bg-bg-sunken p-1 ring-1 ring-text/15">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-bg-sunken ${item.danger ? 'text-danger' : 'text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ExtensionCard({
  ext,
  onToggle,
  onOpen,
  onEdit,
  onReview,
  onRemove,
  onLogs,
}: {
  ext: ExtensionRecord
  onToggle: (on: boolean) => void
  onOpen: (panelId: string) => void
  onEdit: () => void
  onReview: () => void
  onRemove: () => void
  onLogs: () => void
}) {
  const m = ext.manifest
  const [showSettings, setShowSettings] = useState(false)
  const missing = ungrantedPermissions(m, ext.grants)
  const places = where(ext)

  async function exportBundle() {
    try {
      const bundle = await extensionsApi.bundle(ext.id)
      downloadText(`${ext.id}.rpext.json`, JSON.stringify(bundle, null, 2))
    } catch (e) {
      toastError(explain(e))
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xl text-accent">{m.glyph}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-base font-semibold text-text">{m.name}</h3>
            <span className="text-xs text-text-muted">v{m.version}</span>
            {m.author && <span className="text-xs text-text-muted">by {m.author}</span>}
          </div>
          {m.description && <p className="mt-0.5 text-sm leading-relaxed text-text-muted">{m.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {places.map((p) => (
              <span key={p} className="rounded-full bg-bg-sunken px-2.5 py-0.5 text-[11px] text-text-muted">
                {p}
              </span>
            ))}
            {m.permissions.map((p) => (
              <span
                key={p}
                title={PERMISSION_INFO[p].detail}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${ext.grants.includes(p) ? RISK_STYLE[PERMISSION_INFO[p].risk] : 'bg-bg-sunken text-text-muted/60 line-through'}`}
              >
                {PERMISSION_INFO[p].label}
              </span>
            ))}
          </div>
        </div>
        <Toggle checked={ext.enabled} onChange={onToggle} />
      </div>

      {ext.enabled && missing.length > 0 && (
        <button onClick={onReview} className="mt-3 w-full rounded-xl bg-warning/10 px-3 py-2 text-left text-xs text-warning transition-colors hover:bg-warning/15">
          Needs your approval for {missing.length} more permission{missing.length > 1 ? 's' : ''}. Review
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {m.panels.slice(0, 3).map((p, i) => (
          <Button key={p.id} variant={i === 0 ? 'primary' : 'secondary'} disabled={!ext.enabled} onClick={() => onOpen(p.id)} title={ext.enabled ? undefined : 'Turn the extension on first'}>
            Open {m.panels.length > 1 ? p.title : ''}
          </Button>
        ))}
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        {m.settings.length > 0 && (
          <Button variant="ghost" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </Button>
        )}
        <CardMenu
          items={[
            { label: 'Permissions', onClick: onReview },
            { label: 'Console', onClick: onLogs },
            { label: 'Export', onClick: exportBundle },
            { label: 'Remove', onClick: onRemove, danger: true },
          ]}
        />
      </div>

      {showSettings && (
        <div className="mt-4 rounded-xl bg-bg-sunken p-4">
          <ExtensionSettingsForm ext={ext} />
        </div>
      )}
    </div>
  )
}

function AppScreen({ ext, panelId, onBack, onEdit }: { ext: ExtensionRecord; panelId: string; onBack: () => void; onEdit: () => void }) {
  const panel = ext.manifest.panels.find((p) => p.id === panelId) ?? ext.manifest.panels[0]
  const [reload, setReload] = useState(0)
  const [showLogs, setShowLogs] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 py-3 sm:px-8">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1.5 inline" />
          Extensions
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-lg text-accent">{panel.glyph}</span>
          <h2 className="truncate text-base font-semibold text-text">{ext.manifest.name}</h2>
        </div>
        <Button variant="ghost" onClick={() => setReload((n) => n + 1)} title="Reload">
          <RotateCw size={14} />
        </Button>
        <Button variant="ghost" onClick={() => setShowLogs(true)}>
          <ScrollText size={14} />
        </Button>
        <Button variant="ghost" onClick={onEdit}>
          <Pencil size={14} />
        </Button>
      </header>
      <div className="min-h-0 flex-1 px-4 pb-4 sm:px-8 sm:pb-8">
        <div className="mx-auto h-full max-w-4xl overflow-hidden rounded-lg border border-border bg-bg-elevated">
          <ExtensionFrame ext={ext} panel={panel} surface="view" reloadKey={reload} />
        </div>
      </div>
      {showLogs && <LogsDialog extId={ext.id} name={ext.manifest.name} onClose={() => setShowLogs(false)} />}
    </div>
  )
}

export function ExtensionsView() {
  const extensions = useExtensions()
  const [open, setOpen] = useState<{ id: string; panel: string } | null>(null)
  const [studioId, setStudioId] = useState<string | null>(null)
  const [permsFor, setPermsFor] = useState<{ id: string; enabling: boolean } | null>(null)
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const byId = useMemo(() => new Map((extensions ?? []).map((e) => [e.id, e])), [extensions])
  const installed = extensions ?? []
  const examples = EXAMPLE_BUNDLES.filter((b) => !byId.has(b.manifest.id))
  const permsExt = permsFor ? byId.get(permsFor.id) : undefined
  const studioExt = studioId ? byId.get(studioId) : undefined
  const openExt = open ? byId.get(open.id) : undefined

  async function install(bundle: unknown, source: 'import' | 'example'): Promise<ExtensionRecord | undefined> {
    try {
      const result = await extensionsApi.install(bundle, source)
      toastSuccess(result.created ? `Installed ${result.record.manifest.name}` : `Updated ${result.record.manifest.name}`)
      return result.record
    } catch (e) {
      toastError(explain(e))
      return undefined
    }
  }

  async function importFile(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const record = await install(JSON.parse(await file.text()), 'import')
        if (record && !record.enabled) setPermsFor({ id: record.id, enabling: true })
      } catch {
        toastError(`${file.name} is not valid JSON.`)
      }
    }
  }

  async function installExample(bundle: ExtensionBundle) {
    const record = await install(bundle, 'example')
    if (record) setPermsFor({ id: record.id, enabling: true })
  }

  async function toggle(ext: ExtensionRecord, on: boolean) {
    if (on && ungrantedPermissions(ext.manifest, ext.grants).length > 0) {
      setPermsFor({ id: ext.id, enabling: true })
      return
    }
    try {
      await extensionsApi.setState(ext.id, { enabled: on })
    } catch (e) {
      toastError(explain(e))
    }
  }

  async function confirmGrants(ext: ExtensionRecord, grants: Permission[], enable: boolean) {
    try {
      await extensionsApi.setState(ext.id, { grants, ...(enable ? { enabled: true } : {}) })
      setPermsFor(null)
    } catch (e) {
      toastError(explain(e))
    }
  }

  async function remove(ext: ExtensionRecord) {
    const ok = await confirmDialog({
      title: `Remove ${ext.manifest.name}?`,
      body: 'Its files and everything it stored are deleted. Export it first if you want a copy.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await extensionsApi.remove(ext.id)
      if (open?.id === ext.id) setOpen(null)
    } catch (e) {
      toastError(explain(e))
    }
  }

  if (openExt && open) {
    return (
      <>
        <AppScreen ext={openExt} panelId={open.panel} onBack={() => setOpen(null)} onEdit={() => setStudioId(openExt.id)} />
        {studioExt && <ExtensionStudio ext={studioExt} onClose={() => setStudioId(null)} onGrant={() => setPermsFor({ id: studioExt.id, enabling: false })} />}
        {permsExt && permsFor && (
          <PermissionsDialog ext={permsExt} enabling={permsFor.enabling} onClose={() => setPermsFor(null)} onConfirm={(g) => confirmGrants(permsExt, g, permsFor.enabling)} />
        )}
      </>
    )
  }

  return (
    <ViewShell
      title="Extensions"
      description="Small apps, minigames, themes and scripts that run in a sandbox. Build your own in the Studio, import one, or have an AI agent write it for you."
      actions={
        <>
          <FileButton accept=".json,application/json" multiple onPick={importFile} title="Import an extension file">
            <Upload size={14} />
            Import
          </FileButton>
          <Button variant="primary" onClick={() => setShowNew(true)}>
            <Plus size={14} className="mr-1 inline" />
            New
          </Button>
        </>
      }
    >
      {extensions === undefined ? null : installed.length === 0 ? (
        <EmptyState action={<Button variant="primary" onClick={() => setShowNew(true)}>Build your first extension</Button>}>
          Nothing installed yet. Try one of the examples below, or start from a template.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {installed.map((ext) => (
            <ExtensionCard
              key={ext.id}
              ext={ext}
              onToggle={(on) => toggle(ext, on)}
              onOpen={(panelId) => setOpen({ id: ext.id, panel: panelId })}
              onEdit={() => setStudioId(ext.id)}
              onReview={() => setPermsFor({ id: ext.id, enabling: false })}
              onRemove={() => remove(ext)}
              onLogs={() => setLogsFor(ext.id)}
            />
          ))}
        </div>
      )}

      {examples.length > 0 && (
        <section className="mt-10">
          <h3 className="mb-1 text-sm font-semibold text-text">Examples</h3>
          <p className="mb-4 text-xs text-text-muted">Ready-made extensions that also show how they are built. Install one, then open it in the Studio to see its code.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {examples.map((b) => (
              <div key={b.manifest.id} className="flex items-start gap-3 rounded-lg border border-border bg-bg-elevated p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-lg text-text-muted">{b.manifest.glyph}</div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-medium text-text">{b.manifest.name}</h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{b.manifest.description}</p>
                  <Button variant="secondary" className="mt-3" onClick={() => installExample(b)}>
                    Install
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showNew && (
        <NewExtensionDialog
          takenIds={installed.map((e) => e.id)}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false)
            setStudioId(id)
          }}
        />
      )}
      {permsExt && permsFor && (
        <PermissionsDialog ext={permsExt} enabling={permsFor.enabling} onClose={() => setPermsFor(null)} onConfirm={(g) => confirmGrants(permsExt, g, permsFor.enabling)} />
      )}
      {logsFor && byId.get(logsFor) && <LogsDialog extId={logsFor} name={byId.get(logsFor)!.manifest.name} onClose={() => setLogsFor(null)} />}
      {studioExt && <ExtensionStudio ext={studioExt} onClose={() => setStudioId(null)} onGrant={() => setPermsFor({ id: studioExt.id, enabling: false })} />}
    </ViewShell>
  )
}
