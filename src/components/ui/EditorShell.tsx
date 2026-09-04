import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

export interface EditorTab {
  id: string
  label: string
  /** Shown as a small count/dot next to the label — e.g. number of entries in a list tab. */
  badge?: number
}

/**
 * The shared frame for a full-page editor (world, character): a fixed header with a back button,
 * an eyebrow + title, and optional right-aligned actions; an optional horizontal tab strip; a
 * scrolling content column; and a sticky footer for the save/delete bar. Replaces the ad-hoc
 * "back button + mx-auto max-w-2xl + border-t footer" each editor rolled by hand.
 */
export function EditorShell({
  onBack,
  backLabel = 'Back',
  eyebrow,
  title,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  footer,
  children,
}: {
  onBack: () => void
  backLabel?: string
  eyebrow?: string
  title: string
  headerActions?: ReactNode
  tabs?: EditorTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-bg-elevated">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1 rounded-lg py-1 pr-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            {backLabel}
          </button>
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{eyebrow}</div>
            )}
            <div className="truncate font-display text-base text-text">{title}</div>
          </div>
          {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
        </div>

        {tabs && tabs.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            {/* Mobile: a native select is a far better picker than a strip that scrolls a few
                tabs at a time off-screen with no affordance. Desktop keeps the visible strip. */}
            <select
              value={activeTab}
              onChange={(e) => onTabChange?.(e.target.value)}
              className="mb-2 mt-1 w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:hidden"
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.badge !== undefined && t.badge > 0 ? ` (${t.badge})` : ''}
                </option>
              ))}
            </select>
            <div className="hidden gap-1 overflow-x-auto sm:flex">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTabChange?.(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                    activeTab === t.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  {t.label}
                  {t.badge !== undefined && t.badge > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] ${
                        activeTab === t.id ? 'bg-accent/15 text-accent' : 'bg-bg-sunken text-text-muted'
                      }`}
                    >
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </div>

      {footer && (
        <div className="shrink-0 border-t border-border bg-bg-elevated">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">{footer}</div>
        </div>
      )}
    </div>
  )
}
