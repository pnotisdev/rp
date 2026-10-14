import type { WorldCard } from '@/lib/types'
import { type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'
import { downloadJsonFile, toEnvelope } from '@/lib/io/transfer'
import { EditorShell } from '@/components/ui/EditorShell'
import { OverviewTab } from './editor/OverviewTab'
import { LoreTab } from './editor/LoreTab'
import { ScenesTab } from './editor/ScenesTab'
import { DatingTab } from './editor/DatingTab'
import { ClockTab } from './editor/ClockTab'
import { useWorldEditor } from './editor/useWorldEditor'

export function WorldEditor({
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
  const f = useWorldEditor({ world, initialTemplate, initialTab, onDone })
  const { tab, setTab, name, saving, save, remove, tabs } = f

  return (
    <EditorShell
      onBack={onDone}
      backLabel="Worlds"
      eyebrow="World"
      title={name || 'Untitled world'}
      headerActions={world && <Button onClick={() => downloadJsonFile(toEnvelope('world', world), `${world.name} world`)}>Export</Button>}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          {world ? (
            <Button variant="danger" onClick={remove}>
              Delete world
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : world ? 'Save changes' : 'Create world'}
          </Button>
        </>
      }
    >
      {tab === 'overview' && <OverviewTab f={f} />}

      {tab === 'lore' && <LoreTab f={f} />}

      {tab === 'scenes' && <ScenesTab f={f} />}

      {tab === 'dating' && <DatingTab f={f} />}

      {tab === 'clock' && world && <ClockTab f={f} />}
    </EditorShell>
  )
}

