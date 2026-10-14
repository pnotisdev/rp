/** Serializes read-modify-write operations against a chat's shared `giftCoins` wallet. */
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
