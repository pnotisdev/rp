import { useState } from 'react'
import type { GiftRarity, RelationshipDimension, WorldCard } from '@/lib/types'
import { formatRelationshipStage, RELATIONSHIP_MILESTONES } from '@/lib/dating/stage'
import { getWorldTemplate, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { TextField } from '@/components/ui/Field'
import { type EditorTab } from '@/components/ui/EditorShell'


export const GIFT_RARITIES: GiftRarity[] = ['common', 'uncommon', 'rare', 'epic']
export const RELATIONSHIP_DELTA_DIMENSIONS: ('affection' | RelationshipDimension)[] = [
  'affection',
  'trust',
  'chemistry',
  'comfort',
  'respect',
  'curiosity',
  'tension',
]
export const EDITABLE_STAGES = ['acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts'] as const
export const DEFAULT_THRESHOLDS = Object.fromEntries(RELATIONSHIP_MILESTONES.map((m) => [m.stage, m.at])) as Record<
  (typeof EDITABLE_STAGES)[number] | 'near_strangers',
  number
>
export const DEFAULT_STAGE_HINT = EDITABLE_STAGES.map((s) => `${formatRelationshipStage(s)} ${DEFAULT_THRESHOLDS[s]}`).join(', ')

export function blankWorld(template?: WorldTemplateId): Omit<WorldCard, 'id' | 'createdAt' | 'updatedAt'> {
  const def = template ? getWorldTemplate(template) : undefined
  return {
    name: 'New World',
    description: def?.description ?? '',
    rules: def?.rules ?? '',
    lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
    template,
  }
}

/** A comma-separated list of ids, committed on blur rather than per keystroke. */
export function TokenListField({
  label,
  hint,
  value,
  allowed,
  onCommit,
}: {
  label: string
  hint?: string
  value: readonly string[] | undefined
  /** Closed vocabulary to filter against, or `undefined` to accept any non-empty token. */
  allowed?: readonly string[]
  onCommit: (next: string[] | undefined) => void
}) {
  const [raw, setRaw] = useState((value ?? []).join(', '))
  // Re-sync when the row's own value changes from outside (a different entry scrolled into this slot).
  const joined = (value ?? []).join(', ')
  const [lastJoined, setLastJoined] = useState(joined)
  if (joined !== lastJoined) {
    setLastJoined(joined)
    setRaw(joined)
  }
  const commit = () => {
    const tokens = raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
    const kept = allowed ? tokens.filter((t) => allowed.includes(t)) : tokens
    const unique = [...new Set(kept)]
    setRaw(unique.join(', '))
    onCommit(unique.length ? unique : undefined)
  }
  return <TextField label={label} hint={hint} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit} />
}

export const WORLD_TABS: EditorTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'lore', label: 'Lore' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'dating', label: 'Dating sim' },
  { id: 'clock', label: 'Clock' },
]
