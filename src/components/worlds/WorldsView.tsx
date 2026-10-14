import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { tintStyle } from '@/lib/color.hue'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldsApi } from '@/lib/api/client'
import type { WorldCard } from '@/lib/types'
import { type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { DropZone } from '@/components/ui/DropZone'
import { importAndReport } from '@/lib/io/importFiles'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { WorldTemplateGallery } from './WorldTemplateGallery'
import { GenerateWorldDialog } from './GenerateWorldDialog'
import { WorldEditor } from './WorldEditor'

export function WorldsView({
  initialWorldId,
  initialTab,
  onConsumedInitial,
}: {
  /** Deep-link into this world's editor on mount (the command palette's "jump to a world"). */
  initialWorldId?: string | null
  /** Paired with `initialWorldId` — also land on this specific tab (the Relationship panel's "Customize" link jumping straight to 'dating'). Ignored without `initialWorldId`. */
  initialTab?: string | null
  onConsumedInitial?: () => void
} = {}) {
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [selected, setSelected] = useState<WorldCard | 'new' | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<WorldTemplateId | undefined>(undefined)
  // Latched into local state the moment a match is found, same reason `pendingTemplate` is local rather than read straight from a prop
  const [resolvedTab, setResolvedTab] = useState<string | undefined>(undefined)
  const [showTemplateGallery, setShowTemplateGallery] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)

  useEffect(() => {
    if (!initialWorldId) return
    const match = worlds.find((w) => w.id === initialWorldId)
    if (!match) return
    setSelected(match)
    setResolvedTab(initialTab ?? undefined)
    onConsumedInitial?.()
    // Only re-run when the target id itself changes (or the list finishes loading)
  }, [initialWorldId, worlds.length])

  if (selected) {
    return (
      <WorldEditor
        world={selected === 'new' ? null : selected}
        initialTemplate={selected === 'new' ? pendingTemplate : undefined}
        initialTab={selected === 'new' ? undefined : resolvedTab}
        onDone={() => setSelected(null)}
      />
    )
  }

  const importWorlds = (files: File[]) => importAndReport('world', files, (data) => worldsApi.create(data))

  return (
    <DropZone onFiles={importWorlds} label="Drop world files to import">
    <ViewShell
      title="Worlds"
      description="A world is a shared setting: its tone, its rules, its lore, and its scene backgrounds. Any number of characters can live in one; assign a world from the character's editor."
      actions={
        <>
          <FileButton onPick={(f) => importWorlds(Array.from(f))} accept=".json" multiple title="Import worlds exported from this app">
            Import
          </FileButton>
          <Button onClick={() => setShowGenerate(true)}>Generate with AI</Button>
          <Button variant="primary" onClick={() => setShowTemplateGallery(true)}>
            New world
          </Button>
        </>
      }
    >
      {showTemplateGallery && (
        <WorldTemplateGallery
          onChoose={(template) => {
            setPendingTemplate(template)
            setShowTemplateGallery(false)
            setSelected('new')
          }}
          onClose={() => setShowTemplateGallery(false)}
        />
      )}
      {showGenerate && (
        <GenerateWorldDialog
          onClose={() => setShowGenerate(false)}
          onCreated={(world) => {
            setShowGenerate(false)
            setSelected(world)
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {worlds.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="group rounded-lg border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-sunken"
          >
            <div className="portrait-frame mb-3 aspect-[4/3] w-full rounded-xl">
              {w.avatarDataUrl ? (
                <img src={w.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center" style={tintStyle(w.name)}>
                  <Globe size={26} strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{w.name}</div>
            <div className="truncate px-1 text-xs text-text-muted">
              {w.lorebook.entries.length} {w.lorebook.entries.length === 1 ? 'lore entry' : 'lore entries'}
            </div>
          </button>
        ))}
        {worlds.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              <Button variant="primary" onClick={() => setShowTemplateGallery(true)}>
                Create your first world
              </Button>
            }
          >
            No worlds yet. Start from a template (Freeform RP, Visual Novel, Dating Sim, or Slice of
            Life) and reshape it from there.
          </EmptyState>
        )}
      </div>
    </ViewShell>
    </DropZone>
  )
}
