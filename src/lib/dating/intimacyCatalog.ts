import type { BodyRegion } from '@/lib/dating/arousal'
import { isAnyHardLimit, kinkValence, type KinkId, type KinkProfile } from '@/lib/dating/kinks'
import { isRegionAvailable, type TouchProfile } from '@/lib/dating/touch'
import type { CommitmentStatus } from '@/lib/types'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import { COMMITMENT_ORDER } from '@/lib/dating/stage'

/**
 * `affection` exists because `isExplicitCategory` is the thing that decides what a player at a
 * non-explicit rating is even shown, and it keys off the category. Holding hands in public or
 * falling asleep against someone is not explicit content; filed under `activity` it would have been
 * hidden from everyone except players on the `'explicit'` dial, which is exactly backwards. It sits
 * beside `kissing_spot` as the second non-explicit category.
 */
export type IntimacyCategory = 'affection' | 'kissing_spot' | 'position' | 'toy' | 'activity'

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
   * A natural, pre-written player-action line — the starting point for the composer when this is
   * clicked in the Relationship panel (the connected model adapts it to the current scene first;
   * see `draftIntimacyAction`), and the verbatim fallback via `composeIntimacyActionText` when no
   * model is reachable. `{char}` is replaced with the real name. Every built-in entry has one,
   * hand-written for that specific action rather than templated, since a generic "does {label}"
   * sentence reads badly across this varied a catalog. A world's own custom entries fall back to
   * `composeIntimacyActionText`'s generic per-category template when this is unset, so authoring
   * one is optional, not required, to add a new unlockable.
   */
  actionText?: string
  /**
   * A clear, model-facing description of the physical act — used in two places the terse player
   * `actionText` isn't enough on its own: the brief for `draftIntimacyAction`'s scene-adaptation
   * call, and a directive injected into the *character's* reply turn (`intimacyActionDirective`) so
   * the model unmistakably registers what the player just initiated and writes a real response to
   * it rather than glossing past a one-line stage direction. `{char}` is substituted; the player is
   * always "you". Phrased to slot after "moved the scene into" / "initiating this now:". Falls back
   * to `defaultIntimacyPromptNote`'s per-category template when unset (a world's custom entries).
   */
  promptNote?: string
  /**
   * Coins required to actually own this before it can be bought/used (`Chat.toyInventory`) —
   * meaningful for `toy`-category entries in practice (the user's own ask: "buy toys"); unset
   * means no purchase step, which stays true for every kissing_spot/position/activity entry, since
   * those aren't physical objects to own.
   */
  price?: number
  /**
   * How much arousal (`dating/arousal.ts`) this activity can deliver per turn while it's the active
   * one — the intensity axis, where `minWarmth` is the difficulty axis. A forehead kiss is 1; a
   * position is 8. Unset falls back to `intimacyArousalWeight`'s per-category default, so a world's
   * own entries need not set one; author it only where that default reads wrong (a winding-down
   * activity, say).
   */
  arousalWeight?: number
  /**
   * Body regions this entry actually involves (`arousal.ts`). Feeds the meter straight from a click
   * with no model call, and lets a character's `TouchProfile` filter out an entry that would touch
   * somewhere they've ruled out. Built-in entries are tagged in `BUILT_IN_ENTRY_REGIONS` below.
   */
  regions?: BodyRegion[]
  /** Kinks this entry involves (`kinks.ts`). One hard limit here and the entry is never offered or described. */
  kinks?: KinkId[]
  /**
   * A kink this entry needs the character to be *positively* into — `kinkValence >= 1` — not merely
   * to have left unlisted. `kinks` above is a veto: absent a hard limit, an entry is offered. For a
   * handful of things that is the wrong default, because an unauthored character scores 0 on
   * everything and 0 would then read as consent. `kinkValence`'s own doc already says the quiet
   * part: "Nothing on record is neutral, not permission and not refusal."
   *
   * Deliberately rare. Use it where the fiction has a real-world analogue that is harmful when it
   * isn't wanted, and where warmth is a poor stand-in for having actually agreed.
   */
  requiresEagerness?: KinkId
  /**
   * Background ids (`vn/backgrounds.ts`) this entry only makes sense in — "the edge of the onsen"
   * is nonsense in a classroom, and warmth is no kind of gate on that. Applied only when the caller
   * actually knows where the scene is; a caller that passes no background gets the entry offered,
   * since "unknown" is not the same as "wrong place".
   */
  requiresBackground?: string[]
}

/**
 * Regions and kinks for the built-in entries, kept beside the catalog rather than inline so the
 * hand-written `actionText`/`promptNote` lines above stay readable. A world's own entries carry
 * their own `regions`/`kinks` on the entry itself.
 */
const BUILT_IN_ENTRY_REGIONS: Record<string, BodyRegion[]> = {
  'aff-hands-public': ['hands'],
  'aff-earbuds': ['ears', 'shoulders'],
  'aff-cooking': ['hands'],
  'aff-hair-washing': ['hair'],
  'aff-slow-dance': ['waist', 'hands'],
  'aff-falling-asleep': ['shoulders'],
  'aff-bath-together': ['back', 'chest', 'shoulders'],
  'kiss-forehead': ['face'],
  'kiss-nose': ['face'],
  'kiss-knuckles': ['hands'],
  'kiss-hairline': ['face', 'hair'],
  'kiss-palm': ['hands'],
  'kiss-shoulder-clothed': ['shoulders'],
  'kiss-cheek': ['face'],
  'kiss-hand': ['hands'],
  'kiss-temple': ['face', 'hair'],
  'kiss-neck': ['neck'],
  'kiss-jaw': ['face', 'neck'],
  'kiss-collarbone': ['chest', 'shoulders'],
  'kiss-wrist': ['hands'],
  'kiss-ear': ['ears'],
  'kiss-shoulder': ['back', 'shoulders', 'waist'],
  'kiss-thigh': ['inner_thigh', 'thighs'],
  'pos-missionary-hooked': ['genitals', 'thighs', 'hips'],
  'pos-face-to-face-slow': ['genitals', 'hips', 'chest'],
  'pos-chest-to-back': ['genitals', 'hips', 'back', 'chest'],
  'pos-spooning-deep': ['genitals', 'hips', 'back'],
  'pos-edge-of-bed': ['genitals', 'thighs', 'hips'],
  'pos-side-by-side': ['genitals', 'hips', 'thighs'],
  'pos-wall-one-leg': ['genitals', 'hips', 'thighs'],
  'pos-desk': ['genitals', 'hips', 'back'],
  'pos-table': ['genitals', 'hips', 'thighs'],
  'pos-window': ['genitals', 'hips', 'chest', 'back'],
  'pos-bath-edge': ['genitals', 'hips', 'thighs'],
  'pos-shower-bench': ['genitals', 'hips', 'chest'],
  'pos-onsen-edge': ['genitals', 'hips', 'thighs'],
  'pos-carry': ['genitals', 'hips', 'thighs'],
  'pos-prone': ['genitals', 'hips', 'back'],
  'pos-lotus': ['genitals', 'hips', 'chest', 'back'],
  'pos-standing-behind': ['genitals', 'hips', 'back', 'chest'],
  'pos-full-nelson': ['genitals', 'hips', 'shoulders'],
  'toy-warming-gel': ['chest', 'waist', 'inner_thigh'],
  'toy-thighhighs': ['thighs', 'inner_thigh'],
  'toy-lingerie': ['chest', 'waist', 'hips'],
  'toy-sheer-robe': ['chest', 'waist', 'shoulders'],
  'toy-cat-ears': ['hair', 'ears'],
  'toy-bunny-outfit': ['chest', 'waist', 'hips'],
  'toy-maid-outfit': ['chest', 'waist', 'thighs'],
  'toy-harness': ['chest', 'waist', 'shoulders'],
  'toy-scarf-eyes': ['face', 'hair'],
  'toy-sensory-kit': ['face', 'chest', 'waist', 'inner_thigh'],
  'toy-wax-candle': ['chest', 'waist'],
  'toy-mirror': ['other'],
  'toy-wand': ['genitals'],
  'toy-remote': ['genitals', 'hips'],
  'toy-collar': ['neck'],
  'toy-rope': ['hands'],
  'toy-cuff-set': ['hands'],
  'toy-under-bed': ['hands', 'feet'],
  'toy-spreader': ['feet', 'thighs'],
  'toy-plug': ['genitals', 'hips'],
  'act-massage-more': ['back', 'shoulders', 'waist', 'inner_thigh'],
  'act-undressing-slowly': ['chest', 'waist', 'shoulders'],
  'act-grinding': ['hips', 'thighs'],
  'act-dry-humping': ['hips', 'thighs'],
  'act-marking': ['neck', 'shoulders', 'chest'],
  'act-hands-on-them': ['genitals', 'inner_thigh'],
  'act-oral': ['genitals', 'inner_thigh', 'lips'],
  'act-mutual': ['genitals', 'hands'],
  'act-mutual-watching': ['genitals'],
  'act-toy-tease': ['inner_thigh', 'hips', 'genitals'],
  'act-eye-contact': ['face'],
  'act-morning-shower': ['back', 'chest', 'hair'],
  'act-aftershocks': ['back', 'waist'],
  'act-roleplay-explicit': ['other'],
  'act-begging': ['genitals'],
  'act-dirty-talk-specific': ['ears'],
  'act-praise-during': ['face'],
  'act-overstimulation': ['genitals'],
  'act-anal': ['genitals', 'hips'],
  'act-finish-on': ['genitals', 'chest'],
  'act-public-risk': ['genitals', 'hips'],
  'act-recording': ['other'],
  'act-full-night': ['genitals'],
  'act-second-round': ['genitals'],
  'act-cleaning-up': ['genitals', 'inner_thigh'],
  'pos-lap-clothed': ['hips', 'waist'],
  'pos-pinned-standing': ['shoulders', 'waist'],
  'pos-chair-straddle': ['hips', 'thighs', 'waist'],
  'pos-missionary': ['genitals', 'hips', 'back'],
  'pos-face-to-face': ['genitals', 'hips', 'chest'],
  'pos-cowgirl': ['genitals', 'hips', 'chest'],
  'pos-doggy': ['genitals', 'hips', 'back'],
  'pos-spooning': ['genitals', 'hips', 'back', 'neck'],
  'pos-against-wall': ['genitals', 'hips', 'thighs'],
  'pos-reverse-cowgirl': ['genitals', 'hips', 'back'],
  'pos-legs-over-shoulders': ['genitals', 'thighs', 'inner_thigh'],
  'pos-sixty-nine': ['genitals', 'inner_thigh', 'lips'],
  'toy-massage-oil': ['back', 'shoulders', 'waist'],
  'toy-feather': ['waist', 'chest', 'inner_thigh'],
  'toy-blindfold': ['face', 'hair'],
  'toy-ice': ['chest', 'waist'],
  'toy-body-paint': ['waist', 'chest', 'lips'],
  'toy-vibrator': ['genitals', 'hips'],
  'toy-silk-ties': ['hands'],
  'toy-handcuffs': ['hands'],
  'act-dirty-talk': ['ears'],
  'act-massage': ['back', 'shoulders', 'thighs'],
  'act-aftercare': ['back', 'hair', 'face'],
  'act-shower': ['back', 'waist', 'chest'],
  'act-morning-after': ['genitals', 'hips', 'back'],
  'act-praise': ['face'],
  'act-edging': ['genitals'],
  'act-exhibitionism': ['genitals', 'hips'],
}

