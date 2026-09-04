/**
 * Import SillyTavern's own preset files. ST ships (and its community trades) two kinds this app can
 * use directly:
 *
 *  - **instruct** presets (`input_sequence`, `output_sequence`, `wrap`, `names_behavior`, …) — the
 *    turn-format definition, mapped onto this app's `InstructTemplate`.
 *  - **system-prompt** presets (`content`, `post_history`) — the instruction block text.
 *
 * ST's context, textgen-sampler, NovelAI, and chat-completion presets are a different enough model
 * that they aren't converted here; `parseSillyTavernPreset` returns `{ kind: 'unsupported' }` for
 * them so the caller can say so rather than silently doing nothing.
 *
 * The conversion is intentionally lossy-but-safe: it produces a working template the user can then
 * tweak in the editor, not a byte-perfect replica of ST's prompt assembly (which has first-turn
 * special-casing and alignment messages this app has no equivalent for).
 */

import type { InstructTemplate } from './instructTemplates'

export type ParsedSillyTavernPreset =
  | { kind: 'instruct'; name: string; template: Omit<InstructTemplate, 'id'> }
  | { kind: 'sysprompt'; name: string; prompt: string; postHistory: string }
  | { kind: 'unsupported'; detail: string }
  | null

type Obj = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** ST wraps `{{macro}}`; this app wraps `{macro}` and substitutes only `{name}`. */
function toAppMacros(seq: string): { text: string; hadName: boolean } {
  const hadName = /\{\{\s*(name|char)\s*\}\}/i.test(seq)
  const text = seq.replace(/\{\{\s*(?:name|char)\s*\}\}/gi, '{name}').replace(/\{\{[^}]+\}\}/g, '')
  return { text, hadName }
}

function isForceNames(namesBehavior: unknown): boolean {
  return namesBehavior === 'force' || namesBehavior === 'always' || namesBehavior === true
}

function convertInstruct(o: Obj): { name: string; template: Omit<InstructTemplate, 'id'> } {
  const wrap = o.wrap === true ? '\n' : ''
  const force = isForceNames(o.names_behavior)

  const build = (seqRaw: string, isTurn: boolean): { prefix: string; names: boolean } => {
    const { text, hadName } = toAppMacros(seqRaw)
    const base = text ? text + wrap : ''
    // ST's force-names prepends `{{char}}: ` to the turn *content*; a sequence that already carries
    // `{{name}}` is doing it inside the marker instead. Only one or the other.
    if (isTurn && force && !hadName) return { prefix: `${base}{name}: `, names: true }
    return { prefix: base, names: hadName }
  }

  const user = build(str(o.input_sequence), true)
  const assistant = build(str(o.output_sequence || o.last_output_sequence), true)
  const systemSeq = str(o.story_string_prefix) || str(o.system_sequence)
  const system = build(systemSeq, false)

  const namesInPrompt = user.names || assistant.names || force

  const stopCandidates = [
    str(o.stop_sequence),
    toAppMacros(str(o.input_sequence)).text.trim(),
    toAppMacros(str(o.output_sequence)).text.trim(),
    toAppMacros(str(o.system_sequence)).text.trim(),
  ]
  const stopSequences = [...new Set(stopCandidates.map((s) => s.trim()).filter((s) => s.length >= 2))]

  return {
    name: str(o.name) || 'Imported template',
    template: {
      name: str(o.name) || 'Imported template',
      systemPrefix: system.prefix,
      systemSuffix: str(o.story_string_suffix) || str(o.system_suffix),
      userPrefix: user.prefix,
      userSuffix: str(o.input_suffix),
      assistantPrefix: assistant.prefix,
      assistantSuffix: str(o.output_suffix),
      stopSequences,
      namesInPrompt,
    },
  }
}

export function parseSillyTavernPreset(raw: unknown): ParsedSillyTavernPreset {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Obj

  // System-prompt preset: a `content` string, no turn sequences.
  if (typeof o.content === 'string' && !('input_sequence' in o) && !('output_sequence' in o)) {
    return {
      kind: 'sysprompt',
      name: str(o.name) || 'Imported system prompt',
      prompt: o.content,
      postHistory: str(o.post_history),
    }
  }

  // Instruct preset: has at least one turn sequence.
  if (typeof o.input_sequence === 'string' || typeof o.output_sequence === 'string') {
    const { name, template } = convertInstruct(o)
    return { kind: 'instruct', name, template }
  }

  // Context preset — recognisable but this app's builder owns the story-string layout.
  if (typeof o.story_string === 'string') {
    return { kind: 'unsupported', detail: 'a context/story-string preset (this app builds that block itself)' }
  }
  // textgen / kobold sampler preset.
  if ('temp' in o || 'temperature' in o || 'rep_pen' in o || 'sampler_order' in o) {
    return { kind: 'unsupported', detail: 'a sampler preset (import samplers from Settings → Generation instead)' }
  }
  return { kind: 'unsupported', detail: "an unrecognised preset shape" }
}
