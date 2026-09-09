import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

let useSettingsStore: typeof import('./useSettingsStore')['useSettingsStore']
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  useSettingsStore = (await import('./useSettingsStore')).useSettingsStore
})
afterAll(() => vi.unstubAllGlobals())

describe('chat provider credentials', () => {
  it('isolates shared OpenMayhem media credentials when switching image and speech providers', () => {
    const s = useSettingsStore.getState()
    s.setOpenMayhemApiKey('media-secret')
    s.setVoiceConfig({ ttsProvider: 'elevenlabs', ttsApiKey: 'eleven-secret', ttsVoice: 'old-voice' })
    s.setVoiceConfig({ ttsProvider: 'openmayhem' })
    expect(useSettingsStore.getState()).toMatchObject({ ttsApiKey: '', ttsVoice: '', openMayhemApiKey: 'media-secret' })
    s.setVoiceConfig({ ttsModel: 'speech/model' })
    s.setImageBackendConfig({ imageBackend: 'novelai-image', imageBackendUsername: 'novel-secret', imageBackendModel: 'old-image' })
    s.setImageBackendConfig({ imageBackend: 'openmayhem' })
    expect(useSettingsStore.getState()).toMatchObject({ imageBackendUsername: '', imageBackendPassword: '', imageBackendModel: '', ttsModel: 'speech/model', openMayhemApiKey: 'media-secret' })
    s.setVoiceConfig({ ttsProvider: 'openai-compatible' })
    expect(useSettingsStore.getState()).toMatchObject({ ttsApiKey: '', ttsModel: '', openMayhemApiKey: 'media-secret' })
  })
  it('clears the old key and model when entering and leaving OpenMayhem', () => {
    const set = useSettingsStore.getState().setChatBackendConfig
    set({ chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://example.test/v1', chatBackendApiKey: 'old-secret', chatBackendModel: 'old-model' })
    set({ chatBackendBaseUrl: 'https://api.openmayhem.ai/v1' })
    expect(useSettingsStore.getState()).toMatchObject({ chatBackendApiKey: '', chatBackendModel: '' })
    set({ chatBackendApiKey: 'mayhem-secret', chatBackendModel: 'example/chat' })
    set({ chatBackendBaseUrl: 'https://example.test/v1' })
    expect(useSettingsStore.getState()).toMatchObject({ chatBackendApiKey: '', chatBackendModel: '' })
  })
  it('keeps credentials when choosing a different model on the same provider', () => {
    const set = useSettingsStore.getState().setChatBackendConfig
    set({ chatBackendBaseUrl: 'https://api.openmayhem.ai/v1', chatBackendApiKey: 'mayhem-secret', chatBackendModel: 'one' })
    set({ chatBackendModel: 'two' })
    expect(useSettingsStore.getState()).toMatchObject({ chatBackendApiKey: 'mayhem-secret', chatBackendModel: 'two' })
  })
})