/**
 * What kinks each built-in entry involves. This is the *only* thing a hard limit can act on:
 * `intimacyEntryKinks` falls through to `[]` for anything missing here, and `isAnyHardLimit([])` is
 * always false — so an untagged entry cannot be excluded by any limit an author sets, however
 * carefully the entry itself is written. Half the catalog used to be missing from this table.
 *
 * The rule for what to tag: **something a character could plausibly have an opinion about.** A kiss
 * to the forehead gets `gentle` because a character can genuinely be eager for or averse to
 * tenderness (`kinkResponsiveness` reads valence, not just limits); a kiss to the wrist gets
 * nothing, because there is no coherent stance to take on it. An absent entry below is a
 * deliberate "nothing to have an opinion about", not an oversight.
 */
const BUILT_IN_ENTRY_KINKS: Record<string, KinkId[]> = {
  // affection — all `gentle`, which is the only stance there is to take on closeness.
  'aff-hands-public': ['gentle'],
  'aff-earbuds': ['gentle'],
  'aff-cooking': ['gentle'],
  'aff-hair-washing': ['gentle'],
  'aff-slow-dance': ['gentle'],
  'aff-falling-asleep': ['gentle'],
  'aff-bath-together': ['gentle'],

  // kissing_spot — the tender end reads as `gentle`; the merely sensual ones carry no stance.
  'kiss-forehead': ['gentle'],
  'kiss-nose': ['gentle'],
  'kiss-knuckles': ['gentle'],
  'kiss-hairline': ['gentle'],
  'kiss-palm': ['gentle'],
  'kiss-cheek': ['gentle'],
  'kiss-hand': ['gentle'],
  'kiss-temple': ['gentle'],

  // position — the useful axis here is gentle vs rough, which is what an author actually rules out.
  'pos-lap-clothed': ['gentle'],
  'pos-pinned-standing': [],
  'pos-chair-straddle': [],
  'pos-missionary': ['gentle'],
  'pos-missionary-hooked': [],
  'pos-face-to-face-slow': ['gentle'],
  'pos-chest-to-back': [],
  'pos-spooning-deep': ['gentle'],
  'pos-edge-of-bed': [],
  'pos-side-by-side': ['gentle'],
  'pos-wall-one-leg': ['rough'],
  'pos-desk': ['rough'],
  'pos-table': [],
  'pos-window': ['exhibitionism'],
  'pos-bath-edge': [],
  'pos-shower-bench': [],
  'pos-onsen-edge': ['exhibitionism'],
  'pos-carry': ['rough'],
  'pos-prone': ['rough'],
  'pos-lotus': ['gentle'],
  'pos-standing-behind': ['rough'],
  'pos-full-nelson': ['rough', 'bondage'],
  'pos-face-to-face': ['gentle'],
  'pos-spooning': ['gentle'],
  'pos-cowgirl': [],
  'pos-doggy': ['rough'],
  'pos-reverse-cowgirl': [],
  'pos-legs-over-shoulders': ['rough'],
  'pos-against-wall': ['rough'],
  'pos-sixty-nine': ['oral'],

  // toy
  'toy-massage-oil': ['gentle'],
  'toy-warming-gel': ['sensory_play'],
  // Wearables. `roleplay` on the costume ones is the stance an author would actually rule out —
  // someone who finds dressing up mortifying, rather than someone with a view on lingerie.
  'toy-thighhighs': [],
  'toy-lingerie': [],
  'toy-sheer-robe': [],
  'toy-cat-ears': ['roleplay'],
  'toy-bunny-outfit': ['roleplay'],
  'toy-maid-outfit': ['roleplay'],
  'toy-harness': ['bondage'],
  'toy-scarf-eyes': ['sensory_play', 'bondage'],
  'toy-sensory-kit': ['sensory_play', 'bondage'],
  'toy-wax-candle': ['sensory_play'],
  'toy-mirror': ['voyeurism'],
  'toy-wand': ['toys', 'overstimulation'],
  'toy-remote': ['toys', 'exhibitionism'],
  'toy-collar': ['bondage'],
  'toy-rope': ['bondage'],
  'toy-cuff-set': ['bondage'],
  'toy-under-bed': ['bondage'],
  'toy-spreader': ['bondage', 'rough'],
  'toy-plug': ['toys', 'anal'],
  'toy-feather': ['sensory_play'],
  'toy-blindfold': ['sensory_play', 'bondage'],
  'toy-ice': ['sensory_play'],
  'toy-body-paint': ['sensory_play'],
  'toy-vibrator': ['toys'],
  'toy-silk-ties': ['bondage'],
  'toy-handcuffs': ['bondage'],

  // activity
  'act-dirty-talk': ['dirty_talk'],
  'act-dirty-talk-specific': ['dirty_talk'],
  'act-massage-more': ['gentle'],
  'act-undressing-slowly': ['gentle'],
  'act-grinding': [],
  'act-dry-humping': [],
  'act-marking': ['marking'],
  'act-hands-on-them': [],
  'act-oral': ['oral'],
  'act-mutual': [],
  'act-mutual-watching': ['voyeurism'],
  'act-toy-tease': ['toys', 'edging'],
  'act-eye-contact': [],
  'act-morning-shower': ['gentle'],
  'act-aftershocks': ['gentle'],
  'act-roleplay-explicit': ['roleplay'],
  'act-begging': ['edging', 'degradation'],
  'act-praise-during': ['praise'],
  'act-overstimulation': ['overstimulation'],
  'act-anal': ['anal'],
  'act-finish-on': ['bodily_fluids'],
  'act-public-risk': ['exhibitionism'],
  'act-recording': ['recording', 'exhibitionism'],
  'act-full-night': [],
  'act-second-round': ['overstimulation'],
  'act-cleaning-up': ['bodily_fluids', 'gentle'],
  'act-massage': ['gentle'],
  'act-aftercare': ['gentle'],
  'act-shower': [],
  'act-roleplay': ['roleplay'],
  'act-morning-after': ['gentle'],
  'act-praise': ['praise'],
  'act-edging': ['edging'],
  'act-exhibitionism': ['exhibitionism'],
}

