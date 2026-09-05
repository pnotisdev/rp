import type { CommitmentStatus } from '@/lib/types'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import { COMMITMENT_ORDER } from '@/lib/dating/stage'

export type IntimacyCategory = 'kissing_spot' | 'position' | 'toy' | 'activity'

/**
 * One piece of intimate content this relationship can "unlock" — the user's own ask ("unlocking
 * sex positions, places to kiss at, sex toys and more"). Gated by `minWarmth` (same derived 0-100
 * warmth score that already gates `RelationshipStage`/commitment tiers, see `stage.ts`) and
 * optionally `minCommitment` (some things fit better once a relationship is actually official).
 * "Unlocked" only ever meant "the model may draw on this" until the user's own direct follow-up —
 * "unlocked ≠ usable," they want to actually *choose* a kiss spot or initiate an activity, not
 * just hope the model picks up on flavor text. `actionText`/`price` below are that: a real,
 * clickable action in `RelationshipPanel`, not only a prompt hint.
 */
export interface IntimacyUnlockable {
  id: string
  category: IntimacyCategory
  label: string
  minWarmth: number
  /** Unset means no commitment floor — warmth alone is enough. */
  minCommitment?: CommitmentStatus
  /**
   * A natural, pre-written player-action line sent verbatim (via `composeIntimacyActionText`,
   * `{char}` replaced with the real name) when this is clicked in the Relationship panel — e.g.
   * `"*leans in and presses a slow kiss to {char}'s forehead*"`. Every built-in entry has one,
   * hand-written for that specific action rather than templated, since a generic "does {label}"
   * sentence reads badly across this varied a catalog. A world's own custom entries fall back to
   * `composeIntimacyActionText`'s generic per-category template when this is unset, so authoring
   * one is optional, not required, to add a new unlockable.
   */
  actionText?: string
  /**
   * Coins required to actually own this before it can be bought/used (`Chat.toyInventory`) —
   * meaningful for `toy`-category entries in practice (the user's own ask: "buy toys"); unset
   * means no purchase step, which stays true for every kissing_spot/position/activity entry, since
   * those aren't physical objects to own.
   */
  price?: number
}

/**
 * `kissing_spot` sits apart from the other three categories: kissing itself is romantic content
 * this app has never gated behind the explicit-content dial (`intimacyGuidance`'s own
 * `fade_to_black` case explicitly allows scenes up through kissing), so these stay available at
 * every `IntimacyDetailLevel` once warmth earns them. `position`/`toy`/`activity` are unambiguously
 * explicit-tier content and only ever surface when the user has actually turned that dial to
 * `'explicit'` — see `intimacyOptionsGuidance`.
 */
