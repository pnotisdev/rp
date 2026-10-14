// Reads texting bubbles aloud through the configured TTS provider, in order, when auto-voice is on.

import { useCallback, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { speakableBubble } from '@/lib/text/texting'
import type { Character } from '@/lib/characters/cardSpec'
import { enqueueSpeech, setSpeechErrorHandler, stopSpeech } from '@/lib/voice/speechQueue'
import { supportsAudioTags, synthesizeSpeech } from '@/lib/voice/ttsProviders'

export function useBubbleVoice(character: Character | undefined) {
  const enabled = useSettingsStore((s) => s.autoVoiceTexting)
  const ref = useRef(character)
  ref.current = character

  useEffect(() => {
    let lastToast = 0
    setSpeechErrorHandler((e) => {
      if (Date.now() - lastToast < 10_000) return
      lastToast = Date.now()
      toastError(`Voice: ${errorMessage(e)}`)
    })
    return () => {
      setSpeechErrorHandler(null)
      stopSpeech()
    }
  }, [])

  useEffect(() => {
    if (!enabled) stopSpeech()
  }, [enabled])

  /** Queues one bubble's speech; a no-op while auto-voice is off. */
  const speakBubble = useCallback((text: string) => {
    // Read at call time so a settings change never re-renders the chat.
    const s = useSettingsStore.getState()
    const c = ref.current
    if (!s.autoVoiceTexting) return
    const provider = c?.voice?.provider ?? s.ttsProvider
    const model = s.ttsModel
    const spoken = speakableBubble(text, { audioTags: supportsAudioTags(provider, model) })
    if (!spoken) return
    enqueueSpeech(spoken, (line, signal) =>
      synthesizeSpeech(
        {
          provider,
          apiKey: provider === 'openmayhem' ? s.openMayhemApiKey : s.ttsApiKey,
          model,
          baseUrl: s.ttsBaseUrl,
          region: s.ttsRegion,
          voice: c?.voice?.voiceId || s.ttsVoice,
        },
        line,
        s.baseUrl,
        signal,
      ),
    )
  }, [])

  return { speakBubble, stopSpeech, voiceOn: enabled }
}
