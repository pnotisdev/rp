import type { GenerationParams } from '@/lib/api/types'

export interface SamplerPreset {
  id: string
  name: string
  /** One line on the feel and when to reach for it. */
  use: string
  /** Only the fields this preset opinionates; merged over whatever's already set. */
  params: Partial<GenerationParams>
}

/** Starting points for the sampler, picked in Settings -> Generation. */
export const BUILTIN_PRESETS: SamplerPreset[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    use: 'A sensible all-round default for roleplay. Start here.',
    params: { temperature: 0.9, top_p: 1, top_k: 0, min_p: 0.05, typical: 1, rep_pen: 1.08, rep_pen_range: 2048 },
  },
  {
    id: 'precise',
    name: 'Precise',
    use: 'Tight and predictable. Follows instructions closely, rarely surprises you.',
    params: { temperature: 0.4, top_p: 1, top_k: 40, min_p: 0.1, typical: 1, rep_pen: 1.12, rep_pen_range: 2048 },
  },
  {
    id: 'creative',
    name: 'Creative',
    use: 'Wider vocabulary and more varied phrasing, still coherent. Good for prose-heavy scenes.',
    params: { temperature: 1.1, top_p: 0.98, top_k: 0, min_p: 0.03, typical: 1, rep_pen: 1.05, rep_pen_range: 3072 },
  },
  {
    id: 'wild',
    name: 'Wild',
    use: 'High variance. Unpredictable and occasionally incoherent. For when a scene has gone stale.',
    params: { temperature: 1.6, top_p: 0.98, top_k: 0, min_p: 0.02, typical: 1, rep_pen: 1.03, rep_pen_range: 2048 },
  },
  {
    id: 'smooth',
    name: 'Smooth',
    use: 'Low temperature held together by min-p. Steady, readable, few weird word choices.',
    params: { temperature: 0.7, top_p: 1, top_k: 0, min_p: 0.08, typical: 1, rep_pen: 1.1, rep_pen_range: 2048 },
  },
  {
    id: 'anti-loop',
    name: 'Anti-repetition (DRY)',
    use: 'For a model or chat that keeps looping the same phrases. Uses the DRY sampler.',
    params: {
      temperature: 0.95,
      top_p: 1,
      top_k: 0,
      min_p: 0.05,
      typical: 1,
      rep_pen: 1.05,
      rep_pen_range: 2048,
      dry_multiplier: 0.8,
      dry_base: 1.75,
      dry_allowed_length: 2,
    },
  },
  {
    id: 'long-form',
    name: 'Long-form',
    use: 'Bigger replies with a wider repetition window. For scene-setting and description.',
    params: {
      max_length: 600,
      temperature: 1,
      top_p: 0.98,
      top_k: 0,
      min_p: 0.04,
      typical: 1,
      rep_pen: 1.06,
      rep_pen_range: 4096,
    },
  },
  {
    id: 'snappy',
    name: 'Snappy',
    use: 'Short replies, quick back-and-forth. Pairs well with the Companion-chat system prompt.',
    params: { max_length: 140, temperature: 0.85, top_p: 1, top_k: 0, min_p: 0.06, typical: 1, rep_pen: 1.1 },
  },
  {
    id: 'mirostat',
    name: 'Mirostat',
    use: 'Targets a set surprise level instead of a fixed temperature. Try if the others feel off.',
    params: {
      temperature: 1,
      top_p: 1,
      top_k: 0,
      min_p: 0,
      typical: 1,
      mirostat: 2,
      mirostat_tau: 5,
      mirostat_eta: 0.1,
      rep_pen: 1.05,
    },
  },
  {
    id: 'small-model',
    name: 'Small model',
    use: 'Extra guardrails for weaker or heavily quantized models (7B and under).',
    params: {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.1,
      typical: 1,
      rep_pen: 1.15,
      rep_pen_range: 1024,
      rep_pen_slope: 0.9,
    },
  },

  // SillyTavern's own KoboldAI sampler presets, unchanged (default/content/presets/kobold).
  {
    id: 'st-universal-light',
    name: 'SillyTavern: Universal Light',
    use: 'Temperature 1.25 with min-p 0.1 and no repetition penalty. Light variety.',
    params: { temperature: 1.25, rep_pen: 1, rep_pen_range: 0, rep_pen_slope: 0, top_p: 1, min_p: 0.1, top_a: 0, top_k: 0, typical: 1, tfs: 1, sampler_order: [5, 6, 0, 1, 2, 3, 4], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
  {
    id: 'st-universal-creative',
    name: 'SillyTavern: Universal Creative',
    use: 'Temperature 1.5 with min-p 0.1 holding it together.',
    params: { temperature: 1.5, rep_pen: 1, rep_pen_range: 0, rep_pen_slope: 0, top_p: 1, min_p: 0.1, top_a: 0, top_k: 0, typical: 1, tfs: 1, sampler_order: [5, 6, 0, 1, 2, 3, 4], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
  {
    id: 'st-universal-super-creative',
    name: 'SillyTavern: Universal Super-Creative',
    use: 'Temperature 2 with min-p 0.1. Very varied; the sampler order matters here.',
    params: { temperature: 2, rep_pen: 1, rep_pen_range: 0, rep_pen_slope: 0, top_p: 1, min_p: 0.1, top_a: 0, top_k: 0, typical: 1, tfs: 1, sampler_order: [5, 6, 0, 1, 2, 3, 4], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
  {
    id: 'st-recovered-ruins',
    name: 'SillyTavern: Recovered Ruins',
    use: 'Temperature 1, top-p 0.95, a mild repetition penalty over 600 tokens.',
    params: { temperature: 1, rep_pen: 1.1, rep_pen_range: 600, rep_pen_slope: 0, top_p: 0.95, min_p: 0.01, top_a: 0, top_k: 0, typical: 1, tfs: 1, sampler_order: [6, 0, 1, 2, 3, 4, 5], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
  {
    id: 'st-neutral',
    name: 'SillyTavern: Neutral',
    use: 'Every sampler off at temperature 1: the model exactly as it is.',
    params: { temperature: 1, rep_pen: 1, rep_pen_range: 0, rep_pen_slope: 0, top_p: 1, min_p: 0, top_a: 0, top_k: 0, typical: 1, tfs: 1, sampler_order: [6, 0, 1, 3, 4, 2, 5], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
  {
    id: 'st-deterministic',
    name: 'SillyTavern: Deterministic',
    use: 'Always the most likely token (top-k 1). The same prompt gives the same reply.',
    params: { temperature: 0, rep_pen: 1, rep_pen_range: 0, rep_pen_slope: 0, top_p: 0, min_p: 0, top_a: 0, top_k: 1, typical: 1, tfs: 1, sampler_order: [6, 0, 1, 3, 4, 2, 5], mirostat: 0, mirostat_tau: 5, mirostat_eta: 0.1 },
  },
]
