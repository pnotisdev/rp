// Speech-to-text via KoboldCpp's own OpenAI-compatible Whisper endpoint — reuses the
// app's existing connection, no separate provider/config needed for the "Ears".

export async function transcribeAudio(koboldBaseUrl: string, audio: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', audio, 'speech.webm')
  form.append('model', 'whisper-1')
  const res = await fetch(`${koboldBaseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json().catch(() => null)
  const serverMessage =
    typeof data?.warning === 'string' ? data.warning : typeof data?.error === 'string' ? data.error : null

  if (!res.ok) {
    throw new Error(
      serverMessage ??
        `Transcription failed (${res.status}) — make sure KoboldCpp was launched with a Whisper model loaded.`,
    )
  }
  const text = data?.text
  if (typeof text !== 'string') {
    throw new Error(
      serverMessage ?? 'Transcription returned no text — make sure KoboldCpp was launched with a Whisper model loaded.',
    )
  }
  return text.trim()
}
