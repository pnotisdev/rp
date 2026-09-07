import type { GalleryEntry } from '@/lib/characters/cardSpec'
import type { RelationshipStage } from '@/lib/types'
import type { IntimacyPhase } from '@/lib/dating/intimacyScene'

/**
 * Item 10: picks which (if any) gallery CG should auto-surface full-bleed on the VN stage right
 * now, from the live scene state rather than the player browsing the Gallery. Pure and stateless —
 * `VNStage` recomputes this every render, so the CG appears and disappears with the condition
 * itself (e.g. it drops away the moment `intimacyPhase` moves on from `'peak'`).
 */
export interface CgTriggerContext {
  affection: number
  sceneFlags: readonly string[]
  intimacyPhase?: IntimacyPhase
  /** The catalog entry id from the player's most recent intimacy action, if any — see `StoredMessage.intimacyAction.optionId`. Naturally one-shot: it only matches for the reply immediately following that action, since the next player message replaces it. */
  lastCatalogActionId?: string
  relationshipStage?: RelationshipStage
}

function galleryUnlocked(entry: GalleryEntry, affection: number, sceneFlags: readonly string[]): boolean {
  if (affection < entry.unlockAffection) return false
  if (entry.requiredFlags?.length && !entry.requiredFlags.every((f) => sceneFlags.includes(f))) return false
  return true
}

function triggerFires(trigger: GalleryEntry['autoTrigger'], ctx: CgTriggerContext): boolean {
  if (!trigger) return false
  switch (trigger.kind) {
    case 'intimacyPhase':
      return ctx.intimacyPhase === trigger.phase
    case 'catalogAction':
      return !!ctx.lastCatalogActionId && ctx.lastCatalogActionId === trigger.optionId
    case 'sceneFlag':
      return ctx.sceneFlags.includes(trigger.flag)
    case 'relationshipStage':
      return ctx.relationshipStage === trigger.stage
  }
}

/**
 * The first gallery entry (in authored order) that's both unlocked and has a firing `autoTrigger`.
 * `isEnding` entries are never auto-surfaced — those stay a browsable epilogue the player reaches
 * on their own, not something swapped into a live scene unprompted. Returns undefined with nothing
 * to show, which is the common case (most entries have no `autoTrigger` at all).
 */
export function triggeredCg(gallery: GalleryEntry[] | undefined, ctx: CgTriggerContext): GalleryEntry | undefined {
  if (!gallery?.length) return undefined
  return gallery.find((entry) => !entry.isEnding && galleryUnlocked(entry, ctx.affection, ctx.sceneFlags) && triggerFires(entry.autoTrigger, ctx))
}
