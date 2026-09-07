import { Gift, MessageSquare, RotateCcw, Zap, type LucideIcon } from 'lucide-react'
import type { ChoiceOption } from '@/lib/types'

const KIND_ICON: Record<ChoiceOption['kind'], LucideIcon> = { gift: Gift, action: Zap, line: MessageSquare }

/**
 * `vnChoiceStyle: 'centered'` — a real VN choice screen: the whole stage dims, and the AI-suggested
 * choices stack full-width down the middle, instead of the docked pill row. `VNStage` renders this
 * as a sibling of the dock panel (not nested inside it) so it can cover the entire scene, and only
 * ever for genuine AI-suggested choices — quick replies stay docked either way (see `VNStage`'s own
 * doc comment on `choiceListSlot` vs `activeChoiceData`).
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
  return (
    <div className="vn-centered-choices absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/55 px-6 backdrop-blur-[2px]">
      <div className="flex w-full max-w-md flex-col gap-2.5">
        {choices.map((choice, i) => {
          const KindIcon = KIND_ICON[choice.kind]
          return (
            <button
              key={choice.id || i}
              onClick={() => onPick(choice)}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-5 py-3.5 text-left text-[15px] text-white shadow-[0_10px_30px_-12px_rgb(0_0_0_/_0.7)] backdrop-blur-sm transition-colors hover:border-accent/50 hover:bg-white/20"
            >
              <KindIcon size={16} strokeWidth={2} className="shrink-0 text-accent" />
              <span className="flex-1">
                {choice.label}
                {choice.kind === 'gift' && choice.giftName && <span className="ml-1.5 text-sm text-white/60">({choice.giftName})</span>}
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
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <RotateCcw size={13} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Thinking…' : 'Different options'}
      </button>
    </div>
  )
}
