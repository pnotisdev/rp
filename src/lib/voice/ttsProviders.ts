// Multi-provider text-to-speech. Every provider returns a playable audio Blob from
// plain text — the Companion view doesn't need to know which one is behind it.

export type TtsProviderId = 'koboldcpp' | 'openai-compatible' | 'elevenlabs' | 'azure' | 'alibaba'

export interface TtsConfig {
  provider: TtsProviderId
  apiKey?: string
  /** For 'openai-compatible' only — e.g. a local Kokoro-FastAPI server. koboldcpp reuses the app's own connection URL instead. */
  baseUrl?: string
  /** Azure region, e.g. "eastus". */
  region?: string
  voice: string
}

export const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
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

async function speakElevenLabs(apiKey: string, voiceId: string, text: string): Promise<Blob> {
  if (!apiKey) throw new Error('ElevenLabs needs an API key (Settings → Voice)')
  if (!voiceId) throw new Error('ElevenLabs needs a voice ID (Settings → Voice)')
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  })
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status})`)
  return res.blob()
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

/**
 * Synthesizes speech for the given text using whichever provider is configured.
 * `koboldBaseUrl` is the app's own KoboldCpp connection URL (Settings → Connection) —
 * koboldcpp exposes an OpenAI-compatible /v1/audio/speech endpoint, so the local
 * provider is just the same call pointed at that URL with no API key.
 */
export async function synthesizeSpeech(config: TtsConfig, text: string, koboldBaseUrl: string): Promise<Blob> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Nothing to speak')

  switch (config.provider) {
    case 'koboldcpp':
      return speakOpenAiCompatible(koboldBaseUrl, undefined, trimmed, config.voice)
    case 'openai-compatible':
      if (!config.baseUrl) throw new Error('Set a server URL for the OpenAI-compatible provider (Settings → Voice)')
      return speakOpenAiCompatible(config.baseUrl, config.apiKey, trimmed, config.voice)
    case 'elevenlabs':
      return speakElevenLabs(config.apiKey ?? '', config.voice, trimmed)
    case 'azure':
      return speakAzure(config.apiKey ?? '', config.region ?? '', config.voice, trimmed)
    case 'alibaba':
      // DashScope's TTS request/response shape hasn't been confirmed against a live account —
      // rather than guess at an API contract, this is left honestly unimplemented.
      throw new Error('Alibaba Cloud Model Studio isn\'t wired up yet — the other providers are ready to use.')
  }
}

/** Voices available for the local koboldcpp TTS model, if one is loaded. */
export async function listKoboldSpeakers(koboldBaseUrl: string): Promise<string[]> {
  const res = await fetch(`${koboldBaseUrl.replace(/\/+$/, '')}/api/extra/speakers_list`)
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as { speakers?: { name?: string }[] } | null
  return Array.isArray(data?.speakers) ? data.speakers.map((s) => s.name).filter((n): n is string => !!n) : []
}
