import type { GalleryEntry } from '@/lib/characters/cardSpec'
import type { RelationshipStage } from '@/lib/types'
import type { IntimacyPhase } from '@/lib/dating/intimacyScene'

/** Item 10: picks which (if any) gallery CG should auto-surface full-bleed on the VN stage right now, from the live scene state… */
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

/** The first gallery entry (in authored order) that's both unlocked and has a firing `autoTrigger`. */
export function triggeredCg(gallery: GalleryEntry[] | undefined, ctx: CgTriggerContext): GalleryEntry | undefined {
  if (!gallery?.length) return undefined
  return gallery.find((entry) => !entry.isEnding && galleryUnlocked(entry, ctx.affection, ctx.sceneFlags) && triggerFires(entry.autoTrigger, ctx))
}
