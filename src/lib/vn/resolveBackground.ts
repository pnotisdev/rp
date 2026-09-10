/**
 * The single decision for "what is VN mode standing in right now" — every fallback in one ordered
 * walk instead of the three-line chain this replaces, which bottomed out at `undefined` and painted
 * the neutral gradient. That bottom was reached constantly on a chat's opening messages: a static
 * greeting is never generated, so it carries no `<<scene:>>` tag, and `detectGreetingScene`'s model
 * pass is deliberately skipped for a world with no uploaded art. Reading the narration itself
 * (step 4) is what closes that gap without a model call or a new stored field.
 */

import type { Chat, WorldCard } from '@/lib/types'
import { backgroundLabel, matchBackgroundKeyword, DEFAULT_BACKGROUNDS } from '@/lib/vn/backgrounds'
import { getUnlockedBackgroundIds } from '@/lib/vn/unlocks'

/** Where a resolved background came from — surfaced in the stage's location caption so a guessed place reads as a guess. */
export type BackgroundSource = 'tag' | 'event' | 'location' | 'text' | 'world-default' | 'locked-tag' | 'none'

export interface ResolvedBackground {
  /** The chosen background id, or undefined when nothing anywhere suggested a place. */
  id?: string
  /** Uploaded art for that id — only ever set for an id the player has actually unlocked. */
  url?: string
  source: BackgroundSource
}

export interface ResolveBackgroundParams {
  /** `scene.background` off the message being shown. */
  taggedBackground?: string
  chat: Chat
  world?: WorldCard
  /** The active speaker's warmth-gated affection, for `backgroundUnlocks`. */
  affection: number
  /** Recent narration — the current line plus whatever came just before it — read only when nothing above resolved. */
  narration?: string
  /** World clock is dark, so prefer `backgroundsNight` art. */
  night?: boolean
}

/** An id is only usable if the world hasn't gated it behind more affection than the player has. */
function unlocked(id: string | undefined, world: WorldCard | undefined, affection: number): boolean {
  if (!id) return false
  return affection >= Number(world?.backgroundUnlocks?.[id] ?? 0)
}

/** Every id the model could have picked, plus the world's own custom locations, as match candidates. */
function candidates(world: WorldCard | undefined, affection: number): { id: string; label: string }[] {
  const ids = getUnlockedBackgroundIds(world, affection)
  const customLabels = new Map((world?.customBackgrounds ?? []).map((b) => [b.id, b.label]))
  const seen = new Set(ids)
  const rows = ids.map((id) => ({ id, label: customLabels.get(id) ?? backgroundLabel(id, world) }))
  // A world with uploaded art narrows `getUnlockedBackgroundIds` to just those ids; the defaults are
  // still legitimate *places* to recognise in prose, they just have no photo behind them.
  for (const d of DEFAULT_BACKGROUNDS) if (!seen.has(d.id)) rows.push(d)
  return rows
}

export function resolveSceneBackground(params: ResolveBackgroundParams): ResolvedBackground {
  const { taggedBackground, chat, world, affection, narration, night } = params

  const withArt = (id: string | undefined, source: BackgroundSource): ResolvedBackground => {
    if (!id) return { source: 'none' }
    const url = (night && world?.backgroundsNight?.[id]) || world?.backgrounds?.[id] || undefined
    return { id, url, source }
  }

  // 1. What the model tagged this very line with, whenever it's a place the player can actually see.
  if (unlocked(taggedBackground, world, affection)) return withArt(taggedBackground, 'tag')

  // 2. An active date/event carries its own authored location.
  const eventBackground = chat.activeEvent?.backgroundId
  if (unlocked(eventBackground, world, affection)) return withArt(eventBackground, 'event')

  // 3. The chat's own established scene location — free text, but it was written from a background
  //    label in the first place (see `createChat`), so it usually matches one exactly.
  const pool = candidates(world, affection)
  if (chat.scene?.location) {
    const fromLocation = matchBackgroundKeyword(chat.scene.location, pool)
    if (unlocked(fromLocation, world, affection)) return withArt(fromLocation, 'location')
  }

  // 4. The prose itself. Deliberately last among the real signals — an explicit tag always outranks
  //    a guess — but ahead of giving up, because a greeting that plainly says "the classroom is
  //    empty" should never render as an unplaced void.
  if (narration) {
    const fromText = matchBackgroundKeyword(narration, pool)
    if (unlocked(fromText, world, affection)) return withArt(fromText, 'text')
  }

  // 5. The world author's own opening shot.
  if (unlocked(world?.defaultBackgroundId, world, affection)) return withArt(world!.defaultBackgroundId, 'world-default')

  // 6. A tag that exists but is still gated: paint that place's lighting without ever handing over
  //    its art, which is what the unlock was protecting. Better than a nowhere.
  if (taggedBackground) return { id: taggedBackground, source: 'locked-tag' }

  return { source: 'none' }
}
