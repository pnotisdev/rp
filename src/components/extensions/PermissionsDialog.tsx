// The trust moment: what an extension asks for, in plain words, before anything is allowed.

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PERMISSION_INFO, highestRisk, type ExtensionRecord, type Permission, type PermissionRisk } from '@/lib/extensions/manifest'

export const RISK_STYLE: Record<PermissionRisk, string> = {
  low: 'bg-bg-sunken text-text-muted',
  medium: 'bg-warning/12 text-warning',
  high: 'bg-danger/12 text-danger',
}

export const RISK_LABEL: Record<PermissionRisk, string> = { low: 'Read only', medium: 'Can change things', high: 'Can alter the AI' }

export function PermissionsDialog({
  ext,
  enabling,
  onConfirm,
  onClose,
}: {
  ext: ExtensionRecord
  /** True when this dialog is the gate to switching the extension on. */
  enabling: boolean
  onConfirm: (grants: Permission[]) => Promise<void> | void
  onClose: () => void
}) {
  const requested = ext.manifest.permissions
  const [allowed, setAllowed] = useState<Permission[]>(() => (ext.grants.length ? ext.grants : requested))
  const [busy, setBusy] = useState(false)
  const risk = highestRisk(allowed)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(allowed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title={enabling ? `Turn on ${ext.manifest.name}` : `Permissions for ${ext.manifest.name}`} size="md">
      <p className="mb-4 text-sm leading-relaxed text-text-muted">
        Extensions run in a sandbox with no internet and no access to your files. They can only do what you allow here.
      </p>
      {requested.length === 0 ? (
        <p className="mb-5 rounded-xl bg-bg-sunken px-4 py-3 text-sm text-text-muted">This extension asks for no special access.</p>
      ) : (
        <ul className="mb-5 space-y-2">
          {requested.map((p) => {
            const info = PERMISSION_INFO[p]
            const on = allowed.includes(p)
            return (
              <li key={p}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-bg-sunken px-4 py-3 transition-colors hover:bg-bg-sunken/70">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setAllowed((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]))}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text">{info.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RISK_STYLE[info.risk]}`}>{RISK_LABEL[info.risk]}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">{info.detail}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {risk === 'high' && (
        <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-xs leading-relaxed text-danger">
          This can change what you send and what the AI says. Only allow it for extensions you wrote or trust.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={confirm}>
          {enabling ? 'Allow and turn on' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}
