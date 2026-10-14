/** A named-progression divider for a long Settings tab (today */
export function SettingsEyebrow({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
