import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Sparkles, Upload, Wand2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import type { ViewId } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/Button'
import { NewChatDialog } from './NewChatDialog'

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
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl)
  const { status, model, maxContext } = useConnectionStatus(baseUrl)

  const [urlDraft, setUrlDraft] = useState(baseUrl)
  const [probing, setProbing] = useState(false)
  const [probeHit, setProbeHit] = useState<{ url: string; model: string } | null>(null)
  const probedFor = useRef<string | null>(null)
  const [showNewChat, setShowNewChat] = useState(false)

  const seed = characters.find((c) => c.id === SEED_CHARACTER_ID)
  const featured = seed ?? characters[0]

  useEffect(() => setUrlDraft(baseUrl), [baseUrl])

  // Once, when we're offline on the current URL, quietly try the usual KoboldCpp defaults.
  useEffect(() => {
    if (status !== 'offline' || probedFor.current === baseUrl) return
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
  }, [status, baseUrl])

  const applyUrl = (url: string) => {
    probedFor.current = null
    setProbeHit(null)
    setBaseUrl(normalizeUrl(url))
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-lg py-10">
        <MessageCircle size={30} strokeWidth={1.25} className="mb-4 text-accent" />
        <h1 className="font-display text-2xl text-text">Welcome to RP Suite</h1>
        <p className="mt-1.5 text-sm text-text-muted">
          A local-first roleplay client for KoboldCpp. Two steps and you're talking.
        </p>

        {/* 1. Connection */}
        <div className="mt-8 rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                status === 'online' ? 'bg-success' : status === 'checking' ? 'bg-warning' : 'bg-danger'
              }`}
            />
            <span className="text-sm font-medium text-text">
              {status === 'online' ? 'Model connected' : status === 'checking' ? 'Looking for your model…' : 'No model connected'}
            </span>
          </div>

          {status === 'online' && (
            <p className="text-xs text-text-muted">
              {model ?? 'A model'} is loaded{maxContext ? ` — ${maxContext.toLocaleString()} token context` : ''}. You're
              ready to chat.
            </p>
          )}

          {status !== 'online' && (
            <div className="space-y-3 text-xs text-text-muted">
              <p>
                Start KoboldCpp with a model loaded, then check again. Running it on another machine? Launch it with{' '}
                <code className="rounded-md bg-bg-sunken px-1 py-0.5 font-mono text-[11px]">--host 0.0.0.0</code> and put that machine's
                address
                below.
              </p>
              <div className="flex gap-2">
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={() => urlDraft !== baseUrl && applyUrl(urlDraft)}
                  placeholder="http://localhost:5001"
                  className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
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
              <p>
                You can set this up later — it only matters when a character actually needs to reply. Change it any time in
                Settings → Connection.
              </p>
            </div>
          )}
        </div>

        {/* 2. First chat */}
        <div className="mt-4 rounded-2xl border border-border bg-bg-elevated p-5">
          <div className="mb-3 text-sm font-medium text-text">Start your first chat</div>

          {featured ? (
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
    </div>
  )
}
