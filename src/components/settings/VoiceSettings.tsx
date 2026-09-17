import { useOpenMayhemModels } from '@/lib/hooks/useOpenMayhemModels'
import { OpenMayhemVoiceField } from './OpenMayhemVoiceField'
import { OpenMayhemModelSelect } from './OpenMayhemModelSelect'
import { OpenMayhemMediaKey } from './OpenMayhemMediaKey'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { listKoboldSpeakers, synthesizeSpeech, TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

const PROVIDERS = Object.keys(TTS_PROVIDER_LABELS) as TtsProviderId[]

export function VoiceSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const ttsApiKey = useSettingsStore((s) => s.ttsApiKey)
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)
  const ttsModel = useSettingsStore((s) => s.ttsModel)
  const openMayhemApiKey = useSettingsStore((s) => s.openMayhemApiKey)
  const { models, loading, reload } = useOpenMayhemModels('AUDIO_SPEECH', ttsProvider === 'openmayhem')
  const setVoiceConfig = useSettingsStore((s) => s.setVoiceConfig)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [loadingSpeakers, setLoadingSpeakers] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const testAudioRef = useRef<HTMLAudioElement | null>(null)

  const testControllerRef = useRef<AbortController | null>(null)
  const testUrlRef = useRef<string | null>(null)
  useEffect(() => {
    setTestState('idle')
    return () => {
      testControllerRef.current?.abort()
      testAudioRef.current?.pause()
      if (testUrlRef.current) URL.revokeObjectURL(testUrlRef.current)
    }
  }, [ttsProvider, ttsModel, ttsVoice, ttsApiKey, ttsBaseUrl, ttsRegion, openMayhemApiKey])

  const loadSpeakers = async () => {
    setLoadingSpeakers(true)
    setSpeakers(await listKoboldSpeakers(baseUrl))
    setLoadingSpeakers(false)
  }

  // Round-trips a short line through whichever provider is configured right now and plays the
  // result back — a real synthesis + playback, not just a ping, so a wrong voice ID or a key with
  // no quota left surfaces here instead of the first time a line is read aloud in a scene.
  const testConnection = async () => {
    testAudioRef.current?.pause()
    if (testUrlRef.current) URL.revokeObjectURL(testUrlRef.current)
    const controller = new AbortController()
    testControllerRef.current = controller
    setTestState('loading')
    setTestError('')
    try {
      const blob = await synthesizeSpeech(
        { provider: ttsProvider, apiKey: ttsProvider === 'openmayhem' ? openMayhemApiKey : ttsApiKey, model: ttsModel, baseUrl: ttsBaseUrl, region: ttsRegion, voice: ttsVoice },
        'Testing, one two three.',
        baseUrl,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      testUrlRef.current = url
      const audio = new Audio(url)
      testAudioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setTestError('The browser could not play the generated audio.')
        setTestState('error')
      }
      await audio.play()
      setTestState('ok')
    } catch (e) {
      if (controller.signal.aborted) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) toastError(errorMessage(e))
        return
      }
      if (testUrlRef.current) URL.revokeObjectURL(testUrlRef.current)
      setTestState('error')
      setTestError(errorMessage(e))
    }
  }

  return (
    <SettingsPage>
      <Section
        title="Voice (text-to-speech)"
        description="Read a character's lines aloud from Visual Novel mode. Keys are stored in this browser. OpenMayhem uses RP Suite's local relay; other providers are contacted directly."
      >
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Provider</span>
            <select
              value={ttsProvider}
              onChange={(e) => {
                setVoiceConfig({ ttsProvider: e.target.value as TtsProviderId })
                setTestState('idle')
              }}
              className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {TTS_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          {ttsProvider === 'openmayhem' && <>
            <OpenMayhemMediaKey />
            <OpenMayhemModelSelect kind="speech" models={models?.map((m) => m.id) ?? null} loading={loading} value={ttsModel}
              onChange={(model) => setVoiceConfig({ ttsModel: model, ttsVoice: '' })} />
            <Button onClick={reload} disabled={loading}>Refresh models</Button>
            <OpenMayhemVoiceField model={models?.find((m) => m.id === ttsModel)} value={ttsVoice} onChange={(voice) => setVoiceConfig({ ttsVoice: voice })} />
            <p className="my-3 text-xs text-text-muted">Testing and reading lines aloud generate billed speech jobs. Visual Novel mode uses this model and voice; character voice overrides must be supported by this model. Stop requests cancellation; work already done may still be billed.</p>
          </>}

          {ttsProvider === 'koboldcpp' && (
            <>
              <p className="mb-2 text-xs text-text-muted">
                Uses your existing KoboldCpp connection. Needs a TTS-capable model (e.g. OuteTTS, Kokoro)
                loaded there.
              </p>
              <div className="mb-3 flex items-end gap-2">
                <TextField
                  label="Voice"
                  value={ttsVoice}
                  onChange={(e) => setVoiceConfig({ ttsVoice: e.target.value })}
                  placeholder="e.g. a voice name from the list below"
                  className="flex-1"
                  list="kobold-speakers"
                />
                <datalist id="kobold-speakers">
                  {speakers.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Button onClick={loadSpeakers} disabled={loadingSpeakers}>
                  {loadingSpeakers ? 'Loading…' : 'List voices'}
                </Button>
              </div>
            </>
          )}

          {ttsProvider === 'openai-compatible' && (
            <>
              <TextField
                label="Server URL"
                value={ttsBaseUrl}
                onChange={(e) => setVoiceConfig({ ttsBaseUrl: e.target.value })}
                placeholder="e.g. http://localhost:8880 for local Kokoro-FastAPI"
              />
              <TextField
                label="API key (optional)"
                type="password"
                value={ttsApiKey}
                onChange={(e) => setVoiceConfig({ ttsApiKey: e.target.value })}
              />
              <TextField
                label="Voice"
                value={ttsVoice}
                onChange={(e) => setVoiceConfig({ ttsVoice: e.target.value })}
                placeholder="e.g. alloy, or a Kokoro voice id"
              />
            </>
          )}

          {ttsProvider === 'elevenlabs' && (
            <>
              <TextField
                label="API key"
                type="password"
                value={ttsApiKey}
                onChange={(e) => setVoiceConfig({ ttsApiKey: e.target.value })}
              />
              <TextField
                label="Voice ID"
                value={ttsVoice}
                onChange={(e) => setVoiceConfig({ ttsVoice: e.target.value })}
                placeholder="from your ElevenLabs voice library"
              />
            </>
          )}

          {ttsProvider === 'azure' && (
            <>
              <TextField
                label="Subscription key"
                type="password"
                value={ttsApiKey}
                onChange={(e) => setVoiceConfig({ ttsApiKey: e.target.value })}
              />
              <TextField
                label="Region"
                value={ttsRegion}
                onChange={(e) => setVoiceConfig({ ttsRegion: e.target.value })}
                placeholder="e.g. eastus"
              />
              <TextField
                label="Voice name"
                value={ttsVoice}
                onChange={(e) => setVoiceConfig({ ttsVoice: e.target.value })}
                placeholder="e.g. en-US-JennyNeural"
              />
            </>
          )}

          {ttsProvider !== 'alibaba' && (
            <div className="mt-3 flex items-center gap-2.5">
              <Button onClick={testConnection} disabled={testState === 'loading' || ttsProvider === 'openmayhem' && (!openMayhemApiKey.trim() || !models?.some((m) => m.id === ttsModel))} className="flex items-center gap-1.5">
                {testState === 'loading' ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : null}
                {testState === 'loading' ? 'Testing…' : 'Test connection'}
              </Button>
              {testState === 'loading' && <Button onClick={() => { testControllerRef.current?.abort(); setTestState('idle') }}>Stop test</Button>}
              {testState === 'ok' && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 size={14} strokeWidth={2} />
                  It spoke. Connection works.
                </span>
              )}
              {testState === 'error' && (
                <span className="flex items-center gap-1 text-xs text-danger" title={testError}>
                  <XCircle size={14} strokeWidth={2} className="shrink-0" />
                  {testError}
                </span>
              )}
            </div>
          )}

          {ttsProvider === 'alibaba' && (
            <p className="text-xs text-danger">
              Not wired up yet. Model Studio's request format hasn't been confirmed against a live
              account, so this was left honest rather than guessed at. The other four providers work now.
            </p>
          )}
      </Section>

    </SettingsPage>
  )
}
