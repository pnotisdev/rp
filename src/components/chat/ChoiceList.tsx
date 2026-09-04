import { Gift, MessageSquare, RotateCcw, Zap, type LucideIcon } from 'lucide-react'
import type { ChoiceOption } from '@/lib/types'

interface ChoiceListProps {
  choices: ChoiceOption[]
  onPick: (choice: ChoiceOption) => void
  onRefresh: () => void
  refreshing: boolean
  /** 'vn' drops the chip's own surface/border so it reads as part of the glass dialogue box it's nested in, instead of a separate app-chrome card floating over the scene. */
  variant?: 'default' | 'vn'
}

// A small icon reads the kind at a glance without a boxed text tag competing with the chip's
// own pill shape — one rounded surface per choice instead of a pill nested inside a pill.
const KIND_ICON: Record<ChoiceOption['kind'], LucideIcon> = { gift: Gift, action: Zap, line: MessageSquare }

const CHIP_CLASSES = {
  default: 'bg-bg-elevated text-text hover:bg-accent/10 hover:text-accent',
  vn: 'bg-white/10 text-white hover:bg-white/20',
}
const KIND_ICON_CLASSES = { default: 'text-accent', vn: 'text-accent' }
const REFRESH_CLASSES = {
  default: 'text-text-muted hover:bg-bg-sunken hover:text-text',
  vn: 'text-white/60 hover:bg-white/10 hover:text-white',
}
const GIFT_NAME_CLASSES = { default: 'text-text-muted', vn: 'text-white/60' }

/** The "what happens next" prompt shown once a reply lands — picking one sends it and moves the scene forward. Wrapped pill chips rather than stacked full-width rows, so a set of 3 doesn't cost three lines of vertical space. */
export function ChoiceList({ choices, onPick, onRefresh, refreshing, variant = 'default' }: ChoiceListProps) {
  return (
    <div className={`flex w-full flex-wrap items-center gap-2 ${variant === 'default' ? 'mx-auto max-w-chat px-4 pb-2.5' : ''}`}>
      {choices.map((choice, i) => {
        const KindIcon = KIND_ICON[choice.kind]
        return (
          <button
            key={choice.id || i}
            onClick={() => onPick(choice)}
            className={`flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-left text-sm transition-colors ${CHIP_CLASSES[variant]}`}
          >
            <KindIcon size={13} strokeWidth={2} className={`shrink-0 ${KIND_ICON_CLASSES[variant]}`} />
            {choice.label}
            {choice.kind === 'gift' && choice.giftName && (
              <span className={`text-xs ${GIFT_NAME_CLASSES[variant]}`}>({choice.giftName})</span>
            )}
          </button>
        )
      })}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="Different options"
        aria-label="Different options"
        className={`flex items-center gap-1 rounded-full px-2 py-1.5 text-xs transition-colors disabled:opacity-40 ${REFRESH_CLASSES[variant]}`}
      >
        <RotateCcw size={13} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Thinking…' : 'Different options'}
      </button>
    </div>
  )
}
