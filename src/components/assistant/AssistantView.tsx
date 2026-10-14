import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Paperclip, Plus, Send, Square, Trash2, X } from 'lucide-react'
import { agentApi, assistantThreadsApi, type WorkspaceConfig } from '@/lib/api/client'
import { composeMessageText, readAttachment, type PendingAttachment } from '@/lib/attachments'
import { shrinkImage } from '@/lib/images'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useAssistant } from '@/lib/assistant/useAssistant'
import { detectProducer, PRODUCER_DETAIL, PRODUCER_LABEL, type ProducerKind } from '@/lib/assistant/requests'
import type { AssistantMessage, AssistantThread } from '@/lib/assistant/thread'
import { CharacterDraftCard } from './CharacterDraftCard'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

/** The Assistant: a plain conversation with the model, with no character and no relationship. */

/** Renders a reply's text: headings, list items and fenced code, and nothing more elaborate. */
const STARTERS = [
  { label: 'Make a character', prompt: 'Create a character for me: a quiet night-shift librarian with a dry sense of humor and a secret.' },
  { label: 'Write a story', prompt: 'Write a short story about two rivals stuck together during a long train delay.' },
  { label: 'Plan a world', prompt: 'Help me design a small fantasy harbor town: its places, factions and a few secrets.' },
]

