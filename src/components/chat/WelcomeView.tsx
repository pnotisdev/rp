import { useEffect, useState } from 'react'
import { MessageCircle, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHostedBackendStatus } from '@/lib/hooks/useHostedBackendStatus'
import { useOpenAiModels } from '@/lib/hooks/useOpenAiModels'
import { detectLocalBackend } from '@/lib/api/detectBackend'
import { KNOWN_CHAT_PROVIDERS, NOVELAI_MODELS } from '@/lib/api/chatBackend'
import { toastError, toastSuccess } from '@/lib/store/useToastStore'
import type { ViewId } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { HostedConnectionStatus } from '@/components/settings/HostedConnectionStatus'
import { NewChatDialog } from './NewChatDialog'
import { TrashPanel } from './TrashPanel'

const INPUT_CLASS =
  'flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40'

/** Providers that are really local runners — kept off the cloud picker, since the "Local server" tab auto-detects them. */
const LOCAL_PROVIDER_IDS = new Set(['lmstudio', 'ollama'])

/** Every cloud option the welcome screen's compact picker offers — the hosted OpenAI-compatible
 *  roster (the local runners belong on the "Local server" tab, which auto-detects them) plus
 *  NovelAI folded in as one more choice, so there's a single "Provider" dropdown instead of a
 *  separate backend-kind selector (Settings → Connection's fuller, two-step version). */
const HOSTED_PROVIDER_OPTIONS: { id: string; label: string; kind: 'openai-compatible' | 'novelai'; baseUrl?: string; modelExample?: string }[] = [
  ...KNOWN_CHAT_PROVIDERS.filter((p) => !LOCAL_PROVIDER_IDS.has(p.id)).map((p) => ({ id: p.id, label: p.label, kind: 'openai-compatible' as const, baseUrl: p.baseUrl, modelExample: p.modelExample })),
  { id: 'novelai', label: 'NovelAI (hosted, subscription)', kind: 'novelai' as const },
]
const DEFAULT_HOSTED_PROVIDER = KNOWN_CHAT_PROVIDERS.find((p) => p.id === 'openrouter')!

// The seeded starter character (server/seedContent.ts) — featured on the welcome screen when it
// still exists, so a fresh install is one click from a running conversation.
const SEED_CHARACTER_ID = 'a0000000-0000-4000-8000-000000000002'

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '')

const isLoopbackUrl = (u: string) => {
  try {
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(new URL(u).hostname)
  } catch {
    return false
  }
}

