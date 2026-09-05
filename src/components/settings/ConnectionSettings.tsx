import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { CHAT_BACKEND_LABELS, KNOWN_CHAT_PROVIDERS, NOVELAI_MODELS, type ChatBackendId } from '@/lib/api/chatBackend'
import { TextField, SelectField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { Button } from '@/components/ui/Button'
import { toastSuccess } from '@/lib/store/useToastStore'

const CHAT_BACKENDS = Object.keys(CHAT_BACKEND_LABELS) as ChatBackendId[]

const STATUS_DOT = { online: 'bg-success', offline: 'bg-danger', checking: 'bg-warning' } as const
const STATUS_LABEL = { online: 'Connected', offline: 'Not reachable', checking: 'Checking…' } as const
const BUILTIN_IDS = new Set(BUILTIN_INSTRUCT_TEMPLATES.map((t) => t.id))

export function ConnectionSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const setBaseUrl = useSettingsStore((s) => s.setBaseUrl)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const chatBackendApiKey = useSettingsStore((s) => s.chatBackendApiKey)
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const setChatBackendConfig = useSettingsStore((s) => s.setChatBackendConfig)
  const [draft, setDraft] = useState(baseUrl)
  const { status, model, version, maxContext, detectedTemplateId } = useConnectionStatus(baseUrl)

  // Only nudge when the model clearly implies a builtin format AND the active template is itself a
  // builtin we can compare against — a user on a hand-tuned custom template is assumed to know.
  const detected = detectedTemplateId ? BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === detectedTemplateId) : undefined
  const templateMismatch =
    detected && BUILTIN_IDS.has(instructTemplateId) && detectedTemplateId !== instructTemplateId ? detected : undefined

  // Derived from the current base URL rather than stored separately (same "match against known
  // values, fall back to custom" idiom as the sampler/instruct-template presets elsewhere in
  // Settings) — picking a provider is a one-time convenience fill-in, not a lock; editing the Base
  // URL afterward is exactly what quietly falls back to "Custom" here.
  const matchedProvider = KNOWN_CHAT_PROVIDERS.find((p) => p.baseUrl === chatBackendBaseUrl)

  return (
    <SettingsPage>
      <Section title="KoboldCpp connection" surface="bare">
        <TextField
          label="Server URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setBaseUrl(draft)}
          placeholder="http://localhost:5001"
        />
        <div className="mt-6 rounded-xl bg-bg-elevated p-5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-text">{STATUS_LABEL[status]}</span>
          </div>
          {model && <div className="mt-1 text-text-muted">Model: {model}</div>}
          {version && <div className="text-text-muted">KoboldCpp {version}</div>}
          {maxContext !== null && (
            <div className="text-text-muted">
              Max context: {maxContext.toLocaleString()} tokens — used automatically for judge/assist
              calls (relationship scoring, choices, objectives, lore suggestions) instead of a fixed
              guess.
            </div>
          )}
          {status === 'offline' && (
            <p className="mt-2 text-text-muted">
              Make sure KoboldCpp is running and reachable at this URL. If it's on another machine,
              launch it with <code>--host 0.0.0.0</code> or your usual CORS/tunnel setup.
            </p>
          )}
        </div>

        {templateMismatch && (
          <div className="mt-4 rounded-xl bg-warning/10 p-4 text-xs ring-1 ring-warning/30">
            <p className="text-text">
              This model's chat template looks like <strong>{templateMismatch.name}</strong>, but the
              active instruct template is{' '}
              <strong>
                {BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === instructTemplateId)?.name ?? instructTemplateId}
              </strong>
              . A mismatch is the usual cause of a model that rambles, ignores its character, leaks
              instructions, or never stops.
            </p>
            <div className="mt-2.5">
              <Button
                variant="primary"
                onClick={() => {
                  setInstructTemplateId(templateMismatch.id)
                  toastSuccess(`Instruct template set to ${templateMismatch.name}`)
                }}
              >
                Switch to {templateMismatch.name}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Chat generation backend"
        description="Everything above is KoboldCpp's own connection — used whenever the backend below is left on 'KoboldCpp (local)'. Switching this to an OpenAI-compatible provider redirects generation (the main chat, and every background judge/assist call) there instead."
        surface="bare"
      >
        <SelectField
          label="Backend"
          value={chatBackend}
          onChange={(e) => setChatBackendConfig({ chatBackend: e.target.value as ChatBackendId })}
        >
          {CHAT_BACKENDS.map((id) => (
            <option key={id} value={id}>
              {CHAT_BACKEND_LABELS[id]}
            </option>
          ))}
        </SelectField>

        {chatBackend === 'openai-compatible' && (
          <>
            <p className="mb-2 text-xs text-text-muted">
              Any server that speaks the OpenAI Chat Completions format. Live-verified against a real
              account: three real turns against OpenRouter's free <code className="font-mono">minimax/minimax-m3:free</code>{' '}
              came back in character with working streaming, relationship scoring, and choice
              suggestions (ROADMAP.md #121). The rest of the list below is each vendor's own
              documented endpoint, not independently re-checked here — worth a quick sanity check on
              your first real reply with a new one.
            </p>
            <SelectField
              label="Provider"
              value={matchedProvider?.id ?? 'custom'}
              onChange={(e) => {
                const provider = KNOWN_CHAT_PROVIDERS.find((p) => p.id === e.target.value)
                if (provider) setChatBackendConfig({ chatBackendBaseUrl: provider.baseUrl })
              }}
            >
              {!matchedProvider && <option value="custom">Custom</option>}
              {KNOWN_CHAT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Base URL"
              value={chatBackendBaseUrl}
              onChange={(e) => setChatBackendConfig({ chatBackendBaseUrl: e.target.value })}
              placeholder="e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1"
            />
            <TextField
              label="API key"
              type="password"
              value={chatBackendApiKey}
              onChange={(e) => setChatBackendConfig({ chatBackendApiKey: e.target.value })}
            />
            <TextField
              label="Model"
              value={chatBackendModel}
              onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
              placeholder={matchedProvider ? `e.g. ${matchedProvider.modelExample}` : 'e.g. gpt-4o-mini'}
            />
            <p className="mt-2 text-xs text-text-muted">
              Keys are stored only in this browser and sent directly to the base URL above — never
              through any other server. Context-size and tokenizer figures elsewhere in the app fall
              back to an estimate for this backend, since hosted providers don't expose either. Temperature,
              top P, penalties, and reasoning effort for this backend live in Settings → Generation,
              separate from the KoboldCpp sampler above.
            </p>
          </>
        )}

        {chatBackend === 'novelai' && (
          <>
            <p className="mb-2 text-xs text-text-muted">
              NovelAI's own hosted models — a paid subscription, not something verified live while
              building this (see ROADMAP.md #123). Built against NovelAI's documented contract,
              cross-checked against SillyTavern's own current source rather than guessed at.
              Erato isn't offered here — it needs a different tokenizer this app doesn't bundle yet;
              Kayra and Clio both work through the local tokenizer for stop sequences.
            </p>
            <SelectField
              label="Model"
              value={chatBackendModel}
              onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
            >
              {NOVELAI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label="API key"
              type="password"
              value={chatBackendApiKey}
              onChange={(e) => setChatBackendConfig({ chatBackendApiKey: e.target.value })}
              hint="From your NovelAI account's user settings, not your login password."
            />
            <p className="mt-2 text-xs text-text-muted">
              Keys are stored only in this browser and sent directly to NovelAI — never through any
              other server. The KoboldCpp sampler above supplies temperature/top P/penalties for
              this backend too, since NovelAI's own sampler shape is close enough to reuse directly.
            </p>
          </>
        )}
      </Section>
    </SettingsPage>
  )
}
