import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_COMPLETION_SAMPLER } from '@/lib/api/types'
import { profileFieldsOf, profileMatches, upsertProfile, type ProfileFields } from './connectionProfiles'

const state = (over: Partial<ProfileFields> = {}): ProfileFields => ({
  baseUrl: 'http://localhost:5001',
  chatBackend: 'koboldcpp',
  chatBackendBaseUrl: '',
  chatBackendApiKey: '',
  chatBackendModel: '',
  instructTemplateId: 'gemma4',
  sampler: { max_context_length: 8192, max_length: 512, temperature: 0.9, top_p: 1, top_k: 0, min_p: 0.05, typical: 1, tfs: 1, rep_pen: 1.08, rep_pen_range: 2048, rep_pen_slope: 0.7 },
  chatCompletionSampler: DEFAULT_CHAT_COMPLETION_SAMPLER,
  reasoningTokenReserve: 0,
  reasoningPrefix: '',
  reasoningSuffix: '',
  ...over,
})

let n = 0
const id = () => `id-${++n}`

describe('connection profiles', () => {
  it('keeps only the profile fields, as a copy', () => {
    const live = { ...state(), unrelated: 'x' } as ProfileFields
    const copy = profileFieldsOf(live)
    expect(copy).not.toHaveProperty('unrelated')
    live.sampler.temperature = 2
    expect(copy.sampler.temperature).toBe(0.9)
  })

  it('adds a profile and finds it again by value', () => {
    const list = upsertProfile([], '  Local Gemma ', state(), id)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Local Gemma')
    expect(profileMatches(list[0], state())).toBe(true)
    expect(profileMatches(list[0], state({ instructTemplateId: 'chatml' }))).toBe(false)
    expect(profileMatches(list[0], state({ sampler: { ...state().sampler, temperature: 1 } }))).toBe(false)
  })

  it('replaces a profile saved under the same name and keeps its id', () => {
    const first = upsertProfile([], 'Main', state(), id)
    const second = upsertProfile(first, 'main', state({ chatBackendModel: 'qwen' }), id)
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe(first[0].id)
    expect(second[0].chatBackendModel).toBe('qwen')
  })

  it('ignores a blank name', () => {
    expect(upsertProfile([], '   ', state(), id)).toEqual([])
  })

  it('keeps separate profiles for separate names', () => {
    const list = upsertProfile(upsertProfile([], 'A', state(), id), 'B', state({ chatBackend: 'openai-compatible' }), id)
    expect(list.map((p) => p.name)).toEqual(['A', 'B'])
    expect(list[1].chatBackend).toBe('openai-compatible')
  })
})
