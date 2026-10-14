import { BODY_REGIONS } from '@/lib/dating/arousal'
import { type KinkProfile } from '@/lib/dating/kinks'
import type { TouchProfile } from '@/lib/dating/touch'
import { type ReactNode } from 'react'
import { type DriveConfig } from '@/lib/persona/drive'
import { estimateTokens } from '@/lib/tokenEstimate'
import { type EditorTab } from '@/components/ui/EditorShell'

/** `description`/`personality`/`scenario`/`mes_example` all sit in the prompt's always-included, never-trimmed section */
export const FIXED_FIELD_TOKEN_HINT = 400

/** Appends a soft "this field is getting large" note to a fixed-section field's hint. */
export function fixedFieldHint(base: ReactNode, value: string): ReactNode {
  const tokens = estimateTokens(value)
  if (tokens <= FIXED_FIELD_TOKEN_HINT) return base
  return (
    <>
      {base}
      {base ? ' ' : null}
      <span className="text-amber-500">
        ~{tokens} tokens. This field is sent in full every turn and never trimmed; consider tightening it or moving
        detail into Character lore.
      </span>
    </>
  )
}

export const TABS: EditorTab[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'life', label: 'Life & background' },
  { id: 'vn', label: 'Visual novel' },
  { id: 'dating', label: 'Dating sim' },
  { id: 'worldsim', label: 'World sim' },
  { id: 'voice', label: 'Voice' },
  { id: 'advanced', label: 'Advanced' },
]

/** The regions an authored sensitivity map scores at exactly this value. */
export function regionsAt(sensitivity: Partial<Record<string, number>> | undefined, value: number): string {
  return Object.entries(sensitivity ?? {})
    .filter(([, v]) => v === value)
    .map(([region]) => region)
    .join(', ')
}

export function kinksAt(valence: Partial<Record<string, number>> | undefined, value: number): string {
  return Object.entries(valence ?? {})
    .filter(([, v]) => v === value)
    .map(([kink]) => kink)
    .join(', ')
}

export const lines = (raw: string) => raw.split('\n').map((v) => v.trim()).filter(Boolean)

/** The live persona engine's list fields as editable one-per-line text. */
export function driveListText(d: DriveConfig | undefined) {
  return {
    fixations: (d?.fixations ?? []).join('\n'),
    loves: (d?.loves ?? []).join('\n'),
    boredBy: (d?.boredBy ?? []).join('\n'),
    motifs: (d?.motifs ?? []).join('\n'),
  }
}

export function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean)
}

/** Only real regions. */
export function parseRegions(raw: string): string[] {
  return parseList(raw).filter((v) => (BODY_REGIONS as readonly string[]).includes(v))
}

/** Kink ids stay open, so a world's own vocabulary survives being typed in here. */
export function parseKinks(raw: string): string[] {
  return parseList(raw)
}

/** Rebuilds a profile from the fields above, preserving anything they don't own */
export function composeTouchProfile(
  existing: TouchProfile | undefined,
  sensitiveRaw: string,
  unresponsiveRaw: string,
  offLimitsRaw: string,
): TouchProfile | null {
  const sensitive = parseRegions(sensitiveRaw)
  const unresponsive = parseRegions(unresponsiveRaw)
  const offLimits = parseRegions(offLimitsRaw)
  const sensitivity: Record<string, number> = {}
  for (const [region, value] of Object.entries(existing?.sensitivity ?? {})) {
    if (value !== 3 && value !== 0 && value !== undefined) sensitivity[region] = value
  }
  for (const region of sensitive) sensitivity[region] = 3
  for (const region of unresponsive) sensitivity[region] = 0
  const profile: TouchProfile = {
    ...(Object.keys(sensitivity).length ? { sensitivity: sensitivity as TouchProfile['sensitivity'] } : {}),
    ...(offLimits.length ? { offLimits: offLimits as NonNullable<TouchProfile['offLimits']> } : {}),
    ...(existing?.gated ? { gated: existing.gated } : {}),
  }
  return Object.keys(profile).length ? profile : null
}

export function composeKinkProfile(
  existing: KinkProfile | undefined,
  likedRaw: string,
  dislikedRaw: string,
  hardLimitsRaw: string,
): KinkProfile | null {
  const liked = parseKinks(likedRaw)
  const disliked = parseKinks(dislikedRaw)
  const hardLimits = parseKinks(hardLimitsRaw)
  const valence: Record<string, number> = {}
  for (const [kink, value] of Object.entries(existing?.valence ?? {})) {
    if (value !== 2 && value !== -1 && value !== undefined) valence[kink] = value
  }
  for (const kink of liked) valence[kink] = 2
  for (const kink of disliked) valence[kink] = -1
  const profile: KinkProfile = {
    ...(Object.keys(valence).length ? { valence: valence as KinkProfile['valence'] } : {}),
    ...(hardLimits.length ? { hardLimits } : {}),
  }
  return Object.keys(profile).length ? profile : null
}
