import type { GenerationParams } from '@/lib/api/types'

export const BUILTIN_PRESETS: { name: string; params: Partial<GenerationParams> }[] = [
  {
    name: 'Balanced',
    params: { temperature: 0.9, top_p: 0.95, top_k: 0, min_p: 0.05, rep_pen: 1.08 },
  },
  {
    name: 'Creative Writing',
    params: { temperature: 1.15, top_p: 0.92, top_k: 0, min_p: 0.02, rep_pen: 1.05, rep_pen_range: 3072 },
  },
  {
    name: 'Precise / Deterministic',
    params: { temperature: 0.3, top_p: 1, top_k: 40, min_p: 0.1, rep_pen: 1.15 },
  },
  {
    name: 'Chaotic',
    params: { temperature: 1.6, top_p: 0.98, top_k: 0, min_p: 0, rep_pen: 1.02 },
  },
]
