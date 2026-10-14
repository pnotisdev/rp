/** Reactive expression-repetition check for Visual Novel mode */

/** How many of this speaker's most recent tagged turns to look back across. */
const EXPRESSION_LOOKBACK = 5

/** Consecutive identical expressions (counting back from the latest) before it's worth naming. Below this, holding a look for a beat or two is just normal pacing, not staleness. */
const REPEAT_THRESHOLD = 3

/** `recentExpressionIds` is this speaker's own last few char turns' tagged `scene.expression`, oldest first */
export function expressionRepeatNote(charName: string, recentExpressionIds: (string | undefined)[]): string | undefined {
  const ids = recentExpressionIds.filter((id): id is string => !!id?.trim()).slice(-EXPRESSION_LOOKBACK)
  if (ids.length < REPEAT_THRESHOLD) return undefined

  // Trailing run: how many turns, counting back from the most recent, share the latest expression.
  const held = ids[ids.length - 1]
  let run = 1
  for (let i = ids.length - 2; i >= 0 && ids[i] === held; i--) run++
  if (run < REPEAT_THRESHOLD) return undefined

  return `${charName} has been drawn with the same "${held}" expression for ${run} replies in a row now. Let the face actually change this time, react with a different expression unless the moment genuinely calls for holding perfectly still.`
}
