import { useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { listKoboldSpeakers, synthesizeSpeech, TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { errorMessage } from '@/lib/store/useToastStore'

const PROVIDERS = Object.keys(TTS_PROVIDER_LABELS) as TtsProviderId[]

export function VoiceSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const ttsApiKey = useSettingsStore((s) => s.ttsApiKey)
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)
  const setVoiceConfig = useSettingsStore((s) => s.setVoiceConfig)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [loadingSpeakers, setLoadingSpeakers] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const testAudioRef = useRef<HTMLAudioElement | null>(null)

  const loadSpeakers = async () => {
    setLoadingSpeakers(true)
    setSpeakers(await listKoboldSpeakers(baseUrl))
    setLoadingSpeakers(false)
  }

  // Round-trips a short line through whichever provider is configured right now and plays the
  // result back — a real synthesis + playback, not just a ping, so a wrong voice ID or a key with
  // no quota left surfaces here instead of the first time it's tried from the Companion view.
  const testConnection = async () => {
    testAudioRef.current?.pause()
    setTestState('loading')
    setTestError('')
    try {
      const blob = await synthesizeSpeech(
        { provider: ttsProvider, apiKey: ttsApiKey, baseUrl: ttsBaseUrl, region: ttsRegion, voice: ttsVoice },
        'Testing, one two three.',
        baseUrl,
      )
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      testAudioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      audio.onerror = () => URL.revokeObjectURL(url)
      await audio.play().catch(() => {})
      setTestState('ok')
    } catch (e) {
      setTestState('error')
      setTestError(errorMessage(e))
    }
  }

  return (
    <SettingsPage>
      <Section
        title="Voice — the Companion's mouth"
        description="Text-to-speech provider for the Companion view. Keys are stored only in this browser and sent directly to the provider you pick — never through any other server."
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

          {ttsProvider === 'koboldcpp' && (
            <>
              <p className="mb-2 text-xs text-text-muted">
                Uses your existing KoboldCpp connection — needs a TTS-capable model (e.g. OuteTTS, Kokoro)
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
              <Button onClick={testConnection} disabled={testState === 'loading'} className="flex items-center gap-1.5">
                {testState === 'loading' ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : null}
                {testState === 'loading' ? 'Testing…' : 'Test connection'}
              </Button>
              {testState === 'ok' && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 size={14} strokeWidth={2} />
                  It spoke — connection works.
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
              Not wired up yet — Model Studio's request format hasn't been confirmed against a live
              account, so this was left honest rather than guessed at. The other four providers work now.
            </p>
          )}
      </Section>

      <Section
        title="Ears (speech-to-text)"
        description={
          <>
            Uses KoboldCpp's own Whisper endpoint over your existing connection — no separate setup.
            Launch KoboldCpp with a Whisper model loaded (<code className="font-mono">--whispermodel</code>)
            for the Companion's push-to-talk mic to work.
          </>
        }
        surface="bare"
      />
    </SettingsPage>
  )
}
