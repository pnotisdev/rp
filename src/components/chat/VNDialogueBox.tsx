import { forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'

/**
 * VN mode's dialogue box: one floating glass panel of a **fixed height**, carrying either the
 * character's line or — in `inline` input mode — the player's own, in the same frame.
 *
 * The height is fixed on purpose. The box used to grow with its content (`min-h` to `max-h-[40vh]`)
 * and had the composer, choices and a utility row all stacked inside it, so the scene it was
 * covering resized on every turn and the art never got to be the subject. Now the frame is a
 * constant, long replies scroll inside it, and everything that isn't dialogue lives outside it.
 *
 * The read/write swap is deliberately loud where it matters and invisible where it doesn't: the
 * nameplate identity, the accent rail down the left edge, and the caret all change; the frame,
 * its position and its height do not. That's what keeps "the same box is both people" legible
 * rather than confusing — you always know whose box it is, and nothing under it ever moves.
 */

export interface VNPlateColors {
  /** Nameplate text, set on the box's own glass. */
  name: string
  /** Monogram chip fill, when there's no avatar. */
  chip: string
}

interface VNDialogueBoxProps {
  speakerName: string
  speakerAvatarUrl?: string
  /** Monogram fallback, computed by the caller so both surfaces agree on it. */
  initials: string
  plate: VNPlateColors
  /** True while the player owns the box — swaps the nameplate to their persona and the body to the composer. */
  writing: boolean
  /** Rendered dialogue (already run through the message/SFX renderer). Read state only. */
  children: ReactNode
  /** The composer, rendered in place of the dialogue while `writing`. */
  composer: ReactNode
  /** Streaming caret. */
  streaming?: boolean
  /** ADV "line finished" glyph. */
  complete?: boolean
  /** A small caption under the line — an intimacy-action badge, a generation-failure note. */
  caption?: ReactNode
  /** Swipe/regenerate/voice/pin cluster, docked to the box's top-right and faded until hover. */
  utilities?: ReactNode
  /** Read state's footer affordance: clicking it (or the box) hands the box over. Omitted in `docked` input mode, where the composer lives below instead. */
  onStartWriting?: () => void
  /** Escape out of write state. */
  onStopWriting?: () => void
  /** Who the box becomes when the player writes. */
  personaLabel: string
}

export const VNDialogueBox = forwardRef<HTMLDivElement, VNDialogueBoxProps>(function VNDialogueBox(
  {
    speakerName,
    speakerAvatarUrl,
    initials,
    plate,
    writing,
    children,
    composer,
    streaming,
    complete,
    caption,
    utilities,
    onStartWriting,
    onStopWriting,
    personaLabel,
  },
  bodyRef,
) {
  // The caret belongs in the box the instant it becomes the player's — taking it over and then
  // having to click it would defeat the whole point of the swap. Reached through the DOM rather
  // than a `Composer` prop so the composer stays a plain slot this component knows nothing about.
  const writeAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (writing) writeAreaRef.current?.querySelector('textarea')?.focus()
  }, [writing])

  return (
    <div
      className="vn-stack group/vnbox relative pb-3 sm:pb-5"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && writing) onStopWriting?.()
      }}
    >
      {/* Utilities float above the frame rather than taking a row inside it, so the box's fixed
          height is all dialogue. Near-invisible at rest; full opacity on hover or keyboard focus. */}
      {utilities && !writing && (
        <div className="pointer-events-none absolute -top-1 right-4 z-20 flex justify-end opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/vnbox:opacity-100 sm:right-6">
          <div className="vn-glass pointer-events-auto flex items-center gap-0.5 rounded-full px-1.5 py-1">{utilities}</div>
        </div>
      )}

      {/* Whose box it is reads off the nameplate — avatar and name in read state, the persona in
          accent with a pen glyph in write state. Write state adds a soft accent ring around the
          whole frame, the ordinary "this field is live" signal, instead of a coloured bar down one
          edge: at this size a hard stripe was the loudest thing on screen, next to art it was
          supposed to be deferring to. */}
      <div
        className={`vn-box vn-glass-solid relative overflow-hidden rounded-[22px] transition-shadow duration-200 ${
          writing ? 'ring-1 ring-accent/30' : ''
        }`}
      >

        <div className="flex items-center gap-2.5 px-4 pb-1 pt-3 sm:px-6">
          {writing ? (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Pencil size={12} strokeWidth={2.25} />
              </span>
              <span className="font-display text-[15px] font-semibold leading-none text-accent">{personaLabel}</span>
              <span className="ml-auto hidden text-[10px] uppercase tracking-[0.14em] text-white/35 sm:inline">
                Enter to send · Esc to cancel
              </span>
            </>
          ) : (
            <>
              {speakerAvatarUrl ? (
                <img src={speakerAvatarUrl} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-white/20" />
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full font-display text-[10px] text-white ring-1 ring-white/15"
                  style={{ backgroundColor: plate.chip }}
                >
                  {initials}
                </span>
              )}
              <span className="font-display text-[15px] font-semibold leading-none" style={{ color: plate.name }}>
                {speakerName}
              </span>
            </>
          )}
        </div>

        {/* The fixed frame. Write state takes the footer strip's height too (its own control row
            sits there instead), so the outer box is the same size either way — see `.vn-box` in
            globals.css. Nothing below this ever shifts. */}
        <div className={`px-4 sm:px-6 ${writing ? 'vn-box-body-write' : 'vn-box-body'}`}>
          {writing ? (
            <div ref={writeAreaRef} className="h-full pb-2 pt-1">
              {composer}
            </div>
          ) : (
            <div ref={bodyRef} className="h-full overflow-y-auto pb-2 pt-1.5">
              <p
                className="vn-dialogue whitespace-pre-wrap text-[15px] leading-[1.75] text-white/95 sm:text-base"
                style={{ textShadow: '0 1px 3px rgb(0 0 0 / 0.55)' }}
              >
                {children}
                {streaming && <span className="cursor-blink font-mono">▋</span>}
                {complete && (
                  <ChevronDown size={13} strokeWidth={2.5} className="vn-next-glyph ml-1 inline-block align-[-1px] text-white/60" aria-hidden />
                )}
              </p>
              {caption}
            </div>
          )}
        </div>

        {/* Read state's one footer line — the invitation to take the box over. Same height as
            nothing at all in write state, because the composer's own control row sits there instead. */}
        {!writing && onStartWriting && (
          <button
            type="button"
            onClick={onStartWriting}
            className="vn-box-foot flex w-full items-center gap-2 border-t border-white/[0.07] px-4 text-left text-[13px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/75 sm:px-6"
          >
            <Pencil size={12} strokeWidth={2} className="shrink-0" />
            <span className="truncate">Say something as {personaLabel}…</span>
            <span className="ml-auto hidden shrink-0 rounded border border-white/15 px-1.5 py-px text-[10px] tracking-wide text-white/35 sm:inline">
              Enter
            </span>
          </button>
        )}
      </div>
    </div>
  )
})
