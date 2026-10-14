// SillyTavern-compatible macro engine: nested macros, scoped blocks, {{if}}/{{else}}, variables, dice, picks and card, chat, time and instruct values.

import type { CharacterCardData } from './cardSpec'
import type { InstructTemplate } from '@/lib/prompt/instructTemplates'
import { formatDate, hashString, humanDuration, isFalseText, rollDice, seededRandom, variablesFor, type MacroVariables } from './macroSupport'

export interface MacroContext {
  charName: string
  userName: string
  /** Card fields behind {{description}}, {{personality}}, {{scenario}}, {{greeting}} and the rest. */
  card?: Partial<CharacterCardData>
  /** The player's persona text, for {{persona}}. */
  persona?: string
  /** The chat so far, oldest first, for {{lastMessage}} and friends. `at` is a timestamp for {{idleDuration}}. */
  history?: { role: 'user' | 'char'; text: string; at?: number }[]
  /** Other characters in a group chat, besides `charName`. */
  participants?: string[]
  /** Keeps {{pick}} stable and scopes local variables. */
  chatId?: string
  /** Defaults to the stored variables for `chatId`. */
  variables?: MacroVariables & { persist?: () => void }
  model?: string
  generationType?: string
  input?: string
  original?: string
  maxContext?: number
  maxResponse?: number
  systemPrompt?: string
  instruct?: InstructTemplate
  /** World info outlets, for {{outlet::key}}. */
  outlets?: Record<string, string>
  /** Collects words named by {{banned::word}}. */
  banned?: string[]
  hasExtension?: (name: string) => boolean
  random?: () => number
  now?: Date
}

interface Run {
  ctx: MacroContext
  random: () => number
  now: Date
  vars: MacroVariables & { persist?: () => void }
  contentHash: number
  picks: number
}

interface Span {
  start: number
  end: number
  body: string
}

interface Parsed {
  name: string
  args: string[]
  flags: string
  closing?: boolean
  shorthand?: { global: boolean; key: string; rest: string }
}

const TRIM_MARK = '\u0000TRIM\u0000'
/** Macros that take a block as their last argument, and how many arguments they have with it. */
const SCOPED: Record<string, number> = { if: 2, trim: 1, reverse: 1, setvar: 2, setglobalvar: 2, addvar: 2, addglobalvar: 2 }

/** Index of the `}}` closing the macro that opens at `from`, or -1. Nested macros are skipped. */
function matchEnd(text: string, from: number): number {
  let depth = 0
  for (let i = from + 2; i < text.length; i += 1) {
    if (text.startsWith('{{', i)) {
      depth += 1
      i += 1
    } else if (text.startsWith('}}', i)) {
      if (depth === 0) return i
      depth -= 1
      i += 1
    }
  }
  return -1
}

function topLevel(text: string): Span[] {
  const spans: Span[] = []
  let i = 0
  for (;;) {
    const start = text.indexOf('{{', i)
    if (start < 0) return spans
    const close = matchEnd(text, start)
    if (close < 0) return spans
    spans.push({ start, end: close + 2, body: text.slice(start + 2, close) })
    i = close + 2
  }
}

/** Splits on `::` outside nested macros. */
function splitArgs(rest: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < rest.length; i += 1) {
    if (rest.startsWith('{{', i)) {
      depth += 1
      i += 1
    } else if (rest.startsWith('}}', i) && depth > 0) {
      depth -= 1
      i += 1
    } else if (depth === 0 && rest.startsWith('::', i)) {
      out.push(rest.slice(from, i))
      from = i + 2
      i += 1
    }
  }
  out.push(rest.slice(from))
  return out
}

