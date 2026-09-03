import type { ReactNode } from 'react'

type SectionSurface = 'elevated' | 'sunken' | 'bare'

const SURFACE_CLASSES: Record<Exclude<SectionSurface, 'bare'>, string> = {
  elevated: 'bg-bg-elevated',
  sunken: 'bg-bg-sunken',
}

interface SectionProps {
  title: string
  description?: ReactNode
  /** Right-aligned header accessory — a toggle, a mode switch — sitting level with the title. */
  action?: ReactNode
  /**
   * 'elevated' (default) is for a section sitting on the bare page background (Settings tabs).
   * 'sunken' is for one nested inside an already-elevated surface (a Modal's body) so it still
   * reads as a distinct block rather than blending into the panel behind it. 'bare' skips the
   * card surface entirely, for content that supplies its own (a segmented button row, a lone
   * field + button) rather than a boxed block.
   */
  surface?: SectionSurface
  className?: string
  /** Extra classes for the inner content wrapper — e.g. `divide-y divide-border` for a list of toggles. Ignored when `surface="bare"`, which has no wrapper to apply them to. */
  contentClassName?: string
  children?: ReactNode
}

/**
 * The "labeled card" pattern — a heading, an optional one-line description, and a padded content
 * block — used throughout Settings and several modal bodies. Previously copy-pasted per section
 * (`rounded-2xl bg-bg-elevated p-6` in some files, `rounded-xl bg-bg-sunken p-4` in others, with
 * the heading's own margin drifting between mb-1/mb-2/mb-3 depending who wrote it last) rather
 * than sharing one definition — standardized here to one padding/radius per surface tier instead.
 */
export function Section({
  title,
  description,
  action,
  surface = 'elevated',
  className = '',
  contentClassName = '',
  children,
}: SectionProps) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {surface === 'bare' ? (
        children
      ) : (
        <div className={`rounded-xl p-5 ${SURFACE_CLASSES[surface]} ${contentClassName}`}>{children}</div>
      )}
    </section>
  )
}
