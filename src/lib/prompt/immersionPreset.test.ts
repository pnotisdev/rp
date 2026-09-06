import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS } from './builtinPresets'
import { BUILTIN_SYSTEM_PROMPTS } from './systemPrompts'
import {
  MAXIMUM_IMMERSION_SAMPLER_PRESET_ID,
  MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID,
  MAXIMUM_IMMERSION_WORLD_TEMPLATE_ID,
  maximumImmersionChecklist,
  maximumImmersionSamplerParams,
  maximumImmersionSystemPrompt,
} from './immersionPreset'

describe('immersionPreset', () => {
  it('names a system prompt id that actually exists among the built-ins', () => {
    expect(BUILTIN_SYSTEM_PROMPTS.some((p) => p.id === MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID)).toBe(true)
  })

  it('names a sampler preset id that actually exists among the built-ins', () => {
    expect(BUILTIN_PRESETS.some((p) => p.id === MAXIMUM_IMMERSION_SAMPLER_PRESET_ID)).toBe(true)
  })

  it('picks the "dating_sim" world template — the one that keeps every mechanic', () => {
    expect(MAXIMUM_IMMERSION_WORLD_TEMPLATE_ID).toBe('dating_sim')
  })

  it('returns the exact prompt text of the named system-prompt preset', () => {
    const expected = BUILTIN_SYSTEM_PROMPTS.find((p) => p.id === MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID)!.prompt
    expect(maximumImmersionSystemPrompt()).toBe(expected)
  })

  it('returns the exact params object of the named sampler preset', () => {
    const expected = BUILTIN_PRESETS.find((p) => p.id === MAXIMUM_IMMERSION_SAMPLER_PRESET_ID)!.params
    expect(maximumImmersionSamplerParams()).toEqual(expected)
  })

  it('builds a checklist naming both what it applies directly and what it only recommends', () => {
    const { applied, recommended } = maximumImmersionChecklist()
    expect(applied.length).toBeGreaterThan(0)
    expect(recommended.length).toBeGreaterThan(0)
    expect(applied.map((i) => i.label)).toContain('System prompt (this character)')
    expect(recommended.map((i) => i.label)).toContain('World template')
    // Every item is a real label+detail pair, not a placeholder.
    for (const item of [...applied, ...recommended]) {
      expect(item.label.trim()).not.toBe('')
      expect(item.detail.trim()).not.toBe('')
    }
  })
})
