import { DEFAULT_REGION_SENSITIVITY, type BodyRegion, type RegionSensitivity } from '@/lib/dating/arousal'

// A character's own body: where they respond, where they don't, and where they won't yet.

export interface TouchProfile {
  /** Per-region multiplier, 0-3. 0 means this character simply doesn't respond there. */
  sensitivity?: RegionSensitivity
  /** Regions that are off-limits regardless of arousal or warmth — a hard filter, not a preference. */
  offLimits?: BodyRegion[]
  /** Regions that only open up past a warmth threshold. */
  gated?: Partial<Record<BodyRegion, number>>
}

/** This character's response at a region, falling back to the shared default map. */
export function sensitivityFor(profile: TouchProfile | undefined, region: BodyRegion): number {
  return profile?.sensitivity?.[region] ?? DEFAULT_REGION_SENSITIVITY[region]
}

/** Whether a region is available at this warmth. Off-limits is absolute; a gate is a threshold. */
export function isRegionAvailable(profile: TouchProfile | undefined, region: BodyRegion, warmth: number): boolean {
  if (profile?.offLimits?.includes(region)) return false
  const gate = profile?.gated?.[region]
  return gate === undefined || warmth >= gate
}

/** Every region this character has ruled out or not yet opened up, at the given warmth. */
export function unavailableRegions(profile: TouchProfile | undefined, warmth: number): BodyRegion[] {
  if (!profile) return []
  const gated = Object.keys(profile.gated ?? {}) as BodyRegion[]
  return [...new Set([...(profile.offLimits ?? []), ...gated])].filter((region) => !isRegionAvailable(profile, region, warmth))
}

/** How responsive a region has to be before finding it counts as learning something about this character. */
const DISCOVERY_SENSITIVITY = 2

/** Regions worth remembering having found — the discovery loop. */
export function newlyDiscoveredRegions(
  profile: TouchProfile | undefined,
  touched: readonly BodyRegion[],
  alreadyKnown: readonly BodyRegion[] | undefined,
): BodyRegion[] {
  const known = new Set(alreadyKnown ?? [])
  return [...new Set(touched)].filter((region) => !known.has(region) && sensitivityFor(profile, region) >= DISCOVERY_SENSITIVITY)
}

/** The running list, with anything newly found appended. Returns the original array when nothing was. */
export function withDiscoveredRegions(
  known: BodyRegion[] | undefined,
  found: readonly BodyRegion[],
): BodyRegion[] | undefined {
  return found.length ? [...(known ?? []), ...found] : known
}
