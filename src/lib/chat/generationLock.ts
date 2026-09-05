/**
 * A one-at-a-time claim over a chat's generation pipeline.
 *
 * `useChatSession` can only have one generation in flight: `runGeneration` writes through a single
 * set of shared refs (abort controller, gen key) and a single set of streaming-text state, and
 * every path into it does its own `messagesApi` writes against a specific message row on the way.
 * Two overlapping runs interleave those writes — observed live as a saved message whose `rawText`
 * came from one run while its `text`/`failed` came from another, and (on a double send) as two
 * user messages plus two placeholder replies created before either generation began.
 *
 * The guard this replaces was React state (`isGenerating`), which is only visible to a callback
 * that was created on a later render. Two calls dispatched inside the same tick both read the
 * pre-generation value and both proceeded. This lock is deliberately synchronous and mutable:
 * `begin()` never awaits, so nothing can interleave between its read and its write, and a second
 * caller sees the first's claim immediately rather than one render later.
 *
 * Lives here rather than inline in the hook so its contract is directly testable — the hook holds
 * one of these in a ref for the lifetime of a chat session.
 */
export interface GenerationLock {
  /**
   * Test-and-set. `true` means the caller now owns the lock and owes exactly one `end()`, which
   * belongs in a `finally` so a thrown or aborted generation can't strand it held forever.
   * `false` means someone else is mid-generation and the caller should back off.
   */
  begin(): boolean
  /** Releases the claim. Safe to call when not held — a caller that bailed early can release
   *  unconditionally in its `finally` without tracking whether it ever claimed. */
  end(): void
  /** Whether a generation is currently claimed. Read-only; for callers that need to *report* the
   *  busy state (a toast, a disabled control) without trying to take the lock. */
  readonly held: boolean
}

export function createGenerationLock(): GenerationLock {
  let held = false
  return {
    begin() {
      if (held) return false
      held = true
      return true
    },
    end() {
      held = false
    },
    get held() {
      return held
    },
  }
}
