/**
 * Serializes read-modify-write operations against a chat's shared `giftCoins` wallet. Every
 * coin-touching call site (buys, `useItem`'s currency effect, the judge's reward, a date payout)
 * does a GET-then-PUT round trip against a non-atomic server endpoint (shallow merge, not
 * compare-and-swap), so two in flight at once can silently overwrite each other's coin delta. This
 * mutex just guarantees only one such critical section runs at a time per chat — a queued caller
 * still runs after, unlike `GenerationLock`, which refuses a second claim outright.
 */
export interface CoinMutex {
  /** Queues `fn` behind the current holder, runs it alone, then releases (even if `fn` throws). */
  run<T>(fn: () => Promise<T>): Promise<T>
}

export function createCoinMutex(): CoinMutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn, fn)
      // Swallow the outcome in the chained tail so one rejection can't poison later queued callers.
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  }
}

const mutexesByChatId = new Map<string, CoinMutex>()

/** The one `CoinMutex` for this chat, created on first use and reused for the rest of the session. */
export function getCoinMutex(chatId: string): CoinMutex {
  let mutex = mutexesByChatId.get(chatId)
  if (!mutex) {
    mutex = createCoinMutex()
    mutexesByChatId.set(chatId, mutex)
  }
  return mutex
}
