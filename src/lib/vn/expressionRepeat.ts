/**
 * Reactive expression-repetition check for Visual Novel mode — the mirror of `text/slop.ts`'s
 * `buildSlopAvoidanceNote`, but for the one thing a VN stage makes the most visible on screen: the
 * character's face. `prompt/vnProse.ts`'s `vnExpressionGuidance` already tells the model, every
 * turn, to let the expression move; that's a standing rule the model can silently agree with and
 * ignore, the same way a generic "vary your prose" instruction never stopped any specific cliché.
 * This instead looks at what the last few turns actually tagged and names the exact expression back
 * to the model once it's genuinely gone stale — the same "here's the specific thing you're
 * repeating" pressure `findSlop` applies to prose, applied to the scene tag instead.
 */

/** How many of this speaker's most recent tagged turns to look back across. */
const EXPRESSION_LOOKBACK = 5

/** Consecutive identical expressions (counting back from the latest) before it's worth naming. Below this, holding a look for a beat or two is just normal pacing, not staleness. */
const REPEAT_THRESHOLD = 3

/**
 * `recentExpressionIds` is this speaker's own last few char turns' tagged `scene.expression`,
 * oldest first — same convention `buildSlopAvoidanceNote`'s `recentCharTurns` uses for text. Costs
 * nothing (returns `undefined`) unless the trailing run of turns actually used one identical id.
 */
export function expressionRepeatNote(charName: string, recentExpressionIds: (string | undefined)[]): string | undefined {
  const ids = recentExpressionIds.filter((id): id is string => !!id?.trim()).slice(-EXPRESSION_LOOKBACK)
  if (ids.length < REPEAT_THRESHOLD) return undefined

  // Trailing run: how many turns, counting back from the most recent, share the latest expression.
  // Deliberately the *trailing* run rather than the longest run anywhere in the window — a face
  // that moved and then came back to rest doesn't need calling out, only one stuck exactly now.
  const held = ids[ids.length - 1]
  let run = 1
  for (let i = ids.length - 2; i >= 0 && ids[i] === held; i--) run++
  if (run < REPEAT_THRESHOLD) return undefined

  return `${charName} has been drawn with the same "${held}" expression for ${run} replies in a row now. Let the face actually change this time — react with a different expression unless the moment genuinely calls for holding perfectly still.`
}
