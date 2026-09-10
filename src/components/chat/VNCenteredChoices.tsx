import { useEffect } from 'react'
import { Gift, MessageSquare, RotateCcw, Zap, type LucideIcon } from 'lucide-react'
import type { ChoiceOption } from '@/lib/types'

const KIND_ICON: Record<ChoiceOption['kind'], LucideIcon> = { gift: Gift, action: Zap, line: MessageSquare }

/**
 * `vnChoiceStyle: 'centered'` — the genre's own choice screen: the options float over the scene as
 * a stack of wide bars, roughly where a VN puts them, rather than as a docked pill row.
 *
 * Two things changed from the first pass at this. It sits high (over the character, above the
 * dialogue box) instead of dead centre, so the sprite and the line that prompted the choice both
 * stay readable underneath — the whole point is that this is a beat *in* the scene, not a screen
 * that replaces it. And the scrim is much lighter, for the same reason: enough separation to read
 * the bars against, not a blackout.
 *
 * `VNStage` renders this as a sibling of the dialogue box (not nested inside it) so it can span the
 * whole stage, and only ever for genuine AI-suggested choices — quick replies stay docked either
 * way (see `VNStage`'s own doc comment on `choiceListSlot` vs `activeChoiceData`).
 */
export function VNCenteredChoices({
  choices,
  onPick,
  onRefresh,
  refreshing,
}: {
  choices: ChoiceOption[]
  onPick: (choice: ChoiceOption) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  // Number keys, the way every VN on a keyboard works. Bound while the screen is up and released
  // with it, so nothing is listening once the choice is made.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > choices.length) return
      e.preventDefault()
      onPick(choices[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choices, onPick])

  return (
    <div className="vn-centered-choices pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[78%] flex-col items-center justify-center gap-3 px-5">
      {/* A soft pool of shade behind the stack rather than a full-stage dim — the art stays the subject. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgb(0 0 0 / 0.55), transparent 78%)' }}
      />
      <div className="pointer-events-auto relative flex w-full max-w-xl flex-col gap-2.5">
        {choices.map((choice, i) => {
          const KindIcon = KIND_ICON[choice.kind]
          return (
            <button
              key={choice.id || i}
              onClick={() => onPick(choice)}
              style={{ '--i': i } as React.CSSProperties}
              className="vn-choice-row vn-glass group/choice relative flex w-full items-center gap-3 overflow-hidden rounded-2xl py-3.5 pl-4 pr-5 text-left text-[15px] text-white/90 transition-[color,background-color,transform] duration-150 hover:translate-x-1 hover:bg-white/[0.14] hover:text-white"
            >
              {/* The accent rule only lights on the hovered/focused row — a pointer, not decoration on every bar. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px] bg-accent opacity-0 transition-opacity group-hover/choice:opacity-100 group-focus-visible/choice:opacity-100"
              />
              <span className="w-4 shrink-0 text-center font-mono text-[11px] text-white/35 transition-colors group-hover/choice:text-accent">
                {i + 1}
              </span>
              <KindIcon size={15} strokeWidth={2} className="shrink-0 text-accent/85" />
              <span className="flex-1">
                {choice.label}
                {choice.kind === 'gift' && choice.giftName && <span className="ml-1.5 text-sm text-white/55">({choice.giftName})</span>}
              </span>
            </button>
          )
        })}
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="Different options"
        aria-label="Different options"
        className="vn-glass pointer-events-auto relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/55 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-40"
      >
        <RotateCcw size={13} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Thinking…' : 'Different options'}
      </button>
    </div>
  )
}
