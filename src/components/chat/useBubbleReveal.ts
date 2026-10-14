// Paces texting bubbles: a message watched while it was being written shows its bubbles one at a time, like texts arriving.

import { useEffect, useState } from 'react'
import { typingDelayMs, type Bubble } from '@/lib/text/texting'

/** Message ids seen streaming this session, mapped to how many bubbles are already shown. */
const revealed = new Map<string, number>()

export function useBubbleReveal(
  id: string,
  bubbles: Bubble[],
  opts: { streaming: boolean; pending: boolean; failed?: boolean; onShow?: (bubble: Bubble) => void },
): { visible: number; typing: boolean } {
  if (opts.streaming && !revealed.has(id)) revealed.set(id, 0)
  const tracked = revealed.has(id)
  const [count, setCount] = useState(() => revealed.get(id) ?? 0)
  const total = bubbles.length

  useEffect(() => {
    if (!tracked || count >= total) return
    const delay = count === 0 ? 200 : typingDelayMs(bubbles[count])
    const timer = window.setTimeout(() => {
      revealed.set(id, count + 1)
      setCount(count + 1)
      opts.onShow?.(bubbles[count])
    }, delay)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, count, total, id])

  if (!tracked) return { visible: total, typing: false }
  const visible = Math.min(count, total)
  const typing = !opts.failed && (visible < total || opts.streaming || opts.pending || total === 0)
  return { visible, typing }
}
