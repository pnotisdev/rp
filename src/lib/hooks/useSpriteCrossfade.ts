import { useEffect, useState } from 'react'

const SPRITE_FADE_MS = 200

/** Swaps between expression sprites with a brief dip-to-transparent instead of a hard cut. */
export function useSpriteCrossfade(src: string | undefined) {
  const [displaySrc, setDisplaySrc] = useState(src)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (src === displaySrc) return
    setVisible(false)
    const t = setTimeout(() => {
      setDisplaySrc(src)
      setVisible(true)
    }, SPRITE_FADE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return { displaySrc, visible, fadeMs: SPRITE_FADE_MS }
}
