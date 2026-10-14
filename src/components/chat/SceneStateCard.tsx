import { AROUSAL_BAND_PHRASE } from '@/lib/dating/arousal'
import { describeClothingSide } from '@/lib/dating/clothing'
import { arousalOf, clothingOf, sceneArousalBand, stageOf, turnsInStage, type IntimacyScene } from '@/lib/dating/intimacyScene'
import { describeContact, sceneParticipants, SCENE_PLAYER } from '@/lib/dating/sceneParticipants'
import type { ScenarioGraph } from '@/lib/dating/intimacyStages'
import { StageCard, StageLabel, StageMeter, StageRow, type StageVariant } from '@/components/ui/Stage'

/** The live intimacy scene, read back to the player in the VN HUD's own idiom. */

/** Sentence-cases a band phrase for use as a standalone value. */
function bandLabel(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** A stage's structural kind as a player-facing name. `kind` is engine vocabulary; these aren't. */
const STAGE_KIND_LABEL: Record<string, string> = {
  opening: 'Opening',
  foreplay: 'Building',
  oral: 'Going down',
  penetrative: 'Together',
  climax: 'At the peak',
}

export interface SceneStateCardProps {
  scene: IntimacyScene
  /** Whose panel this is; their row sorts first, and clothing/arousal resolve against their id. */
  viewingId: string
  /** Resolves a participant id to a display name. */
  nameOf: (id: string) => string
  userName: string
  /** `countCharReplies` — the scale scene turns and contact durations are measured on. */
  charReplyCount: number
  /** The scenario the scene is running on, for its title and stage lookup. */
  graph?: ScenarioGraph
  variant?: StageVariant
  /** Drops the meters and the per-person breakdown, leaving the one-line summary. For the VN HUD. */
  compact?: boolean
  /** Lets long values wrap rather than truncate — for the Director inspector, where the whole value is the point. */
  wrap?: boolean
  className?: string
}

export function SceneStateCard({
  scene,
  viewingId,
  nameOf,
  userName,
  charReplyCount,
  graph,
  variant = 'default',
  compact,
  wrap,
  className = '',
}: SceneStateCardProps) {
  const roster = sceneParticipants(scene)
  // A scene with no roster predates them and has exactly one participant: whoever is being viewed.
  const people = roster.length ? [viewingId, ...roster.filter((id) => id !== viewingId)] : [viewingId]
  const stage = graph ? stageOf(scene, graph) : undefined
  const sceneTurns = scene.startedAtTurn === undefined ? undefined : charReplyCount - scene.startedAtTurn
  const contactLine = scene.contact?.length
    ? describeContact(scene.contact, (id) => (id === SCENE_PLAYER ? userName : nameOf(id)), charReplyCount)
    : scene.contactRegions?.length
      ? scene.contactRegions.map((r) => r.replace(/_/g, ' ')).join(', ')
      : ''
  const dressed = people
    .map((id) => ({ id, text: describeClothingSide(clothingOf(scene, id), 'char') }))
    .filter((entry) => entry.text !== 'dressed')
  const playerClothing = describeClothingSide(scene.clothing, 'user')

  return (
    <StageCard variant={variant} className={className}>
      <StageRow label="Scene" variant={variant} first wrap={wrap}>
        {scene.activityLabel}
      </StageRow>

      {stage && (
        <StageRow label="Stage" variant={variant} wrap={wrap}>
          {STAGE_KIND_LABEL[stage.kind] ?? stage.kind}
          {sceneTurns !== undefined && sceneTurns > 0 ? ` · turn ${sceneTurns}` : ''}
          {graph && roster.length > 1 ? ` · ${graph.title}` : ''}
        </StageRow>
      )}

      {compact ? (
        // One line for the stage HUD: how far along, without a number to stare at.
        <StageRow label={nameOf(viewingId)} variant={variant}>
          {bandLabel(AROUSAL_BAND_PHRASE[sceneArousalBand(scene, viewingId)])}
        </StageRow>
      ) : (
        <StageRow variant={variant}>
          <div className="space-y-1.5">
            {people.map((id) => {
              const value = arousalOf(scene, id).value
              return (
                <div key={id}>
                  <div className="mb-1 flex min-w-0 items-center gap-1.5">
                    <StageLabel variant={variant}>{nameOf(id)}</StageLabel>
                    <span className={`min-w-0 truncate ${variant === 'vn' ? 'text-white/90' : 'text-text'}`}>
                      {bandLabel(AROUSAL_BAND_PHRASE[sceneArousalBand(scene, id)])}
                    </span>
                  </div>
                  <StageMeter value={value} tone="romance" variant={variant} />
                </div>
              )
            })}
          </div>
        </StageRow>
      )}

      {!compact && (dressed.length > 0 || playerClothing !== 'dressed') && (
        <StageRow label="Undressed" variant={variant} wrap={wrap}>
          {[
            ...dressed.map((entry) => `${nameOf(entry.id)}: ${entry.text}`),
            playerClothing !== 'dressed' ? `${userName}: ${playerClothing}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </StageRow>
      )}

      {!compact && contactLine && (
        <StageRow label="Contact" variant={variant} wrap={wrap}>
          {contactLine}
        </StageRow>
      )}

      {!compact && stage?.softMaxTurns !== undefined && turnsInStage(scene, charReplyCount) > stage.softMaxTurns && (
        // Says what's true rather than what to do, the same restraint the afterglow line uses.
        <StageRow variant={variant}>
          <span className={variant === 'vn' ? 'text-white/60' : 'text-text-muted'}>
            This part has run longer than it usually would.
          </span>
        </StageRow>
      )}
    </StageCard>
  )
}
