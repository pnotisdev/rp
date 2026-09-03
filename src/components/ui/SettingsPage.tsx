import type { ReactNode } from 'react'

/** The shared outer container for every Settings tab — one column width and one inter-section gap, instead of each tab picking its own (max-w-md/2xl, space-y-8/14 all appeared before). */
export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="max-w-2xl space-y-10">{children}</div>
}