function parseBody(body: string): Parsed | null {
  let b = body
  let flags = ''
  while (b && '!?~#'.includes(b[0])) {
    flags += b[0]
    b = b.slice(1)
  }
  b = b.replace(/^\s+/, '')
  if (b.startsWith('/') && !b.startsWith('//')) return { name: b.slice(1).trim().toLowerCase(), args: [], flags, closing: true }
  if (b.startsWith('//')) return { name: '//', args: [b.slice(2)], flags }
  const shorthand = /^([.$])([a-zA-Z](?:[\w-]*\w)?)\s*([\s\S]*)$/.exec(b)
  if (shorthand) return { name: '', args: [], flags, shorthand: { global: shorthand[1] === '$', key: shorthand[2], rest: shorthand[3].trim() } }
  const utc = /^time_utc([+-]\d{1,2})$/i.exec(b)
  if (utc) return { name: 'time', args: [`UTC${utc[1]}`], flags }
  const m = /^([a-zA-Z][\w-]*)([\s\S]*)$/.exec(b)
  if (!m) return null
  const rest = m[2]
  const name = m[1].toLowerCase()
  if (rest.startsWith('::')) return { name, args: splitArgs(rest.slice(2)), flags }
  // The older single-colon and space forms carry everything after them as one argument.
  if (rest.startsWith(':')) return { name, args: [rest.slice(1)], flags }
  if (/^\s/.test(rest)) return { name, args: rest.trim() ? splitArgs(rest.trim()) : [], flags }
  return rest === '' ? { name, args: [], flags } : null
}

/** The `{{/name}}` that closes a block opened just before `from`, skipping nested blocks of the same macro. */
function findClose(text: string, from: number, name: string): Span | null {
  let depth = 0
  for (const span of topLevel(text.slice(from))) {
    const p = parseBody(span.body)
    if (!p || p.name !== name) continue
    if (p.closing) {
      if (depth === 0) return { start: from + span.start, end: from + span.end, body: span.body }
      depth -= 1
    } else if (p.args.length < SCOPED[name]) depth += 1
  }
  return null
}

const num = (v: string | undefined) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** Adds numbers, or appends text when either side is not a number. */
function addValues(a: string | undefined, b: string): string {
  const x = num(a ?? '0')
  const y = num(b)
  return x !== null && y !== null ? String(x + y) : `${a ?? ''}${b}`
}

function bare(sequence: string | undefined): string {
  return (sequence ?? '').replace('{name}: ', '').replace('{name}', '')
}

function simple(name: string, c: Run): string | undefined {
  const { ctx } = c
  const card = ctx.card ?? {}
  const history = ctx.history ?? []
  const lastOf = (role?: 'user' | 'char') => [...history].reverse().find((m) => !role || m.role === role)
  const tpl = ctx.instruct
  switch (name) {
    case 'user': return ctx.userName
    case 'char': return ctx.charName
    case 'group': case 'groupnotmuted': case 'charifnotgroup': return [ctx.charName, ...(ctx.participants ?? [])].join(', ')
    case 'notchar': return [ctx.userName, ...(ctx.participants ?? [])].join(', ')
    case 'noop': return ''
    case 'newline': return '\n'
    case 'space': return ' '
    case 'description': case 'chardescription': return card.description ?? ''
    case 'personality': case 'charpersonality': return card.personality ?? ''
    case 'scenario': case 'charscenario': return card.scenario ?? ''
    case 'persona': return ctx.persona ?? ''
    case 'mesexamples': case 'mesexamplesraw': return card.mes_example ?? ''
    case 'charprompt': return card.system_prompt ?? ''
    case 'charinstruction': return card.post_history_instructions ?? ''
    case 'chardepthprompt': return ((card.extensions as { depth_prompt?: { prompt?: string } } | undefined)?.depth_prompt?.prompt) ?? ''
    case 'charcreatornotes': case 'creatornotes': return card.creator_notes ?? ''
    case 'charfirstmessage': case 'greeting': return card.first_mes ?? ''
    case 'charversion': case 'version': case 'char_version': return card.character_version ?? ''
    case 'model': return ctx.model ?? ''
    case 'original': return ctx.original ?? ''
    case 'ismobile': return 'false'
    case 'input': return ctx.input ?? ''
    case 'lastgenerationtype': return ctx.generationType ?? ''
    case 'maxcontext': case 'maxcontexttokens': return ctx.maxContext === undefined ? '' : String(ctx.maxContext)
    case 'maxresponse': case 'maxresponsetokens': return ctx.maxResponse === undefined ? '' : String(ctx.maxResponse)
    case 'maxprompt': case 'maxprompttokens': return ctx.maxContext === undefined ? '' : String(ctx.maxContext - (ctx.maxResponse ?? 0))
    case 'systemprompt': case 'defaultsystemprompt': case 'instructsystem': case 'instructsystemprompt': return ctx.systemPrompt ?? ''
    case 'lastmessage': return lastOf()?.text ?? ''
    case 'lastusermessage': return lastOf('user')?.text ?? ''
    case 'lastcharmessage': return lastOf('char')?.text ?? ''
    case 'lastmessageid': return history.length ? String(history.length - 1) : ''
    case 'firstdisplayedmessageid': return history.length ? '0' : ''
    case 'allchatrange': return history.length ? `0-${history.length - 1}` : ''
    case 'time': return c.now.toLocaleTimeString()
    case 'date': return c.now.toLocaleDateString()
    case 'weekday': return formatDate(c.now, 'dddd')
    case 'isotime': return formatDate(c.now, 'HH:mm')
    case 'isodate': return formatDate(c.now, 'YYYY-MM-DD')
    case 'idleduration': case 'idle_duration': {
      const at = lastOf('user')?.at
      return at === undefined ? '' : humanDuration(c.now.getTime() - at)
    }
    case 'instructsystemprefix': case 'instructstorystringprefix': return bare(tpl?.systemPrefix)
    case 'instructsystemsuffix': case 'instructstorystringsuffix': return bare(tpl?.systemSuffix)
    case 'instructuserprefix': case 'instructinput': case 'instructfirstuserprefix': case 'instructfirstinput': case 'instructlastuserprefix': case 'instructlastinput': return bare(tpl?.userPrefix)
    case 'instructusersuffix': return bare(tpl?.userSuffix)
    case 'instructassistantprefix': case 'instructoutput': case 'instructfirstassistantprefix': case 'instructfirstoutputprefix': case 'instructlastassistantprefix': case 'instructlastoutputprefix': return bare(tpl?.assistantPrefix)
    case 'instructassistantsuffix': case 'instructseparator': return bare(tpl?.assistantSuffix)
    case 'instructstop': return tpl?.stopSequences[0] ?? ''
    default: return undefined
  }
}

