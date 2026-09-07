import { useSpriteCrossfade } from '@/lib/hooks/useSpriteCrossfade'

/**
 * A small floating portrait for the default (non-VN) layout, shown only while a live date/hangout
 * scene is active, crossfading between expressions with the same `useSpriteCrossfade` as VNStage.
 * Deliberately narrow: no background, dialogue box, or scene chrome — just the one missing visual cue.
 */
export function ReactivePortrait({ spriteUrl, alt }: { spriteUrl: string | undefined; alt: string }) {
  const { displaySrc, visible, fadeMs } = useSpriteCrossfade(spriteUrl)
  if (!displaySrc) return null

  return (
    <div
      // Hidden below `sm` — a phone-width chat is already tight on room; VN mode is the intended
      // experience there. animate-panel-in reuses the app's standard modal/toast entrance, firing
      // once on mount (scene start), not on every expression crossfade.
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
