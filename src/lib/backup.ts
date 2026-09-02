import { backupApi } from '@/lib/api/client'

/** Fetches a full backup (every table + every avatar/sprite/background file) and downloads it as one JSON file. */
export async function downloadBackup(): Promise<void> {
  const backup = await backupApi.fetchBackup()
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rp-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Replaces every table and every avatar/sprite/background file with what's in the given backup file. Irreversible. */
export async function restoreBackupFile(file: File): Promise<void> {
  const text = await file.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  await backupApi.restore(data)
}