/** Reads a legacy one-argument list: `a::b` first, else comma-separated with `\,` as a literal comma. */
function listFrom(args: string[]): string[] {
  if (args.length !== 1) return args
  const only = args[0]
  if (only.includes('::')) return only.split('::').map((s) => s.trim())
  return only
    .replace(/\\,/g, '\u0000')
    .split(',')
    .map((s) => s.trim().replace(/\u0000/g, ','))
}

function readVar(c: Run, global: boolean, key: string): string | undefined {
  return (global ? c.vars.global : c.vars.local)[key]
}

function writeVar(c: Run, global: boolean, key: string, value: string): void {
  ;(global ? c.vars.global : c.vars.local)[key] = value
  c.vars.persist?.()
}

/** `{{.name}}` and `{{$name}}`: read, set, add, subtract, step, default and compare. */
function shorthand(sh: NonNullable<Parsed['shorthand']>, c: Run): string {
  const { global, key } = sh
  const cur = readVar(c, global, key)
  const m = /^(\+\+|--|\?\?=|\?\?|\|\|=|\|\||\+=|-=|==|!=|>=|<=|>|<|=)\s*([\s\S]*)$/.exec(sh.rest)
  if (!m) return cur ?? ''
  const value = resolveText(m[2], c)
  switch (m[1]) {
    case '++': case '--': {
      const next = String((num(cur) ?? 0) + (m[1] === '++' ? 1 : -1))
      writeVar(c, global, key, next)
      return next
    }
    case '=': writeVar(c, global, key, value); return ''
    case '+=': writeVar(c, global, key, addValues(cur, value)); return ''
    case '-=': writeVar(c, global, key, String((num(cur) ?? 0) - (num(value) ?? 0))); return ''
    case '??': return cur ?? value
    case '||': return cur && !isFalseText(cur) ? cur : value
    case '??=': if (cur === undefined) writeVar(c, global, key, value); return ''
    case '||=': if (cur === undefined || isFalseText(cur)) writeVar(c, global, key, value); return ''
    default: {
      const a = cur ?? ''
      const x = num(a)
      const y = num(value)
      const both = x !== null && y !== null
      const cmp = { '==': a === value, '!=': a !== value, '>': both && x > y, '>=': both && x >= y, '<': both && x < y, '<=': both && x <= y }[m[1]]
      return String(cmp)
    }
  }
}

