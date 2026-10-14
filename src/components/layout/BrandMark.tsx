// The logo: a little box (the tray) holding a small sun (the world), drawn in the current text colour and accent.

export function BrandMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={`shrink-0 ${className}`}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="6.6" r="2.3" fill="rgb(var(--c-accent))" />
      <path d="M4.6 11.2h6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
