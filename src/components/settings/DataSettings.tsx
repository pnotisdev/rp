import { useRef, useState } from 'react'
import { downloadBackup, restoreBackupFile } from '@/lib/backup'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'

export function DataSettings() {
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const runBackup = async () => {
    setBusy('backup')
    try {
      await downloadBackup()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const runRestore = async (file: File) => {
    const confirmed = confirm(
      'This replaces every character, chat, world, and setting in this app with what\'s in the backup file — everything currently here will be permanently lost. This cannot be undone. Continue?',
    )
    if (!confirmed) return
    setBusy('restore')
    try {
      await restoreBackupFile(file)
      toastSuccess('Restore complete — reloading…')
      window.location.reload()
    } catch (e) {
      toastError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Backup</h3>
        <p className="mb-3 text-xs text-text-muted">
          Downloads everything in this app — every character, chat, world, persona, and setting,
          plus every avatar/sprite/background/gallery image — as one JSON file.
        </p>
        <Button variant="primary" onClick={runBackup} disabled={busy !== null}>
          {busy === 'backup' ? 'Preparing…' : 'Download backup'}
        </Button>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Restore</h3>
        <p className="mb-3 text-xs text-text-muted">
          Replaces everything currently in this app with the contents of a backup file. This is
          destructive and cannot be undone — anything created since that backup was taken is lost.
        </p>
        <Button
          variant="danger"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === 'restore' ? 'Restoring…' : 'Restore from backup…'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && runRestore(e.target.files[0])}
        />
      </section>
    </div>
  )
}
