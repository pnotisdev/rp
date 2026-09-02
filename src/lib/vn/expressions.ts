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
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'expression'
  if (!existingIds.includes(base)) return base
  let i = 2
  while (existingIds.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}
