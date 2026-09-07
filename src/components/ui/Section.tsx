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
  /** 'elevated' (default) sits on the bare page background; 'sunken' nests inside an already-elevated surface; 'bare' skips the card surface entirely. */
  surface?: SectionSurface
  className?: string
  /** Extra classes for the inner content wrapper; ignored when `surface="bare"`. */
  contentClassName?: string
  children?: ReactNode
}

/** The "labeled card" pattern — heading, optional description, padded content block — used throughout Settings and modal bodies. */
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {surface === 'bare' ? (
        children
      ) : (
        <div className={`rounded-xl p-4 sm:p-5 ${SURFACE_CLASSES[surface]} ${contentClassName}`}>{children}</div>
      )}
    </section>
  )
}