/** The regions an entry involves — its own tag, or the built-in map, or nothing. */
export function intimacyEntryRegions(option: IntimacyUnlockable): BodyRegion[] {
  return option.regions ?? BUILT_IN_ENTRY_REGIONS[option.id] ?? []
}

/** The kinks an entry involves — its own tag, or the built-in map, or nothing. */
export function intimacyEntryKinks(option: IntimacyUnlockable): KinkId[] {
  return option.kinks ?? BUILT_IN_ENTRY_KINKS[option.id] ?? []
}

/** Per-category baseline for an entry with no authored `arousalWeight`. */
const CATEGORY_AROUSAL_WEIGHT: Record<IntimacyCategory, number> = { affection: 1, kissing_spot: 1, position: 7, toy: 4, activity: 3 }

/**
 * The active entry's per-turn arousal weight. The default leans on `minWarmth` as a proxy for
 * intensity — the entries a relationship earns last are the ones that escalate hardest — which
 * holds across the built-in catalog and degrades sensibly for a world's own additions.
 */
export function intimacyArousalWeight(option: IntimacyUnlockable): number {
  if (option.arousalWeight !== undefined) return option.arousalWeight
  const tierBump = option.minWarmth >= 90 ? 2 : option.minWarmth >= 75 ? 1 : 0
  return CATEGORY_AROUSAL_WEIGHT[option.category] + tierBump
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
  // --- affection: non-explicit closeness, available at every rating (see `isExplicitCategory`).
  //     The band a playthrough actually spends most of its time in, and the catalog had nothing in
  //     it — every entry below is weight 1, so clicking one reads as tenderness, not escalation. ---
  { id: 'aff-hands-public', category: 'affection', label: 'holding hands in public', minWarmth: 15, arousalWeight: 1, actionText: "*I let my hand find {char}'s as we walk, and don't let go when the street gets busier.*", promptNote: "taking {char}'s hand in public and keeping it there, the small decision of not letting go when someone might see" },
  { id: 'aff-earbuds', category: 'affection', label: 'sharing earbuds', minWarmth: 15, arousalWeight: 1, actionText: "*I pull one earbud out and hold it toward {char} without saying anything about it.*", promptNote: "offering {char} one earbud and sharing a song, the two of you tethered together by a short wire and having to stand closer for it" },
  { id: 'aff-cooking', category: 'affection', label: 'cooking together', minWarmth: 15, arousalWeight: 1, actionText: "*I hand {char} a knife and the other half of the vegetables, and we work the same counter without getting in each other's way.*", promptNote: "cooking together in the same small kitchen, the easy choreography of two people working around each other, neither of them making it a big deal" },
  { id: 'aff-hair-washing', category: 'affection', label: 'washing their hair', minWarmth: 35, arousalWeight: 1, actionText: "*I work the shampoo through {char}'s hair slowly, fingertips against their scalp, until their shoulders come down.*", promptNote: "washing {char}'s hair for them, fingertips working slowly against their scalp, the particular defencelessness of letting someone do that" },
  { id: 'aff-slow-dance', category: 'affection', label: 'slow dancing at home', minWarmth: 35, arousalWeight: 1, actionText: "*I take {char}'s hand, put the other at their waist, and we move to something barely loud enough to dance to.*", promptNote: "slow dancing in a room too small for it, to music barely loud enough, more standing close and swaying than actual dancing" },
  { id: 'aff-falling-asleep', category: 'affection', label: 'falling asleep against them', minWarmth: 35, arousalWeight: 1, actionText: "*I stop fighting it and let my head come to rest against {char}, breathing slowing before I can decide not to.*", promptNote: "falling asleep against {char} without meaning to, the trust of going under next to someone, and whatever they do about it" },
  { id: 'aff-bath-together', category: 'affection', label: 'a bath together', minWarmth: 35, arousalWeight: 1, actionText: "*I settle into the water behind {char} and pull them back against my chest, the heat doing most of the talking.*", promptNote: "sharing a bath with {char}, warm water and no hurry, backs against chests, the conversation going quieter than it would anywhere else" },

  // --- kissing_spot: available across the whole warmth ladder, no commitment required ---
  { id: 'kiss-forehead', category: 'kissing_spot', label: 'forehead', minWarmth: 15, actionText: "*I tilt {char}'s chin up and press a slow kiss to their forehead, lingering there a second before I pull back.*", promptNote: "a slow, tender kiss to {char}'s forehead, held long enough that they go still under it" },
  { id: 'kiss-cheek', category: 'kissing_spot', label: 'cheek', minWarmth: 15, actionText: "*I lean in and kiss {char}'s cheek, letting it linger a moment longer than it needs to.*", promptNote: "a lingering kiss to {char}'s cheek, a beat longer than it needed to be, close enough that they feel you decide to stay there" },
  { id: 'kiss-hand', category: 'kissing_spot', label: 'the back of the hand', minWarmth: 15, actionText: "*I take {char}'s hand, turn it in mine, and kiss the back of it without breaking eye contact.*", promptNote: "a kiss to the back of {char}'s hand with your eyes on theirs the whole time, so they have to decide whether to look away" },
  { id: 'kiss-nose', category: 'kissing_spot', label: 'the tip of the nose', minWarmth: 15, actionText: "*I lean in and kiss the very tip of {char}'s nose, mostly to see what they do about it.*", promptNote: "a light kiss to the tip of {char}'s nose, more teasing than romantic, the sort that makes them scrunch up or shove you" },
  { id: 'kiss-knuckles', category: 'kissing_spot', label: 'knuckles', minWarmth: 15, actionText: "*I lift {char}'s hand and press my mouth to their knuckles, one at a time, not hurrying it.*", promptNote: "kisses pressed to {char}'s knuckles one at a time, unhurried, their hand still held in yours after you stop" },
  { id: 'kiss-hairline', category: 'kissing_spot', label: 'hairline', minWarmth: 15, actionText: "*I kiss {char} right where their hair starts, the way you would someone you were seeing off.*", promptNote: "a kiss to {char}'s hairline, the kind you give someone you're seeing off or settling down, asking nothing at all" },
  { id: 'kiss-palm', category: 'kissing_spot', label: 'the palm of the hand', minWarmth: 35, actionText: "*I turn {char}'s hand over and kiss the middle of their palm, then close their fingers over it.*", promptNote: "a kiss to the centre of {char}'s palm, their fingers folded closed over it afterward as if it were something to keep" },
  { id: 'kiss-shoulder-clothed', category: 'kissing_spot', label: 'shoulder, through a sleeve', minWarmth: 35, actionText: "*I kiss {char}'s shoulder through their sleeve, resting there a second longer than I meant to.*", promptNote: "a kiss to {char}'s shoulder through the fabric of their sleeve, nothing bare about it, lingering a beat past what was intended" },
  { id: 'kiss-temple', category: 'kissing_spot', label: 'temple', minWarmth: 35, actionText: "*I brush {char}'s hair back and kiss them softly at the temple.*", promptNote: "a soft kiss to {char}'s temple, their hair pushed back first, the kind of kiss that asks nothing back" },
  { id: 'kiss-neck', category: 'kissing_spot', label: 'neck', minWarmth: 35, actionText: "*I dip my head and trail a kiss along the side of {char}'s neck, slow, feeling them react.*", promptNote: "kisses trailed slowly along {char}'s neck, feeling {char}'s pulse or breath change under your mouth as you go" },
  { id: 'kiss-jaw', category: 'kissing_spot', label: 'along the jaw', minWarmth: 55, actionText: "*I kiss along {char}'s jaw, unhurried, working from just under their ear toward their chin.*", promptNote: "unhurried kisses along {char}'s jaw, working from under the ear toward the chin, their breath going shallow somewhere in the middle of it" },
  { id: 'kiss-collarbone', category: 'kissing_spot', label: 'collarbone', minWarmth: 55, actionText: "*I ease {char}'s collar aside and press a kiss to the line of their collarbone.*", promptNote: "a kiss to the line of {char}'s collarbone, collar eased aside, mouth warm against a place usually covered" },
  { id: 'kiss-wrist', category: 'kissing_spot', label: 'inner wrist', minWarmth: 55, actionText: "*I turn {char}'s wrist over and kiss the thin skin on the inside of it, right over the pulse.*", promptNote: "a kiss to the thin skin inside {char}'s wrist, right over the pulse, close enough to feel it pick up" },
  { id: 'kiss-ear', category: 'kissing_spot', label: 'behind the ear', minWarmth: 75, actionText: "*I kiss {char} just behind the ear, close enough that they can feel me breathe.*", promptNote: "a kiss just behind {char}'s ear, close enough that they feel you breathe before they feel your mouth" },
  { id: 'kiss-shoulder', category: 'kissing_spot', label: 'shoulder blade', minWarmth: 75, actionText: "*I move behind {char} and kiss the curve of their shoulder blade, one hand resting at their waist.*", promptNote: "a kiss to the curve of {char}'s shoulder blade from behind, one hand at their waist, them unable to see it coming" },
  { id: 'kiss-thigh', category: 'kissing_spot', label: 'inner thigh', minWarmth: 90, minCommitment: 'dating', actionText: "*I settle lower and kiss my way slowly up the inside of {char}'s thigh, taking my time.*", promptNote: "kisses working slowly up the inside of {char}'s thigh, unhurried, their leg tensing or opening as you go" },

  // --- position: explicit-only (see intimacyOptionsGuidance). Phrased as guiding things there mid-scene. ---
  // The clothed tier. Everything here can happen with clothes on, which is what makes it the right
  // rung between a kiss and a bed — the catalog used to jump straight from one to the other.
  { id: 'pos-lap-clothed', category: 'position', label: 'pulled into their lap, still dressed', minWarmth: 55, actionText: "*I take {char} by the hips and pull them down into my lap, both of us still fully dressed, and just hold them there.*", promptNote: "{char} pulled into your lap with both of you still fully dressed, held there, nothing happening yet and both of you aware of how little would have to change" },
  { id: 'pos-pinned-standing', category: 'position', label: 'pinned standing, fully clothed', minWarmth: 55, actionText: "*I back {char} up until there's nowhere left to go and brace a hand on the wall beside their head, not touching them otherwise.*", promptNote: "{char} backed against a wall with your hand braced beside their head, fully clothed and barely touching, the whole charge of it in the not-touching" },
  { id: 'pos-chair-straddle', category: 'position', label: 'straddling them in a chair', minWarmth: 55, actionText: "*I sit back and pull {char} down to straddle my lap in the chair, their knees either side of me.*", promptNote: "{char} straddling your lap in a chair, knees either side of you, their height advantage for once, both of you still dressed" },
  { id: 'pos-missionary', category: 'position', label: 'missionary', minWarmth: 75, minCommitment: 'dating', actionText: "*I ease {char} down onto their back and move over them, settling between their legs, weight on my forearms so I can watch their face.*", promptNote: "the missionary position: {char} on their back, you over them, face to face, weight settling in as you find a slow rhythm, {char}'s hands finding your back or shoulders" },
  { id: 'pos-face-to-face', category: 'position', label: 'in their lap, face to face', minWarmth: 75, minCommitment: 'dating', actionText: "*I pull {char} up into my lap so we're chest to chest, their legs around me, close enough to feel every breath.*", promptNote: "{char} straddling your lap, chest to chest and face to face, close enough that every breath and every shift registers on both of you" },
  { id: 'pos-cowgirl', category: 'position', label: 'them on top', minWarmth: 75, minCommitment: 'dating', actionText: "*I lie back and guide {char} over me, hands on their hips, letting them set the pace from up there.*", promptNote: "{char} on top, riding you, setting their own pace, hands braced on your chest or laced with yours, the rhythm rising and falling as they find what works" },
  { id: 'pos-doggy', category: 'position', label: 'from behind', minWarmth: 75, minCommitment: 'dating', actionText: "*I turn {char} over onto their hands and knees and move in behind them, one hand spread flat on their lower back.*", promptNote: "taking {char} from behind, them on their hands and knees, your hand spread on their lower back, their arms giving out by degrees" },
  { id: 'pos-spooning', category: 'position', label: 'spooning', minWarmth: 35, actionText: "*I fit myself against {char}'s back, both of us on our sides, and pull them in close by the hip.*", promptNote: "spooning: you at {char}'s back, both on your sides, close enough there's no space left between you, one hand free to roam or hold" },
  { id: 'pos-missionary-hooked', category: 'position', label: 'missionary, legs hooked', minWarmth: 75, minCommitment: 'dating', actionText: "*I catch {char}'s legs behind the knee and hook them up over my arms, changing the angle without pulling back.*", promptNote: "missionary with {char}'s legs hooked up over your arms, the angle changed without either of you having to stop, deeper than the position started out" },
  { id: 'pos-face-to-face-slow', category: 'position', label: 'face to face, slow', minWarmth: 75, minCommitment: 'dating', actionText: "*I slow everything right down until it's just the two of us breathing at each other, barely moving.*", promptNote: "face to face and deliberately slow, barely moving, both of you close enough that every small change in breathing is a whole conversation" },
  { id: 'pos-chest-to-back', category: 'position', label: 'from behind, chest to back', minWarmth: 75, minCommitment: 'dating', actionText: "*I move in behind {char} and press my chest flat to their back, one arm crossing their front to hold them there.*", promptNote: "taking {char} from behind with your chest flat against their back and one arm across their front, closer and less impersonal than being on all fours" },
  { id: 'pos-spooning-deep', category: 'position', label: 'spooning, slow and deep', minWarmth: 75, minCommitment: 'dating', actionText: "*Still on our sides, I hitch {char}'s top leg back over mine and don't rush any of it.*", promptNote: "spooning that turns into sex without either of you sitting up, {char}'s top leg hooked back over yours, slow and deep and almost lazy about it" },
  { id: 'pos-edge-of-bed', category: 'position', label: 'on the edge of the bed, you standing', minWarmth: 75, minCommitment: 'dating', actionText: "*I pull {char} down to the edge of the mattress and stay standing, hands closing around their thighs.*", promptNote: "{char} lying back at the very edge of the bed with you standing, hands around their thighs, the height difference doing most of the work" },
  { id: 'pos-side-by-side', category: 'position', label: 'on your sides, face to face', minWarmth: 75, minCommitment: 'dating', actionText: "*We stay on our sides, facing each other, legs tangling until it works.*", promptNote: "both of you on your sides facing each other, legs tangled until the angle works, the least athletic and most conversational way to do this" },
  { id: 'pos-wall-one-leg', category: 'position', label: 'against the wall, one leg up', minWarmth: 75, minCommitment: 'dating', actionText: "*I press {char} to the wall and lift one of their legs to my hip, leaving the other foot on the floor.*", promptNote: "{char} against the wall with one leg hitched up to your hip and the other foot still on the floor, upright and carrying their own weight, unlike being lifted entirely" },
  { id: 'pos-against-wall', category: 'position', label: 'against the wall', minWarmth: 75, minCommitment: 'dating', actionText: "*I back {char} into the wall and lift them, their legs coming up around me, my forearm braced beside their head.*", promptNote: "{char} pinned against the wall with their legs around you, held up by you entirely, nothing under them to brace against" },

  // The top tier is distinguished by exposure (somewhere you could be caught) or by trust (something
  // that needs real coordination to be safe), not by intensity.
  { id: 'pos-desk', category: 'position', label: 'bent over the desk', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['classroom', 'office', 'club-room', 'library', 'school-nurse-office'], actionText: "*I sweep enough of the desk clear to matter and bend {char} forward over it.*", promptNote: "{char} bent forward over a desk, whatever was on it pushed aside, the wrongness of the furniture being part of it" },
  { id: 'pos-table', category: 'position', label: 'on the table', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['kitchen', 'living-room', 'restaurant', 'cafe'], actionText: "*I lift {char} up onto the table and step in between their knees before they've finished settling.*", promptNote: "{char} lifted onto a table with you standing between their knees, everything at the wrong height and better for it" },
  { id: 'pos-window', category: 'position', label: 'against the window', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['bedroom', 'living-room', 'office', 'hospital'], actionText: "*I walk {char} back until the glass is cold against their shoulders, and don't close the curtain.*", promptNote: "{char} pressed to a window with the curtain open, cold glass at their back, the street below and the question of who can see part of the whole thing" },
  { id: 'pos-bath-edge', category: 'position', label: 'the edge of the bath', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['shower', 'onsen'], actionText: "*I sit {char} on the rim of the tub, water still running, and kneel into the space between.*", promptNote: "{char} perched on the edge of the bath with the water still running, wet tile and nowhere dry to brace, the two of you working around the awkwardness of it" },
  { id: 'pos-shower-bench', category: 'position', label: 'the shower bench', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['shower', 'onsen'], actionText: "*I get {char} down onto the bench under the spray and follow them into it.*", promptNote: "the two of you on a shower bench under running water, steam and slick skin, the water getting in the way and neither of you stopping to fix it" },
  { id: 'pos-onsen-edge', category: 'position', label: 'the edge of the onsen', minWarmth: 90, minCommitment: 'exclusive', requiresBackground: ['onsen'], actionText: "*I lift {char} up to sit on the warm stone at the water's edge, still waist-deep myself.*", promptNote: "{char} sitting on warm wet stone at the edge of the water with you still standing in it, open air and the constant risk of not being alone out here" },
  { id: 'pos-carry', category: 'position', label: 'standing, carried', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I get my hands under {char}'s thighs and lift, and we don't make it anywhere near the bed.*", promptNote: "{char} carried entirely, legs around you and nothing under them, held up by your arms alone for as long as that lasts" },
  { id: 'pos-prone', category: 'position', label: 'face down, flat', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I ease {char} flat onto their front and settle over them, my weight following them down.*", promptNote: "{char} flat on their front with your weight settled over them, pinned by it, everything tighter and slower for the lack of room to move" },
  { id: 'pos-lotus', category: 'position', label: 'seated, wrapped around each other', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I sit up and pull {char} into my lap until their legs cross behind me and there's no space left anywhere.*", promptNote: "both of you seated and wrapped around each other, legs crossed behind backs, almost no movement possible and the closeness doing all of the work instead" },
  { id: 'pos-standing-behind', category: 'position', label: 'standing, from behind', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I turn {char} to face away and keep them upright against me, one arm across their chest.*", promptNote: "{char} standing, facing away, held upright against you with an arm across their chest, both of you having to work for balance" },
  { id: 'pos-full-nelson', category: 'position', label: 'full nelson', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I hook my arms up under {char}'s and take their weight, checking their face before I do anything else.*", promptNote: "{char} held in a full nelson, arms hooked up under theirs and their weight taken entirely by you. This one is about being completely held rather than about force: {char} stays able to say stop and be put down at once, and you keep checking that they are still all right with it" },
  { id: 'pos-reverse-cowgirl', category: 'position', label: 'reverse cowgirl', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I have {char} turn around so they're facing away, then guide them back down over me, hands running up their spine.*", promptNote: "{char} on top but facing away, setting their own pace with your hands on their hips and their back to you, neither of you able to read the other's face" },
  { id: 'pos-legs-over-shoulders', category: 'position', label: 'legs over shoulders', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I press forward until {char}'s knees fold toward their chest and hook their legs over my shoulders.*", promptNote: "{char} on their back with their legs hooked over your shoulders, folded close, the angle deeper than they expected" },
  { id: 'pos-sixty-nine', category: 'position', label: '69', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I shift us both around until we're head to toe, mouths where our hands were.*", promptNote: "the two of you head to toe, going down on each other at once, each of you losing rhythm whenever the other gets it right" },

  // --- toy: explicit-only, and now the one category that costs coins — see `price` ---
  { id: 'toy-massage-oil', category: 'toy', label: 'massage oil', minWarmth: 55, price: 8, actionText: "*I warm a little massage oil between my palms and start working it slowly into {char}'s back and shoulders.*", promptNote: "warming massage oil and working it over {char}'s body, thumbs pressing into knotted muscle, the slick glide of hands finding where the tension actually sits" },
  { id: 'toy-feather', category: 'toy', label: 'a feather tickler', minWarmth: 55, price: 8, actionText: "*I draw a feather tickler in a slow line down {char}'s side, watching for the shiver.*", promptNote: "teasing {char}'s bare skin with a feather tickler, drawn slow, the shiver arriving a moment after the touch does" },
  { id: 'toy-warming-gel', category: 'toy', label: 'warming gel', minWarmth: 55, price: 8, actionText: "*I work a little of the gel over {char}'s skin and wait with them for it to start going warm.*", promptNote: "warming gel worked slowly over {char}'s skin, the heat arriving a beat after the touch does and building while neither of you moves" },
  { id: 'toy-scarf-eyes', category: 'toy', label: 'a scarf over the eyes', minWarmth: 55, price: 6, actionText: "*I fold a scarf over and tie it loose across {char}'s eyes, asking if it's comfortable before I let go.*", promptNote: "a scarf tied loosely over {char}'s eyes, improvised rather than intended for this, loose enough to push off whenever they want to" },
  { id: 'toy-thighhighs', category: 'toy', label: 'thighhighs', minWarmth: 55, price: 9, actionText: "*I hand {char} the thighhighs and sit back down, entirely content to wait.*", promptNote: "{char} in thighhighs and nothing much else, the band of them against bare skin and the small distance of fabric making the rest of it worse" },
  { id: 'toy-lingerie', category: 'toy', label: 'lingerie', minWarmth: 55, price: 14, actionText: "*I leave the box on the bed and tell {char} I'd like to see it on, whenever they want.*", promptNote: "{char} wearing lingerie that was chosen for them, the deliberateness of having been picked out for it doing as much work as the sight of it" },
  { id: 'toy-sheer-robe', category: 'toy', label: 'something sheer', minWarmth: 55, price: 10, actionText: "*I settle the robe over {char}'s shoulders, which covers nothing and somehow makes it worse.*", promptNote: "{char} in something sheer that covers nothing, the pretence of being dressed more charged than being undressed would be" },
  { id: 'toy-cat-ears', category: 'toy', label: 'cat ears', minWarmth: 55, price: 8, actionText: "*I set the ears in {char}'s hair and straighten them, keeping an absolutely straight face about it.*", promptNote: "{char} wearing cat ears, half a joke and half not, the embarrassment of going along with it part of what makes it work" },
  { id: 'toy-bunny-outfit', category: 'toy', label: 'a bunny-girl outfit', minWarmth: 75, minCommitment: 'dating', price: 22, actionText: "*I lay the outfit out where {char} can see exactly what it is, and let them decide.*", promptNote: "{char} in a bunny-girl outfit, absurd and effective in equal measure, the two of you unable to take it entirely seriously and unable to ignore it either" },
  { id: 'toy-maid-outfit', category: 'toy', label: 'a maid outfit', minWarmth: 75, minCommitment: 'dating', price: 22, actionText: "*I ask, not quite seriously, and {char} takes the outfit out of my hands anyway.*", promptNote: "{char} in a maid outfit, the formality of it played straight for exactly as long as either of you can manage" },
  { id: 'toy-harness', category: 'toy', label: 'a strap harness', minWarmth: 90, minCommitment: 'exclusive', price: 26, actionText: "*I work the harness over {char}, adjusting each strap until it sits how I want it.*", promptNote: "a strap harness fitted over {char}, each strap adjusted deliberately, the framing of it rather than any coverage being the entire point" },
  { id: 'toy-blindfold', category: 'toy', label: 'a blindfold', minWarmth: 75, minCommitment: 'dating', price: 15, actionText: "*I gather {char}'s hair aside and settle a blindfold over their eyes, checking it isn't too tight.*", promptNote: "a blindfold over {char}'s eyes so they can't see what's coming, every sound and every touch landing harder for it" },
  { id: 'toy-ice', category: 'toy', label: 'ice, traced slowly', minWarmth: 75, minCommitment: 'dating', price: 12, actionText: "*I take a piece of ice from the glass and trace it slowly along {char}'s collarbone, down the centre of their chest.*", promptNote: "tracing a piece of ice slowly over {char}'s bare skin, the cold and the wet trail behind it, their stomach pulling tight away from it" },
  { id: 'toy-body-paint', category: 'toy', label: 'body paint or chocolate', minWarmth: 75, minCommitment: 'dating', price: 18, actionText: "*I dip a finger in and drag a slow line across {char}'s stomach, then lean down to follow it.*", promptNote: "dragging body paint or chocolate across {char}'s skin, then following the line with your mouth, warm after cold" },
  { id: 'toy-sensory-kit', category: 'toy', label: 'a sensory kit', minWarmth: 75, minCommitment: 'dating', price: 26, actionText: "*I set the whole kit out where {char} can see it, and let them watch me decide what to start with.*", promptNote: "working through a sensory kit on {char} — blindfold, feather, ice, one after another — the anticipation between each one worse than any of them" },
  { id: 'toy-wax-candle', category: 'toy', label: 'a low-temperature candle', minWarmth: 75, minCommitment: 'dating', price: 14, actionText: "*I hold the candle high enough that it cools on the way down, and let the first drop land where {char} can watch it.*", promptNote: "low-temperature wax dripped onto {char}'s skin from high enough to cool on the way, the brief sting and then the warmth setting, {char} bracing for each drop" },
  { id: 'toy-mirror', category: 'toy', label: 'a mirror, placed deliberately', minWarmth: 75, minCommitment: 'dating', price: 16, actionText: "*I turn {char} to face the mirror and tell them, quietly, to keep looking.*", promptNote: "a mirror placed so {char} has to watch, and being told to keep looking — the difference between doing this and seeing yourself do it" },
  { id: 'toy-vibrator', category: 'toy', label: 'a vibrator', minWarmth: 90, minCommitment: 'dating', price: 30, actionText: "*I switch the vibrator on low and run it in a slow circle over {char}'s hip, not where they want it yet.*", promptNote: "using a vibrator on {char}, teasing before giving them what they want: the hum against sensitive skin, {char}'s hips chasing or flinching from the intensity, their hands finding something to grip" },
  { id: 'toy-wand', category: 'toy', label: 'a wand massager', minWarmth: 90, minCommitment: 'dating', price: 32, actionText: "*I set the wand against {char} on the lowest setting and keep it there, whatever they do about it.*", promptNote: "a wand massager held against {char} and kept there, relentless in a way a hand cannot be, past the point where they can hold still — and you watching for whether they want it moved" },
  { id: 'toy-remote', category: 'toy', label: 'something they hold the remote to', minWarmth: 90, minCommitment: 'exclusive', price: 34, actionText: "*I press the remote into {char}'s hand and tell them it's theirs to decide.*", promptNote: "a toy whose remote {char} is holding, so the pace is entirely theirs and you have to live with whatever they choose to do with that" },
  { id: 'toy-collar', category: 'toy', label: 'a soft collar', minWarmth: 90, minCommitment: 'exclusive', price: 20, actionText: "*I fasten the collar at {char}'s throat, two fingers under it to check it isn't tight.*", promptNote: "a soft collar fastened at {char}'s throat, checked for room with two fingers, the weight of it more the point than anything it does" },
  { id: 'toy-rope', category: 'toy', label: 'soft rope', minWarmth: 90, minCommitment: 'exclusive', price: 22, actionText: "*I take my time with the rope, wrapping {char}'s wrists in slow deliberate turns.*", promptNote: "soft rope wound around {char}'s wrists in slow deliberate turns, the unhurried care of the tying doing as much as the result" },
  { id: 'toy-cuff-set', category: 'toy', label: 'a padded cuff set', minWarmth: 90, minCommitment: 'exclusive', price: 28, actionText: "*I buckle the padded cuffs around {char}'s wrists and check each one with a finger before moving on.*", promptNote: "padded cuffs buckled on {char}, each checked for room, built to be comfortable for long enough that neither of you has to hurry" },
  { id: 'toy-under-bed', category: 'toy', label: 'an under-the-bed set', minWarmth: 90, minCommitment: 'exclusive', price: 30, actionText: "*I clip {char}'s wrists and ankles to the straps and step back to look at what that leaves them able to do.*", promptNote: "{char} spread and clipped to under-the-bed straps at both wrists and ankles, able to pull against them and get nowhere, and being looked at while they work that out" },
  { id: 'toy-spreader', category: 'toy', label: 'a spreader bar', minWarmth: 90, minCommitment: 'exclusive', price: 26, actionText: "*I fix {char}'s ankles to either end of the bar and let them find out how little that leaves them.*", promptNote: "a spreader bar holding {char}'s ankles apart, the position not theirs to change, every adjustment now something you have to do for them" },
  { id: 'toy-plug', category: 'toy', label: 'a plug, worked up to', minWarmth: 90, minCommitment: 'exclusive', price: 24, actionText: "*I take it slowly, plenty of lube and plenty of time, watching {char}'s face for every part of it.*", promptNote: "working a plug into {char} slowly, with lubricant and real patience, stopping whenever their face says to, the stretch and the settling of it once it is in" },
  { id: 'toy-silk-ties', category: 'toy', label: 'silk ties', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*I loop the silk loosely around {char}'s wrists and knot it to the headboard, leaving enough give that they could pull free if they wanted.*", promptNote: "loosely tying {char}'s wrists with silk, light bondage they could slip if they wanted" },
  { id: 'toy-handcuffs', category: 'toy', label: 'playful handcuffs', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*I click the cuffs closed around {char}'s wrists, slow, watching their face the whole time.*", promptNote: "cuffing {char}'s wrists with playful handcuffs, slow, watching their face as they work out they can't reach for you" },

  // --- activity: explicit-only (kinks, aftercare, and other non-position/toy intimate beats) ---
  { id: 'act-dirty-talk', category: 'activity', label: 'dirty talk', minWarmth: 55, actionText: "*I bring my mouth to {char}'s ear and tell them, low and specific, exactly what I want to do to them.*", promptNote: "murmuring filthy, specific things in {char}'s ear, close enough to feel {char}'s breath catch or their hands still against you" },
  { id: 'act-massage', category: 'activity', label: 'a slow, sensual massage', minWarmth: 55, actionText: "*I have {char} lie down and start working slow, deliberate pressure up either side of their spine.*", promptNote: "a slow, sensual full-body massage, pressure working up either side of {char}'s spine until they stop holding themselves up at all" },
  { id: 'act-aftercare', category: 'activity', label: 'quiet aftercare', minWarmth: 55, arousalWeight: 1, actionText: "*I pull {char} in against my chest and just hold them, one hand moving slow circles on their back, in no rush to move or talk.*", promptNote: "quiet aftercare: holding {char} close, one hand moving slow over damp skin or tangled hair, reassuring them, letting them come down at their own pace" },
  { id: 'act-massage-more', category: 'activity', label: 'a massage that turns into more', minWarmth: 55, actionText: "*I keep working at {char}'s back until my hands stop pretending that's all this is.*", promptNote: "a massage whose hands gradually stop pretending, the pressure turning into something else by degrees, neither of you naming the moment it changed" },
  { id: 'act-undressing-slowly', category: 'activity', label: 'undressing them slowly', minWarmth: 55, actionText: "*I take {char}'s clothes off one piece at a time, slower than either of us wants.*", promptNote: "undressing {char} deliberately slowly, one piece at a time, taking longer over it than either of you would like" },
  { id: 'act-grinding', category: 'activity', label: 'grinding, still clothed', minWarmth: 55, actionText: "*I pull {char} down against me and move, both of us still fully dressed and neither of us stopping.*", promptNote: "the two of you moving against each other still fully clothed, friction through fabric, going on much longer than it needs to before anything comes off" },
  { id: 'act-dry-humping', category: 'activity', label: "dry humping until it isn't", minWarmth: 55, actionText: "*Neither of us gets undressed, and neither of us stops, and it stops being a joke somewhere in the middle.*", promptNote: "dry humping that started half as a joke and stopped being one, clothes staying on past the point where that made sense, both of you close to a line and not crossing it yet" },
  { id: 'act-shower', category: 'activity', label: 'showering together', minWarmth: 75, minCommitment: 'dating', actionText: "*I take {char}'s hand and pull them toward the bathroom, reaching in to start the water.*", promptNote: "moving things into the shower together, hot water and slick skin, hands sliding where they wouldn't dry" },
  { id: 'act-marking', category: 'activity', label: 'hickeys and light bites', minWarmth: 55, minCommitment: 'dating', actionText: "*I set my mouth against {char}'s neck and stay there long enough to leave something behind.*", promptNote: "leaving marks on {char} — a hickey held long enough to bruise, light bites at the shoulder — and both of you aware they will still be there tomorrow" },
  { id: 'act-hands-on-them', category: 'activity', label: 'hands on them, watching the reaction', minWarmth: 75, minCommitment: 'dating', actionText: "*I get my hand where {char} wants it and keep my eyes on their face instead of anywhere else.*", promptNote: "using your hands on {char} while watching their face rather than your hands, adjusting to every reaction, the whole point being how closely you are reading them" },
  { id: 'act-oral', category: 'activity', label: 'oral, slow and thorough', minWarmth: 75, minCommitment: 'dating', actionText: "*I work my way down and take my time about it, in no hurry to be anywhere else.*", promptNote: "going down on {char} slowly and thoroughly, unhurried, their hands ending up in your hair and their ability to stay quiet going first" },
  { id: 'act-mutual', category: 'activity', label: 'touching each other at the same time', minWarmth: 75, minCommitment: 'dating', actionText: "*We end up with a hand each on the other, both of us losing track of what we were doing every time the other gets it right.*", promptNote: "the two of you touching each other at once, each losing rhythm whenever the other does something well, neither able to concentrate on both halves" },
  { id: 'act-mutual-watching', category: 'activity', label: 'watching each other', minWarmth: 75, minCommitment: 'dating', actionText: "*Neither of us reaches for the other. We just watch, close enough to, and don't.*", promptNote: "both of you touching yourselves while watching the other, close enough to reach and deliberately not, the watching harder to bear than being touched would be" },
  { id: 'act-toy-tease', category: 'activity', label: 'teasing with a toy, nothing more yet', minWarmth: 75, minCommitment: 'dating', actionText: "*I use the toy everywhere except where {char} actually wants it, and keep doing that.*", promptNote: "teasing {char} with a toy everywhere except where they want it, drawing it out well past patience, nothing else happening yet and both of you knowing it will" },
  { id: 'act-eye-contact', category: 'activity', label: 'not looking away', minWarmth: 75, minCommitment: 'dating', actionText: "*I hold {char}'s eyes through all of it and don't let them look off to the side.*", promptNote: "holding eye contact through the whole thing, neither of you allowed the relief of looking away, which makes it far more exposing than anything physical in it" },
  { id: 'act-morning-shower', category: 'activity', label: 'washing each other after', minWarmth: 75, minCommitment: 'dating', arousalWeight: 1, actionText: "*I get us both under the water afterward and wash {char} properly, taking my time, not starting anything.*", promptNote: "washing each other clean afterward, careful and unhurried and not starting anything again, the tenderness of it landing harder than the sex did" },
  { id: 'act-aftershocks', category: 'activity', label: 'holding them through the aftershocks', minWarmth: 75, minCommitment: 'dating', arousalWeight: 1, actionText: "*I stay exactly where I am and hold {char} while it keeps going through them.*", promptNote: "holding {char} still while the aftershocks keep moving through them, not pulling away and not doing anything more, just staying until it settles" },
  { id: 'act-roleplay-explicit', category: 'activity', label: 'a roleplay that stops pretending', minWarmth: 75, minCommitment: 'dating', actionText: "*We start it as a bit, and somewhere in the middle neither of us is acting any more.*", promptNote: "a roleplay both of you started as a game that stops being one partway through, the character slipping and the real thing underneath showing up instead" },
  { id: 'act-roleplay', category: 'activity', label: 'acting out a fantasy', minWarmth: 75, minCommitment: 'dating', actionText: "*I catch {char}'s eye and slip into the role from the fantasy we talked about, waiting to see if they'll play along.*", promptNote: "acting out a shared fantasy the two of you talked about earlier, both of you half in character and half not, the pretending slipping whenever it gets real" },
  { id: 'act-morning-after', category: 'activity', label: 'slow morning-after', minWarmth: 75, minCommitment: 'dating', actionText: "*I pull {char} back down under the covers, half-asleep, hands already wandering, in no hurry for the day to start.*", promptNote: "slow, unhurried morning-after sex, both of you still half-asleep, nothing urgent about it and nowhere to be" },
  { id: 'act-praise', category: 'activity', label: 'praise, when it counts', minWarmth: 75, minCommitment: 'dating', actionText: "*I take {char}'s face in both hands and tell them, plainly, how good they are, how good they feel, how much I want them.*", promptNote: "praising {char} out loud while it matters most: how good they are, how much you want them, until they can't take the compliment and can't ask you to stop" },
  { id: 'act-edging', category: 'activity', label: 'teasing and edging', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I bring {char} right up to the edge, then still my hand and wait, watching them, until the tension eases enough to start again.*", promptNote: "edging {char}: bringing them to the brink and stopping, over and over, until they're past being able to be patient about it" },
  { id: 'act-begging', category: 'activity', label: 'until they beg', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I stop again, and wait, and don't start until {char} actually asks me to.*", promptNote: "edging {char} until they are past being able to hold out and actually ask, the asking itself the thing you were after, and you giving in the moment it lands" },
  { id: 'act-dirty-talk-specific', category: 'activity', label: 'dirty talk that gets specific', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I stop being vague about it and tell {char} exactly what I'm going to do, in order.*", promptNote: "dirty talk that stops being suggestive and gets specific — naming exactly what is about to happen and in what order — and watching what the specificity does to {char}" },
  { id: 'act-praise-during', category: 'activity', label: "praise while it's happening", minWarmth: 90, minCommitment: 'exclusive', actionText: "*I keep talking the whole way through, telling {char} how good they are, not letting them off it.*", promptNote: "praising {char} continuously through the act itself rather than around it, not letting up, until they cannot take the compliment and cannot ask you to stop either" },
  { id: 'act-overstimulation', category: 'activity', label: 'past the first one', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I don't stop after the first, and I keep watching {char}'s face to see how much further they want this.*", promptNote: "not stopping after {char} has already come once, everything far too much and continuing anyway. {char} stays entirely able to end it and you keep checking, out loud or by reading them, that continuing is still what they want — the intensity is the point, ignoring them is not" },
  { id: 'act-anal', category: 'activity', label: 'anal, with the patience it takes', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I prepare {char} properly and slowly, and we go at whatever pace their body actually allows.*", promptNote: "anal with real preparation and real patience: plenty of lubricant, working up by degrees, stopping every time {char} needs it and starting again only when they say, the slowness not optional" },
  { id: 'act-finish-on', category: 'activity', label: 'where it ends up', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I ask {char} where they want it, and do what they say.*", promptNote: "finishing somewhere {char} has actually chosen — asked first, answered, and done accordingly — and the mess and closeness of it afterward" },
  { id: 'act-public-risk', category: 'activity', label: 'half-dressed, door unlocked', minWarmth: 90, minCommitment: 'exclusive', actionText: "*Neither of us is properly dressed and neither of us checked the door, and we're both keeping quiet about it.*", promptNote: "half-dressed somewhere the door was never locked, both of you keeping your voices down, the possibility of the handle turning running underneath all of it" },
  { id: 'act-recording', category: 'activity', label: 'a camera, agreed on first', minWarmth: 90, minCommitment: 'exclusive', requiresEagerness: 'recording', actionText: "*I ask {char} first, properly, and only set the camera down once they've actually said yes.*", promptNote: "recording this, with {char} having actually agreed to it beforehand — the asking shown, not skipped — and both of you aware of the camera the whole time in a way that changes how you move" },
  { id: 'act-full-night', category: 'activity', label: 'not stopping at once', minWarmth: 90, minCommitment: 'exclusive', actionText: "*It's late, and then it's later, and neither of us has suggested sleeping.*", promptNote: "a night that keeps going, ebbing and restarting more than once, both of you increasingly wrecked and neither willing to be the one to call it" },
  { id: 'act-second-round', category: 'activity', label: 'again, before either of you can talk', minWarmth: 90, minCommitment: 'exclusive', actionText: "*Neither of us has caught our breath yet and I'm already reaching for {char} again.*", promptNote: "starting again before either of you has got your breath back or said a word, still oversensitive from the first time, the lack of any recovery part of it" },
  { id: 'act-cleaning-up', category: 'activity', label: 'cleaning them up', minWarmth: 90, minCommitment: 'exclusive', arousalWeight: 2, actionText: "*I take my time cleaning {char} up afterward, unhurried, not making it into anything else.*", promptNote: "cleaning {char} up afterward, thorough and unhurried, the intimacy of it sitting somewhere between what just happened and aftercare" },
  { id: 'act-exhibitionism', category: 'activity', label: 'somewhere you could be overheard', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I don't lower my voice, and the door's barely shut. The chance of being heard is half the point.*", promptNote: "fooling around somewhere the two of you could be overheard, the risk part of the thrill, both of you going quieter than you want to" },
]

function commitmentMet(min: CommitmentStatus | undefined, actual: CommitmentStatus): boolean {
  if (!min) return true
  return COMMITMENT_ORDER.indexOf(actual) >= COMMITMENT_ORDER.indexOf(min)
}

/**
 * The built-in ~37-entry catalog plus whatever a world has added of its own — additive by default,
 * same "author extends a fixed default set" pattern as `CustomBackground`/`DEFAULT_BACKGROUNDS`, not
 * a wholesale override like `getGiftCatalog` — a world's own kinks add to the sensible defaults
 * rather than requiring the author to redefine sex positions from scratch just to add one more.
 *
 * `replaceIntimacyCatalog` is the escape hatch that additive-only design was missing: the built-in
 * entries assume a humanoid body plan throughout (hands, hips, knees, a back to lie on), which reads
 * fine for the overwhelming majority of cards but has no honest way to be suppressed for a
 * non-humanoid or otherwise very different character — a world could add its own entries, but could
 * never stop the ~37 defaults from also surfacing alongside them. Set alongside `customIntimacyOptions`
 * (never alone; an empty catalog with nothing to draw from isn't useful on its own), this makes those
 * additions the *entire* catalog instead of a supplement to it.
 */
export function getIntimacyCatalog(world?: { customIntimacyOptions?: IntimacyUnlockable[]; replaceIntimacyCatalog?: boolean }): IntimacyUnlockable[] {
  if (world?.replaceIntimacyCatalog) return world.customIntimacyOptions ?? []
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
/** A character's own limits, applied to the action set rather than described to the model. */
export interface IntimacyProfiles {
  touch?: TouchProfile
  kinks?: KinkProfile
}

/**
 * Whether this specific character will engage with an entry at all. A hard-limited kink or a region
 * they've ruled out (or not yet opened up at this warmth) removes the entry from the set entirely —
 * from the panel, from the prompt, and from anywhere a stage edge could route into it.
 */
export function isEntryAllowed(
  option: IntimacyUnlockable,
  warmth: number,
  profiles?: IntimacyProfiles,
  sceneBackgroundId?: string,
): boolean {
  // Deliberately above the no-profile check below: a character nobody has authored has no profile
  // at all, and that is the exact case this gate exists for. Behind the early return it would have
  // been inert precisely when it mattered.
  if (option.requiresEagerness && kinkValence(profiles?.kinks, option.requiresEagerness) < 1) return false
  // Only filters when the caller actually knows where the scene is — see `requiresBackground`.
  if (option.requiresBackground?.length && sceneBackgroundId && !option.requiresBackground.includes(sceneBackgroundId)) {
    return false
  }
  if (!profiles) return true
  if (isAnyHardLimit(profiles.kinks, intimacyEntryKinks(option))) return false
  return intimacyEntryRegions(option).every((region) => isRegionAvailable(profiles.touch, region, warmth))
}

export function getUnlockedIntimacyOptions(
  warmth: number,
  commitmentStatus: CommitmentStatus,
  world?: { customIntimacyOptions?: IntimacyUnlockable[]; replaceIntimacyCatalog?: boolean },
  ownedToyIds?: Set<string>,
  profiles?: IntimacyProfiles,
  /** Where the scene currently is, for `requiresBackground`. Omit when the caller doesn't know. */
  sceneBackgroundId?: string,
): IntimacyUnlockable[] {
  return getIntimacyCatalog(world).filter((item) => {
    if (!(warmth >= item.minWarmth && commitmentMet(item.minCommitment, commitmentStatus))) return false
    if (item.category === 'toy' && ownedToyIds && !ownedToyIds.has(item.id)) return false
    // Last, so an entry ruled out by this character never reaches the panel or the prompt.
    return isEntryAllowed(item, warmth, profiles, sceneBackgroundId)
  })
}

/** A single catalog entry by id — `buyToy`'s lookup, same shape as `giftById`/`itemById`. */
export function intimacyItemById(id: string, world?: { customIntimacyOptions?: IntimacyUnlockable[]; replaceIntimacyCatalog?: boolean }): IntimacyUnlockable | undefined {
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
  world?: { customIntimacyOptions?: IntimacyUnlockable[]; replaceIntimacyCatalog?: boolean },
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
  const template =
    option.actionText ??
    (option.category === 'kissing_spot'
      ? `*kisses {char} on the ${option.label}*`
      : option.category === 'affection'
        ? `*${option.label}, with {char}*`
        : `*brings up trying ${option.label}*`)
  return template.replace(/\{char\}/g, charName)
}

/** The per-category fallback description for an entry with no authored `promptNote` (a world's own
 *  custom addition). Deliberately plain — an author who wants something sharper adds a `promptNote`. */
function defaultIntimacyPromptNote(option: IntimacyUnlockable): string {
  switch (option.category) {
    case 'affection':
      return `${option.label}, with {char}`
    case 'kissing_spot':
      return `a kiss to {char}'s ${option.label}`
    case 'position':
      return `the ${option.label} position`
    case 'toy':
      return `using ${option.label} on {char}`
    default:
      return option.label
  }
}

/** The model-facing description of an intimacy action, `{char}` resolved. Shared by
 *  `intimacyActionDirective` and `draftIntimacyAction`. */
export function resolveIntimacyPromptNote(option: IntimacyUnlockable, charName: string): string {
  return (option.promptNote ?? defaultIntimacyPromptNote(option)).replace(/\{char\}/g, charName)
}

/**
 * The line injected into the *character's* reply turn (`useChatSession` → `runGeneration`'s
 * `extraStyleGuidance`) right after the player sends an intimacy action. Its whole job is to make
 * sure the model actually registers what the player just deliberately initiated — a terse
 * `*I ease {char} onto their back*` on its own reads like a stage direction the model can gloss
 * past — and writes a real, in-the-moment response to it. Real names interpolated directly rather
 * than `{{char}}`/`{{user}}`: `styleGuidance` strings are never macro-substituted (see
 * `mindGuidance.ts`'s note on the same point).
 */
export function intimacyActionDirective(option: IntimacyUnlockable, personaName: string, charName: string): string {
  return `${personaName} has just moved the scene into ${resolveIntimacyPromptNote(option, charName)}. This is something ${personaName} is doing on purpose, right now, not a passing detail. Write ${charName}'s response to it as the actual next beat: how ${charName} takes it, what they do and say, in ${charName}'s own voice and at the register the scene is already at.`
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
/**
 * Whether a category is explicit-tier content, gated behind an `'explicit'` rating. `kissing_spot`
 * is romantic rather than explicit and has never been behind that dial (`intimacyGuidance`'s own
 * `fade_to_black` case allows scenes up through kissing), so it stays available at every level.
 */
export function isExplicitCategory(category: IntimacyCategory): boolean {
  return category !== 'kissing_spot' && category !== 'affection'
}

/**
 * Which categories the player may deliberately *choose* from the Relationship panel at a given
 * rating. The panel used to render all four regardless of the setting, so a chat set to
 * `fade_to_black` still handed the player buttons that send an explicit action line as their own
 * message — the dial held on the prompt and not on the UI.
 *
 * Deliberately NOT the same rule as `intimacyOptionsGuidance` below, which withholds explicit
 * categories from the *prompt* at every level except `'explicit'`. The two answer different
 * questions: that one is "what may the model volunteer unprompted", this one is "what may the
 * player explicitly ask for". Only a rating that actually asks for *less* — `fade_to_black` or
 * `suggestive` — takes the choice away.
 *
 * `'default'` therefore keeps everything, and that is load-bearing rather than an oversight:
 * `intimacyGuidance`'s own contract is that `'default'` is "the exact behavior every chat already
 * had before this setting existed, so nobody's existing output changes unless they deliberately
 * pick a level". Hiding these from someone who never opened the setting would break exactly that
 * promise, and silently remove actions they already had.
 */
export function allowedIntimacyCategories(level: IntimacyDetailLevel): IntimacyCategory[] {
  const all: IntimacyCategory[] = ['affection', 'kissing_spot', 'position', 'toy', 'activity']
  const asksForLess = level === 'fade_to_black' || level === 'suggestive'
  return asksForLess ? all.filter((c) => !isExplicitCategory(c)) : all
}

export function intimacyOptionsGuidance(unlocked: IntimacyUnlockable[], intimacyLevel: IntimacyDetailLevel): string {
  const explicitUnlocked = intimacyLevel === 'explicit'
  const parts: string[] = []

  // Outside the explicit gate below, same as kissing — this is closeness, not content.
  const affection = topLabels(unlocked, 'affection')
  if (affection.length) parts.push(`Small, ordinary closeness this relationship has earned: ${affection.join(', ')}.`)

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
  return `${parts.join(' ')} Use whichever, if any, genuinely fits this exact moment, and never force one in just because it's unlocked. This isn't only something to wait for either: it's just as natural for your character to be the one who leans in, reaches out, or makes the first move themselves, instead of only responding once it's suggested to them.`
}