export const DEFAULT_INTIMACY_CATALOG: IntimacyUnlockable[] = [
  // --- kissing_spot: available across the whole warmth ladder, no commitment required ---
  { id: 'kiss-forehead', category: 'kissing_spot', label: 'forehead', minWarmth: 15, actionText: "*leans in and presses a slow kiss to {char}'s forehead*" },
  { id: 'kiss-cheek', category: 'kissing_spot', label: 'cheek', minWarmth: 15, actionText: "*kisses {char}'s cheek, lingering a moment*" },
  { id: 'kiss-hand', category: 'kissing_spot', label: 'the back of the hand', minWarmth: 15, actionText: "*brings {char}'s hand up and kisses the back of it*" },
  { id: 'kiss-temple', category: 'kissing_spot', label: 'temple', minWarmth: 35, actionText: '*kisses {char} softly at the temple*' },
  { id: 'kiss-neck', category: 'kissing_spot', label: 'neck', minWarmth: 35, actionText: "*trails a kiss along {char}'s neck*" },
  { id: 'kiss-jaw', category: 'kissing_spot', label: 'along the jaw', minWarmth: 55, actionText: "*kisses along {char}'s jaw, slow and unhurried*" },
  { id: 'kiss-collarbone', category: 'kissing_spot', label: 'collarbone', minWarmth: 55, actionText: "*presses a kiss to {char}'s collarbone*" },
  { id: 'kiss-wrist', category: 'kissing_spot', label: 'inner wrist', minWarmth: 55, actionText: "*turns {char}'s wrist over and kisses the inside of it*" },
  { id: 'kiss-ear', category: 'kissing_spot', label: 'behind the ear', minWarmth: 75, actionText: '*kisses {char} just behind the ear*' },
  { id: 'kiss-shoulder', category: 'kissing_spot', label: 'shoulder blade', minWarmth: 75, actionText: "*kisses {char}'s shoulder blade, gentle*" },
  { id: 'kiss-thigh', category: 'kissing_spot', label: 'inner thigh', minWarmth: 90, minCommitment: 'dating', actionText: "*kisses along the inside of {char}'s thigh*" },

  // --- position: explicit-only (see intimacyOptionsGuidance). Phrased as guiding things there mid-scene, not a cold-start action. ---
  { id: 'pos-missionary', category: 'position', label: 'missionary', minWarmth: 75, minCommitment: 'dating', actionText: '*guides {char} onto their back, settling over them*' },
  { id: 'pos-face-to-face', category: 'position', label: 'face to face in their lap', minWarmth: 75, minCommitment: 'dating', actionText: '*pulls {char} into their lap, face to face*' },
  { id: 'pos-cowgirl', category: 'position', label: 'on top', minWarmth: 75, minCommitment: 'dating', actionText: '*settles back and pulls {char} on top*' },
  { id: 'pos-doggy', category: 'position', label: 'from behind', minWarmth: 75, minCommitment: 'dating', actionText: '*turns {char} around, guiding them from behind*' },
  { id: 'pos-spooning', category: 'position', label: 'spooning', minWarmth: 55, minCommitment: 'dating', actionText: '*pulls {char} close from behind, spooning*' },
  { id: 'pos-against-wall', category: 'position', label: 'pressed against a wall', minWarmth: 90, minCommitment: 'exclusive', actionText: '*presses {char} back against the wall*' },
  { id: 'pos-reverse-cowgirl', category: 'position', label: 'reverse cowgirl', minWarmth: 90, minCommitment: 'exclusive', actionText: '*has {char} turn around, facing away*' },
  { id: 'pos-legs-over-shoulders', category: 'position', label: 'legs over their shoulders', minWarmth: 90, minCommitment: 'exclusive', actionText: "*hooks {char}'s legs over their shoulders*" },
  { id: 'pos-sixty-nine', category: 'position', label: '69', minWarmth: 90, minCommitment: 'exclusive', actionText: '*shifts them both around, head to toe*' },

  // --- toy: explicit-only, and now the one category that costs coins — see `price` ---
  { id: 'toy-massage-oil', category: 'toy', label: 'massage oil', minWarmth: 55, price: 8, actionText: "*warms massage oil between their hands and starts working it into {char}'s skin*" },
  { id: 'toy-feather', category: 'toy', label: 'a feather tickler', minWarmth: 55, price: 8, actionText: "*trails a feather tickler slowly along {char}'s skin*" },
  { id: 'toy-blindfold', category: 'toy', label: 'a blindfold', minWarmth: 75, minCommitment: 'dating', price: 15, actionText: "*ties a blindfold gently over {char}'s eyes*" },
  { id: 'toy-ice', category: 'toy', label: 'ice, traced slowly', minWarmth: 75, minCommitment: 'dating', price: 12, actionText: "*traces a piece of ice slowly along {char}'s skin*" },
  { id: 'toy-body-paint', category: 'toy', label: 'body-safe paint or chocolate', minWarmth: 75, minCommitment: 'dating', price: 18, actionText: "*dips a finger in and drags it slowly across {char}'s skin*" },
  { id: 'toy-vibrator', category: 'toy', label: 'a vibrator', minWarmth: 90, minCommitment: 'dating', price: 30, actionText: '*reaches for the vibrator, teasing {char} with it first*' },
  { id: 'toy-silk-ties', category: 'toy', label: 'silk ties for light bondage', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*ties {char}'s wrists loosely with the silk*" },
  { id: 'toy-handcuffs', category: 'toy', label: 'playful handcuffs', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*clicks the handcuffs on, playful, watching {char}'s reaction*" },

  // --- activity: explicit-only (kinks, aftercare, and other non-position/toy intimate beats) ---
  { id: 'act-dirty-talk', category: 'activity', label: 'dirty talk', minWarmth: 55, actionText: "*leans in close and murmurs something filthy in {char}'s ear*" },
  { id: 'act-massage', category: 'activity', label: 'a slow, sensual massage', minWarmth: 55, actionText: "*starts working slow, deliberate hands into {char}'s shoulders*" },
  { id: 'act-aftercare', category: 'activity', label: 'quiet aftercare and reassurance', minWarmth: 55, actionText: '*pulls {char} in close, quiet, just holding them*' },
  { id: 'act-shower', category: 'activity', label: 'showering together', minWarmth: 75, minCommitment: 'dating', actionText: "*takes {char}'s hand and pulls them toward the shower*" },
  { id: 'act-roleplay', category: 'activity', label: 'acting out a shared fantasy', minWarmth: 75, minCommitment: 'dating', actionText: "*grins and starts play-acting the fantasy they'd talked about*" },
  { id: 'act-morning-after', category: 'activity', label: 'slow, unhurried morning-after intimacy', minWarmth: 75, minCommitment: 'dating', actionText: '*pulls {char} back down, in no hurry to start the day*' },
  { id: 'act-praise', category: 'activity', label: 'praise, said while it matters most', minWarmth: 75, minCommitment: 'dating', actionText: "*cups {char}'s face and tells them exactly how good they are*" },
  { id: 'act-edging', category: 'activity', label: 'teasing and edging', minWarmth: 90, minCommitment: 'exclusive', actionText: '*slows everything down right at the edge, teasing*' },
  { id: 'act-exhibitionism', category: 'activity', label: 'the thrill of maybe being overheard', minWarmth: 90, minCommitment: 'exclusive', actionText: "*doesn't bother lowering their voice, door barely closed*" },
]

function commitmentMet(min: CommitmentStatus | undefined, actual: CommitmentStatus): boolean {
  if (!min) return true
  return COMMITMENT_ORDER.indexOf(actual) >= COMMITMENT_ORDER.indexOf(min)
}

/**
 * The built-in ~37-entry catalog plus whatever a world has added of its own — additive, same
 * "author extends a fixed default set" pattern as `CustomBackground`/`DEFAULT_BACKGROUNDS`, not a
 * wholesale override like `getGiftCatalog` — a world's own kinks add to the sensible defaults
 * rather than requiring the author to redefine sex positions from scratch just to add one more.
 */
export function getIntimacyCatalog(world?: { customIntimacyOptions?: IntimacyUnlockable[] }): IntimacyUnlockable[] {
  return world?.customIntimacyOptions?.length ? [...DEFAULT_INTIMACY_CATALOG, ...world.customIntimacyOptions] : DEFAULT_INTIMACY_CATALOG
}

/**
 * Every catalog entry (built-in plus this world's own additions) this specific relationship has
 * earned so far, at its current warmth and commitment tier. `ownedToyIds`, when passed, further
 * restricts `toy`-category results to ones actually bought (`Chat.toyInventory`) — warmth/
 * commitment only ever gate *eligibility to buy*, not automatic possession, so the model should
 * never be told about a toy the player hasn't actually purchased. Omitted (the Relationship
 * panel's own call) returns every eligible toy regardless of ownership, since the panel needs to
 * render a "Buy" affordance for the ones not owned yet, not just hide them.
 */
export function getUnlockedIntimacyOptions(
  warmth: number,
  commitmentStatus: CommitmentStatus,
  world?: { customIntimacyOptions?: IntimacyUnlockable[] },
  ownedToyIds?: Set<string>,
): IntimacyUnlockable[] {
  return getIntimacyCatalog(world).filter((item) => {
    if (!(warmth >= item.minWarmth && commitmentMet(item.minCommitment, commitmentStatus))) return false
    if (item.category === 'toy' && ownedToyIds && !ownedToyIds.has(item.id)) return false
    return true
  })
}

/** A single catalog entry by id — `buyToy`'s lookup, same shape as `giftById`/`itemById`. */
export function intimacyItemById(id: string, world?: { customIntimacyOptions?: IntimacyUnlockable[] }): IntimacyUnlockable | undefined {
  return getIntimacyCatalog(world).find((i) => i.id === id)
}

/**
 * The nearest still-locked entry in one category, for a "what's coming next" readout
 * (`RelationshipPanel`'s Unlocks tab) — lowest `minWarmth` among the ones not yet unlocked. A
 * reasonable "closest" heuristic even though a returned entry's own `minCommitment` could still
 * gate it further once warmth alone clears its bar; the caller shows both requirements rather than
 * only warmth. Returns `undefined` once every entry in the category is already unlocked.
 */
export function nextLockedInCategory(
  category: IntimacyCategory,
  warmth: number,
  commitmentStatus: CommitmentStatus,
  world?: { customIntimacyOptions?: IntimacyUnlockable[] },
): IntimacyUnlockable | undefined {
  const unlockedIds = new Set(getUnlockedIntimacyOptions(warmth, commitmentStatus, world).map((i) => i.id))
  return getIntimacyCatalog(world)
    .filter((i) => i.category === category && !unlockedIds.has(i.id))
    .sort((a, b) => a.minWarmth - b.minWarmth)[0]
}

/**
 * The actual sent-as-the-player message when an unlocked (and, for toys, owned) entry is clicked
 * in the Relationship panel — `option.actionText` with `{char}` substituted, or a generic
 * per-category fallback when unset (always true for a world's own custom entries unless the
 * author filled one in; every built-in entry has its own hand-written line instead of using this).
 * Pure and tested on its own so the panel never has to duplicate this substitution logic.
 */
export function composeIntimacyActionText(option: IntimacyUnlockable, charName: string): string {
  const template = option.actionText ?? (option.category === 'kissing_spot' ? `*kisses {char} on the ${option.label}*` : `*brings up trying ${option.label}*`)
  return template.replace(/\{char\}/g, charName)
}

/** How many items from one category to actually name in the prompt — the highest-threshold (most recently earned, most "current") ones read as most relevant, and capping keeps this from growing into a wall of text turn after turn as more unlock. */
const MAX_PER_CATEGORY = 4

function topLabels(items: IntimacyUnlockable[], category: IntimacyCategory): string[] {
  return items
    .filter((i) => i.category === category)
    .sort((a, b) => b.minWarmth - a.minWarmth)
    .slice(0, MAX_PER_CATEGORY)
    .map((i) => i.label)
}

/**
 * A `styleGuidance` line naming what this relationship has actually unlocked so far — a bank of
 * ideas for the model to draw from *if* a scene genuinely goes there, never a mandate, same
 * "deterministic code decides eligibility, model narrates" split as `sceneProgressionNudge`.
 * `position`/`toy`/`activity` only ever appear once `intimacyLevel` is `'explicit'` — `kissing_spot`
 * is romantic, not explicit, content and was never gated behind that dial to begin with, so it
 * still shows at every other level. Returns `''` with nothing to say, so a fresh relationship (or a
 * user who's left explicit content off) pays nothing for this. Callers should pass `unlocked` from
 * `getUnlockedIntimacyOptions` with `ownedToyIds` set, so an unbought toy is never mentioned here.
 */
export function intimacyOptionsGuidance(unlocked: IntimacyUnlockable[], intimacyLevel: IntimacyDetailLevel): string {
  const explicitUnlocked = intimacyLevel === 'explicit'
  const parts: string[] = []

  const kissingSpots = topLabels(unlocked, 'kissing_spot')
  if (kissingSpots.length) parts.push(`Places a kiss could land now that you're this close: ${kissingSpots.join(', ')}.`)

  if (explicitUnlocked) {
    const positions = topLabels(unlocked, 'position')
    if (positions.length) parts.push(`Positions this relationship has earned, if a scene goes there: ${positions.join(', ')}.`)
    const toys = topLabels(unlocked, 'toy')
    if (toys.length) parts.push(`Toys or props that would fit: ${toys.join(', ')}.`)
    const activities = topLabels(unlocked, 'activity')
    if (activities.length) parts.push(`Other things that could come up: ${activities.join(', ')}.`)
  }

  if (parts.length === 0) return ''
  return `${parts.join(' ')} Use whichever, if any, genuinely fits this exact moment — never force one in just because it's unlocked.`
}
