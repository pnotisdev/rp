import { slugifyId } from '@/lib/text/slugify'
import { BASE_OUTFIT_ID, spriteKey } from '@/lib/vn/outfits'
import { pickVariant } from '@/lib/vn/pickVariant'

/**
 * The default expression set, same-family fallback chains for missing art, and sprite resolution
 * (exact tag -> fallback -> neutral -> avatar, outfit-aware) used by VN mode's reactive portraits.
 */

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
  { id: 'disgust', label: 'Disgust', emoji: '🤢' },
  { id: 'confusion', label: 'Confusion', emoji: '😕' },
  { id: 'pain', label: 'Pain', emoji: '😣' },
  { id: 'relief', label: 'Relief', emoji: '😌' },
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

/** Same-family fallback chain to try, in order, when the tagged expression has no drawn/unlocked sprite — before finally falling back to 'neutral' then the avatar. Hand-authored, not embedding-based. */
export const EXPRESSION_FALLBACKS: Record<string, string[]> = {
  happy: ['laughing', 'smitten', 'blush'],
  smirk: ['flirty', 'happy'],
  laughing: ['happy', 'smitten'],
  sad: ['crying', 'yearning', 'annoyed'],
  crying: ['sad', 'scared'],
  angry: ['annoyed', 'determined'],
  annoyed: ['angry', 'determined'],
  surprised: ['scared', 'embarrassed', 'confusion'],
  scared: ['surprised', 'crying'],
  disgust: ['annoyed', 'angry'],
  confusion: ['thinking', 'surprised'],
  pain: ['scared', 'crying', 'determined'],
  relief: ['happy', 'sleepy'],
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

/** Item 11's "up to N variants per slot" — extra alternates for a sprite key, picked alongside the primary in `sprites`. */
export interface SpriteVariantOptions {
  variants: Record<string, string[]> | undefined
  /** Stable per-showing seed (e.g. the message id) so the pick doesn't flicker across unrelated re-renders — see `pickVariant`. */
  seed: string
}

/** The single source of truth for "which sprite shows for this tagged expression" — exact tag -> `EXPRESSION_FALLBACKS` chain -> 'neutral' -> avatar (or undefined). A fallback must be both uploaded and unlocked at the current affection, same as the primary tag. */
export function resolveExpressionSprite(
  sprites: Record<string, string> | undefined,
  spriteUnlocks: Record<string, number> | undefined,
  avatarDataUrl: string | undefined,
  expression: string,
  affection: number,
  /** Which wardrobe state to draw (`outfits.ts`). Omitted or `BASE_OUTFIT_ID` reproduces exact pre-outfit behavior. */
  outfitId?: string,
  /** Omitted reproduces exact pre-variant behavior (always the primary sprite). */
  variantOptions?: SpriteVariantOptions,
): string | undefined {
  const isAvailable = (key: string): boolean => !!sprites?.[key] && affection >= Number(spriteUnlocks?.[key] ?? 0)
  const resolved = (key: string): string => {
    const pool = variantOptions?.variants?.[key]
    return pool?.length ? pickVariant([sprites![key], ...pool], `${variantOptions!.seed}:${key}`) : sprites![key]
  }

  /** The full exact -> same-family -> neutral walk, within one outfit. */
  const withinOutfit = (outfit: string | undefined): string | undefined => {
    const key = (id: string) => spriteKey(outfit, id)
    if (isAvailable(key(expression))) return resolved(key(expression))
    for (const fallback of EXPRESSION_FALLBACKS[expression] ?? []) {
      if (isAvailable(key(fallback))) return resolved(key(fallback))
    }
    if (expression !== 'neutral' && isAvailable(key('neutral'))) return resolved(key('neutral'))
    return undefined
  }

  const inOutfit = withinOutfit(outfitId)
  if (inOutfit) return inOutfit
  // A partially-drawn outfit degrades to the *base* art rather than straight to the avatar — wrong clothes beats no character.
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

/** Every currently unlocked expression id paired with its display label (custom label wins over a same-id default), for `detectExpressionTextMismatch` (`sceneVision.ts`). Unfiltered by sprite art, unlike the vision-pass shortlist. */
export function expressionCandidatesFor(
  unlockedExpressionIds: string[],
  customExpressions: CustomExpression[] | undefined,
): { id: string; label: string }[] {
  const labelById = new Map<string, string>([
    ...DEFAULT_EXPRESSIONS.map((e) => [e.id, e.label] as const),
    ...(customExpressions ?? []).map((c) => [c.id, c.label] as const),
  ])
  return unlockedExpressionIds.map((id) => ({ id, label: labelById.get(id) ?? id }))
}

/** Turns a free-typed label into a safe expression id (lowercase, hyphenated, matching the server's `SAFE_KEY_RE`) since this becomes both a sprite filename and a prompt token. Suffixes on collision with `existingIds`. */
export function slugifyExpressionId(label: string, existingIds: string[]): string {
  return slugifyId(label, existingIds, 'expression')
}
