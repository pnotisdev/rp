import { useEffect, useRef, useState } from 'react'

/**
 * Reveals `text` one character at a time, `speedMs` per character — VN mode's ADV-style typewriter
 * effect for the dialogue box. `active: false` or `speedMs <= 0` shows the full text immediately;
 * the caller passes `speedMs: 0` for `reducedMotion`, same as every other animation in the app.
 * Restarts from scratch whenever `text`, `active`, or `speedMs` changes — a fresh line (a swipe, a
 * new reply finishing) always types out again rather than picking up mid-reveal.
 */
export function useTypewriterReveal(text: string, speedMs: number, active: boolean) {
  const [revealedLength, setRevealedLength] = useState(active && speedMs > 0 ? 0 : text.length)
  const skipRef = useRef(false)

  useEffect(() => {
    skipRef.current = false
    if (!active || speedMs <= 0) {
      setRevealedLength(text.length)
      return
    }
    setRevealedLength(0)
    let count = 0
    const id = setInterval(() => {
      count = skipRef.current ? text.length : Math.min(count + 1, text.length)
      setRevealedLength(count)
      if (count >= text.length) clearInterval(id)
    }, speedMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, active, speedMs])

  return {
    revealed: text.slice(0, revealedLength),
    done: revealedLength >= text.length,
    /** Jumps straight to the full text — VN mode's click-anywhere-to-skip. */
    skip: () => {
      skipRef.current = true
      setRevealedLength(text.length)
    },
  }
}
