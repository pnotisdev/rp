// The chat dock: a side drawer that hosts extension panels placed in the "chat" slot.

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ExtensionRecord, PanelSpec } from '@/lib/extensions/manifest'
import { useExtensions } from '@/lib/extensions/useExtensions'
import { ExtensionFrame } from './ExtensionFrame'

export function chatPanels(extensions: ExtensionRecord[] | undefined): { ext: ExtensionRecord; panel: PanelSpec }[] {
  return (extensions ?? []).filter((e) => e.enabled).flatMap((ext) => ext.manifest.panels.filter((p) => p.slots.includes('chat')).map((panel) => ({ ext, panel })))
}

export function ExtensionDock({ onClose, onOpenExtensions }: { onClose: () => void; onOpenExtensions?: () => void }) {
  const extensions = useExtensions()
  const items = chatPanels(extensions)
  const [index, setIndex] = useState(0)
  const current = items[Math.min(index, Math.max(0, items.length - 1))]

  return (
    <aside
      data-rp-part="dock"
      className="animate-panel-in fixed inset-y-3 right-3 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated"
      aria-label="Extensions"
    >
      <header className="flex items-center gap-1 px-2 pb-1 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.map((item, i) => (
            <button
              key={`${item.ext.id}:${item.panel.id}`}
              onClick={() => setIndex(i)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                current === item ? 'bg-accent/10 font-medium text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'
              }`}
            >
              <span>{item.panel.glyph}</span>
              {item.panel.title}
            </button>
          ))}
        </div>
        <button onClick={onClose} title="Close" aria-label="Close" className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-sunken hover:text-text">
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {current ? (
          <ExtensionFrame ext={current.ext} panel={current.panel} surface="chat" onClose={onClose} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-sm leading-relaxed text-text-muted">
              {extensions === undefined ? 'Loading…' : 'No extensions are on for the chat yet. Turn one on, or build your own.'}
            </p>
            {onOpenExtensions && extensions !== undefined && (
              <Button variant="secondary" onClick={onOpenExtensions}>
                Open Extensions
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