/** `{{if cond}}then{{else}}other{{/if}}`: the condition may be `!x`, a macro name, `.var` or `$var`. */
function conditional(rawCondition: string, rawContent: string, c: Run): string {
  let cond = rawCondition.trim()
  const inverted = cond.startsWith('!')
  if (inverted) cond = cond.slice(1).trim()
  cond = resolveText(cond, c)
  const sh = /^([.$])([a-zA-Z](?:[\w-]*\w)?)$/.exec(cond)
  if (sh) cond = readVar(c, sh[1] === '$', sh[2]) ?? ''
  else if (/^[a-zA-Z][\w-]*$/.test(cond) && simple(cond.toLowerCase(), c) !== undefined) cond = simple(cond.toLowerCase(), c) ?? ''
  const truthy = !isFalseText(cond) !== inverted
  // Split on the first `{{else}}` that is not inside a nested block.
  let thenPart = rawContent
  let elsePart: string | undefined
  let depth = 0
  for (const span of topLevel(rawContent)) {
    const p = parseBody(span.body)
    if (!p || p.name !== 'if' && p.name !== 'else') continue
    if (p.name === 'if') depth += p.closing ? -1 : p.args.length < SCOPED.if ? 1 : 0
    else if (depth === 0) {
      thenPart = rawContent.slice(0, span.start)
      elsePart = rawContent.slice(span.end)
      break
    }
  }
  const chosen = truthy ? thenPart : elsePart
  return chosen === undefined ? '' : resolveText(chosen, c)
}

function callMacro(p: Parsed, c: Run): string | undefined {
  const a = p.args.map((x) => resolveText(x, c))
  const arg = (i: number) => a[i] ?? ''
  const key = () => arg(0).trim()
  const flat = simple(p.name, c)
  if (flat !== undefined && a.length === 0) return flat
  switch (p.name) {
    case 'space': return ' '.repeat(num(arg(0)) ?? 1)
    case 'newline': return '\n'.repeat(num(arg(0)) ?? 1)
    case 'trim': return a.length ? arg(0).trim() : TRIM_MARK
    case 'reverse': return Array.from(arg(0)).reverse().join('')
    case '//': case 'comment': return ''
    case 'else': return ''
    case 'random': {
      const list = listFrom(a)
      return list.length ? list[Math.floor(c.random() * list.length)] : ''
    }
    case 'pick': {
      const list = listFrom(a)
      if (!list.length) return ''
      const rng = seededRandom(hashString(`${c.ctx.chatId ?? ''}-${c.contentHash}-${c.picks++}`))
      return list[Math.floor(rng() * list.length)]
    }
    case 'roll': {
      const total = rollDice(arg(0), c.random)
      return total === null ? '' : String(total)
    }
    case 'banned': c.ctx.banned?.push(arg(0).replace(/^"|"$/g, '')); return ''
    case 'outlet': return c.ctx.outlets?.[arg(0)] ?? ''
    case 'hasextension': return String(c.ctx.hasExtension?.(arg(0)) ?? false)
    case 'time': {
      const offset = /^UTC([+-]\d{1,2})$/i.exec(arg(0).trim())
      if (!offset) return c.now.toLocaleTimeString()
      const at = new Date(c.now.getTime() + c.now.getTimezoneOffset() * 60000 + Number(offset[1]) * 3600000)
      return at.toLocaleTimeString()
    }
    case 'datetimeformat': return formatDate(c.now, arg(0))
    case 'timediff': {
      const x = Date.parse(arg(0))
      const y = Date.parse(arg(1))
      return Number.isNaN(x) || Number.isNaN(y) ? '' : humanDuration(x - y)
    }
    case 'greeting': case 'charfirstmessage': {
      const n = num(arg(0)) ?? 0
      const card = c.ctx.card
      return n === 0 ? (card?.first_mes ?? '') : (card?.alternate_greetings?.[n - 1] ?? '')
    }
    case 'lastswipeid': return c.ctx.history?.length ? '1' : ''
    case 'currentswipeid': return c.ctx.history?.length ? '1' : ''
  }
  // Variables: setvar, getvar and friends, with the global twins.
  const v = /^(set|add|inc|dec|get|has|delete|flush)(global)?var(key|index)?$|^(varexists|globalvarexists)$/.exec(p.name)
  if (!v) return undefined
  const global = !!v[2] || p.name === 'globalvarexists'
  const op = v[1] ?? 'has'
  const k = key()
  const cur = readVar(c, global, k)
  if (v[3]) return objectVar(op, global, k, arg(1), arg(2), c, cur)
  switch (op) {
    case 'set': writeVar(c, global, k, arg(1)); return ''
    case 'add': writeVar(c, global, k, addValues(cur, arg(1))); return ''
    case 'inc': case 'dec': {
      const next = String((num(cur) ?? 0) + (op === 'inc' ? 1 : -1))
      writeVar(c, global, k, next)
      return next
    }
    case 'get': return cur ?? ''
    case 'has': return String(cur !== undefined)
    default: {
      const store = global ? c.vars.global : c.vars.local
      delete store[k]
      c.vars.persist?.()
      return ''
    }
  }
}

