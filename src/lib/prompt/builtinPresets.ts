import type { GenerationParams } from '@/lib/api/types'

export interface SamplerPreset {
  id: string
  name: string
  /** One line on the feel and when to reach for it. */
  use: string
  /** Only the fields this preset opinionates; merged over whatever's already set. */
  params: Partial<GenerationParams>
}

/**
 * Starting points for the sampler, picked in Settings -> Generation. Each one only sets the
 * handful of fields it actually has an opinion about, so applying one leaves max context, stop
 * sequences, and anything else you tuned by hand alone.
 */
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
]
