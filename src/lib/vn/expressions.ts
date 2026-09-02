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
  { id: 'embarrassed', label: 'Embarrassed', emoji: '😳' },
  { id: 'thinking', label: 'Thinking', emoji: '🤔' },
  { id: 'determined', label: 'Determined', emoji: '😤' },
  { id: 'sleepy', label: 'Sleepy', emoji: '😴' },
]

export const DEFAULT_EXPRESSION_IDS = DEFAULT_EXPRESSIONS.map((e) => e.id)
