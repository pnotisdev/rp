import type { Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { estimateTokens } from '@/lib/tokenEstimate'
import { MAX_REGEX_HAYSTACK_LENGTH } from '@/lib/text/regexSafety'

export interface ActivationOptions {
  /** How many recent messages (rendered as plain text) to scan for keyword hits. */
  scanDepth: number
}

/**
 * Scans recent chat text for lorebook entry keyword matches. `always`-mode entries (constant:
 * true) are always included. `manual` entries fire purely off their own `enabled` toggle — this
 * app has no in-chat "activate for this turn" control, so unlike upstream SillyTavern's
 * manual mode (activated ad hoc via slash command), here it's simply an entry the author flips
 * on/off by hand in the editor rather than one keyword-triggered automatically.
 * Mirrors ST's "always / when relevant (keyword) / manual" activation modes.
 *
 * (Previously took a `manuallyActivatedIds: Set<number>` for a future per-turn "force this entry
 * on" control, additive on top of `enabled` — removed as dead machinery nothing ever populated,
 * per section 9's own note. It also would have been unsafe to wire up as originally shaped:
 * `LorebookEntry.id` is only unique within one book, and this function scans several books at
 * once, so a single flat id set could force on a same-numbered entry in an unrelated book too —
 * the same cross-source id-collision problem section 9's scene-flag-authoring writeup already
 * flagged for a very similar sticky/cooldown idea. A real version of this control needs a stable
 * composite key across sources first, which is its own, separate piece of work, not a quick
 * revival of this branch.)
 */
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

/** How many extra recursive-scanning passes a book gets before we stop chaining — bounds a pathological entry->entry->entry cycle to a fixed cost instead of looping. */
const MAX_RECURSION_DEPTH = 3

/**
 * Scans for matches per-book, then caps each book to its own token_budget
 * (estimated, since this runs synchronously) so a large lorebook can never
 * silently eat the whole context — this is the actual "token saving"
 * mechanism: only relevant, budget-fitting lore gets injected, never
 * everything that merely matches a keyword.
 */
export function activateWorldInfo(
  books: Lorebook[],
  recentText: string,
  affection = 0,
  runtime?: WorldInfoRuntimeInput,
): WorldInfoActivationResult {
  const haystackLower = recentText.toLowerCase()
  const activated: LorebookEntry[] = []
  const droppedForBudget: LorebookEntry[] = []
  const droppedForGroup: LorebookEntry[] = []

  // sticky/cooldown: track which composite keys ended up active this turn (and which of those
  // were a fresh keyword hit rather than a sticky carry-over) so the per-entry state can be
  // rolled forward once, after every book has been scanned.
  const activeKeys = new Set<string>()
  const freshMatchKeys = new Set<string>()
  const stickyCandidates: { key: string; entry: LorebookEntry }[] = []

  for (let bookIndex = 0; bookIndex < books.length; bookIndex++) {
    const book = books[bookIndex]
    let matched: LorebookEntry[] = []
    const matchedIds = new Set<number>()
    const keywordEntries: LorebookEntry[] = []

    for (const entry of book.entries) {
      const mode = entry.activationMode ?? (entry.constant ? 'always' : 'keyword')
      // Manual-mode entries have their own enabled check below, not the generic one — kept
      // separate so this stays a no-op fallthrough point if a real per-turn override ever lands.
      if (mode !== 'manual' && !entry.enabled) continue
      const requiredAffection = Number((entry.extensions as Record<string, unknown> | undefined)?.affectionMin ?? 0)
      if (Number.isFinite(requiredAffection) && affection < requiredAffection) continue
      // ST's "delay": hold the entry back until the chat is at least `delay` messages long. Needs the
      // turn counter, so like sticky/cooldown it only applies when a runtime is threaded through
      // (always the case in-app; old callers that pass no runtime keep today's behaviour).
      if (runtime && entry.delay !== undefined && runtime.turn < entry.delay) continue
      if (mode === 'always') {
        matched.push(entry)
        continue
      }
      if (mode === 'manual') {
        // Manual entries are considered "on" purely via their own enabled toggle.
        if (entry.enabled) matched.push(entry)
        continue
      }
      // Keyword-mode entries also chain via recursive scanning below, so keep the candidate
      // list around rather than only checking each one once against the original text.
      keywordEntries.push(entry)
    }

    for (let ei = 0; ei < keywordEntries.length; ei++) {
      const entry = keywordEntries[ei]
      const matchedNow = matchesKeywords(entry, recentText, haystackLower) && passesProbability(entry)
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

    // Recursive scanning: a just-activated entry's own content can introduce new keywords that
    // trigger further entries — e.g. a "the Duke" entry mentioning "Ashfall Keep" pulling in the
    // Ashfall Keep entry, even though the original message never said it. Only keyword-mode
    // entries chain this way; always/manual entries are already fully resolved above. Depth-capped
    // so a cycle of entries referencing each other can't loop forever.
    if (book.recursive_scanning) {
      let frontier = matched.filter((e) => keywordEntries.includes(e))
      for (let depth = 0; depth < MAX_RECURSION_DEPTH && frontier.length > 0; depth++) {
        const frontierText = frontier.map((e) => e.content).join('\n')
        const frontierLower = frontierText.toLowerCase()
        const next: LorebookEntry[] = []
        for (const entry of keywordEntries) {
          if (entry.id !== undefined && matchedIds.has(entry.id)) continue
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

    // Inclusion groups: entries sharing a group name are alternatives for the same beat (e.g.
    // three mutually-exclusive "how the party reacts" entries) — only the highest-priority one
    // in each group should actually fire, not all of them at once.
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
      // ST's weighted inclusion groups: if any member sets `groupWeight`, the winner is a
      // weighted random draw across the whole group (an unset weight defaults to 1) instead of
      // the plain deterministic "highest insertion_order wins" rule every group used before this
      // existed — that rule stays the default so a book with no weights set behaves exactly as
      // it always has.
      const winner = group.some((e) => e.groupWeight !== undefined)
        ? pickWeighted(group)
        : [...group].sort((a, b) => b.insertion_order - a.insertion_order)[0]
      matched.push(winner)
      droppedForGroup.push(...group.filter((e) => e !== winner))
    }

    // Higher insertion_order = higher priority = filled into the budget first.
    const byPriority = [...matched].sort((a, b) => b.insertion_order - a.insertion_order)
    const budget = book.token_budget ?? Infinity
    let used = 0
    for (const entry of byPriority) {
      const cost = estimateTokens(entry.content)
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
    // Carry forward any still-pending block from a key that wasn't even scanned this turn (e.g. its
    // book dropped out of a group chat's roster for a turn) so a cooldown isn't silently cleared.
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
        // A fresh keyword hit (re)starts the sticky window; a sticky carry-over keeps the window it
        // already has rather than extending it forever.
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

/**
 * SillyTavern's own convention: a key wrapped in slashes (`/pattern/flags`) is a regex, not a
 * literal substring. `caseSensitive` only adds an implicit `i` flag when the author didn't
 * already specify one explicitly — an explicit `i` (or the entry being case-sensitive) is
 * always respected as written.
 */
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

function matchesKeywords(entry: LorebookEntry, haystackOriginal: string, haystackLower: string): boolean {
  if (entry.keys.length === 0) return false
  const test = (k: string) => {
    const regex = parseRegexKey(k, !!entry.case_sensitive)
    // Section 9's ReDoS finding: only the regex path can catastrophically backtrack, so only it
    // gets capped — plain `.includes()` below stays uncapped since substring matching can't blow
    // up regardless of input length, and truncating it would just silently miss real content.
    if (regex) return regex.test(haystackOriginal.slice(0, MAX_REGEX_HAYSTACK_LENGTH))
    const needle = entry.case_sensitive ? k : k.toLowerCase()
    const hay = entry.case_sensitive ? haystackOriginal : haystackLower
    return needle.length > 0 && hay.includes(needle)
  }
  const primaryHit = entry.keys.some(test)
  if (!primaryHit) return false
  if (entry.selective && entry.secondary_keys && entry.secondary_keys.length > 0) {
    return entry.secondary_keys.some(test)
  }
  return true
}

export function recentMessagesText(messages: { text: string }[], scanDepth: number): string {
  return messages
    .slice(-scanDepth)
    .map((m) => m.text)
    .join('\n')
}

/**
 * A short human label for a lorebook entry, for lists that name entries rather than show them
 * (the Prompt Inspector's "matched but didn't fit" / "lost to a higher-priority entry" lines).
 *
 * The naive `keys[0] ?? comment` this replaces produced an empty string for the very entries
 * these lists exist to explain: an always-active entry needs no keys, and `comment` is optional,
 * so a world of them rendered as 96 empty slots separated by commas. `??` only catches the
 * missing `comment`, never the empty one. Falls through keys -> comment -> a snippet of the
 * content itself -> a last-resort placeholder, so the result is never blank.
 */
export function describeEntry(entry: Pick<LorebookEntry, 'keys' | 'comment' | 'content'>): string {
  const key = entry.keys.find((k) => k.trim())
  if (key) return key.trim()
  const comment = entry.comment?.trim()
  if (comment) return comment
  const content = entry.content.trim().replace(/\s+/g, ' ')
  if (content) return content.length > 40 ? `${content.slice(0, 40)}…` : content
  return '(untitled entry)'
}
