import { useEffect, useState } from 'react'

const FRAMES = ['|', '/', '-', '\\']

/** A terminal-style ascii spinner — fits the app's monospace/ascii icon language better than a CSS spinner ring. */
export function Spinner({ className = '' }: { className?: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120)
    return () => clearInterval(id)
  }, [])
  return <span className={`font-mono ${className}`}>{FRAMES[frame]}</span>
}
