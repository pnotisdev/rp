// Host event bus: the app emits, subscribed extension channels receive.

export interface Channel {
  extId: string
  events: Set<string>
  deliver(event: string, payload: unknown): void
}

const channels = new Set<Channel>()

export function registerChannel(channel: Channel): () => void {
  channels.add(channel)
  return () => void channels.delete(channel)
}

/** Delivers to every channel subscribed to `event`; a throwing channel never affects the others or the caller. */
export function emitHostEvent(event: string, payload: unknown): void {
  for (const channel of channels) {
    if (!channel.events.has(event)) continue
    try {
      channel.deliver(event, payload)
    } catch {
      /* a dead frame must not break the app */
    }
  }
}

/** True when some channel listens for `event`, so watchers can skip work nobody would see. */
export function hasSubscribers(event: string): boolean {
  for (const channel of channels) if (channel.events.has(event)) return true
  return false
}
