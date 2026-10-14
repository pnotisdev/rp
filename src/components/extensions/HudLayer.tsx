// Floating extension panels ("hud" slot) pinned to the corners of the chat.

import type { HudAnchor } from '@/lib/extensions/manifest'
import { useExtensions } from '@/lib/extensions/useExtensions'
import { ExtensionFrame } from './ExtensionFrame'

const POSITION: Record<HudAnchor, string> = {
  'top-left': 'left-3 top-16 items-start',
  'top-right': 'right-3 top-16 items-end',
  'bottom-left': 'bottom-24 left-3 items-start',
  'bottom-right': 'bottom-24 right-3 items-end',
}

export function HudLayer() {
  const extensions = useExtensions()
  const items = (extensions ?? [])
    .filter((e) => e.enabled)
    .flatMap((ext) => ext.manifest.panels.filter((p) => p.slots.includes('hud')).map((panel) => ({ ext, panel })))
  if (items.length === 0) return null
  const anchors = Object.keys(POSITION) as HudAnchor[]
  return (
    <>
      {anchors.map((anchor) => {
        const group = items.filter((i) => (i.panel.anchor ?? 'top-right') === anchor)
        if (group.length === 0) return null
        return (
          <div key={anchor} className={`pointer-events-none absolute z-30 hidden flex-col gap-2 sm:flex ${POSITION[anchor]}`}>
            {group.map(({ ext, panel }) => (
              <div key={`${ext.id}:${panel.id}`} className="pointer-events-auto max-w-[calc(100vw-1.5rem)]" style={{ width: panel.width ?? 220 }}>
                <ExtensionFrame ext={ext} panel={panel} surface="hud" height="auto" />
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}
