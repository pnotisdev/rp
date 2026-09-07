import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHostedBackendStatus } from '@/lib/hooks/useHostedBackendStatus'
import { KNOWN_CHAT_PROVIDERS, NOVELAI_MODELS } from '@/lib/api/chatBackend'
import type { ViewId } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { HostedConnectionStatus } from '@/components/settings/HostedConnectionStatus'
import { NewChatDialog } from './NewChatDialog'
import { TrashPanel } from './TrashPanel'

const INPUT_CLASS =
  'flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40'

/** Every hosted option the welcome screen's compact picker offers — the full OpenAI-compatible
 *  roster plus NovelAI folded in as one more choice, so there's a single "Provider" dropdown
 *  instead of a separate backend-kind selector (Settings → Connection's fuller, two-step version). */
const HOSTED_PROVIDER_OPTIONS: { id: string; label: string; kind: 'openai-compatible' | 'novelai'; baseUrl?: string; modelExample?: string }[] = [
  ...KNOWN_CHAT_PROVIDERS.map((p) => ({ id: p.id, label: p.label, kind: 'openai-compatible' as const, baseUrl: p.baseUrl, modelExample: p.modelExample })),
  { id: 'novelai', label: 'NovelAI (hosted, subscription)', kind: 'novelai' as const },
]
const DEFAULT_HOSTED_PROVIDER = KNOWN_CHAT_PROVIDERS.find((p) => p.id === 'openrouter')!

// The seeded starter character (server/seedContent.ts) — featured on the welcome screen when it
// still exists, so a fresh install is one click from a running conversation.
const SEED_CHARACTER_ID = 'a0000000-0000-4000-8000-000000000002'

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '')

