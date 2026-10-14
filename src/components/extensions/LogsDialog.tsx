// A scrollable console for one extension's output (panels, scripts, hooks).

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useExtensionLogs } from '@/lib/extensions/logStore'

export function ConsoleView({ extId, className = '' }: { extId: string; className?: string }) {
  const all = useExtensionLogs((s) => s.entries)
  const entries = all.filter((e) => e.extId === extId).slice(-120)
  if (entries.length === 0) return <p className={`text-xs text-text-muted ${className}`}>Nothing logged yet. Use console.log or rp.log in your code.</p>
  return (
    <div className={`space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed ${className}`}>
      {entries.map((e) => (
        <div key={e.id} className={e.level === 'error' ? 'text-danger' : e.level === 'warn' ? 'text-warning' : 'text-text-muted'}>
          <span className="opacity-60">{new Date(e.time).toLocaleTimeString()} {e.surface} </span>
          <span className="whitespace-pre-wrap break-words">{e.text}</span>
        </div>
      ))}
    </div>
  )
}

export function LogsDialog({ extId, name, onClose }: { extId: string; name: string; onClose: () => void }) {
  const clear = useExtensionLogs((s) => s.clear)
  return (
    <Modal
      onClose={onClose}
      title={`${name}: console`}
      size="2xl"
      scrollable
      headerExtra={
        <Button variant="ghost" onClick={() => clear(extId)}>
          Clear
        </Button>
      }
    >
      <ConsoleView extId={extId} className="min-h-[8rem] flex-1 rounded-xl bg-bg-sunken p-3" />
    </Modal>
  )
}
