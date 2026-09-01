import { useState } from 'react'
import type { Objective } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'

interface ObjectivePanelProps {
  activeObjective: Objective | undefined
  onClose: () => void
  onCreate: (title: string, description: string, createdBy: 'user' | 'ai') => Promise<void>
  onSuggest: () => Promise<{ title: string; description: string }>
  onGenerateTasks: () => Promise<void>
  onAddTask: (description: string) => Promise<void>
  onToggleTask: (taskId: string) => Promise<void>
  onSetStatus: (status: 'completed' | 'abandoned') => Promise<void>
}

export function ObjectivePanel({
  activeObjective,
  onClose,
  onCreate,
  onSuggest,
  onGenerateTasks,
  onAddTask,
  onToggleTask,
  onSetStatus,
}: ObjectivePanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newTask, setNewTask] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const pending = activeObjective?.tasks.filter((t) => t.status === 'pending') ?? []
  const done = activeObjective?.tasks.filter((t) => t.status === 'done') ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Objective</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {error && <p className="mb-3 text-xs text-danger">{error}</p>}

        {!activeObjective ? (
          <div className="flex-1 overflow-y-auto">
            <p className="mb-4 text-xs text-text-muted">
              Set a goal for this roleplay to work toward. The character's replies will be steered toward
              it, and tasks get checked off automatically as they happen in the scene.
            </p>
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Help Mira find her missing satchel" />
            <TextAreaField
              label="Description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  run('suggest', async () => {
                    const idea = await onSuggest()
                    if (idea.title) {
                      setTitle(idea.title)
                      setDescription(idea.description)
                    }
                  })
                }
                disabled={busy !== null}
              >
                {busy === 'suggest' ? 'Thinking…' : 'Suggest one for me'}
              </Button>
              <Button
                variant="primary"
                onClick={() => run('create', () => onCreate(title, description, 'user'))}
                disabled={busy !== null || !title.trim()}
              >
                Create objective
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <h3 className="text-sm font-semibold text-text">{activeObjective.title}</h3>
            {activeObjective.description && (
              <p className="mb-3 mt-1 text-xs text-text-muted">{activeObjective.description}</p>
            )}

            <div className="my-4 space-y-1.5">
              {activeObjective.tasks.length === 0 && (
                <p className="text-xs text-text-muted">No tasks yet — generate some, or add your own below.</p>
              )}
              {[...pending, ...done].map((task) => (
                <label
                  key={task.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-bg-sunken px-3 py-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={task.status === 'done'}
                    onChange={() => onToggleTask(task.id)}
                    className="mt-0.5"
                  />
                  <span className={task.status === 'done' ? 'text-text-muted line-through' : 'text-text'}>
                    {task.description}
                  </span>
                </label>
              ))}
            </div>

            <div className="mb-4 flex gap-2">
              <TextField
                label=""
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="Add a task by hand"
                className="flex-1"
              />
              <Button
                onClick={() =>
                  run('addTask', async () => {
                    await onAddTask(newTask)
                    setNewTask('')
                  })
                }
                disabled={busy !== null || !newTask.trim()}
                className="mt-5"
              >
                Add
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <div className="flex gap-2">
                <Button onClick={() => run('tasks', onGenerateTasks)} disabled={busy !== null}>
                  {busy === 'tasks' ? 'Generating…' : 'Generate tasks with AI'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => run('abandon', () => onSetStatus('abandoned'))} disabled={busy !== null}>
                  Abandon
                </Button>
                <Button variant="primary" onClick={() => run('complete', () => onSetStatus('completed'))} disabled={busy !== null}>
                  Mark complete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
