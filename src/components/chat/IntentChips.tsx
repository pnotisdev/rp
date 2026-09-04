import type { RelationshipDimension } from '@/lib/types'
import { availableIntents, type MessageIntent } from '@/lib/dating/intent'

/**
 * 10b's intent chips — a quiet row inside the composer for tagging *how* the next line is meant.
 * Arming a chip attaches it to the message you send next, then disarms. The tag never moves a stat
 * on its own; it's context for the relationship judge, and can land badly if misread (`intent.ts`).
 *
 * Lives inside the composer card (passed as `Composer`'s `intentSlot`) rather than as its own bar,
 * so it reads as part of composing a message. Reassure and Apologize only appear once there's
 * friction to repair (tension elevated).
 */
export function IntentChips({
  stats,
  armed,
  onArm,
  variant = 'default',
}: {
  stats: Partial<Record<RelationshipDimension, number>>
  armed: MessageIntent | null
  onArm: (intent: MessageIntent | null) => void
  variant?: 'default' | 'vn'
}) {
  const intents = availableIntents(stats)
  if (intents.length === 0) return null
  const vn = variant === 'vn'

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className={`mr-0.5 text-[11px] ${vn ? 'text-white/45' : 'text-text-muted/70'}`}>Intent</span>
      {intents.map((spec) => {
        const active = armed === spec.id
        return (
          <button
            key={spec.id}
            type="button"
            title={spec.hint}
            onClick={() => onArm(active ? null : spec.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors ${
              active
                ? vn
                  ? 'bg-accent/30 text-white ring-1 ring-accent/60'
                  : 'bg-accent text-accent-text'
                : vn
                  ? 'text-white/65 hover:bg-white/10 hover:text-white'
                  : 'text-text-muted hover:bg-bg-elevated hover:text-text'
            }`}
          >
            {spec.label}
          </button>
        )
      })}
    </div>
  )
}
