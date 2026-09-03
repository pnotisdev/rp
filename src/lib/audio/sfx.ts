/**
 * Tiny WebAudio-generated UI sounds — a message-send blip and a two-note notification chime
 * (section 6's "Optional UI SFX"). Synthesized rather than shipped as audio files, so there's
 * nothing to source/license and nothing added to the bundle; each is a couple of short sine
 * tones with a fast attack/decay envelope. Both no-op silently if WebAudio isn't available
 * (e.g. a very old browser, or a test/SSR environment) or hasn't been unlocked by a user
 * gesture yet — sound is a nice-to-have, never worth throwing over.
 */

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function tone(c: AudioContext, freq: number, startOffset: number, duration: number, peakGain: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const start = c.currentTime + startOffset
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** A short, quiet blip on sending a message. */
export function playSendBlip(): void {
  const c = getContext()
  if (!c) return
  try {
    tone(c, 720, 0, 0.08, 0.045)
  } catch {
    // WebAudio can throw in odd embedded/test environments — never let a sound effect break sending.
  }
}

/** A brighter two-note chime for a genuine reward moment (stage-up, an unlock, a "yes"). */
export function playNotificationChime(): void {
  const c = getContext()
  if (!c) return
  try {
    tone(c, 660, 0, 0.12, 0.045)
    tone(c, 880, 0.09, 0.18, 0.045)
  } catch {
    // See playSendBlip — never let this throw.
  }
}
