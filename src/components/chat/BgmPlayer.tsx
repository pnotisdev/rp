import { useEffect, useRef } from 'react'
import type { SceneTag } from '@/lib/vn/sceneTag'
import type { WorldCard } from '@/lib/types'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useAudioDuckStore } from '@/lib/store/useAudioDuckStore'
import { resolveBgmTrack } from '@/lib/audio/bgm'

const CROSSFADE_MS = 1400
const STEP_MS = 40
const DUCK_FACTOR = 0.22

/**
 * Background music for VN / Companion mode. Renders nothing visible — a pair of looping `<audio>`
 * elements that crossfade whenever the resolved track changes (the model tags a new mood, the
 * scene moves to a location with its own track, the chat switches worlds). Silent and inert until
 * the user raises `bgmVolume` above 0 in Settings — dragging that slider is itself the user
 * gesture that unlocks browser audio. Drops to a low level (not silent) while `useAudioDuckStore`
 * is ducked (Companion mode's TTS).
 *
 * The fade is driven by a wall-clock `setInterval` rather than `requestAnimationFrame`: rAF is
 * paused outright in a background tab, which would leave a crossfade frozen half-done; a timer
 * keeps ticking (throttled, but ticking) and each step recomputes the volume from real elapsed
 * time, so the fade still lands on target in ~1.4s even if the steps are coarse.
 */
export function BgmPlayer({ world, scene }: { world?: WorldCard; scene?: SceneTag }) {
  const bgmVolume = useSettingsStore((s) => s.bgmVolume)
  const ducked = useAudioDuckStore((s) => s.ducked)

  const track = bgmVolume > 0 ? resolveBgmTrack(world, scene) : undefined
  const targetVolume = bgmVolume * (ducked ? DUCK_FACTOR : 1)

  const aRef = useRef<HTMLAudioElement>(null)
  const bRef = useRef<HTMLAudioElement>(null)
  const s = useRef({ activeIsA: true, appliedTrack: undefined as string | undefined, timer: 0 as ReturnType<typeof setInterval> | 0 }).current

  useEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (!a || !b) return

    // A track change hands playback to the other element; the previous one fades out.
    if (track !== s.appliedTrack) {
      s.appliedTrack = track
      if (track) {
        s.activeIsA = !s.activeIsA
        const incoming = s.activeIsA ? a : b
        if (incoming.src !== absolute(track)) {
          incoming.src = track
          incoming.volume = 0
          try {
            incoming.currentTime = 0
          } catch {
            /* not seekable yet */
          }
        }
        playWithUnlock(incoming)
      }
    }

    const active = s.activeIsA ? a : b
    const other = s.activeIsA ? b : a
    const activeFrom = active.volume
    const activeTo = track ? targetVolume : 0
    const otherFrom = other.volume
    const startedAt = performance.now()

    if (s.timer) clearInterval(s.timer)
    const step = () => {
      const t = Math.min(1, (performance.now() - startedAt) / CROSSFADE_MS)
      active.volume = clamp01(activeFrom + (activeTo - activeFrom) * t)
      if (!other.paused) {
        other.volume = clamp01(otherFrom * (1 - t))
        if (other.volume <= 0.001) other.pause()
      }
      if (t >= 1) {
        active.volume = activeTo
        if (!track) active.pause()
        clearInterval(s.timer)
        s.timer = 0
      }
    }
    step()
    s.timer = setInterval(step, STEP_MS)

    return () => {
      if (s.timer) clearInterval(s.timer)
      s.timer = 0
    }
  }, [track, targetVolume, s])

  useEffect(() => {
    return () => {
      if (s.timer) clearInterval(s.timer)
      aRef.current?.pause()
      bRef.current?.pause()
    }
  }, [s])

  return (
    <>
      <audio ref={aRef} loop preload="auto" />
      <audio ref={bRef} loop preload="auto" />
    </>
  )
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function absolute(url: string): string {
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

/**
 * `.play()` rejects until the page has had a user gesture. Retry once on the next global
 * pointer/key event — by which point the browser has "unlocked" audio for the session.
 */
function playWithUnlock(el: HTMLAudioElement) {
  el.play().catch(() => {
    const retry = () => {
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
      el.play().catch(() => {})
    }
    window.addEventListener('pointerdown', retry, { once: true })
    window.addEventListener('keydown', retry, { once: true })
  })
}
