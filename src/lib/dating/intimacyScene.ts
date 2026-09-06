import type { IntimacyCategory } from '@/lib/dating/intimacyCatalog'

/**
 * A real, persisted state machine for *where an intimate scene currently stands* — building,
 * or at its peak — plus continuity for what's physically happening right now, so the model is
 * told rather than left to infer a position/activity from scrollback. This is deliberately narrow
 * and sits *before* `dating/aftercare.ts`'s `Afterglow` in a scene's lifecycle, not instead of it:
 * `Afterglow` already opens the instant an explicit intimacy action starts (see
 * `useChatSession.ts`'s `sendUserMessage`) and judges how the hours *after* went — a completely
 * different question from "is this scene still building or has it peaked". `'afterglow'` is
 * deliberately not a value of `IntimacyPhase` below: once this state machine reads the scene as
 * having resolved, it clears back to nothing and the already-open aftercare window carries the
 * emotional aftermath the rest of the way, with nothing here duplicated.
 */
export type IntimacyPhase = 'building' | 'peak'

/**
 * Stored per relationship (`RelationshipTrack.intimacyScene`). `undefined`/`null` means no scene is
 * currently active — same null-clears convention `Afterglow`/`RelationshipWarning` already use,
 * since `JSON.stringify` drops `undefined`-valued keys and a bare `undefined` here would silently
 * fail to close out a finished scene.
 */
export interface IntimacyScene {
  phase: IntimacyPhase
  /**
   * A model-facing description of what's currently happening physically — "spooning: you at
   * {char}'s back, both on your sides", "using a vibrator on {char}, teasing before giving them
   * what they want", etc. Taken verbatim from the clicked catalog entry's own resolved prompt note
   * (`intimacyCatalog.ts`'s `resolveIntimacyPromptNote`), `{char}` already substituted, so it reads
   * exactly the way the character's own reply-turn directive already does — no separate authoring.
   */
  activityLabel: string
  /** The catalog category the current activity came from — `kissing_spot` never reaches this (see `isExplicitCategory`; only explicit-tier actions open a scene at all). */
  category: IntimacyCategory
  /**
   * `countCharReplies` value when this scene most recently started or changed. Same staleness
   * convention as `Afterglow.startedAtTurn`: a value now *ahead* of the conversation (a rewind or a
   * fork-from-earlier) means this is stale, not currently live — see `isIntimacySceneStale`.
   */
  updatedAtTurn: number
}

/** True when the stored scene's own turn marker is now ahead of the conversation — a rewind/fork artifact, not a currently-live scene. */
export function isIntimacySceneStale(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && scene.updatedAtTurn > charReplyCount
}

/** Whether a scene should currently be treated as live and worth telling the model about. */
export function isIntimacySceneActive(scene: IntimacyScene | undefined | null, charReplyCount: number): boolean {
  return !!scene && !isIntimacySceneStale(scene, charReplyCount)
}

/**
 * Starts (or re-centers) the state machine — called from the exact site that already opens the
 * aftercare window (`useChatSession.ts`'s `sendUserMessage`) whenever the player clicks an
 * explicit-category intimacy action. A click while a scene is *already* active is itself the
 * consent-checkpoint/renegotiation signal item 1 asks for: a new position/toy/activity goes through
 * the same warmth/commitment-gated catalog click every intimacy action already requires (nothing
 * free-form), and re-centering here steps the phase back to `'building'` rather than assuming the
 * new thing instantly continues at `'peak'` — a changed trajectory earns its own build, it doesn't
 * inherit the old one's intensity.
 */
export function startOrShiftIntimacyScene(activityLabel: string, category: IntimacyCategory, charReplyCount: number): IntimacyScene {
  return { phase: 'building', activityLabel, category, updatedAtTurn: charReplyCount }
}

/**
 * Applies the judge's per-turn phase read (`relationshipAssist.ts`'s `intimacyPhase` field, asked
 * for only while a scene is active — the same ride-along trick `aftercareVerdict`/`completedTaskIndices`
 * already use, so this costs no extra model call). Returns the next scene, or `null` once the judge
 * reads the scene as having wound down or concluded — which hands off entirely to the aftercare
 * window that's already open; nothing here needs to re-derive when the aftermath itself ends.
 * A `hold`/unreadable turn (`undefined`) keeps the current phase rather than resetting it, the same
 * "omit means no change" contract `mood`/`currentNeed` already have.
 */
export function advanceIntimacyScene(
  scene: IntimacyScene,
  judged: IntimacyPhase | 'resolved' | undefined,
  charReplyCount: number,
): IntimacyScene | null {
  if (judged === 'resolved') return null
  if (!judged || judged === scene.phase) return { ...scene, updatedAtTurn: charReplyCount }
  return { ...scene, phase: judged, updatedAtTurn: charReplyCount }
}

/**
 * Sensory-layering `styleGuidance`, scaled to phase, plus the physical-continuity line that's the
 * whole point of persisting this: telling the model what's currently happening instead of leaving
 * it to infer a position from scrollback (or worse, quietly drift to a different one). Never names
 * anything beyond what `scene.activityLabel` already says — that string is itself gated by warmth/
 * commitment/the explicit-content rating upstream, at the moment the action was clicked — so this
 * only ever governs pacing and register, never unlocks content. Real names, no `{{macros}}`
 * (`styleGuidance` strings are never macro-substituted; see `mindGuidance.ts`'s own note).
 */
export function intimacySceneGuidance(charName: string, scene: IntimacyScene): string {
  const continuity = `Right now, physically, ${charName} is in the middle of: ${scene.activityLabel}. Stay continuous with this until something in the scene actually changes it — don't quietly drift to a different position or act, and don't re-describe getting into it as if it just started.`
  const pacing =
    scene.phase === 'building'
      ? "This is still building, not at its peak yet. Let anticipation, teasing, and the slow accumulation of touch and reaction carry the scene rather than jumping straight to full intensity."
      : "This has built to its peak. Let the intensity actually read as that — more urgency, less restraint, reactions less composed than a moment ago."
  return `${continuity} ${pacing}`
}
