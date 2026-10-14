/** A thin strip shown while post-reply "assist" model calls (relationship scoring, choice suggestions, objective checks, memory… */
export function AssistActivityBar({ items, variant = 'default' }: { items: string[]; variant?: 'default' | 'vn' }) {
  if (items.length === 0) return null
  const tone = variant === 'vn' ? 'text-white/55' : 'text-text-muted'
  return (
    <div
      className={`flex items-center gap-2 py-1.5 text-[11px] ${tone} ${
        variant === 'vn' ? 'px-4' : 'mx-auto w-full max-w-chat px-4'
      }`}
      aria-live="polite"
    >
      <span className="flex gap-[3px]">
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      </span>
      <span className="truncate">{items.join(' · ')}</span>
    </div>
  )
}
