import { useEffect, useRef, useState } from 'react'

/** Reveals `text` one character at a time, `speedMs` per character — VN mode's ADV-style typewriter effect for the dialogue box. */
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
