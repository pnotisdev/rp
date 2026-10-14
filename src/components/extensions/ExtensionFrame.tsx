// Renders one sandboxed extension panel and wires its iframe to the permission-checked host bridge.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createBridge } from '@/lib/extensions/bridge'
import { useExtensionFiles } from '@/lib/extensions/bundleCache'
import { registerChannel } from '@/lib/extensions/events'
import { IFRAME_SANDBOX, buildPanelDoc, type PanelSurface } from '@/lib/extensions/frameDoc'
import { appHostApi } from '@/lib/extensions/hostApi'
import { logExtension } from '@/lib/extensions/logStore'
import { resolveSettings, type BundleFile, type ExtensionRecord, type PanelSpec } from '@/lib/extensions/manifest'
import { readThemeSnapshot, useThemeSnapshot } from '@/lib/extensions/theme'

export interface ExtensionFrameProps {
  ext: ExtensionRecord
  panel: PanelSpec
  surface: PanelSurface
  /** Unsaved files from the Studio; bypasses the saved bundle. */
  files?: Record<string, BundleFile>
  /** Pixels, `'auto'` to follow the page's own height, or omitted to fill the parent. */
  height?: number | 'auto'
  /** Bump to force a fresh load (the Studio's reload button). */
  reloadKey?: number
  onClose?: () => void
  className?: string
}

function clonable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

interface InnerProps {
  ext: ExtensionRecord
  panel: PanelSpec
  surface: PanelSurface
  srcDoc: string
  height?: number | 'auto'
  onClose?: () => void
  className?: string
}

function FrameInner({ ext, panel, surface, srcDoc, height, onClose, className = '' }: InnerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const portRef = useRef<MessagePort | null>(null)
  const unregisterRef = useRef<(() => void) | null>(null)
  const loadedRef = useRef(false)
  const eventsRef = useRef(new Set<string>())
  const extRef = useRef(ext)
  extRef.current = ext
  const theme = useThemeSnapshot()
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [measured, setMeasured] = useState<number | null>(null)
  const [dead, setDead] = useState<string | null>(null)

  function onLoad() {
    const frame = frameRef.current
    if (!frame) return
    if (loadedRef.current) {
      portRef.current?.close()
      unregisterRef.current?.()
      setDead('This extension tried to navigate away, so it was stopped.')
      logExtension(ext.id, 'error', 'The panel navigated away and was stopped.', surface)
      return
    }
    loadedRef.current = true
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    const bridge = createBridge({
      extId: ext.id,
      extName: ext.manifest.name,
      host: appHostApi,
      grants: () => extRef.current.grants,
      settings: () => resolveSettings(extRef.current.manifest, extRef.current.settings),
      subscribe: (event) => eventsRef.current.add(event),
      onResize: (h) => setMeasured(h),
      onClose,
    })
    port.onmessage = (e: MessageEvent) => {
      const m = e.data as Record<string, unknown> | null
      if (!m || typeof m !== 'object') return
      if (m.t === 'call') {
        bridge.handle(String(m.method), m.params).then(
          (result) => port.postMessage({ t: 'result', id: m.id, result: clonable(result) }),
          (err: unknown) => port.postMessage({ t: 'result', id: m.id, error: err instanceof Error ? err.message : String(err) }),
        )
      } else if (m.t === 'log') {
        logExtension(ext.id, String(m.level), String(m.text), surface)
      } else if (m.t === 'resize' && typeof m.height === 'number') {
        setMeasured(Math.max(40, Math.min(2000, Math.round(m.height))))
      }
    }
    unregisterRef.current = registerChannel({
      extId: ext.id,
      events: eventsRef.current,
      deliver: (event, payload) => port.postMessage({ t: 'event', event, payload: clonable(payload) }),
    })
    const t = themeRef.current
    frame.contentWindow?.postMessage(
      {
        t: 'init',
        info: {
          api: 1,
          surface,
          extension: { id: ext.id, name: ext.manifest.name, version: ext.manifest.version },
          permissions: extRef.current.grants,
          settings: resolveSettings(extRef.current.manifest, extRef.current.settings),
          dark: t.dark,
        },
        tokens: t.tokens,
        dark: t.dark,
      },
      '*',
      [channel.port2],
    )
  }

  useEffect(
    () => () => {
      portRef.current?.close()
      unregisterRef.current?.()
    },
    [],
  )

  useEffect(() => {
    portRef.current?.postMessage({ t: 'theme', tokens: theme.tokens, dark: theme.dark })
  }, [theme])

  const settingsKey = JSON.stringify(ext.settings)
  useEffect(() => {
    if (eventsRef.current.has('settings')) {
      portRef.current?.postMessage({ t: 'event', event: 'settings', payload: resolveSettings(ext.manifest, ext.settings) })
    }
  }, [settingsKey])

  const style: CSSProperties = height === 'auto' ? { height: measured ?? panel.height ?? 120 } : typeof height === 'number' ? { height } : { height: '100%' }
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {dead ? (
        <p className="p-4 text-sm text-danger">{dead}</p>
      ) : (
        <iframe
          ref={frameRef}
          title={`${ext.manifest.name} — ${panel.title}`}
          sandbox={IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          onLoad={onLoad}
          className="block h-full w-full border-0 bg-transparent"
        />
      )}
    </div>
  )
}

export function ExtensionFrame({ ext, panel, surface, files, height, reloadKey = 0, onClose, className }: ExtensionFrameProps) {
  const loaded = useExtensionFiles(ext, files)
  const autoHeight = height === 'auto'
  const version = useRef(0)
  const built = useMemo(() => {
    if (!loaded) return null
    version.current += 1
    return { version: version.current, doc: buildPanelDoc({ files: loaded, entry: panel.entry, theme: readThemeSnapshot(), surface, autoHeight }) }
    // The theme is read once per build; later changes are pushed over the port without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, panel.entry, surface, autoHeight, reloadKey])

  if (!built) return <div className={`animate-pulse rounded-2xl bg-bg-sunken ${className ?? ''}`} style={{ height: typeof height === 'number' ? height : 160 }} />
  return (
    <FrameInner
      key={`${built.version}:${ext.grants.join(',')}`}
      ext={ext}
      panel={panel}
      surface={surface}
      srcDoc={built.doc}
      height={height}
      onClose={onClose}
      className={className}
    />
  )
}
