/**
 * "Maximum Immersion" — a single opinionated bundle over settings this app already has, for an
 * author who wants the deepest, most immersive setup available without having to already know
 * which system-prompt preset reads as most immersive, which world template carries the full
 * mechanic set, or that slow-burn pacing and VN presentation are worth turning on together. Pure
 * curation: every piece named here already exists (`systemPrompts.ts`, `builtinPresets.ts`,
 * `worldTemplates.ts`, the settings store's own `slowBurnPacing`/`visualNovelMode`), nothing new is
 * invented.
 *
 * Deliberately not a fifth `WorldTemplateId` (`worldTemplates.ts`'s own union is a narrow enum
 * threaded through `WorldCard.template`/`types.ts`, a reserved file this pass doesn't touch, and
 * a new id would need every switch over that type updated too) and deliberately not a global
 * "profile" setting either. Instead this is a bundle a caller applies in one action: a
 * character-level `system_prompt` override (travels with the character, needs no reserved-file
 * change) plus the small set of *global* dials that only exist in Settings
 * (`useSettingsStore.ts` — not reserved, just shared; only its already-exported setters are
 * called, never its file). `CharacterEditor.tsx`'s "Apply Maximum Immersion" button is the one
 * concrete surface for this today; see that file's Advanced tab for the wiring.
 */

import { BUILTIN_PRESETS } from './builtinPresets'
import { BUILTIN_SYSTEM_PROMPTS } from './systemPrompts'
import type { GenerationParams } from '@/lib/api/types'
import type { WorldTemplateId } from '@/lib/world/worldTemplates'

/** "Immersive, no meta" — of the ten built-in system prompts, the one whose entire premise is
 *  strict character immersion (no narration slips, no out-of-character asides), which is exactly
 *  what "maximum immersion" means for the block that governs how every reply gets written. */
export const MAXIMUM_IMMERSION_SYSTEM_PROMPT_ID = 'immersive'

/** "Creative" — wider vocabulary and more varied phrasing while staying coherent, the sampler
 *  preset whose own `use` line calls out prose-heavy scenes specifically. */
export const MAXIMUM_IMMERSION_SAMPLER_PRESET_ID = 'creative'

/** "Dating Sim" — the one world template that keeps every mechanic (gifts, relationship
 *  thresholds, scene flags, the world clock) rather than deliberately dropping some of them. */
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

/** The "Creative" sampler preset's opinionated fields, ready to merge via the settings store's own
 *  `setSampler(patch)` (a `Partial<GenerationParams>` merge — the exact shape every preset chip in
 *  Settings already applies). */
export function maximumImmersionSamplerParams(): Partial<GenerationParams> {
  return findOrThrow(BUILTIN_PRESETS, MAXIMUM_IMMERSION_SAMPLER_PRESET_ID).params
}

export interface MaximumImmersionBundleItem {
  label: string
  detail: string
}

/**
 * A human-readable checklist of what applying the bundle does/recommends — mirrors
 * `GenerateCharacterDialog`'s own per-stage checklist UI (glyph + label), the established pattern
 * for "here's what this one action is about to do" in this codebase. Split into `applied` (this
 * action changes it directly) and `recommended` (named so the author knows to do it themselves,
 * reachable only from screens this pass doesn't own — the world editor's own template picker).
 */
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
