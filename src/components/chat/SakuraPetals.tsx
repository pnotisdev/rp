import type { CSSProperties } from 'react'

// Fixed per-petal values rather than Math.random() on every render — stable across re-renders
// (no petal "jumping" mid-fall when an unrelated state update repaints VNStage), and still reads
// as organic since the seven vary in every axis (x position, size, fall speed, start delay, and
// how far they drift sideways on the way down).
const PETALS = [
  { x: '6%', size: 12, duration: 13, delay: 0, drift: 60 },
  { x: '18%', size: 9, duration: 16, delay: 3, drift: -40 },
  { x: '34%', size: 14, duration: 12, delay: 6, drift: 30 },
  { x: '52%', size: 10, duration: 17, delay: 1.5, drift: -60 },
  { x: '68%', size: 13, duration: 14, delay: 8, drift: 50 },
  { x: '82%', size: 8, duration: 15, delay: 4.5, drift: -30 },
  { x: '93%', size: 11, duration: 18, delay: 10, drift: 40 },
]

/** A single soft, rounded petal shape — four overlapping lobes, not a generic circle/diamond. */
function Petal() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full text-romance/70" fill="currentColor">
      <path d="M12 2c2 3 2 6 0 8-2-2-2-5 0-8Zm0 20c-2-3-2-6 0-8 2 2 2 5 0 8ZM2 12c3-2 6-2 8 0-2 2-5 2-8 0Zm20 0c-3 2-6 2-8 0 2-2 5-2 8 0Z" />
    </svg>
  )
}

/**
 * Ambient falling-petal layer behind the VN scene — the "keep improving the design" ask, and a
 * genuinely open ROADMAP item ("subtle ambient particle/gradient effects... optional falling
 * sakura petals layer"). VNStage only mounts this for outdoor backgrounds where petals make
 * sense (park/forest/rooftop/city-street/beach) — the parent decides that, this just renders.
 */
export function SakuraPetals() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {PETALS.map((p, i) => (
        <div
          key={i}
          className="sakura-petal"
          style={
            {
              '--x': p.x,
              '--size': `${p.size}px`,
              '--duration': `${p.duration}s`,
              '--delay': `${p.delay}s`,
              '--drift': `${p.drift}px`,
            } as CSSProperties
          }
        >
          <Petal />
        </div>
      ))}
    </div>
  )
}
