import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

let useSettingsStore: typeof import('./useSettingsStore')['useSettingsStore']
beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  useSettingsStore = (await import('./useSettingsStore')).useSettingsStore
})
afterAll(() => vi.unstubAllGlobals())

describe('chat provider credentials', () => {
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