function AssistantText({ text }: { text: string }) {
  const blocks = useMemo(() => text.split(/```/), [text])
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, i) =>
        // Odd indices are the inside of a fence.
        i % 2 === 1 ? (
          <pre key={i} className="overflow-x-auto rounded-lg bg-bg-sunken p-3 text-xs">
            <code>{block.replace(/^\w*\n/, '')}</code>
          </pre>
        ) : (
          block
            .split('\n\n')
            .filter((p) => p.trim())
            .map((para, j) => {
              const heading = /^(#{1,4})\s+(.*)$/.exec(para.trim())
              if (heading) {
                return (
                  <p key={`${i}-${j}`} className="text-[15px] font-semibold text-text">
                    {heading[2]}
                  </p>
                )
              }
              const lines = para.split('\n')
              const isList = lines.every((l) => /^\s*(?:[-*+]|\d+\.)\s+/.test(l))
              if (isList) {
                return (
                  <ul key={`${i}-${j}`} className="ml-4 list-disc space-y-1">
                    {lines.map((l, k) => (
                      <li key={k}>{l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')}</li>
                    ))}
                  </ul>
                )
              }
              return (
                <p key={`${i}-${j}`} className="whitespace-pre-wrap">
                  {para}
                </p>
              )
            })
        ),
      )}
    </div>
  )
}

/** A generated story: the outline up front, each chapter as it lands. */
function StoryCard({ message }: { message: AssistantMessage }) {
  const story = message.attachment?.story
  const [openChapter, setOpenChapter] = useState<number | null>(0)
  if (!story) return null
  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <div className="text-base font-semibold text-accent">{story.title}</div>
      <p className="mt-1 text-xs text-text-muted">{story.premise}</p>
      <div className="mt-3 space-y-1.5 border-t border-accent/20 pt-3">
        {story.chapters.map((chapter, i) => {
          const isWriting = story.writingIndex === i
          return (
            <div key={i}>
              <button
                onClick={() => setOpenChapter(openChapter === i ? null : i)}
                disabled={!chapter.text}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/10 disabled:opacity-60"
              >
                <span className="w-5 shrink-0 text-[10px] tabular-nums text-text-muted/70">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-text">{chapter.title}</span>
                {isWriting && <Spinner className="text-xs" />}
                {!chapter.text && !isWriting && <span className="shrink-0 text-[10px] text-text-muted">pending</span>}
              </button>
              {openChapter === i && chapter.text && (
                <div className="px-2 pb-2 pt-1">
                  <AssistantText text={chapter.text} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Pictures in a message, small until clicked. */
function Pictures({ images }: { images: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((src, i) => (
        <a key={i} href={src} target="_blank" rel="noreferrer">
          <img src={src} alt="" className="max-h-40 max-w-[16rem] rounded-lg border border-border object-contain" />
        </a>
      ))}
    </div>
  )
}

/** One tool the assistant used: a quiet line that opens to the arguments and what came back. */
function ToolCard({ tool, onRevert }: { tool: NonNullable<AssistantMessage['tool']>; onRevert?: () => void }) {
  const brief = tool.result.replace(/\s+/g, ' ').slice(0, 90)
  return (
    <div>
      <details className="rounded-xl bg-bg-sunken px-3 py-2 text-xs">
        <summary className="flex cursor-pointer select-none items-center gap-2 text-text-muted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tool.isError ? 'bg-danger' : 'bg-success'}`} />
          <span className="shrink-0 font-medium text-text">{tool.name}</span>
          <span className="truncate">{brief}</span>
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-muted">
          {JSON.stringify(tool.arguments, null, 2)}
          {'\n\n'}
          {tool.result}
        </pre>
      </details>
      {tool.images && <Pictures images={tool.images} />}
      {tool.undo && (
        <div className="mt-1 flex items-center gap-2 px-3 text-xs text-text-muted">
          {tool.undo.reverted ? (
            <span>Reverted</span>
          ) : (
            <Button variant="ghost" onClick={onRevert}>
              Revert this change to {tool.undo.name}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function AssistantView() {
  const threads = useApiQuery<AssistantThread[]>('assistant-threads', () => assistantThreadsApi.list(), []) ?? []
  const [threadId, setThreadId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceConfig | null>(null)
  const assistantTools = useSettingsStore((s) => s.assistantTools)
  const setAssistantTools = useSettingsStore((s) => s.setAssistantTools)
  const autoBuild = useSettingsStore((s) => s.assistantAutoBuild)

  const { thread, load, isBusy, streamingText, progress, sendMessage, produceCharacter, produceStory, redoStage, saveCharacter, revertEdit, abort } =
    useAssistant(threadId, () => setRefreshKey((k) => k + 1))

  // Newest thread selected on first load, so the view is never an empty shell when history exists.
  useEffect(() => {
    if (!threadId && threads.length) setThreadId(threads[0].id)
  }, [threadId, threads])

  useEffect(() => {
    if (threadId) void load(threadId)
  }, [threadId, load, refreshKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread?.messages.length, streamingText])

  const newThread = async () => {
    try {
      const created = await assistantThreadsApi.create({ title: 'New conversation', messages: [] })
      setThreadId(created.id)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const removeThread = async (id: string) => {
    try {
      await assistantThreadsApi.remove(id)
      if (id === threadId) setThreadId(null)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  useEffect(() => {
    void agentApi.workspace().then(setWorkspace, () => setWorkspace(null))
  }, [assistantTools])

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        const a = await readAttachment(file)
        setAttachments((prev) => [...prev, a])
      } catch (e) {
        toastError(errorMessage(e))
      }
    }
  }

  /** What the composer's text looks like it's asking to have made, for the offer chip. */
  const offered: ProducerKind | undefined = useMemo(() => detectProducer(draft), [draft])

  /** Sends the composer's text. A request for a character builds a draft card instead, unless `plain` asks for an ordinary reply. */
  const submit = async ({ plain = false }: { plain?: boolean } = {}) => {
    const text = composeMessageText(draft.trim(), attachments).trim()
    const pictures = attachments.filter((a): a is Extract<PendingAttachment, { kind: 'image' }> => a.kind === 'image')
    if ((!text && !pictures.length) || isBusy) return
    let id = threadId
    if (!id) {
      const created = await assistantThreadsApi.create({ title: 'New conversation', messages: [] })
      id = created.id
      setThreadId(id)
    }
    setDraft('')
    setAttachments([])
    if (autoBuild && !plain && detectProducer(text) === 'character') return void (await produceCharacter(text, id))
    await sendMessage(text, id, await Promise.all(pictures.map((a) => shrinkImage(a.dataUrl))))
  }

  /** Runs the producer on the composer's text instead of sending it as an ordinary message. */
  const runProducer = async (kind: ProducerKind) => {
    const text = draft.trim()
    if (!text || isBusy) return
    let id = threadId
    if (!id) {
      const created = await assistantThreadsApi.create({ title: text.slice(0, 60), messages: [] })
      id = created.id
      setThreadId(id)
    }
    setDraft('')
    if (kind === 'character') await produceCharacter(text, id)
    else await produceStory(text, id)
  }

  const messages = thread?.messages ?? []

  return (
    // A flex item of App's own row wrapper, so it has to be told to grow and to allow shrinking.
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {/* Thread list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 p-3">
          <span className="text-sm font-semibold">Assistant</span>
          <Button onClick={newThread} className="inline-flex items-center gap-1.5">
            <Plus size={14} />
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {threads.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">No conversations yet.</p>}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                t.id === threadId ? 'bg-bg-sunken text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              <button onClick={() => setThreadId(t.id)} className="min-w-0 flex-1 truncate text-left">
                {t.title}
              </button>
              <button
                onClick={() => removeThread(t.id)}
                title="Delete conversation"
                className="shrink-0 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Thread */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-chat space-y-5">
            {messages.length === 0 && !isBusy && (
              <div className="py-16 text-center">
                <p className="text-lg font-semibold tracking-tight text-text">Ask the model anything.</p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
                  This is a plain conversation, not a character. It can also build a roleplay character for your library,
                  or write a full story chapter by chapter, when you ask it to.
                </p>
                <div className="mx-auto mt-6 flex max-w-md flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setDraft(s.prompt)}
                      className="rounded-md bg-bg-sunken px-3.5 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => m.tool ? (
              <div key={m.id}>
                <ToolCard tool={m.tool} onRevert={() => void revertEdit(m.id)} />
                {m.attachment?.kind === 'character' && m.attachment.character && (
                  <CharacterDraftCard generated={m.attachment.character} busy={isBusy} onSave={() => void saveCharacter(m.id)} onRedo={(stage) => void redoStage(m.id, stage)} />
                )}
              </div>
            ) : (
              <div key={m.id}>
                <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                {m.error ? (
                  <p className="text-sm text-danger">{m.error}</p>
                ) : (
                  // A card shows its own title and summary; the text stays in the thread for the model's context.
                  !m.attachment && <AssistantText text={m.text} />
                )}
                {m.images && <Pictures images={m.images} />}
                {m.attachment?.kind === 'character' && m.attachment.character && (
                  <CharacterDraftCard
                    generated={m.attachment.character}
                    busy={isBusy}
                    onSave={() => void saveCharacter(m.id)}
                    onRedo={(stage) => void redoStage(m.id, stage)}
                  />
                )}
                {m.attachment?.kind === 'story' && <StoryCard message={m} />}
              </div>
            ))}
            {streamingText && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">Assistant</div>
                <AssistantText text={streamingText} />
              </div>
            )}
            {progress && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Spinner className="text-xs" />
                <span>{progress.label}…</span>
              </div>
            )}
            {isBusy && !streamingText && !progress && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Spinner className="text-xs" />
                <span>Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-border px-6 py-3">
          <div className="mx-auto max-w-chat">
            {offered && !isBusy && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                {autoBuild && offered === 'character' ? (
                  // Enter builds the card; the button is the way out when the request was not really for a character.
                  <>
                    <span className="min-w-0 flex-1 text-[11px] text-text-muted">Enter drafts every section as a card for you to review. Nothing is saved until you click Save.</span>
                    <Button onClick={() => void submit({ plain: true })}>Send as plain chat</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" onClick={() => void runProducer(offered)}>
                      {PRODUCER_LABEL[offered]}
                    </Button>
                    <span className="min-w-0 flex-1 text-[11px] text-text-muted">{PRODUCER_DETAIL[offered]}</span>
                  </>
                )}
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs text-text-muted">Tools</span>
              <SegmentedControl
                size="sm"
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'read', label: 'Look' },
                  { value: 'write', label: 'Look and change' },
                ]}
                value={assistantTools}
                onChange={setAssistantTools}
              />
              <span className="text-[11px] text-text-muted">
                {assistantTools === 'off'
                  ? 'Plain conversation.'
                  : assistantTools === 'read'
                    ? 'Can search your library, read files in the workspace, look at pictures and fetch web pages.'
                    : 'Can also edit your library and the workspace files, and make pictures. Each file change asks first. It cannot delete.'}
              </span>
            </div>
            {workspace && assistantTools !== 'off' && (
              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-text-muted">
                <FolderOpen size={12} className="shrink-0" />
                {workspace.root ? <span className="truncate" title={workspace.root}>Workspace: {workspace.root}</span> : <span>No workspace folder set. Choose one in Settings, Agents to let it work with files.</span>}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div key={i} className="group relative">
                    {a.kind === 'image' ? <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-lg border border-border object-cover" /> : <div className="flex h-14 max-w-[10rem] items-center rounded-lg border border-border px-2.5 text-xs text-text-muted"><span className="truncate">{a.name}</span></div>}
                    <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-muted hover:text-danger">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.json,.csv,.log,.js,.ts,.tsx,.py,.html,.css,.yml,.yaml,.xml" className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} title="Attach pictures or text files" aria-label="Attach pictures or text files" className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-sunken hover:text-text">
                <Paperclip size={16} strokeWidth={1.6} />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
                  if (pasted.length) {
                    e.preventDefault()
                    void addFiles(pasted)
                  }
                }}
                rows={2}
                placeholder="Ask anything. Shift+Enter for a new line."
                className="min-h-[52px] flex-1 resize-y rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent/60"
              />
              {isBusy ? (
                <Button onClick={abort} className="inline-flex items-center gap-1.5">
                  <Square size={14} />
                  Stop
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void submit()}
                  disabled={!draft.trim() && !attachments.length}
                  className="inline-flex items-center gap-1.5"
                >
                  <Send size={14} />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
