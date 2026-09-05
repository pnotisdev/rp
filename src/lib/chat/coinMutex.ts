/**
 * Serializes read-modify-write operations against a chat's shared `giftCoins` wallet.
 *
 * Every coin-touching call site (`buyGift`, `buyItem`, `buyToy`, `useItem`'s currency effect, the
 * per-turn relationship judge's +2 reward, and a date/hangout's end-of-scene payout) follows the
 * same shape: `GET` the chat, read `giftCoins` off that snapshot, compute a new value, `PUT` the
 * whole patch back. None of that round-trip is atomic — the server's `PUT /api/chats/:id` is a
 * shallow merge of whatever patch it's handed, not a compare-and-swap, so two of these in flight at
 * once race: whichever `PUT` lands second silently overwrites the first's coin delta with a value
 * computed from the *same stale snapshot*, and the first purchase's cost (or reward) evaporates
 * while its inventory/other-field write (a different key in the same shallow merge) still lands.
 *
 * Live repro that found this: buying a 20-coin gift and an 8-coin item back-to-back from the Shop
 * tab (two ordinary, non-frantic clicks) left both items owned but only deducted 8 coins total —
 * the 20-coin purchase's cost vanished because its `PUT` was overwritten by the second purchase's,
 * which had read its `giftCoins` baseline before the first purchase's `PUT` committed.
 *
 * This mutex doesn't change any call site's read-then-write shape — it just guarantees only one
 * such critical section runs at a time *for a given chat*, so every read inside one is guaranteed
 * to see the previous section's write. A caller queued behind the current holder still runs (unlike
 * `GenerationLock`, which refuses a second claim outright) — a purchase clicked while a turn's
 * background reward is mid-flight should still go through, just after, with the right balance.
 *
 * Keyed per chat (via `getCoinMutex`) so two different open chats never block each other.
 */
export interface CoinMutex {
  /** Queues `fn` behind whatever's currently holding the mutex, runs it alone, then releases —
   *  even if `fn` throws, so one failed purchase can't wedge every later one. */
  run<T>(fn: () => Promise<T>): Promise<T>
}

export function createCoinMutex(): CoinMutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn, fn)
      // Swallow the outcome in the chained tail so one rejection doesn't poison every later queued
      // caller — each caller still gets its own `result` promise with the real value or rejection.
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
