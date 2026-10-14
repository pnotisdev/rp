import type { ReactNode } from 'react'

interface ViewShellProps {
  title: string
  /** One short paragraph under the title — what this view is for. */
  description?: ReactNode
  /** Right-aligned header actions, level with the title — usually the primary "New …" button. */
  actions?: ReactNode
  children: ReactNode
}

/** The shared frame for every top-level view: one scroll area, one centered column, one header. */
export function ViewShell({ title, description, actions, children }: ViewShellProps) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-text">{title}</h2>
            {description && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}
