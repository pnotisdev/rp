// Helpers for the macro engine: variable storage, small date formatter, durations, seeded random.

const STORAGE_KEY = 'rp-macro-vars'

export interface MacroVariables {
  local: Record<string, string>
  global: Record<string, string>
}

interface Stored {
  global: Record<string, string>
  chats: Record<string, Record<string, string>>
}

let stored: Stored | null = null

function load(): Stored {
  if (stored) return stored
  stored = { global: {}, chats: {} }
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (raw) stored = { ...stored, ...(JSON.parse(raw) as Partial<Stored>) }
  } catch {
    // Unreadable storage just means a fresh start.
  }
  return stored
}

function save(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // shortcut: variables live in this browser only; move them into the chat record if they need to follow a chat across devices.
  }
}

/** The variables a macro call reads and writes: globals shared everywhere, locals per chat. Writes persist. */
export function variablesFor(chatId: string | undefined): MacroVariables & { persist(): void } {
  const s = load()
  const key = chatId || '_'
  s.chats[key] ??= {}
  return { local: s.chats[key], global: s.global, persist: save }
}

/** Test hook: forget everything held in memory and storage. */
export function resetMacroVariables(): void {
  stored = { global: {}, chats: {} }
  save()
}

/** "false", "off", "0" and empty read as false, the way SillyTavern's `{{if}}` does. */
export function isFalseText(v: string): boolean {
  const t = v.trim().toLowerCase()
  return t === '' || t === 'false' || t === 'off' || t === '0'
}

/** The few moment.js tokens a prompt realistically uses. */
export function formatDate(d: Date, format: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const month = d.toLocaleString('en-US', { month: 'long' })
  const weekday = d.toLocaleString('en-US', { weekday: 'long' })
  const h12 = d.getHours() % 12 || 12
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: month,
    MMM: month.slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    dddd: weekday,
    ddd: weekday.slice(0, 3),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(h12),
    h: String(h12),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
    a: d.getHours() < 12 ? 'am' : 'pm',
  }
  // `[text]` is moment's escape; longer tokens are tried first.
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (m, literal?: string) => literal ?? tokens[m] ?? m)
}

/** "2 hours, 5 minutes": the two biggest non-zero units. */
export function humanDuration(ms: number): string {
  const total = Math.max(0, Math.round(Math.abs(ms) / 1000))
  const units: [string, number][] = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
  const parts: string[] = []
  let rest = total
  for (const [name, size] of units) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n} ${name}${n === 1 ? '' : 's'}`)
  }
  return parts.length ? parts.slice(0, 2).join(', ') : '0 seconds'
}

/** A small string hash for seeding. */
export function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** Deterministic random in [0, 1) from a seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rolls `2d6+3` style dice. Returns null for a formula it cannot read. */
export function rollDice(formula: string, random: () => number): number | null {
  const f = /^\d+$/.test(formula.trim()) ? `1d${formula.trim()}` : formula.trim().toLowerCase()
  const m = /^(\d{0,3})d(\d{1,4})([+-]\d{1,4})?$/.exec(f)
  if (!m) return null
  const count = m[1] ? Number(m[1]) : 1
  const sides = Number(m[2])
  if (count < 1 || count > 100 || sides < 1) return null
  let total = m[3] ? Number(m[3]) : 0
  for (let i = 0; i < count; i += 1) total += 1 + Math.floor(random() * sides)
  return total
}
