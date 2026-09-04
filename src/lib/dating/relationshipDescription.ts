import { getRelationshipStats, computeWarmth, relationshipStageForWarmth, relationshipMilestonesFor, formatRelationshipStage, formatCommitmentStatus } from '@/lib/dating/stage'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'

/**
 * Moved verbatim out of `useChatSession.ts` (no behavior change) so the headless outreach tick
 * (`src/lib/dating/outreach.ts`) can build the same relationship-flavor text a live chat turn
 * would, without duplicating this logic.
 */
export function buildGiftTasteNote(character: Character): string | undefined {
  const { giftLikes, giftDislikes, loveLanguage } = character
  const parts: string[] = []
  if (loveLanguage?.trim()) parts.push(`feels most loved through ${loveLanguage.trim()}`)
  if (giftLikes?.length) parts.push(`tends to genuinely love gifts like ${giftLikes.join(', ')}`)
  if (giftDislikes?.length) parts.push(`isn't really moved by gifts like ${giftDislikes.join(', ')}`)
  if (parts.length === 0) return undefined
  return `${character.card.name} ${parts.join('; ')}. React to any gift given accordingly, in character, without reciting this as a checklist.`
}

export function buildRelationshipDescription(
  chat: Pick<Chat, 'affection' | 'relationshipStats' | 'commitmentStatus' | 'relationshipWarning' | 'breakupCount'>,
  world: WorldCard | undefined,
  character: Character,
): string | undefined {
  if (chat.affection === undefined) return undefined
  const primaryName = character.card.name
  const stats = getRelationshipStats(chat)
  const stage = relationshipStageForWarmth(computeWarmth(chat.affection, stats), relationshipMilestonesFor(world?.relationshipThresholds))
  const notes: string[] = []
  if (stats.trust >= 70) notes.push('a deep mutual trust has built up')
  if (stats.chemistry >= 70) notes.push('there is a strong romantic spark')
  if (stats.tension >= 60) notes.push('real unresolved tension between them')
  if (stats.comfort <= 20 && stage !== 'near_strangers') notes.push('things still feel a little unsettled between them')
  const giftTasteNote = buildGiftTasteNote(character)
  // Only stated when there's an actual explicit status (10c's DTR ladder) — an unset/'none'
  // commitment is the ordinary default for most chats and isn't worth a line every single turn.
  const commitmentNote =
    chat.commitmentStatus && chat.commitmentStatus !== 'none'
      ? `{{user}} and ${primaryName} are officially ${formatCommitmentStatus(chat.commitmentStatus)}.`
      : undefined
  // 10c's "Breakups & reconciliation" — a standing warning is the model's cue to actually play the
  // strain, not just have the numbers move; a past breakup colors things even once patched up.
  const warningNote = chat.relationshipWarning
    ? `The relationship is genuinely on the rocks right now (${chat.relationshipWarning.reason}). Let that show; don't just narrate past it.`
    : undefined
  const breakupNote =
    chat.breakupCount && chat.breakupCount > 0
      ? `${primaryName} and {{user}} have broken up before. Some caution or guardedness is earned here, whether or not that's fully behind them now.`
      : undefined
  // `primaryName` is spelled out rather than left as a `{{char}}` macro — this stays about the
  // scene's primary/relationship-tracked character even in a group chat, where `{{char}}` would
  // otherwise resolve to whoever's currently speaking instead (see resolveSpeaker/buildCurrentPrompt).
  return [
    `Relationship: {{user}} and ${primaryName} are at the "${formatRelationshipStage(stage)}" stage${notes.length ? `: ${notes.join('; ')}` : ''}.`,
    '(Let this colour tone, warmth, and what feels earned right now. Never state a number, "affection", or "stage" out loud.)',
    commitmentNote,
    warningNote,
    breakupNote,
    giftTasteNote,
  ]
    .filter(Boolean)
    .join('\n')
}
