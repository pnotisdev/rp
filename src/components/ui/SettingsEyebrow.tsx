/**
 * A named-progression divider for a long Settings tab (today: Generation, ~16 sections deep) —
 * "Basics" / "Authoring" / "Power user" read as optional rungs to climb, not a wall of equally-
 * weighted cards. A label + a rule rather than a bare label so it still reads as a group divider
 * regardless of `SettingsPage`'s own uniform `space-y-10` between it and the section below.
 */
export function SettingsEyebrow({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-text-muted">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
