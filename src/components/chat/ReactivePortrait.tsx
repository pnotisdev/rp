import { useSpriteCrossfade } from '@/lib/hooks/useSpriteCrossfade'

/**
 * 10b's other open half, alongside the live-scene opener: VN mode's sprite already reacts to the
 * model's own scene tags turn by turn, but the *default* (non-VN) layout had nothing equivalent —
 * a live date/hangout read exactly like an ordinary text chat with no visual sense of the
 * character actually being there. A small floating portrait, live only while a scene is active,
 * crossfading between expressions with the same `useSpriteCrossfade` VNStage uses, so the two
 * surfaces can never drift into different transition feels.
 *
 * Deliberately narrow in scope: no background, no dialogue box, no scene chrome — VN mode already
 * owns that whole presentation, and duplicating it here would just be a second, worse VN mode
 * layered under the ordinary chat. This is the one missing visual cue, not a redesign.
 */
export function ReactivePortrait({ spriteUrl, alt }: { spriteUrl: string | undefined; alt: string }) {
  const { displaySrc, visible, fadeMs } = useSpriteCrossfade(spriteUrl)
  if (!displaySrc) return null

  return (
    <div
      // Hidden below `sm`: a phone-width default chat is already tight on room (see this file's
      // own mobile-ergonomics history) — VN mode is the intended immersive experience there, so a
      // floating portrait on top of the transcript would just be in the way, not additive.
      // `animate-panel-in` is the same fade+settle every modal/toast in the app already uses on
      // mount — reused rather than a bespoke entrance, and already covered by both reduced-motion
      // guards for free. It fires once, when the scene starts (this component mounts/unmounts with
      // `liveDateActive`), not on every expression crossfade, which is a plain opacity transition.
      className="animate-panel-in pointer-events-none absolute right-4 top-4 z-10 hidden overflow-hidden rounded-2xl bg-bg-elevated shadow-lg ring-1 ring-romance/20 sm:block"
      aria-hidden="true"
    >
      <img
        src={displaySrc}
        alt={alt}
        className={`h-32 w-24 object-cover transition-opacity ease-out lg:h-40 lg:w-28 ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{ transitionDuration: `${fadeMs}ms` }}
      />
    </div>
  )
}
