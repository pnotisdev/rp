import { useState } from 'react'
import type { Scene, ScenePolicy } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'

const POLICIES: { id: ScenePolicy; label: string; hint: string }[] = [
  {
    id: 'manual',
    label: 'Manual',
    hint: 'You pick who replies each turn from the composer’s "reply as" menu, exactly like today.',
  },
  {
    id: 'round_robin',
    label: 'Round-robin',
    hint: 'Cycles through everyone present in a fixed order, one turn each.',
  },
  {
    id: 'director',
    label: 'AI director',
    hint: 'A quick read of the scene picks whoever would naturally respond — falls back to the primary if it can’t decide.',
  },
  {
    id: 'mention',
    label: '@Mention',
    hint: 'Write "@Name" in your own message to address them directly — otherwise falls back to the primary.',
  },
]

export function ScenePanel({
  scene,
  onClose,
  onSave,
}: {
  scene: Scene | undefined
  onClose: () => void
  onSave: (patch: Partial<Scene> | null) => Promise<void>
}) {
  const [location, setLocation] = useState(scene?.location ?? '')
  const [atmosphere, setAtmosphere] = useState(scene?.atmosphere ?? '')
  const [turnPolicy, setTurnPolicy] = useState<ScenePolicy>(scene?.turnPolicy ?? 'manual')
  const [busy, setBusy] = useState(false)

  const save = async (payload: Partial<Scene> | null) => {
    setBusy(true)
    try {
      await onSave(payload)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Scene"
      description="Frames where this group scene is happening and who replies next — section 4/12's Scene entity. Location/atmosphere fold into the prompt the same way an active event's own does; turn policy only matters once more than one character is present."
      size="lg"
      scrollable
    >
      <div className="flex-1 overflow-y-auto">
        <TextAreaField
          label="Location"
          rows={2}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. The campus café, late afternoon"
        />
        <TextAreaField
          label="Atmosphere"
          rows={2}
          value={atmosphere}
          onChange={(e) => setAtmosphere(e.target.value)}
          placeholder="e.g. Tense, right after an argument"
        />

        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium text-text-muted">Turn policy</span>
          <div className="flex flex-col gap-1.5">
            {POLICIES.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-bg-sunken px-3 py-2.5 text-sm"
              >
                <input
                  type="radio"
                  name="scene-turn-policy"
                  className="mt-0.5"
                  checked={turnPolicy === p.id}
                  onChange={() => setTurnPolicy(p.id)}
                />
                <span>
                  <span className="block text-text">{p.label}</span>
                  <span className="block text-[11px] text-text-muted">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex shrink-0 items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => save(null)} disabled={busy || !scene}>
          Clear scene
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              save({
                location: location.trim() || null,
                atmosphere: atmosphere.trim() || null,
                turnPolicy,
                // A fresh policy pick starts its own bookkeeping from scratch rather than
                // inheriting a stale round-robin index from a previous policy.
                roundRobinIndex: turnPolicy === scene?.turnPolicy ? scene?.roundRobinIndex : 0,
              })
            }
            disabled={busy}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
