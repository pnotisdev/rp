// Text <-> sampler field conversions for the advanced Generation panel, and SillyTavern sampler preset import.

import type { GenerationParams } from '@/lib/api/types'

/** One entry per line or comma, blanks dropped. */
export function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Lines of `tokenId: bias`. A bias is clamped to -100..100; lines that do not parse are dropped. */
export function parseLogitBias(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s*[:=,]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line)
    if (m) out[m[1]] = Math.max(-100, Math.min(100, Number(m[2])))
  }
  return out
}

export const formatLogitBias = (bias: Record<string, number> | undefined): string =>
  Object.entries(bias ?? {})
    .map(([id, v]) => `${id}: ${v}`)
    .join('\n')

/** Comma-separated sampler ids, e.g. `6, 0, 1, 3, 4, 2, 5`. Returns undefined for an empty or unreadable list. */
export function parseSamplerOrder(text: string): number[] | undefined {
  const ids = parseList(text).map(Number)
  return ids.length && ids.every((n) => Number.isInteger(n) && n >= 0) ? ids : undefined
}

/** DRY sequence breakers as a JSON array of strings, or a plain comma list. */
export function parseBreakers(text: string): string[] | undefined {
  const t = text.trim()
  if (!t) return undefined
  try {
    const parsed = JSON.parse(t)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // Not JSON: treat it as a comma list below.
  }
  return parseList(t)
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** A SillyTavern sampler preset (the KoboldAI and text-completion kinds) as this app's sampler fields. Fields it does not name stay out. */
export function stSamplerToParams(raw: unknown): Partial<GenerationParams> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!('temp' in o) && !('temperature' in o) && !('rep_pen' in o) && !('sampler_order' in o)) return null
  const out: Partial<GenerationParams> = {}
  const set = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K] | undefined) => {
    if (value !== undefined) out[key] = value
  }
  set('temperature', num(o.temp) ?? num(o.temperature))
  set('top_p', num(o.top_p))
  set('top_k', num(o.top_k))
  set('top_a', num(o.top_a))
  set('min_p', num(o.min_p))
  set('typical', num(o.typical) ?? num(o.typical_p))
  set('tfs', num(o.tfs))
  set('rep_pen', num(o.rep_pen))
  set('rep_pen_range', num(o.rep_pen_range))
  set('rep_pen_slope', num(o.rep_pen_slope))
  set('presence_penalty', num(o.presence_pen))
  set('mirostat', num(o.mirostat) ?? num(o.mirostat_mode))
  set('mirostat_tau', num(o.mirostat_tau))
  set('mirostat_eta', num(o.mirostat_eta))
  set('dry_multiplier', num(o.dry_multiplier))
  set('dry_base', num(o.dry_base))
  set('dry_allowed_length', num(o.dry_allowed_length))
  set('xtc_threshold', num(o.xtc_threshold))
  set('xtc_probability', num(o.xtc_probability))
  set('smoothing_factor', num(o.smoothing_factor))
  set('nsigma', num(o.nsigma))
  set('guidance_scale', num(o.guidance_scale))
  if (Array.isArray(o.sampler_order) && o.sampler_order.every((n) => typeof n === 'number')) set('sampler_order', o.sampler_order as number[])
  if (typeof o.grammar_string === 'string' && o.grammar_string.trim()) set('grammar', o.grammar_string)
  else if (typeof o.grammar === 'string' && o.grammar.trim()) set('grammar', o.grammar)
  if (typeof o.negative_prompt === 'string' && o.negative_prompt.trim()) set('negative_prompt', o.negative_prompt)
  if (typeof o.dry_sequence_breakers === 'string') set('dry_sequence_breakers', parseBreakers(o.dry_sequence_breakers))
  else if (Array.isArray(o.dry_sequence_breakers)) set('dry_sequence_breakers', o.dry_sequence_breakers.map(String))
  // ST keeps dynamic temperature as an on/off flag plus a min and max; the server wants a ± range.
  if (o.dynatemp === true) {
    const min = num(o.min_temp)
    const max = num(o.max_temp)
    if (min !== undefined && max !== undefined && max > min) set('dynatemp_range', (max - min) / 2)
    set('dynatemp_exponent', num(o.dynatemp_exponent))
  } else if (o.dynatemp === false) set('dynatemp_range', 0)
  if (Array.isArray(o.banned_tokens) && o.banned_tokens.length) set('banned_tokens', o.banned_tokens.map(String))
  else if (typeof o.banned_tokens === 'string' && o.banned_tokens.trim()) set('banned_tokens', parseList(o.banned_tokens))
  if (o.logit_bias && typeof o.logit_bias === 'object' && !Array.isArray(o.logit_bias)) {
    const bias = Object.fromEntries(Object.entries(o.logit_bias as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'number' ? [[k, v]] : [])))
    if (Object.keys(bias).length) set('logit_bias', bias)
  }
  return out
}
