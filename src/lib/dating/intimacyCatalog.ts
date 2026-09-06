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
  { id: 'kiss-forehead', category: 'kissing_spot', label: 'forehead', minWarmth: 15, actionText: "*I tilt {char}'s chin up and press a slow kiss to their forehead, lingering there a second before I pull back.*", promptNote: "a slow, tender kiss to {char}'s forehead" },
  { id: 'kiss-cheek', category: 'kissing_spot', label: 'cheek', minWarmth: 15, actionText: "*I lean in and kiss {char}'s cheek, letting it linger a moment longer than it needs to.*", promptNote: "a lingering kiss to {char}'s cheek" },
  { id: 'kiss-hand', category: 'kissing_spot', label: 'the back of the hand', minWarmth: 15, actionText: "*I take {char}'s hand, turn it in mine, and kiss the back of it without breaking eye contact.*", promptNote: "a kiss to the back of {char}'s hand, eyes held" },
  { id: 'kiss-temple', category: 'kissing_spot', label: 'temple', minWarmth: 35, actionText: "*I brush {char}'s hair back and kiss them softly at the temple.*", promptNote: "a soft kiss to {char}'s temple" },
  { id: 'kiss-neck', category: 'kissing_spot', label: 'neck', minWarmth: 35, actionText: "*I dip my head and trail a kiss along the side of {char}'s neck, slow, feeling them react.*", promptNote: "kisses trailed slowly along {char}'s neck" },
  { id: 'kiss-jaw', category: 'kissing_spot', label: 'along the jaw', minWarmth: 55, actionText: "*I kiss along {char}'s jaw, unhurried, working from just under their ear toward their chin.*", promptNote: "unhurried kisses along {char}'s jaw" },
  { id: 'kiss-collarbone', category: 'kissing_spot', label: 'collarbone', minWarmth: 55, actionText: "*I ease {char}'s collar aside and press a kiss to the line of their collarbone.*", promptNote: "a kiss to {char}'s collarbone" },
  { id: 'kiss-wrist', category: 'kissing_spot', label: 'inner wrist', minWarmth: 55, actionText: "*I turn {char}'s wrist over and kiss the thin skin on the inside of it, right over the pulse.*", promptNote: "a kiss to the inside of {char}'s wrist, over the pulse" },
  { id: 'kiss-ear', category: 'kissing_spot', label: 'behind the ear', minWarmth: 75, actionText: "*I kiss {char} just behind the ear, close enough that they can feel me breathe.*", promptNote: "a kiss just behind {char}'s ear" },
  { id: 'kiss-shoulder', category: 'kissing_spot', label: 'shoulder blade', minWarmth: 75, actionText: "*I move behind {char} and kiss the curve of their shoulder blade, one hand resting at their waist.*", promptNote: "a kiss to {char}'s shoulder blade, from behind" },
  { id: 'kiss-thigh', category: 'kissing_spot', label: 'inner thigh', minWarmth: 90, minCommitment: 'dating', actionText: "*I settle lower and kiss my way slowly up the inside of {char}'s thigh, taking my time.*", promptNote: "kisses working slowly up the inside of {char}'s thigh" },

  // --- position: explicit-only (see intimacyOptionsGuidance). Phrased as guiding things there mid-scene. ---
  { id: 'pos-missionary', category: 'position', label: 'missionary', minWarmth: 75, minCommitment: 'dating', actionText: "*I ease {char} down onto their back and move over them, settling between their legs, weight on my forearms so I can watch their face.*", promptNote: "the missionary position: {char} on their back, you over them, face to face" },
  { id: 'pos-face-to-face', category: 'position', label: 'in their lap, face to face', minWarmth: 75, minCommitment: 'dating', actionText: "*I pull {char} up into my lap so we're chest to chest, their legs around me, close enough to feel every breath.*", promptNote: "{char} straddling your lap, the two of you chest to chest, face to face" },
  { id: 'pos-cowgirl', category: 'position', label: 'them on top', minWarmth: 75, minCommitment: 'dating', actionText: "*I lie back and guide {char} over me, hands on their hips, letting them set the pace from up there.*", promptNote: "{char} on top, riding you, setting the pace" },
  { id: 'pos-doggy', category: 'position', label: 'from behind', minWarmth: 75, minCommitment: 'dating', actionText: "*I turn {char} over onto their hands and knees and move in behind them, one hand spread flat on their lower back.*", promptNote: "taking {char} from behind, them on their hands and knees" },
  { id: 'pos-spooning', category: 'position', label: 'spooning', minWarmth: 55, minCommitment: 'dating', actionText: "*I fit myself against {char}'s back, both of us on our sides, and pull them in close by the hip.*", promptNote: "spooning: you at {char}'s back, both on your sides" },
  { id: 'pos-against-wall', category: 'position', label: 'against the wall', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I back {char} into the wall and lift them, their legs coming up around me, my forearm braced beside their head.*", promptNote: "{char} pinned against the wall, legs around you, you holding them up" },
  { id: 'pos-reverse-cowgirl', category: 'position', label: 'reverse cowgirl', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I have {char} turn around so they're facing away, then guide them back down over me, hands running up their spine.*", promptNote: "{char} on top but facing away from you" },
  { id: 'pos-legs-over-shoulders', category: 'position', label: 'legs over shoulders', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I press forward until {char}'s knees fold toward their chest and hook their legs over my shoulders.*", promptNote: "{char} on their back, their legs hooked over your shoulders, folded close" },
  { id: 'pos-sixty-nine', category: 'position', label: '69', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I shift us both around until we're head to toe, mouths where our hands were.*", promptNote: "the two of you head to toe, going down on each other at the same time" },

  // --- toy: explicit-only, and now the one category that costs coins — see `price` ---
  { id: 'toy-massage-oil', category: 'toy', label: 'massage oil', minWarmth: 55, price: 8, actionText: "*I warm a little massage oil between my palms and start working it slowly into {char}'s back and shoulders.*", promptNote: "warming massage oil and working it over {char}'s body" },
  { id: 'toy-feather', category: 'toy', label: 'a feather tickler', minWarmth: 55, price: 8, actionText: "*I draw a feather tickler in a slow line down {char}'s side, watching for the shiver.*", promptNote: "teasing {char}'s bare skin with a feather tickler" },
  { id: 'toy-blindfold', category: 'toy', label: 'a blindfold', minWarmth: 75, minCommitment: 'dating', price: 15, actionText: "*I gather {char}'s hair aside and settle a blindfold over their eyes, checking it isn't too tight.*", promptNote: "slipping a blindfold over {char}'s eyes so they can't see" },
  { id: 'toy-ice', category: 'toy', label: 'ice, traced slowly', minWarmth: 75, minCommitment: 'dating', price: 12, actionText: "*I take a piece of ice from the glass and trace it slowly along {char}'s collarbone, down the centre of their chest.*", promptNote: "tracing a piece of ice slowly over {char}'s bare skin" },
  { id: 'toy-body-paint', category: 'toy', label: 'body paint or chocolate', minWarmth: 75, minCommitment: 'dating', price: 18, actionText: "*I dip a finger in and drag a slow line across {char}'s stomach, then lean down to follow it.*", promptNote: "dragging body paint or chocolate across {char}'s skin, then following it with your mouth" },
  { id: 'toy-vibrator', category: 'toy', label: 'a vibrator', minWarmth: 90, minCommitment: 'dating', price: 30, actionText: "*I switch the vibrator on low and run it in a slow circle over {char}'s hip, not where they want it yet.*", promptNote: "using a vibrator on {char}, teasing before giving them what they want" },
  { id: 'toy-silk-ties', category: 'toy', label: 'silk ties', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*I loop the silk loosely around {char}'s wrists and knot it to the headboard, leaving enough give that they could pull free if they wanted.*", promptNote: "loosely tying {char}'s wrists with silk, light bondage they could slip if they wanted" },
  { id: 'toy-handcuffs', category: 'toy', label: 'playful handcuffs', minWarmth: 90, minCommitment: 'exclusive', price: 25, actionText: "*I click the cuffs closed around {char}'s wrists, slow, watching their face the whole time.*", promptNote: "cuffing {char}'s wrists with playful handcuffs" },

  // --- activity: explicit-only (kinks, aftercare, and other non-position/toy intimate beats) ---
  { id: 'act-dirty-talk', category: 'activity', label: 'dirty talk', minWarmth: 55, actionText: "*I bring my mouth to {char}'s ear and tell them, low and specific, exactly what I want to do to them.*", promptNote: "murmuring filthy, specific things in {char}'s ear" },
  { id: 'act-massage', category: 'activity', label: 'a slow, sensual massage', minWarmth: 55, actionText: "*I have {char} lie down and start working slow, deliberate pressure up either side of their spine.*", promptNote: "giving {char} a slow, sensual full-body massage" },
  { id: 'act-aftercare', category: 'activity', label: 'quiet aftercare', minWarmth: 55, actionText: "*I pull {char} in against my chest and just hold them, one hand moving slow circles on their back, in no rush to move or talk.*", promptNote: "quiet aftercare: holding {char} close, reassuring them, letting them come down" },
  { id: 'act-shower', category: 'activity', label: 'showering together', minWarmth: 75, minCommitment: 'dating', actionText: "*I take {char}'s hand and pull them toward the bathroom, reaching in to start the water.*", promptNote: "moving things into the shower together" },
  { id: 'act-roleplay', category: 'activity', label: 'acting out a fantasy', minWarmth: 75, minCommitment: 'dating', actionText: "*I catch {char}'s eye and slip into the role from the fantasy we talked about, waiting to see if they'll play along.*", promptNote: "acting out a shared fantasy the two of you talked about earlier" },
  { id: 'act-morning-after', category: 'activity', label: 'slow morning-after', minWarmth: 75, minCommitment: 'dating', actionText: "*I pull {char} back down under the covers, half-asleep, hands already wandering, in no hurry for the day to start.*", promptNote: "slow, unhurried morning-after sex, both of you still half-asleep" },
  { id: 'act-praise', category: 'activity', label: 'praise, when it counts', minWarmth: 75, minCommitment: 'dating', actionText: "*I take {char}'s face in both hands and tell them, plainly, how good they are, how good they feel, how much I want them.*", promptNote: "praising {char} out loud while it matters most: how good they are, how much you want them" },
  { id: 'act-edging', category: 'activity', label: 'teasing and edging', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I bring {char} right up to the edge, then still my hand and wait, watching them, until the tension eases enough to start again.*", promptNote: "edging {char}: bringing them to the brink, then stopping, over and over" },
  { id: 'act-exhibitionism', category: 'activity', label: 'somewhere you could be overheard', minWarmth: 90, minCommitment: 'exclusive', actionText: "*I don't lower my voice, and the door's barely shut. The chance of being heard is half the point.*", promptNote: "fooling around somewhere the two of you could be overheard, the risk part of the thrill" },
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
export function getUnlockedIntimacyOptions(
  warmth: number,
  commitmentStatus: CommitmentStatus,
  world?: { customIntimacyOptions?: IntimacyUnlockable[]; replaceIntimacyCatalog?: boolean },
  ownedToyIds?: Set<string>,
): IntimacyUnlockable[] {
  return getIntimacyCatalog(world).filter((item) => {
    if (!(warmth >= item.minWarmth && commitmentMet(item.minCommitment, commitmentStatus))) return false
    if (item.category === 'toy' && ownedToyIds && !ownedToyIds.has(item.id)) return false
    return true
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
  const template = option.actionText ?? (option.category === 'kissing_spot' ? `*kisses {char} on the ${option.label}*` : `*brings up trying ${option.label}*`)
  return template.replace(/\{char\}/g, charName)
}

/** The per-category fallback description for an entry with no authored `promptNote` (a world's own
 *  custom addition). Deliberately plain — an author who wants something sharper adds a `promptNote`. */
function defaultIntimacyPromptNote(option: IntimacyUnlockable): string {
  switch (option.category) {
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
  return category !== 'kissing_spot'
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
  const all: IntimacyCategory[] = ['kissing_spot', 'position', 'toy', 'activity']
  const asksForLess = level === 'fade_to_black' || level === 'suggestive'
  return asksForLess ? all.filter((c) => !isExplicitCategory(c)) : all
}

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
  return `${parts.join(' ')} Use whichever, if any, genuinely fits this exact moment — never force one in just because it's unlocked. This isn't only something to wait for either: it's just as natural for your character to be the one who leans in, reaches out, or makes the first move themselves, instead of only responding once it's suggested to them.`
}
