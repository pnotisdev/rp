import { toastError, toastSuccess } from '@/lib/store/useToastStore'
import { importEnvelopes, type TransferKind } from './transfer'

/** Imports exported persona/world files and toasts the outcome. */
export async function importAndReport(kind: TransferKind, files: File[], create: (data: Record<string, unknown>) => Promise<unknown>) {
  const { created, failed } = await importEnvelopes(kind, files, create)
  if (created) toastSuccess(`Imported ${created} ${kind}${created === 1 ? '' : 's'}.`)
  if (failed.length) toastError(failed.join(' | '))
}
