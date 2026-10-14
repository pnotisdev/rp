import type { Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { estimateTokens } from '@/lib/tokenEstimate'
import { MAX_REGEX_HAYSTACK_LENGTH } from '@/lib/text/regexSafety'

/** Keyword/always/manual lorebook-entry activation */

export interface ActivationOptions {
  /** How many recent messages (rendered as plain text) to scan for keyword hits. */
  scanDepth: number
}

export interface WorldInfoActivationResult {
  activated: LorebookEntry[]
  /** Entries that matched but were dropped because their book's token budget was full. */
  droppedForBudget: LorebookEntry[]
  /** Entries that matched but lost to a higher-priority entry in the same inclusion group. */
  droppedForGroup: LorebookEntry[]
  /** Per-entry sticky/cooldown bookkeeping to persist for the next turn — only present when `runtime` was passed. */
  nextState?: WorldInfoRuntimeState
}

/** Per-entry sticky/cooldown bookkeeping, keyed by `${book.sourceKey}:${entry.id}`. Persisted on `Chat.worldInfoState`. */
export interface WorldInfoEntryRuntime {
  /** Turn this entry stays force-active until (exclusive). Set from `sticky`. */
  activeUntil?: number
  /** Turn this entry can't reactivate by keyword until (exclusive). Set from `cooldown`. */
  blockedUntil?: number
  /** Last turn this entry was active — the trigger for a cooldown when it deactivates. */
  activeAt?: number
}
export type WorldInfoRuntimeState = Record<string, WorldInfoEntryRuntime>

export interface WorldInfoRuntimeInput {
  /** Monotonic turn counter (the caller passes the chat's message count). */
  turn: number
  prevState: WorldInfoRuntimeState
}

function compositeKey(book: Lorebook, bookIndex: number, entry: LorebookEntry, entryIndex: number): string {
  return `${book.sourceKey ?? `b${bookIndex}`}:${entry.id ?? `i${entryIndex}`}`
}

/** Caps recursive-scanning passes so an entry->entry->entry cycle can't loop forever. */
const MAX_RECURSION_DEPTH = 3

/** Scans for matches per-book, then caps each book to its own `token_budget` so a large lorebook can never silently eat the whole context. */
export function activateWorldInfo(
  books: Lorebook[],
  recentText: string,
  affection = 0,
  runtime?: WorldInfoRuntimeInput,
  /** Every message's text, oldest first. Only needed for entries that set their own `scanDepth`. */
  messageTexts?: string[],
): WorldInfoActivationResult {
  const haystackLower = recentText.toLowerCase()
  /** The text an entry scans: the shared recent window, or its own number of last messages. */
  const scanFor = (entry: LorebookEntry): { text: string; lower: string } => {
    if (entry.scanDepth === undefined || !messageTexts) return { text: recentText, lower: haystackLower }
    const text = messageTexts.slice(-Math.max(0, entry.scanDepth)).join('\n')
    return { text, lower: text.toLowerCase() }
  }
  const activated: LorebookEntry[] = []
  const droppedForBudget: LorebookEntry[] = []
  const droppedForGroup: LorebookEntry[] = []

  // Track active/fresh keys per turn for the sticky/cooldown rollup after all books are scanned.
  const activeKeys = new Set<string>()
  const freshMatchKeys = new Set<string>()
  const stickyCandidates: { key: string; entry: LorebookEntry }[] = []

  for (let bookIndex = 0; bookIndex < books.length; bookIndex++) {
    const book = books[bookIndex]
    let matched: LorebookEntry[] = []
    const matchedIds = new Set<number>()
    const keywordEntries: LorebookEntry[] = []
    // Always-on ('always'/constant) entries are a book's baseline lore
    const alwaysEntries = new Set<LorebookEntry>()

    for (const entry of book.entries) {
      const mode = entry.activationMode ?? (entry.constant ? 'always' : 'keyword')
      // Manual entries use their own enabled check below, not this generic one.
      if (mode !== 'manual' && !entry.enabled) continue
      const requiredAffection = Number((entry.extensions as Record<string, unknown> | undefined)?.affectionMin ?? 0)
      if (Number.isFinite(requiredAffection) && affection < requiredAffection) continue
      // ST's `delay`: hold back until the chat reaches `delay` messages; needs a runtime to apply.
      if (runtime && entry.delay !== undefined && runtime.turn < entry.delay) continue
      if (mode === 'always') {
        matched.push(entry)
        alwaysEntries.add(entry)
        continue
      }
      if (mode === 'manual') {
        if (entry.enabled) matched.push(entry)
        continue
      }
      // Kept as a candidate list for recursive scanning below, not just a single original-text check.
      keywordEntries.push(entry)
    }

    for (let ei = 0; ei < keywordEntries.length; ei++) {
      const entry = keywordEntries[ei]
      // `delayUntilRecursion` entries wait for a recursive pass to be triggered by another entry's text.
      if (entry.delayUntilRecursion) continue
      const own = scanFor(entry)
      const matchedNow = matchesKeywords(entry, own.text, own.lower) && passesProbability(entry)
      let active = matchedNow
      if (runtime) {
        const key = compositeKey(book, bookIndex, entry, ei)
        const rt = runtime.prevState[key]
        const stickyActive = rt?.activeUntil !== undefined && runtime.turn < rt.activeUntil
        const onCooldown = rt?.blockedUntil !== undefined && runtime.turn < rt.blockedUntil
        const freshHit = matchedNow && !onCooldown
        active = stickyActive || freshHit
        if (active) activeKeys.add(key)
        if (freshHit) freshMatchKeys.add(key)
        if (entry.sticky || entry.cooldown) stickyCandidates.push({ key, entry })
      }
      if (active) {
        matched.push(entry)
        if (entry.id !== undefined) matchedIds.add(entry.id)
      }
    }

    // Recursive scanning: a just-activated entry's own content can introduce keywords that trigger further keyword-mode entries…
    if (book.recursive_scanning) {
      let frontier = matched.filter((e) => keywordEntries.includes(e) && !e.preventRecursion)
      for (let depth = 0; depth < MAX_RECURSION_DEPTH && frontier.length > 0; depth++) {
        const frontierText = frontier.map((e) => e.content).join('\n')
        const frontierLower = frontierText.toLowerCase()
        const next: LorebookEntry[] = []
        for (const entry of keywordEntries) {
          if (entry.id !== undefined && matchedIds.has(entry.id)) continue
          if (entry.excludeRecursion) continue
          if (matchesKeywords(entry, frontierText, frontierLower) && passesProbability(entry)) {
            next.push(entry)
            if (entry.id !== undefined) matchedIds.add(entry.id)
          }
        }
        if (next.length === 0) break
        matched.push(...next)
        frontier = next
      }
    }

    // Inclusion groups: entries sharing a group are alternatives — only the highest-priority one fires.
    const byGroup = new Map<string, LorebookEntry[]>()
    const ungrouped: LorebookEntry[] = []
    for (const entry of matched) {
      if (entry.group?.trim()) {
        const list = byGroup.get(entry.group) ?? []
        list.push(entry)
        byGroup.set(entry.group, list)
      } else {
        ungrouped.push(entry)
      }
    }
    matched = ungrouped
    for (const group of byGroup.values()) {
      const winner = pickGroupWinner(group, scanFor)
      matched.push(winner)
      droppedForGroup.push(...group.filter((e) => e !== winner))
    }

    // Always-on entries fill first; within each partition, higher insertion_order = higher priority.
    const byPriority = [...matched].sort((a, b) => {
      const aAlways = alwaysEntries.has(a)
      const bAlways = alwaysEntries.has(b)
      if (aAlways !== bAlways) return aAlways ? -1 : 1
      return b.insertion_order - a.insertion_order
    })
    const budget = book.token_budget ?? Infinity
    let used = 0
    for (const entry of byPriority) {
      // `ignoreBudget` entries are always kept and do not count against the book's budget.
      const cost = entry.ignoreBudget ? 0 : estimateTokens(entry.content)
      if (used + cost > budget) {
        droppedForBudget.push(entry)
        continue
      }
      used += cost
      activated.push(entry)
    }
  }

  // Higher insertion_order wins placement priority (inserted closer to the end).
  activated.sort((a, b) => a.insertion_order - b.insertion_order)

  let nextState: WorldInfoRuntimeState | undefined
  if (runtime) {
    nextState = {}
    const { turn, prevState } = runtime
    // Carry forward a pending cooldown even for a key not scanned this turn (e.g. its book left the roster).
    for (const [key, rt] of Object.entries(prevState)) {
      if (rt.blockedUntil !== undefined && turn < rt.blockedUntil) nextState[key] = { blockedUntil: rt.blockedUntil }
    }
    for (const { key, entry } of stickyCandidates) {
      const rt = prevState[key] ?? {}
      const isActive = activeKeys.has(key)
      const wasActive = rt.activeAt !== undefined && rt.activeAt >= turn - 1
      const next: WorldInfoEntryRuntime = {}
      if (isActive) {
        next.activeAt = turn
        // A fresh hit (re)starts the sticky window; a carry-over keeps its existing window.
        if (freshMatchKeys.has(key) && entry.sticky && entry.sticky > 0) {
          next.activeUntil = turn + entry.sticky + 1
        } else if (rt.activeUntil !== undefined && turn < rt.activeUntil) {
          next.activeUntil = rt.activeUntil
        }
        if (rt.blockedUntil !== undefined && turn < rt.blockedUntil) next.blockedUntil = rt.blockedUntil
      } else if (wasActive && entry.cooldown && entry.cooldown > 0) {
        // Just deactivated (sticky expired, or the keyword stopped matching) — start the cooldown.
        next.blockedUntil = turn + entry.cooldown
      } else if (rt.blockedUntil !== undefined && turn < rt.blockedUntil) {
        next.blockedUntil = rt.blockedUntil
      }
      if (next.activeAt !== undefined || next.activeUntil !== undefined || next.blockedUntil !== undefined) {
        nextState[key] = next
      }
    }
  }

  return { activated, droppedForBudget, droppedForGroup, nextState }
}

/** `probability` only gates keyword-triggered entries — "always"/"manual" firing probabilistically would contradict what those modes mean. */
function passesProbability(entry: LorebookEntry): boolean {
  if (entry.probability === undefined) return true
  const p = Math.max(0, Math.min(100, entry.probability))
  return Math.random() * 100 < p
}

/** A weight of 0 can never win as long as some other member has positive weight — only picked at all when every weight in the group is 0 (all equally, arbitrarily excluded). */
function pickWeighted(group: LorebookEntry[]): LorebookEntry {
  const weights = group.map((e) => Math.max(0, e.groupWeight ?? 1))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return group[0]
  let roll = Math.random() * total
  for (let i = 0; i < group.length; i++) {
    roll -= weights[i]
    if (roll < 0) return group[i]
  }
  return group[group.length - 1]
}

/** ST's convention: a key wrapped in slashes (`/pattern/flags`) is a regex, not a literal substring. `caseSensitive` only adds an implicit `i` flag when the author didn't already specify one. */
function parseRegexKey(key: string, caseSensitive: boolean): RegExp | null {
  const match = key.match(/^\/(.+)\/([a-z]*)$/i)
  if (!match) return null
  const flags = !caseSensitive && !match[2].includes('i') ? match[2] + 'i' : match[2]
  try {
    return new RegExp(match[1], flags)
  } catch {
    return null
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether one key is found in the text: a regex, a whole word (single-word keys when the entry asks for it), or a plain substring. */
function keyHits(entry: LorebookEntry, key: string, haystackOriginal: string, haystackLower: string): boolean {
  const regex = parseRegexKey(key, !!entry.case_sensitive)
  // Only the regex path can catastrophically backtrack, so only it's length-capped; plain `.includes()` is safe uncapped.
  if (regex) return regex.test(haystackOriginal.slice(0, MAX_REGEX_HAYSTACK_LENGTH))
  const trimmed = key.trim()
  if (!trimmed) return false
  if (entry.matchWholeWords && !/\s/.test(trimmed)) {
    return new RegExp(`(?<![\\w])${escapeRegex(trimmed)}(?![\\w])`, entry.case_sensitive ? '' : 'i').test(haystackOriginal)
  }
  const needle = entry.case_sensitive ? key : key.toLowerCase()
  const hay = entry.case_sensitive ? haystackOriginal : haystackLower
  return needle.length > 0 && hay.includes(needle)
}

/** How many of an entry's keys (primary and secondary) are found, for group scoring. */
function matchCount(entry: LorebookEntry, haystackOriginal: string, haystackLower: string): number {
  return [...entry.keys, ...(entry.secondary_keys ?? [])].filter((k) => keyHits(entry, k, haystackOriginal, haystackLower)).length
}

function matchesKeywords(entry: LorebookEntry, haystackOriginal: string, haystackLower: string): boolean {
  if (entry.keys.length === 0) return false
  if (!entry.keys.some((k) => keyHits(entry, k, haystackOriginal, haystackLower))) return false
  const secondary = entry.secondary_keys ?? []
  if (!entry.selective || secondary.length === 0) return true
  const hits = secondary.filter((k) => keyHits(entry, k, haystackOriginal, haystackLower)).length
  switch (entry.selectiveLogic ?? 'and_any') {
    case 'and_all': return hits === secondary.length
    case 'not_all': return hits < secondary.length
    case 'not_any': return hits === 0
    default: return hits > 0
  }
}

/** ST's group rules: a prioritized entry beats the rest, then group scoring (most keys matched), then the weighted draw, then the highest insertion order. */
function pickGroupWinner(group: LorebookEntry[], scanFor: (e: LorebookEntry) => { text: string; lower: string }): LorebookEntry {
  const byOrder = (list: LorebookEntry[]) => [...list].sort((a, b) => b.insertion_order - a.insertion_order)[0]
  const prioritized = group.filter((e) => e.groupOverride)
  if (prioritized.length) return byOrder(prioritized)
  let pool = group
  if (group.some((e) => e.useGroupScoring)) {
    const scores = group.map((e) => {
      const own = scanFor(e)
      return matchCount(e, own.text, own.lower)
    })
    const best = Math.max(...scores)
    pool = group.filter((_, i) => scores[i] === best)
  }
  // ST's weighted groups: if any member sets `groupWeight`, pick via weighted random draw; else the plain highest-insertion_order rule.
  return pool.some((e) => e.groupWeight !== undefined) ? pickWeighted(pool) : byOrder(pool)
}

export function recentMessagesText(messages: { text: string }[], scanDepth: number): string {
  return messages
    .slice(-scanDepth)
    .map((m) => m.text)
    .join('\n')
}

/** A short human label for a lorebook entry (Prompt Inspector's match/drop lists). Falls through keys -> comment -> a content snippet -> a placeholder, so it's never blank. */
export function describeEntry(entry: Pick<LorebookEntry, 'keys' | 'comment' | 'content'>): string {
  const key = entry.keys.find((k) => k.trim())
  if (key) return key.trim()
  const comment = entry.comment?.trim()
  if (comment) return comment
  const content = entry.content.trim().replace(/\s+/g, ' ')
  if (content) return content.length > 40 ? `${content.slice(0, 40)}…` : content
  return '(untitled entry)'
}
