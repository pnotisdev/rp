import { describe, expect, it } from 'vitest'
import { KNOWN_CHAT_PROVIDERS, CHAT_BACKEND_LABELS } from './chatBackend'

// The provider picker in Settings → Connection and WelcomeView both resolve their selection by
// `KNOWN_CHAT_PROVIDERS.find(p => p.baseUrl === chatBackendBaseUrl)` and by `p.id`, and
// `OpenAICompatibleClient` builds its request URL as `baseUrl + '/chat/completions'` — so a
// duplicate id, a duplicate/trailing-slashed base URL, or a missing field silently breaks the UI.

describe('KNOWN_CHAT_PROVIDERS', () => {
  it('every entry is well-formed: non-empty id/label/modelExample, https base URL with no trailing slash', () => {
    for (const p of KNOWN_CHAT_PROVIDERS) {
      expect(p.id, `id for ${p.label}`).toMatch(/\S/)
      expect(p.label, `label for ${p.id}`).toMatch(/\S/)
      expect(p.modelExample, `modelExample for ${p.id}`).toMatch(/\S/)
      expect(p.baseUrl, `baseUrl for ${p.id}`).toMatch(/^https?:\/\//)
      expect(p.baseUrl, `baseUrl for ${p.id} must not end in a slash`).not.toMatch(/\/$/)
    }
  })

  it('ids and base URLs are unique (the picker matches on both)', () => {
    const ids = KNOWN_CHAT_PROVIDERS.map((p) => p.id)
    const baseUrls = KNOWN_CHAT_PROVIDERS.map((p) => p.baseUrl)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(baseUrls).size).toBe(baseUrls.length)
  })

  it('includes Nano-GPT pointed at its OpenAI-compatible v1 endpoint', () => {
    const nano = KNOWN_CHAT_PROVIDERS.find((p) => p.id === 'nano-gpt')
    expect(nano).toBeDefined()
    expect(nano?.baseUrl).toBe('https://nano-gpt.com/api/v1')
  })
})

describe('CHAT_BACKEND_LABELS', () => {
  it('has a non-empty label for every backend id', () => {
    for (const [id, label] of Object.entries(CHAT_BACKEND_LABELS)) {
      expect(label, `label for ${id}`).toMatch(/\S/)
    }
  })
})
