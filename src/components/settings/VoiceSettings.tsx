import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { listKoboldSpeakers, TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'

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

  const loadSpeakers = async () => {
    setLoadingSpeakers(true)
    setSpeakers(await listKoboldSpeakers(baseUrl))
    setLoadingSpeakers(false)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h3 className="mb-1 text-sm font-semibold text-text">Voice — the Companion's mouth</h3>
        <p className="mb-3 text-xs text-text-muted">
          Text-to-speech provider for the Companion view. Keys are stored only in this browser and sent
          directly to the provider you pick — never through any other server.
        </p>
        <div className="rounded-2xl bg-bg-elevated p-6">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-text-muted">Provider</span>
            <select
              value={ttsProvider}
              onChange={(e) => setVoiceConfig({ ttsProvider: e.target.value as TtsProviderId })}
              className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none"
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

          {ttsProvider === 'alibaba' && (
            <p className="text-xs text-danger">
              Not wired up yet — Model Studio's request format hasn't been confirmed against a live
              account, so this was left honest rather than guessed at. The other four providers work now.
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-text">Ears (speech-to-text)</h3>
        <p className="text-xs text-text-muted">
          Uses KoboldCpp's own Whisper endpoint over your existing connection — no separate setup. Launch
          KoboldCpp with a Whisper model loaded (<code className="font-mono">--whispermodel</code>) for the
          Companion's push-to-talk mic to work.
        </p>
      </section>
    </div>
  )
}
