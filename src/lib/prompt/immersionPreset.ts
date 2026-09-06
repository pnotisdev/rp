/**
 * "Maximum Immersion" — a single opinionated bundle over settings this app already has, applied by
 * `CharacterEditor.tsx`'s "Apply Maximum Immersion" button. Pure curation: system prompt, sampler
 * preset, slow-burn pacing, and VN mode, all already-existing pieces from `systemPrompts.ts`,
 * `builtinPresets.ts`, and the settings store — nothing new is invented.
 */

import { BUILTIN_PRESETS } from './builtinPresets'
import { BUILTIN_SYSTEM_PROMPTS } from './systemPrompts'
import type { GenerationParams } from '@/lib/api/types'
import type { WorldTemplateId } from '@/lib/world/worldTemplates'

export const MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID = 'immersive'
export const MAXIMUM_IMMERSION_SAMPLER_PRESET_ID = 'creative'
export const MAXIMUM_IMMERSION_WORLD_TEMPLATE_ID: WorldTemplateId = 'dating_sim'

function findOrThrow<T extends { id: string }>(list: T[], id: string): T {
  const found = list.find((x) => x.id === id)
  if (!found) throw new Error(`immersionPreset: missing built-in entry "${id}"`)
  return found
}

/** The full "Immersive, no meta" system-prompt text, for a character-level `system_prompt` override. */
export function maximumImmersionSystemPrompt(): string {
  return findOrThrow(BUILTIN_SYSTEM_PROMPTS, MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID).prompt
}

/** The "Creative" sampler preset's fields, ready to merge via the settings store's `setSampler(patch)`. */
export function maximumImmersionSamplerParams(): Partial<GenerationParams> {
  return findOrThrow(BUILTIN_PRESETS, MAXIMUM_IMMERSION_SAMPLER_PRESET_ID).params
}

export interface MaximumImmersionBundleItem {
  label: string
  detail: string
}

/** Checklist of what applying the bundle does (`applied`) vs. still recommends doing manually (`recommended`). */
export function maximumImmersionChecklist(): { applied: MaximumImmersionBundleItem[]; recommended: MaximumImmersionBundleItem[] } {
  return {
    applied: [
      {
        label: 'System prompt (this character)',
        detail: `"${findOrThrow(BUILTIN_SYSTEM_PROMPTS, MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID).name}" — strict immersion, no narration slips or out-of-character asides.`,
      },
      {
        label: 'Sampler preset (global)',
        detail: `"${findOrThrow(BUILTIN_PRESETS, MAXIMUM_IMMERSION_SAMPLER_PRESET_ID).name}" — wider vocabulary and phrasing for prose-heavy scenes.`,
      },
      { label: 'Slow-burn pacing (global)', detail: 'Turned on — affection and intimacy earn out over time rather than rushing.' },
      { label: 'Visual novel mode (global)', detail: 'Turned on — full-bleed scene presentation with background, sprite, and dialogue box.' },
    ],
    recommended: [
      {
        label: 'World template',
        detail: 'Bind this character to a "Dating Sim" world (Worlds → Content rating) for the full mechanic set — gifts, relationship thresholds, scene flags, the world clock.',
      },
      {
        label: 'Intimacy detail',
        detail: "A per-world content-rating choice on purpose — set it deliberately in that world's own settings rather than having a button change it for you.",
      },
    ],
  }
}
