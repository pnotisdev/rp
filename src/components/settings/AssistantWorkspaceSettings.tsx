// Settings for what the in-app Assistant may touch: one workspace folder, commands, approvals, and its long-term notes.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { agentApi, type MemoryNote, type WorkspaceConfig } from '@/lib/api/client'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { Toggle } from '@/components/ui/Toggle'

export function AssistantWorkspaceSettings() {
  const autoApprove = useSettingsStore((s) => s.assistantAutoApprove)
  const setAutoApprove = useSettingsStore((s) => s.setAssistantAutoApprove)
  const [saved, setSaved] = useState<WorkspaceConfig | null>(null)
  const [folder, setFolder] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<MemoryNote[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void agentApi.workspace().then((w) => {
      setSaved(w)
      setFolder(w.root)
    }, () => setSaved({ root: '', allowCommands: false }))
    void agentApi.memory().then(setNotes, () => setNotes([]))
  }, [])

  const save = async (next: WorkspaceConfig) => {
    try {
      const result = await agentApi.setWorkspace(next)
      setSaved(result)
      setFolder(result.root)
      setError('')
      return result
    } catch (e) {
      setError(errorMessage(e))
      return null
    }
  }

  const toggleCommands = async (allow: boolean) => {
    if (!saved) return
    if (allow) {
      const ok = await confirmDialog({
        title: 'Let the Assistant run commands?',
        body: 'It can then run shell commands in your workspace folder, for example tests or a build. You will still be asked to approve every command, and you can read it first. Only turn this on for a folder you trust.',
        confirmLabel: 'Allow commands',
      })
      if (!ok) return
    }
    await save({ ...saved, allowCommands: allow })
  }

  const addNote = async () => {
    if (!draft.trim()) return
    try {
      const note = await agentApi.addMemory(draft)
      setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]))
      setDraft('')
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const removeNote = async (id: string) => {
    await agentApi.removeMemory(id).catch((e) => toastError(errorMessage(e)))
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <>
      <Section
        title="Assistant workspace"
        description="A folder the Assistant can read, search and (when Tools is set to Look and change) edit. It cannot go outside this folder and cannot delete anything."
      >
        <TextField
          label="Workspace folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="E:\projects\my-story"
          hint={saved?.root ? 'Saved. The Assistant works inside this folder.' : 'Empty means the Assistant has no file access.'}
        />
        {error && <p className="-mt-1 mb-2 text-xs text-danger">{error}</p>}
        <div className="mb-3 flex gap-2">
          <Button
            variant="primary"
            disabled={!saved || folder.trim() === saved.root}
            onClick={async () => {
              if (await save({ root: folder, allowCommands: saved?.allowCommands ?? false })) toastSuccess(folder.trim() ? 'Workspace set.' : 'Workspace cleared.')
            }}
          >
            Save folder
          </Button>
          {saved?.root && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (await save({ root: '', allowCommands: false })) toastSuccess('Workspace cleared.')
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <Toggle checked={autoApprove} onChange={setAutoApprove} label="Apply file edits without asking" description="Off: every edit shows what will change and waits for you. Commands and paid pictures always ask." />
        <Toggle checked={saved?.allowCommands ?? false} onChange={(v) => void toggleCommands(v)} label="Let it run commands" description="Needs a workspace folder. Every command still asks first." />
      </Section>

      <Section title="Assistant memory" description="Short notes the Assistant keeps about you across conversations. It adds to them itself when you tell it something worth remembering, and you can edit them here.">
        {notes.length === 0 && <p className="mb-3 text-xs text-text-muted">Nothing saved yet.</p>}
        <div className="mb-3 space-y-1.5">
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 rounded-md bg-bg-sunken px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 break-words">{n.text}</span>
              <button onClick={() => void removeNote(n.id)} aria-label="Forget this note" className="mt-0.5 text-text-muted hover:text-danger">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addNote()}
            maxLength={300}
            placeholder="Something it should always know…"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent/70"
          />
          <Button onClick={() => void addNote()}>Add</Button>
        </div>
      </Section>
    </>
  )
}
