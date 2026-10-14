// Multi-provider text-to-speech.

import { speakOpenMayhem } from '../api/openMayhemMedia'

export type TtsProviderId = 'koboldcpp' | 'openai-compatible' | 'elevenlabs' | 'azure' | 'alibaba' | 'openmayhem'

export interface TtsConfig {
  provider: TtsProviderId
  apiKey?: string
  /** For 'openai-compatible' only — e.g. a local Kokoro-FastAPI server. koboldcpp reuses the app's own connection URL instead. */
  baseUrl?: string
  /** Azure region, e.g. "eastus". */
  region?: string
  voice: string
  model?: string
}

export const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
  openmayhem: 'OpenMayhem (hosted)',
  koboldcpp: 'KoboldCpp (local)',
  'openai-compatible': 'OpenAI-compatible (incl. local Kokoro)',
  elevenlabs: 'ElevenLabs',
  azure: 'Microsoft / Azure Speech',
  alibaba: 'Alibaba Cloud Model Studio',
}

async function speakOpenAiCompatible(baseUrl: string, apiKey: string | undefined, text: string, voice: string): Promise<Blob> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model: 'tts-1', input: text, voice: voice || 'alloy' }),
  })
  if (!res.ok) throw new Error(`TTS request to ${baseUrl} failed (${res.status})`)
  return res.blob()
}

export const ELEVENLABS_MODELS = [
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest, ~75 ms)' },
  { id: 'eleven_v4_turbo', label: 'v4 Turbo (expressive, voices laughs and sighs)' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 (steadiest for long text)' },
]
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5'

/** Models that read inline audio tags like [laughs] instead of saying them. */
export function supportsAudioTags(provider: TtsProviderId, model?: string): boolean {
  return provider === 'elevenlabs' && /^eleven_v[34]/.test(model ?? '')
}

async function speakElevenLabs(apiKey: string, voiceId: string, text: string, model: string, signal?: AbortSignal): Promise<Blob> {
  if (!apiKey) throw new Error('ElevenLabs needs an API key (Settings → Voice)')
  if (!voiceId) throw new Error('ElevenLabs needs a voice ID (Settings → Voice)')
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: model || DEFAULT_ELEVENLABS_MODEL }),
    signal,
  })
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status})`)
  return res.blob()
}

/** The voices in this ElevenLabs account, for the Settings picker. */
export async function listElevenLabsVoices(apiKey: string): Promise<{ id: string; name: string }[]> {
  if (!apiKey.trim()) return []
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey.trim() } })
  if (!res.ok) throw new Error(`Couldn't load ElevenLabs voices (${res.status})`)
  const data = (await res.json().catch(() => null)) as { voices?: { voice_id?: string; name?: string }[] } | null
  return (data?.voices ?? []).filter((v) => v.voice_id).map((v) => ({ id: v.voice_id!, name: v.name ?? v.voice_id! }))
}

function escapeSsml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function speakAzure(apiKey: string, region: string, voiceName: string, text: string): Promise<Blob> {
  if (!apiKey || !region) throw new Error('Azure Speech needs a subscription key and region (Settings → Voice)')
  const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voiceName || 'en-US-JennyNeural'}">${escapeSsml(text)}</voice></speak>`
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'Ocp-Apim-Subscription-Key': apiKey,
      'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3',
    },
    body: ssml,
  })
  if (!res.ok) throw new Error(`Azure Speech TTS failed (${res.status})`)
  return res.blob()
}

/** Synthesizes speech for the given text using whichever provider is configured. */
export async function synthesizeSpeech(config: TtsConfig, text: string, koboldBaseUrl: string, signal?: AbortSignal): Promise<Blob> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Nothing to speak')
  // A pasted key/id/region with a trailing space or newline is a common, silent cause of a 401
  const apiKey = config.apiKey?.trim()
  const voice = config.voice?.trim() ?? ''
  const baseUrl = config.baseUrl?.trim()
  const region = config.region?.trim()

  switch (config.provider) {
    case 'openmayhem':
      return speakOpenMayhem(apiKey || '', config.model || '', trimmed, voice, signal)
    case 'koboldcpp':
      return speakOpenAiCompatible(koboldBaseUrl, undefined, trimmed, voice)
    case 'openai-compatible':
      if (!baseUrl) throw new Error('Set a server URL for the OpenAI-compatible provider (Settings → Voice)')
      return speakOpenAiCompatible(baseUrl, apiKey, trimmed, voice)
    case 'elevenlabs':
      return speakElevenLabs(apiKey ?? '', voice, trimmed, config.model ?? '', signal)
    case 'azure':
      return speakAzure(apiKey ?? '', region ?? '', voice, trimmed)
    case 'alibaba':
      // DashScope's TTS request/response shape hasn't been confirmed against a live account
      throw new Error('Alibaba Cloud Model Studio isn\'t wired up yet. The other providers are ready to use.')
  }
}

/** Voices available for the local koboldcpp TTS model, if one is loaded. */
export async function listKoboldSpeakers(koboldBaseUrl: string): Promise<string[]> {
  const res = await fetch(`${koboldBaseUrl.replace(/\/+$/, '')}/api/extra/speakers_list`)
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as { speakers?: { name?: string }[] } | null
  return Array.isArray(data?.speakers) ? data.speakers.map((s) => s.name).filter((n): n is string => !!n) : []
}
