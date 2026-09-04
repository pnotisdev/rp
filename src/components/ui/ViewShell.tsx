import type { ReactNode } from 'react'

interface ViewShellProps {
  title: string
  /** One short paragraph under the title — what this view is for. */
  description?: ReactNode
  /** Right-aligned header actions, level with the title — usually the primary "New …" button. */
  actions?: ReactNode
  /**
   * 'normal' (default, max-w-3xl) for text- and list-heavy views (Personas, World Info);
   * 'wide' (max-w-4xl) for the portrait/CG grids (Characters, Worlds, Gallery).
   */
  width?: 'normal' | 'wide'
  children: ReactNode
}

const WIDTH_CLASS: Record<NonNullable<ViewShellProps['width']>, string> = {
  normal: 'max-w-3xl',
  wide: 'max-w-4xl',
}

/**
 * The shared outer frame for every top-level view (Characters, Worlds, Personas, World Info,
 * Gallery, Settings): one column width, one responsive page padding, and one header treatment —
 * a `font-display` title, an optional one-paragraph description, and an optional right-aligned
 * action. Replaces each view rolling its own `mx-auto max-w-* p-8` plus a header row whose
 * heading size and bottom margin had drifted apart (Gallery in particular used a small `text-sm`
 * heading and no centered column at all).
 */
export function ViewShell({ title, description, actions, width = 'normal', children }: ViewShellProps) {
  return (
    <div className={`mx-auto w-full flex-1 overflow-y-auto p-4 sm:p-8 ${WIDTH_CLASS[width]}`}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg text-text">{title}</h2>
          {description && <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
