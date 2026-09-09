import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Send, Square, Trash2, UserPlus } from 'lucide-react'
import { assistantThreadsApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useAssistant } from '@/lib/assistant/useAssistant'
import { detectProducer, PRODUCER_DETAIL, PRODUCER_LABEL, type ProducerKind } from '@/lib/assistant/requests'
import type { AssistantMessage, AssistantThread } from '@/lib/assistant/thread'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

/**
 * The Assistant: a plain conversation with the model, with no character and no relationship.
 *
 * Replaces Companion mode, whose problem was that it ran a voice loop through the roleplay session
 * hook and so inherited the entire dating engine for a use case that wanted none of it. This is the
 * "talking to the model" surface the app was missing — and the two things it can *make* (a roleplay
 * character, a chaptered story) are offered rather than inferred, so ordinary chat stays ordinary.
 */

/** Renders a reply's text: headings, list items and fenced code, and nothing more elaborate. */
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
                  <p key={`${i}-${j}`} className="font-display text-[15px] font-semibold text-text">
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

/** A generated character, with the one action that matters: put it in the library. */
function CharacterCard({ message, onSave }: { message: AssistantMessage; onSave: () => void }) {
  const generated = message.attachment?.character
  if (!generated) return null
  const { card, profile, outfits, characterBook, failedStages, savedCharacterId } = generated
  const rows: { label: string; value: string }[] = [
    { label: 'Personality', value: card.personality },
    { label: 'Scenario', value: card.scenario },
    ...(profile?.occupation ? [{ label: 'Occupation', value: profile.occupation }] : []),
    ...(profile?.likes?.length ? [{ label: 'Likes', value: profile.likes.join(', ') }] : []),
    ...(profile?.goals?.length ? [{ label: 'Goals', value: profile.goals.join(', ') }] : []),
    ...(profile?.boundaries?.length ? [{ label: 'Boundaries', value: profile.boundaries.join(', ') }] : []),
    ...(outfits?.length ? [{ label: 'Wardrobe', value: outfits.map((o) => o.label ?? o.id).join(', ') }] : []),
    ...(characterBook?.entries?.length ? [{ label: 'Lore', value: `${characterBook.entries.length} entries` }] : []),
  ].filter((r) => r.value?.trim())

  return (
    <div className="mt-3 rounded-xl border border-romance/40 bg-romance/5 p-4">
      <div className="font-display text-base font-semibold text-romance">{card.name}</div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-text-muted">{card.description}</p>
      <dl className="mt-3 space-y-1.5 border-t border-romance/20 pt-3 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">{row.label}</dt>
            <dd className="min-w-0 flex-1 whitespace-pre-wrap text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
      {!!failedStages?.length && (
        // Says what didn't come back, so a partial character doesn't look complete.
        <p className="mt-3 text-xs text-warning">
          Some steps produced nothing usable ({failedStages.join(', ')}). You can fill those in after saving.
        </p>
      )}
      <div className="mt-3">
        {savedCharacterId ? (
          <span className="text-xs text-success">Saved to your characters.</span>
        ) : (
          <Button variant="primary" onClick={onSave} className="inline-flex items-center gap-1.5">
            <UserPlus size={14} />
            Save to characters
          </Button>
        )}
      </div>
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
      <div className="font-display text-base font-semibold text-accent">{story.title}</div>
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

export function AssistantView() {
  const threads = useApiQuery<AssistantThread[]>('assistant-threads', () => assistantThreadsApi.list(), []) ?? []
  const [threadId, setThreadId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { thread, load, isBusy, streamingText, progress, sendMessage, produceCharacter, produceStory, saveCharacter, abort } =
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

  /** What the composer's text looks like it's asking to have made, for the offer chip. */
  const offered: ProducerKind | undefined = useMemo(() => detectProducer(draft), [draft])

  const submit = async () => {
    const text = draft.trim()
    if (!text || isBusy) return
    let id = threadId
    if (!id) {
      const created = await assistantThreadsApi.create({ title: 'New conversation', messages: [] })
      id = created.id
      setThreadId(id)
    }
    setDraft('')
    await sendMessage(text)
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
    // The brief is kept in the thread as the user's own turn, so the request reads as a request.
    await sendMessage(text)
    if (kind === 'character') await produceCharacter(text)
    else await produceStory(text)
  }

  const messages = thread?.messages ?? []

  return (
    // A flex item of App's own row wrapper, so it has to be told to grow and to allow shrinking.
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {/* Thread list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-sunken/50">
        <div className="flex items-center justify-between gap-2 p-3">
          <span className="font-display text-sm font-semibold">Assistant</span>
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
              className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors ${
                t.id === threadId ? 'bg-bg-elevated text-text' : 'text-text-muted hover:text-text'
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
                <p className="font-display text-lg text-text">Ask the model anything.</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
                  This is a plain conversation, not a character. It can also build a roleplay character for your library,
                  or write a full story chapter by chapter, when you ask it to.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id}>
                <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                {m.error ? (
                  <p className="text-sm text-danger">{m.error}</p>
                ) : (
                  <AssistantText text={m.text} />
                )}
                {m.attachment?.kind === 'character' && <CharacterCard message={m} onSave={() => void saveCharacter(m.id)} />}
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
        <div className="shrink-0 border-t border-border bg-bg-elevated/60 px-6 py-4">
          <div className="mx-auto max-w-chat">
            {offered && !isBusy && (
              // Offered, never assumed: sending it as an ordinary message stays one keypress away.
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                <Button variant="primary" onClick={() => void runProducer(offered)}>
                  {PRODUCER_LABEL[offered]}
                </Button>
                <span className="min-w-0 flex-1 text-[11px] text-text-muted">{PRODUCER_DETAIL[offered]}</span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
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
                  disabled={!draft.trim()}
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
