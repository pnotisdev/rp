import type { ReactNode } from 'react'

/**
 * The shared "nothing here yet" block — a dashed-outline panel with a line of guidance and an
 * optional primary action. Used for the empty grid/list state of every top-level view instead of
 * each one hand-rolling its own (a dashed border in some, a solid `bg-bg-elevated` card in
 * others, a bare centered `<p>` elsewhere).
 */
export function EmptyState({
  children,
  action,
  className = '',
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center ${className}`}
    >
      <p className="max-w-sm text-sm leading-relaxed text-text-muted">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
