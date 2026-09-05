import { slugifyId } from '@/lib/text/slugify'
import { BASE_OUTFIT_ID, spriteKey } from '@/lib/vn/outfits'

export interface ExpressionOption {
  id: string
  label: string
  emoji: string
}

/** Broad default set so the LLM has real emotional range to tag replies with, even before any custom sprites are uploaded. */
export const DEFAULT_EXPRESSIONS: ExpressionOption[] = [
  { id: 'neutral', label: 'Neutral', emoji: '😐' },
  { id: 'happy', label: 'Happy', emoji: '😊' },
  { id: 'smirk', label: 'Smirk', emoji: '😏' },
  { id: 'laughing', label: 'Laughing', emoji: '😄' },
  { id: 'sad', label: 'Sad', emoji: '😢' },
  { id: 'crying', label: 'Crying', emoji: '😭' },
  { id: 'angry', label: 'Angry', emoji: '😠' },
  { id: 'annoyed', label: 'Annoyed', emoji: '😒' },
  { id: 'surprised', label: 'Surprised', emoji: '😮' },
  { id: 'scared', label: 'Scared', emoji: '😨' },
  { id: 'blush', label: 'Blush', emoji: '☺️' },
  { id: 'love', label: 'Loving', emoji: '🥰' },
  { id: 'flirty', label: 'Flirty', emoji: '😉' },
  { id: 'smitten', label: 'Smitten', emoji: '😍' },
  { id: 'yearning', label: 'Yearning', emoji: '🥺' },
  { id: 'sultry', label: 'Sultry', emoji: '💋' },
  { id: 'aroused', label: 'Aroused', emoji: '🥵' },
  { id: 'embarrassed', label: 'Embarrassed', emoji: '😳' },
  { id: 'thinking', label: 'Thinking', emoji: '🤔' },
  { id: 'determined', label: 'Determined', emoji: '😤' },
  { id: 'sleepy', label: 'Sleepy', emoji: '😴' },
]

export const DEFAULT_EXPRESSION_IDS = DEFAULT_EXPRESSIONS.map((e) => e.id)

/**
 * Section 10's "guaranteed expression coverage for dates": the live-date reactive portrait (and
 * VN mode's own sprite) used to hard-swap straight to the generic avatar the moment the model
 * tagged an expression the creator hadn't drawn (or hadn't unlocked yet) — showing a blank avatar
 * for "yearning" when the creator only drew "love" and "blush" throws away real, close-enough art
 * that already exists. Each entry here is a same-family emotion to try, in order, before finally
 * falling back to 'neutral' and then the avatar. Deliberately a hand-authored judgment call (a
 * "closest embedding" approach would need a model call, a much bigger ask for a cosmetic fallback)
 * rather than a claim of psychological accuracy — every character in this app draws from the same
 * `DEFAULT_EXPRESSIONS` set, so one shared mapping is the same "runs the world" trade-off already
 * made for scene tags/backgrounds. Deliberately excludes 'neutral' as a value (it's the universal
 * last resort, checked separately, not a per-expression association) and excludes an expression
 * from its own list (redundant with the direct check that happens before this is ever consulted).
 */
export const EXPRESSION_FALLBACKS: Record<string, string[]> = {
  happy: ['laughing', 'smitten', 'blush'],
  smirk: ['flirty', 'happy'],
  laughing: ['happy', 'smitten'],
  sad: ['crying', 'yearning', 'annoyed'],
  crying: ['sad', 'scared'],
  angry: ['annoyed', 'determined'],
  annoyed: ['angry', 'determined'],
  surprised: ['scared', 'embarrassed'],
  scared: ['surprised', 'crying'],
  blush: ['embarrassed', 'flirty', 'happy'],
  love: ['smitten', 'blush', 'happy'],
  flirty: ['smirk', 'sultry', 'happy'],
  smitten: ['love', 'blush', 'happy'],
  yearning: ['love', 'sad', 'blush'],
  sultry: ['flirty', 'aroused'],
  aroused: ['sultry', 'blush'],
  embarrassed: ['blush', 'surprised'],
  thinking: ['determined'],
  determined: ['angry', 'thinking'],
  sleepy: [],
}

/**
 * The single source of truth for "which sprite actually shows for this tagged expression" —
 * `ChatWindow.tsx`'s reactive portrait and `VNStage.tsx`'s own sprite used to each inline the same
 * `sprites[expression] || avatarDataUrl` hard swap independently; this replaces both. Checks the
 * exact tag first, then its `EXPRESSION_FALLBACKS` chain, then 'neutral', before finally giving up
 * and returning the avatar (or undefined, if even that isn't set). A fallback still has to be both
 * uploaded *and* unlocked at the current affection — a locked/missing fallback is skipped exactly
 * like a locked/missing primary tag already was.
 */
export function resolveExpressionSprite(
  sprites: Record<string, string> | undefined,
  spriteUnlocks: Record<string, number> | undefined,
  avatarDataUrl: string | undefined,
  expression: string,
  affection: number,
  /**
   * Which wardrobe state to draw (`outfits.ts`). Omitted or `BASE_OUTFIT_ID` reproduces the exact
   * pre-outfit behavior, byte for byte — every existing character and both call sites that don't
   * pass one keep resolving precisely as before.
   */
  outfitId?: string,
): string | undefined {
  const isAvailable = (key: string): boolean => !!sprites?.[key] && affection >= Number(spriteUnlocks?.[key] ?? 0)

  /** The full exact -> same-family -> neutral walk, within one outfit. */
  const withinOutfit = (outfit: string | undefined): string | undefined => {
    const key = (id: string) => spriteKey(outfit, id)
    if (isAvailable(key(expression))) return sprites![key(expression)]
    for (const fallback of EXPRESSION_FALLBACKS[expression] ?? []) {
      if (isAvailable(key(fallback))) return sprites![key(fallback)]
    }
    if (expression !== 'neutral' && isAvailable(key('neutral'))) return sprites![key('neutral')]
    return undefined
  }

  const inOutfit = withinOutfit(outfitId)
  if (inOutfit) return inOutfit
  // A partially-drawn outfit degrades to the *base* art rather than straight to the avatar: an
  // author who only drew `swimsuit--neutral` and `swimsuit--blush` should still get real art for
  // "angry", not a blank portrait. Wrong clothes for one beat beats no character at all — and the
  // same-outfit walk above already tried that outfit's own neutral first, which covers most of it.
  if (outfitId && outfitId !== BASE_OUTFIT_ID) {
    const inBase = withinOutfit(BASE_OUTFIT_ID)
    if (inBase) return inBase
  }
  return avatarDataUrl
}

/** A character-specific expression beyond the default set — e.g. a signature smirk unique to them. */
export interface CustomExpression {
  id: string
  label: string
}

/**
 * Turns a free-typed label into a safe expression id: lowercase, hyphenated, matching the
 * server's `SAFE_KEY_RE` (`server/avatars.ts`) since this id becomes both a sprite filename and a
 * literal token in the model's prompt. `existingIds` gets a numeric suffix appended on collision
 * (with a default expression id or another custom one) rather than silently overwriting it.
 */
export function slugifyExpressionId(label: string, existingIds: string[]): string {
  return slugifyId(label, existingIds, 'expression')
}
