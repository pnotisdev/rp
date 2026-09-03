import type { RegexScript } from '@/lib/types'

export type RegexTarget = 'display' | 'prompt'

/** Compiles a script's pattern once. An invalid pattern returns null (the script is skipped, never throws). */
function compile(script: RegexScript): RegExp | null {
  const flags = new Set(['g', ...(script.flags ?? '').split('')])
  flags.delete('')
  try {
    return new RegExp(script.find, [...flags].join(''))
  } catch {
    return null
  }
}

/** `\n` / `\t` in the replacement field are literal two-character sequences from a text input — turn them into real control characters. */
function unescapeReplacement(replace: string): string {
  return replace.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * Runs every enabled script whose `target` includes `target`, in order, over `text`. Pure and
 * synchronous; a script with a broken pattern is silently skipped so one typo can't blank a
 * message. Returns the input unchanged when nothing applies.
 */
export function applyRegexScripts(text: string, scripts: RegexScript[] | undefined, target: RegexTarget): string {
  if (!text || !scripts?.length) return text
  let out = text
  for (const script of scripts) {
    if (!script.enabled) continue
    if (script.target !== target && script.target !== 'both') continue
    if (!script.find) continue
    const re = compile(script)
    if (!re) continue
    out = out.replace(re, unescapeReplacement(script.replace ?? ''))
  }
  return out
}

/** True when the pattern compiles — used by the editor to flag a bad rule inline. */
export function isValidRegexScript(script: Pick<RegexScript, 'find' | 'flags'>): boolean {
  if (!script.find) return true
  try {
    new RegExp(script.find, script.flags ?? '')
    return true
  } catch {
    return false
  }
}
