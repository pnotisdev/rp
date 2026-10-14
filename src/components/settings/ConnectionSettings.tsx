import { useState, type ReactNode } from 'react'
import { BRAND } from '@/lib/brand'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHostedBackendStatus } from '@/lib/hooks/useHostedBackendStatus'
import { useOpenAiModels } from '@/lib/hooks/useOpenAiModels'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { CHAT_BACKEND_LABELS, KNOWN_CHAT_PROVIDERS, NOVELAI_MODELS, type ChatBackendId } from '@/lib/api/chatBackend'
import { TextField, SelectField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { Button } from '@/components/ui/Button'
import { toastSuccess } from '@/lib/store/useToastStore'
import { HostedConnectionStatus, STATUS_DOT, STATUS_LABEL } from './HostedConnectionStatus'
import { OpenMayhemSetup } from './OpenMayhemSetup'
import { OpenMayhemModelSelect } from './OpenMayhemModelSelect'
import { isOpenMayhem } from '@/lib/api/openMayhem'

const CHAT_BACKENDS = Object.keys(CHAT_BACKEND_LABELS) as ChatBackendId[]
const BUILTIN_IDS = new Set(BUILTIN_INSTRUCT_TEMPLATES.map((t) => t.id))

/** A quiet disclosure for technical detail most people never need. */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-4 text-xs text-text-muted">
      <summary className="cursor-pointer select-none transition-colors hover:text-text">{summary}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </details>
  )
}

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
  // Hosted backends are checked once per config and on demand, not on a timer, since they can be metered.
  const hostedStatus = useHostedBackendStatus(
    chatBackend !== 'koboldcpp',
    chatBackend === 'novelai' ? 'novelai' : 'openai-compatible',
    chatBackendBaseUrl,
    chatBackendApiKey,
    chatBackendModel,
  )

  // Only nudge when the model clearly implies a builtin format and the active template is itself a builtin.
  const detected = detectedTemplateId ? BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === detectedTemplateId) : undefined
  const templateMismatch =
    detected && BUILTIN_IDS.has(instructTemplateId) && detectedTemplateId !== instructTemplateId ? detected : undefined

  // Derived from the base URL: picking a provider is a convenience fill-in, and editing the address falls back to "Custom".
  const matchedProvider = KNOWN_CHAT_PROVIDERS.find((p) => p.baseUrl === chatBackendBaseUrl)

  const { models: openAiModels, loading: modelsLoading, reload: reloadModels } = useOpenAiModels(
    chatBackendBaseUrl,
    chatBackendApiKey,
    chatBackend === 'openai-compatible',
  )
  const [typeModel, setTypeModel] = useState(false)
  const useModelList = openAiModels && openAiModels.length > 0 && !typeModel

  return (
    <SettingsPage>
      <Section
        title="Where replies come from"
        description="Pick the model that writes replies. Run one on your own computer, or connect a hosted provider with an API key."
      >
        <SelectField
          label="Model source"
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
            {isOpenMayhem(chatBackendBaseUrl) && <OpenMayhemSetup />}
            <TextField
              label="Address"
              value={chatBackendBaseUrl}
              onChange={(e) => setChatBackendConfig({ chatBackendBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
            <TextField
              label="API key"
              type="password"
              value={chatBackendApiKey}
              onChange={(e) => setChatBackendConfig({ chatBackendApiKey: e.target.value })}
              hint="Stored in this browser and only sent to the address above."
            />
            {isOpenMayhem(chatBackendBaseUrl) ? (
              <OpenMayhemModelSelect models={openAiModels} loading={modelsLoading} value={chatBackendModel}
                onChange={(model) => setChatBackendConfig({ chatBackendModel: model })} />
            ) : useModelList ? (
              <SelectField
                label="Model"
                value={openAiModels.includes(chatBackendModel) ? chatBackendModel : ''}
                onChange={(e) => {
                  if (e.target.value === '__type__') return setTypeModel(true)
                  setChatBackendConfig({ chatBackendModel: e.target.value })
                }}
                hint={`${openAiModels.length} model${openAiModels.length === 1 ? '' : 's'} available. Not listed? Choose "Type it in".`}
              >
                {!openAiModels.includes(chatBackendModel) && <option value="">Choose a model…</option>}
                {openAiModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__type__">Type it in…</option>
              </SelectField>
            ) : (
              <TextField
                label="Model"
                value={chatBackendModel}
                onChange={(e) => setChatBackendConfig({ chatBackendModel: e.target.value })}
                placeholder={matchedProvider ? `e.g. ${matchedProvider.modelExample}` : 'e.g. gpt-4o-mini'}
                hint={
                  modelsLoading
                    ? 'Looking up models…'
                    : openAiModels && openAiModels.length > 0
                      ? 'Enter an address and key to pick from the provider’s list.'
                      : 'This provider does not list its models, so enter the model name by hand.'
                }
              />
            )}
            {!isOpenMayhem(chatBackendBaseUrl) && openAiModels && openAiModels.length > 0 && typeModel && (
              <button
                className="mb-3 -mt-1 block text-xs text-accent transition-colors hover:underline"
                onClick={() => setTypeModel(false)}
              >
                Back to the model list
              </button>
            )}
            <HostedConnectionStatus status={hostedStatus.status} detail={hostedStatus.detail} recheck={() => { reloadModels(); hostedStatus.recheck() }} />
            <More summary="About hosted models">
              <p>
                {isOpenMayhem(chatBackendBaseUrl)
                  ? 'OpenMayhem requests pass through this app’s server, which forwards your key without saving it.'
                  : 'Requests go straight from your browser to the address above.'}
              </p>
              <p>
                Token counts are estimated for hosted models, and the context size comes from the provider’s model list when it has one. Temperature, top P and similar settings for hosted models are under Settings, Generation.
              </p>
            </More>
          </>
        )}

        {chatBackend === 'novelai' && (
          <>
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
              hint="From your NovelAI account settings, not your login password."
            />
            <HostedConnectionStatus status={hostedStatus.status} detail={hostedStatus.detail} recheck={hostedStatus.recheck} />
            <More summary="About NovelAI">
              <p>NovelAI is a paid, hosted service. Your key stays in this browser. Requests pass through {BRAND.name}'s own server, which forwards them to NovelAI and stores nothing.</p>
              <p>Erato, Kayra and Clio are supported. Sampler settings come from the KoboldCpp sampler under Settings, Generation. Stop sequences are applied here when the model has no tokenizer for NovelAI's own stop handling.</p>
            </More>
          </>
        )}
      </Section>

      <Section
        title="Local model (KoboldCpp)"
        description="Used when the source above is KoboldCpp. Hosted models also reuse its sampler and chat-format settings."
      >
        <TextField
          label="Server address"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setBaseUrl(draft)}
          placeholder="http://localhost:5001"
        />
        <div className="rounded-xl bg-bg-sunken p-4 text-xs">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-sm text-text">{STATUS_LABEL[status]}</span>
          </div>
          {model && <div className="mt-1.5 text-text-muted">Model: {model}</div>}
          {version && <div className="text-text-muted">KoboldCpp {version}</div>}
          {maxContext !== null && <div className="text-text-muted">Context: {maxContext.toLocaleString()} tokens</div>}
          {status === 'offline' && (
            <p className="mt-2 leading-relaxed text-text-muted">
              Start KoboldCpp and check the address above. If it runs on another computer, launch it with <code>--host 0.0.0.0</code>.
            </p>
          )}
        </div>

        {templateMismatch && (
          <div className="mt-4 rounded-xl bg-warning/10 p-4 text-xs">
            <p className="leading-relaxed text-text">
              This model looks like it uses the <strong>{templateMismatch.name}</strong> chat format, but{' '}
              <strong>{BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === instructTemplateId)?.name ?? instructTemplateId}</strong> is selected. A
              mismatch is the usual cause of rambling, ignored characters and replies that never stop.
            </p>
            <div className="mt-2.5">
              <Button
                variant="primary"
                onClick={() => {
                  setInstructTemplateId(templateMismatch.id)
                  toastSuccess(`Chat format set to ${templateMismatch.name}`)
                }}
              >
                Switch to {templateMismatch.name}
              </Button>
            </div>
          </div>
        )}

        <More summary="Make long chats cheaper on the GPU">
          <p>
            The app keeps the start of every prompt identical so KoboldCpp only reads what is new. Launch it with <code>--smartcache 6</code> so it keeps a separate cache for the chat while background checks run.
          </p>
          <p>The line under each reply shows whether the cache was reused or the whole prompt was re-read.</p>
        </More>
      </Section>
    </SettingsPage>
  )
}