/** A fast, self-contained reachability check — the KoboldClient's own calls default to a 30s timeout, too long for probing several URLs. */
async function probeUrl(url: string, timeoutMs = 2500): Promise<string | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${normalizeUrl(url)}/api/v1/model`, { signal: ctrl.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { result?: unknown }
    return typeof body.result === 'string' ? body.result : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const COMMON_URLS = ['http://localhost:5001', 'http://127.0.0.1:5001', 'http://localhost:5000']

export function WelcomeView({
  onStarted,
  onNavigate,
}: {
  onStarted: (chatId: string) => void
  onNavigate: (view: ViewId) => void
}) {
  const charactersResult = useApiQuery('characters', () => charactersApi.list(), [])
  const characters = charactersResult ?? []
  const charactersLoading = charactersResult === undefined
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl)
  const { status: koboldStatus, model, maxContext } = useConnectionStatus(baseUrl)

  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const chatBackendApiKey = useSettingsStore((s) => s.chatBackendApiKey)
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const setChatBackendConfig = useSettingsStore((s) => s.setChatBackendConfig)
  // Which of the two connection paths is showing — directly the same setting Settings → Connection
  // reads, so switching here and there can never disagree.
  const isHosted = chatBackend !== 'koboldcpp'
  const matchedProvider = KNOWN_CHAT_PROVIDERS.find((p) => p.baseUrl === chatBackendBaseUrl)
  const selectedProviderId = chatBackend === 'novelai' ? 'novelai' : (matchedProvider?.id ?? DEFAULT_HOSTED_PROVIDER.id)
  const hostedStatus = useHostedBackendStatus(
    isHosted,
    chatBackend === 'novelai' ? 'novelai' : 'openai-compatible',
    chatBackendBaseUrl,
    chatBackendApiKey,
    chatBackendModel,
  )
  const activeStatus = isHosted ? hostedStatus.status : koboldStatus

  const [urlDraft, setUrlDraft] = useState(baseUrl)
  const [probing, setProbing] = useState(false)
  const [probeHit, setProbeHit] = useState<{ url: string; model: string } | null>(null)
  const probedFor = useRef<string | null>(null)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  // This screen only shows at all once `chats.length === 0` — the one place a deleted chat's
  // recoverability actually matters is right here: deleting your only/last chat bounces you to
  // this exact screen, so without this link the trash it landed in would be unreachable.
  const trashCount = useApiQuery('chats', () => chatsApi.trash(), [])?.length ?? 0

  const seed = characters.find((c) => c.id === SEED_CHARACTER_ID)
  const featured = seed ?? characters[0]

  useEffect(() => setUrlDraft(baseUrl), [baseUrl])

  // Once, when we're offline on the current URL, quietly try the usual KoboldCpp defaults — pointless
  // (and a wasted local request) while the hosted path is the one actually selected.
  useEffect(() => {
    if (isHosted || koboldStatus !== 'offline' || probedFor.current === baseUrl) return
    probedFor.current = baseUrl
    setProbing(true)
    setProbeHit(null)
    let cancelled = false
    ;(async () => {
      for (const url of COMMON_URLS) {
        if (normalizeUrl(url) === normalizeUrl(baseUrl)) continue
        const found = await probeUrl(url)
        if (cancelled) return
        if (found) {
          setProbeHit({ url, model: found })
          break
        }
      }
      if (!cancelled) setProbing(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isHosted, koboldStatus, baseUrl])

  const applyUrl = (url: string) => {
    probedFor.current = null
    setProbeHit(null)
    setBaseUrl(normalizeUrl(url))
  }

  // Switching path never touches the *other* path's already-entered settings — flipping back and
  // forth is always non-destructive. Picking 'hosted' for the first time (still 'koboldcpp')
  // defaults to OpenRouter's free tier rather than landing on an unconfigured, connectionless state.
  const selectPath = (path: 'local' | 'hosted') => {
    if (path === 'local') {
      setChatBackendConfig({ chatBackend: 'koboldcpp' })
      return
    }
    if (chatBackend === 'koboldcpp') {
      setChatBackendConfig({ chatBackend: 'openai-compatible', chatBackendBaseUrl: chatBackendBaseUrl || DEFAULT_HOSTED_PROVIDER.baseUrl })
    }
  }

  const selectHostedProvider = (id: string) => {
    const chosen = HOSTED_PROVIDER_OPTIONS.find((p) => p.id === id)
    if (!chosen) return
    if (chosen.kind === 'novelai') {
      setChatBackendConfig({
        chatBackend: 'novelai',
        chatBackendModel: NOVELAI_MODELS.some((m) => m.id === chatBackendModel) ? chatBackendModel : NOVELAI_MODELS[0].id,
      })
    } else {
      setChatBackendConfig({ chatBackend: 'openai-compatible', chatBackendBaseUrl: chosen.baseUrl })
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-lg py-10">
        <MessageCircle size={30} strokeWidth={1.25} className="mb-4 text-accent" />
        <h1 className="font-display text-2xl text-text">Welcome to RP Suite</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          A local-first roleplay client. Bring your own model — running locally, or a hosted API key.
          Two steps and you're talking.
        </p>

        {/* 1. Connection */}
        <div className="mt-8 rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                activeStatus === 'online' ? 'bg-success' : activeStatus === 'checking' ? 'bg-warning' : 'bg-danger'
              }`}
            />
            <span className="text-sm font-medium text-text">
              {activeStatus === 'online' ? 'Model connected' : activeStatus === 'checking' ? 'Checking connection…' : 'No model connected'}
            </span>
          </div>

          <div className="mb-4 flex gap-2">
            <Chip on={!isHosted} onClick={() => selectPath('local')}>
              Local model
            </Chip>
            <Chip on={isHosted} onClick={() => selectPath('hosted')}>
              Hosted API key
            </Chip>
          </div>

          {!isHosted && koboldStatus === 'online' && (
            <p className="text-xs text-text-muted">
              {model ?? 'A model'} is loaded{maxContext ? ` — ${maxContext.toLocaleString()} token context` : ''}. You're
              ready to chat.
            </p>
          )}

          {!isHosted && koboldStatus !== 'online' && (
            <div className="space-y-3 text-xs text-text-muted">
              <p>
                Point this at a local model server — KoboldCpp, LM Studio, Ollama, or any
                OpenAI-compatible endpoint — then check again. Running it on another machine? Launch
                with{' '}
                <code className="rounded-md bg-bg-sunken px-1 py-0.5 font-mono text-[11px]">--host 0.0.0.0</code>{' '}
                (or your usual tunnel) and put that address below.
              </p>
              <div className="flex gap-2">
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={() => urlDraft !== baseUrl && applyUrl(urlDraft)}
                  placeholder="http://localhost:5001"
                  className={INPUT_CLASS}
                />
                <Button onClick={() => applyUrl(urlDraft)}>Check</Button>
              </div>
              {probing && <p>Trying the usual addresses…</p>}
              {probeHit && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-bg-sunken px-3 py-2">
                  <span className="text-text">
                    Found <span className="font-medium">{probeHit.model}</span> at {probeHit.url}
                  </span>
                  <Button variant="primary" onClick={() => applyUrl(probeHit.url)}>
                    Use it
                  </Button>
                </div>
              )}
              <p>You can set this up later — it only matters when a character actually needs to reply.</p>
            </div>
          )}

          {isHosted && (
            <div className="space-y-3 text-xs text-text-muted">
              <p>
                OpenRouter has a free tier — nothing to pay to try this. Your key is stored only in this
                browser and sent directly to the provider below, never through any other server.
              </p>
              <div>
                <label className="mb-1 block text-text-muted">Provider</label>
                <select
                  value={selectedProviderId}
                  onChange={(e) => selectHostedProvider(e.target.value)}
                  className={`${INPUT_CLASS} w-full cursor-pointer`}
                >
                  {HOSTED_PROVIDER_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-text-muted">API key</label>
                <input
                  type="password"
                  value={chatBackendApiKey}
                  onChange={(e) => setChatBackendConfig({ chatBackendApiKey: e.target.value })}
                  className={`${INPUT_CLASS} w-full`}
                />
              </div>
              <div>
                <label className="mb-1 block text-text-muted">Model</label>
                {chatBackend === 'novelai' ? (
                  <select
                    value={NOVELAI_MODELS.some((m) => m.id === chatBackendModel) ? chatBackendModel : NOVELAI_MODELS[0].id}
                    onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
                    className={`${INPUT_CLASS} w-full cursor-pointer`}
                  >
                    {NOVELAI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={chatBackendModel}
                    onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
                    placeholder={matchedProvider ? `e.g. ${matchedProvider.modelExample}` : 'e.g. gpt-4o-mini'}
                    className={`${INPUT_CLASS} w-full`}
                  />
                )}
              </div>
              <HostedConnectionStatus status={hostedStatus.status} detail={hostedStatus.detail} recheck={hostedStatus.recheck} />
              <p>
                Need more control (custom base URL, per-provider notes)?{' '}
                <button className="text-accent transition-colors hover:underline" onClick={() => onNavigate('settings')}>
                  Open Settings → Connection
                </button>
                .
              </p>
            </div>
          )}
        </div>

        {/* 2. First chat */}
        <div className="mt-4 rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="mb-3 text-sm font-medium text-text">Start your first chat</div>

          {charactersLoading ? (
            // Don't flash the "you have no characters" branch before the list has loaded — a fresh
            // install ships with a seeded character, and that flicker reads as "the seed is missing".
            <div className="h-14 animate-pulse rounded-xl bg-bg-sunken" />
          ) : featured ? (
            <>
              <div className="flex items-center gap-3">
                {featured.avatarDataUrl ? (
                  <img src={featured.avatarDataUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-lg text-text-muted">
                    {featured.card.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">{featured.card.name}</div>
                  <p className="line-clamp-2 text-xs text-text-muted">
                    {featured.card.description || featured.card.personality || 'Your resident character.'}
                  </p>
                </div>
              </div>
              <Button variant="primary" onClick={() => setShowNewChat(true)} className="mt-4 w-full">
                Chat with {featured.card.name}
              </Button>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <button className="hover:text-text" onClick={() => onNavigate('characters')}>
                  Browse characters
                </button>
                <button className="flex items-center gap-1 hover:text-text" onClick={() => onNavigate('characters')}>
                  <Sparkles size={12} strokeWidth={2} /> Generate one
                </button>
                <button className="flex items-center gap-1 hover:text-text" onClick={() => onNavigate('characters')}>
                  <Upload size={12} strokeWidth={2} /> Import a card
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-text-muted">
                You don't have any characters yet — make one from scratch, generate it with the model, or import a
                SillyTavern / Character-Card-V3 file.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => onNavigate('characters')} className="flex items-center gap-1.5">
                  <Wand2 size={14} strokeWidth={2} /> Create a character
                </Button>
                <Button onClick={() => onNavigate('characters')} className="flex items-center gap-1.5">
                  <Upload size={14} strokeWidth={2} /> Import a card
                </Button>
              </div>
            </>
          )}
        </div>

        {trashCount > 0 && (
          <button
            onClick={() => setShowTrash(true)}
            className="mt-4 flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
          >
            <Trash2 size={12} strokeWidth={2} />
            {trashCount === 1 ? '1 deleted chat in the trash' : `${trashCount} deleted chats in the trash`}
          </button>
        )}
      </div>

      {showNewChat && featured && (
        <NewChatDialog
          initialCharacterId={featured.id}
          onClose={() => setShowNewChat(false)}
          onCreated={(id) => {
            setShowNewChat(false)
            onStarted(id)
          }}
        />
      )}
      {showTrash && (
        <TrashPanel onClose={() => setShowTrash(false)} onRestored={(id) => { setShowTrash(false); onStarted(id) }} />
      )}
    </div>
  )
}
