/**
 * A thin strip shown while post-reply "assist" model calls (relationship scoring, choice
 * suggestions, objective checks, memory summary) are still running — so a result popping in a few
 * seconds after the reply reads as expected work rather than a glitch. Fed by
 * `useChatSession().assistActivity`.
 */
export function AssistActivityBar({ items, variant = 'default' }: { items: string[]; variant?: 'default' | 'vn' }) {
  if (items.length === 0) return null
  const tone = variant === 'vn' ? 'text-white/55' : 'text-text-muted'
  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-[11px] ${tone}`} aria-live="polite">
      <span className="flex gap-[3px]">
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      </span>
      <span className="truncate">{items.join(' · ')}</span>
    </div>
  )
}