// Default ports for the local runners this understands — only tried when the user clicks
// "try common addresses", never automatically.
const COMMON_LOCAL_URLS = [
  'http://localhost:5001', // KoboldCpp
  'http://localhost:1234', // LM Studio
  'http://localhost:11434', // Ollama
  'http://localhost:8080', // llama.cpp server
  'http://localhost:5000', // KoboldAI / older
]

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

  // Which panel is showing. Local now covers both KoboldCpp and an OpenAI-compatible server on
  // localhost (LM Studio, llama.cpp, Ollama, ...) — the Check button auto-detects which. Seeded
  // from the stored backend, then owned by the tab clicks; the stored config always stays the
  // source of truth Settings → Connection reads.
  const [mode, setMode] = useState<'local' | 'cloud'>(() =>
    chatBackend === 'koboldcpp' ? 'local' : chatBackend === 'novelai' ? 'cloud' : isLoopbackUrl(chatBackendBaseUrl) ? 'local' : 'cloud',
  )
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
  const localOpenAi = mode === 'local' && chatBackend === 'openai-compatible'
  const activeStatus = mode === 'cloud' || localOpenAi ? hostedStatus.status : koboldStatus

  const { models: cloudModels } = useOpenAiModels(chatBackendBaseUrl, chatBackendApiKey, chatBackend === 'openai-compatible')

  // The Local tab's address field. Seeded from whichever local address we already have — a
  // detected local OpenAI server, else the KoboldCpp URL setting. Never the cloud provider URL.
  const [urlDraft, setUrlDraft] = useState(
    chatBackend === 'openai-compatible' && isLoopbackUrl(chatBackendBaseUrl) ? chatBackendBaseUrl : baseUrl,
  )
  const [detecting, setDetecting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  // This screen only shows at all once `chats.length === 0` — the one place a deleted chat's
  // recoverability actually matters is right here: deleting your only/last chat bounces you to
  // this exact screen, so without this link the trash it landed in would be unreachable.
  const trashCount = useApiQuery('chats', () => chatsApi.trash(), [])?.length ?? 0

  const seed = characters.find((c) => c.id === SEED_CHARACTER_ID)
  const featured = seed ?? characters[0]

  // Reflect a KoboldCpp-URL change made in Settings while this screen is mounted, unless a detect
  // is mid-flight or the field is already showing a detected local OpenAI server.
  useEffect(() => {
    if (detecting || scanning) return
    if (chatBackend === 'openai-compatible' && isLoopbackUrl(chatBackendBaseUrl)) return
    setUrlDraft(baseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  const applyDetected = (found: NonNullable<Awaited<ReturnType<typeof detectLocalBackend>>>) => {
    if (found.kind === 'koboldcpp') {
      setBaseUrl(found.baseUrl)
      setChatBackendConfig({ chatBackend: 'koboldcpp' })
      setUrlDraft(found.baseUrl)
      toastSuccess(found.model ? `Connected to KoboldCpp — ${found.model}` : 'Connected to KoboldCpp')
      return
    }
    const list = found.models ?? []
    const keepModel = list.includes(chatBackendModel) ? chatBackendModel : (list[0] ?? chatBackendModel)
    setChatBackendConfig({ chatBackend: 'openai-compatible', chatBackendBaseUrl: found.baseUrl, chatBackendModel: keepModel })
    setUrlDraft(found.baseUrl)
    setCustomModel(false)
    toastSuccess(list.length ? `Connected — ${list.length} model${list.length === 1 ? '' : 's'} available` : 'Connected')
  }

  const runDetect = async (url: string) => {
    const u = normalizeUrl(url)
    if (!u || detecting) return
    setDetecting(true)
    try {
      const found = await detectLocalBackend(u)
      if (found) applyDetected(found)
      else toastError(`Nothing answered at ${u}. Is the server running, and is the address right?`)
    } finally {
      setDetecting(false)
    }
  }

  const scanCommon = async () => {
    if (scanning) return
    setScanning(true)
    try {
      for (const candidate of COMMON_LOCAL_URLS) {
        const found = await detectLocalBackend(candidate)
        if (found) {
          applyDetected(found)
          return
        }
      }
      toastError('No model server found on the usual local ports. Enter the address manually.')
    } finally {
      setScanning(false)
    }
  }

  // Switching panel never touches the other panel's entered settings — flipping back and forth is
  // non-destructive. The local panel needs *a* local backend selected so its status line means
  // something before detection; the cloud panel defaults to OpenRouter's free tier.
  const selectMode = (next: 'local' | 'cloud') => {
    setMode(next)
    setCustomModel(false)
    if (next === 'local') {
      const localOpenAiConfig = chatBackend === 'openai-compatible' && isLoopbackUrl(chatBackendBaseUrl)
      setUrlDraft(localOpenAiConfig ? chatBackendBaseUrl : baseUrl)
      // Anything but an already-local backend: fall back to KoboldCpp so the status line and the
      // address field are both about a local server, not the cloud provider left selected.
      if (!localOpenAiConfig && chatBackend !== 'koboldcpp') setChatBackendConfig({ chatBackend: 'koboldcpp' })
    } else if (chatBackend === 'koboldcpp' || (chatBackend === 'openai-compatible' && isLoopbackUrl(chatBackendBaseUrl))) {
      setChatBackendConfig({ chatBackend: 'openai-compatible', chatBackendBaseUrl: DEFAULT_HOSTED_PROVIDER.baseUrl })
    }
  }

  const selectHostedProvider = (id: string) => {
    const chosen = HOSTED_PROVIDER_OPTIONS.find((p) => p.id === id)
    if (!chosen) return
    setCustomModel(false)
    if (chosen.kind === 'novelai') {
      setChatBackendConfig({
        chatBackend: 'novelai',
        chatBackendModel: NOVELAI_MODELS.some((m) => m.id === chatBackendModel) ? chatBackendModel : NOVELAI_MODELS[0].id,
      })
    } else {
      setChatBackendConfig({ chatBackend: 'openai-compatible', chatBackendBaseUrl: chosen.baseUrl })
    }
  }

  // Shared by the local and cloud panels for any OpenAI-compatible backend: a real dropdown of the
  // ids `/models` returned, with a "type it in" escape hatch, falling back to a plain field when
  // the provider doesn't expose `/models`.
  const openAiModelField = (
    <div>
      <label className="mb-1 block text-text-muted">Model</label>
      {cloudModels && cloudModels.length > 0 && !customModel ? (
        <select
          value={cloudModels.includes(chatBackendModel) ? chatBackendModel : ''}
          onChange={(e) => {
            if (e.target.value === '__custom__') return setCustomModel(true)
            setChatBackendConfig({ chatBackendModel: e.target.value })
          }}
          className={`${INPUT_CLASS} w-full cursor-pointer`}
        >
          {!cloudModels.includes(chatBackendModel) && <option value="">Choose a model…</option>}
          {cloudModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value="__custom__">Other — type the id…</option>
        </select>
      ) : (
        <>
          <input
            value={chatBackendModel}
            onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
            placeholder={matchedProvider ? `e.g. ${matchedProvider.modelExample}` : 'e.g. gpt-4o-mini'}
            className={`${INPUT_CLASS} w-full`}
          />
          {cloudModels && cloudModels.length > 0 && (
            <button className="mt-1 text-accent transition-colors hover:underline" onClick={() => setCustomModel(false)}>
              Back to the model list
            </button>
          )}
        </>
      )}
    </div>
  )

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
            <Chip on={mode === 'local'} onClick={() => selectMode('local')}>
              Local server
            </Chip>
            <Chip on={mode === 'cloud'} onClick={() => selectMode('cloud')}>
              Cloud provider
            </Chip>
          </div>

          {mode === 'local' && (
            <div className="space-y-3 text-xs text-text-muted">
              {chatBackend === 'koboldcpp' && koboldStatus === 'online' ? (
                <p>
                  {model ?? 'A model'} is loaded{maxContext ? ` — ${maxContext.toLocaleString()} token context` : ''}. You're
                  ready to chat.
                </p>
              ) : localOpenAi && hostedStatus.status === 'online' ? (
                <p>
                  Connected to {normalizeUrl(chatBackendBaseUrl)}
                  {chatBackendModel ? ` — ${chatBackendModel}` : ''}. You're ready to chat.
                </p>
              ) : (
                <p>
                  Enter the address of a local model server. KoboldCpp, LM Studio, Ollama, llama.cpp
                  and TabbyAPI all work; Check figures out which one it is. Running it on another
                  machine? Start it bound to{' '}
                  <code className="rounded-md bg-bg-sunken px-1 py-0.5 font-mono text-[11px]">0.0.0.0</code> and use that
                  address.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runDetect(urlDraft)}
                  placeholder="http://localhost:5001"
                  className={INPUT_CLASS}
                />
                <Button onClick={() => runDetect(urlDraft)} disabled={detecting || scanning}>
                  {detecting ? 'Checking…' : 'Check'}
                </Button>
              </div>
              <button
                className="text-accent transition-colors hover:underline disabled:opacity-50"
                onClick={scanCommon}
                disabled={detecting || scanning}
              >
                {scanning ? 'Trying common addresses…' : "Not sure of the address? Try the common local ports"}
              </button>

              {localOpenAi && (
                <>
                  {openAiModelField}
                  <HostedConnectionStatus status={hostedStatus.status} detail={hostedStatus.detail} recheck={hostedStatus.recheck} />
                </>
              )}
              <p>You can set this up later. It only matters when a character actually needs to reply.</p>
            </div>
          )}

          {mode === 'cloud' && (
            <div className="space-y-3 text-xs text-text-muted">
              <p>
                OpenRouter has a free tier, so there's nothing to pay to try this. Your key is stored
                only in this browser and sent straight to the provider below, never through any other
                server.
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
                <label className="mb-1 block text-text-muted">
                  API key {chatBackend !== 'novelai' && <span className="text-text-muted/70">(some providers don't need one)</span>}
                </label>
                <input
                  type="password"
                  value={chatBackendApiKey}
                  onChange={(e) => setChatBackendConfig({ chatBackendApiKey: e.target.value })}
                  className={`${INPUT_CLASS} w-full`}
                />
              </div>
              {chatBackend === 'novelai' ? (
                <div>
                  <label className="mb-1 block text-text-muted">Model</label>
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
                </div>
              ) : (
                openAiModelField
              )}
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