/** `{{setvarkey::name::key::value}}` and `{{getvarkey::name::key}}` on a variable that holds a JSON object or array. */
function objectVar(op: string, global: boolean, name: string, key: string, value: string, c: Run, cur: string | undefined): string {
  let data: unknown = {}
  try {
    data = cur ? JSON.parse(cur) : /^\d+$/.test(key) ? [] : {}
  } catch {
    data = {}
  }
  const holder = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (op === 'get') {
    const found = holder[key]
    return found === undefined ? '' : typeof found === 'string' ? found : JSON.stringify(found)
  }
  holder[key] = value
  writeVar(c, global, name, JSON.stringify(holder))
  return ''
}

/** Resolves one macro that starts at `open`; returns what it becomes and where scanning resumes. */
function expand(text: string, open: number, close: number, c: Run): { out: string; next: number } {
  const body = text.slice(open + 2, close)
  const after = close + 2
  const p = parseBody(body)
  const keep = { out: `{{${resolveText(body, c)}}}`, next: after }
  if (!p || p.closing) return p?.closing ? { out: text.slice(open, after), next: after } : keep

  if (p.shorthand) return { out: shorthand(p.shorthand, c), next: after }

  // `{{//}} ... {{///}}` is a block comment.
  if (p.name === '//' && body.trim() === '//') {
    const end = topLevel(text.slice(after)).find((s) => s.body.trim() === '///')
    if (end) return { out: '', next: after + end.end }
  }

  let next = after
  const arity = SCOPED[p.name]
  if (arity && p.args.length < arity) {
    const closeSpan = findClose(text, after, p.name)
    if (closeSpan) {
      const content = text.slice(after, closeSpan.start)
      // An `if` block keeps its text raw so only the chosen branch is resolved; others are trimmed like SillyTavern does unless `#` is set.
      p.args.push(p.name === 'if' || p.flags.includes('#') ? content : content.trim())
      next = closeSpan.end
    }
  }

  if (p.name === 'if' && p.args.length >= 2) {
    const result = conditional(p.args[0], p.args.slice(1).join('::'), c)
    return { out: p.flags.includes('#') ? result : result.trim(), next }
  }
  const known = callMacro(p, c)
  return known === undefined ? keep : { out: known, next }
}

function resolveText(text: string, c: Run): string {
  if (!text.includes('{{')) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{{', i)
    if (open < 0) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, open)
    // `{{{x}}}`: the first brace is plain text.
    if (text[open + 2] === '{') {
      out += '{'
      i = open + 1
      continue
    }
    const close = matchEnd(text, open)
    if (close < 0) {
      out += text.slice(open)
      break
    }
    const r = expand(text, open, close, c)
    out += r.out
    i = r.next
  }
  return out
}

/** Replaces every macro in `text`. Unknown ones are left as written, with any macros inside them resolved. */
export function substituteMacros(text: string, ctx: MacroContext): string {
  if (!text || !text.includes('{{')) return text
  const run: Run = {
    ctx,
    random: ctx.random ?? Math.random,
    now: ctx.now ?? new Date(),
    vars: ctx.variables ?? variablesFor(ctx.chatId),
    contentHash: hashString(text),
    picks: 0,
  }
  return resolveText(text, run).replace(new RegExp(`\\n*${TRIM_MARK}\\n*`, 'g'), '')
}
