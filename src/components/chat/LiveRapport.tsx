import { RAPPORT_READS } from '@/lib/dating/rapport'
import type { RapportRead } from '@/lib/types'

/**
 * 10b's live rapport indicator — shown in place of the frozen warmth readout while a live date is
 * running (the number can't move during a date; this is the qualitative read instead). A dot in a
 * trend colour plus a short phrase; the judge's one-line observation is the tooltip. Never shows a
 * number.
 */
const TONE: Record<string, string> = {
  'up-strong': 'bg-accent',
  up: 'bg-accent/70',
  flat: 'bg-text-muted',
  down: 'bg-warning',
  'down-strong': 'bg-danger',
}
const TONE_VN: Record<string, string> = {
  'up-strong': 'bg-accent',
  up: 'bg-accent/80',
  flat: 'bg-white/60',
  down: 'bg-warning',
  'down-strong': 'bg-danger',
}

export function LiveRapport({ read, variant = 'default' }: { read: RapportRead | null | undefined; variant?: 'default' | 'vn' }) {
  if (!read) return null
  const spec = RAPPORT_READS[read.trajectory]
  if (!spec) return null
  const vn = variant === 'vn'

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 ${vn ? 'text-white/85' : 'text-text-muted'}`}
      title={read.note ? `${spec.label} — ${read.note}` : spec.label}
    >
      <span className={`shrink-0 text-[10px] uppercase tracking-[0.06em] ${vn ? 'text-white/45' : 'text-text-muted/60'}`}>
        Live date
      </span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${(vn ? TONE_VN : TONE)[spec.tone]}`} />
      <span className={`truncate ${vn ? 'text-white/90' : 'text-text'}`}>{spec.label}</span>
    </span>
  )
}
