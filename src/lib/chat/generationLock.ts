/**
 * A one-at-a-time claim over a chat's generation pipeline. Replaces a React-state guard
 * (`isGenerating`) that two calls dispatched in the same tick could both slip past — this lock is
 * synchronous and mutable so `begin()` can't be raced between its read and its write.
 */
export interface GenerationLock {
  /** Test-and-set. `true` = caller owns the lock and owes exactly one `end()` (put it in a `finally`). */
  begin(): boolean
  /** Releases the claim. Safe to call when not held. */
  end(): void
  /** Whether a generation is currently claimed, without trying to take the lock. */
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
