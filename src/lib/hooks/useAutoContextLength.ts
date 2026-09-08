import { useEffect } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { KoboldClient } from '@/lib/api/kobold'
import { fetchOpenAiModelContext } from '@/lib/api/detectBackend'

/**
 * Keeps `sampler.max_context_length` matched to whatever the connected model actually supports,
 * while `contextLengthAuto` is on (the default). KoboldCpp reports its real limit directly; a
 * hosted OpenAI-compatible provider sometimes carries it in `/models` metadata. Any manual edit
 * to the field in Settings turns `contextLengthAuto` off and this stops touching it.
 *
 * Mounted once in `App`. A KoboldCpp KV cache is already allocated for its full context at load
 * time, so using all of it costs nothing — the old 8k default just left most of it unused.
 */
export function useAutoContextLength() {
  const auto = useSettingsStore((s) => s.contextLengthAuto)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const chatBackendApiKey = useSettingsStore((s) => s.chatBackendApiKey)
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const setDetectedContextLength = useSettingsStore((s) => s.setDetectedContextLength)

  useEffect(() => {
    if (!auto) return
    let cancelled = false

    async function sync() {
      let detected: number | null = null
      if (chatBackend === 'koboldcpp') {
        const client = new KoboldClient(baseUrl)
        detected = await client.getTrueMaxContextLength().catch(() => client.getMaxContextLength().catch(() => null))
      } else if (chatBackend === 'openai-compatible') {
        detected = await fetchOpenAiModelContext(chatBackendBaseUrl, chatBackendModel, chatBackendApiKey)
      }
      if (!cancelled && typeof detected === 'number' && detected >= 512) {
        setDetectedContextLength(detected)
      }
    }

    sync()
    // Poll only KoboldCpp — it's local and free, and the loaded model can change under the app. A
    // hosted provider is metered and its `/models` size is static per config, so it's fetched once
    // per config change here, the same discipline `useHostedBackendStatus` keeps.
    if (chatBackend !== 'koboldcpp') return () => { cancelled = true }
    const interval = setInterval(sync, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [auto, chatBackend, baseUrl, chatBackendBaseUrl, chatBackendApiKey, chatBackendModel, setDetectedContextLength])
}
