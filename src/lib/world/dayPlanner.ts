/**
 * Tier 3b's "Plan your day" loop — turns the world clock + energy budget (`calendar.ts`) into a
 * short, deterministic menu of things to do right now, rather than requiring an AI-suggested
 * `DateEventCard` just to spend an action. Kept separate from `calendar.ts` itself: that module
 * stays a low-level, character/chat-agnostic primitive layer, while this one is the higher-level
 * "what can {{char}} and I actually do" composition, same split as `world/ambientEvents.ts` /
 * `dating/outreach.ts` sitting apart from `calendar.ts`.
 */
import type { Character } from '@/lib/characters/cardSpec'
import type { DateEventCard, WorldCard } from '@/lib/types'
import { getCurrentActivity, getEnergyRemaining } from './calendar'

export interface DayPlannerActivity {
  id: 'meet' | 'text' | 'rest'
  label: string
  /** 'hangout' spends an action and opens a live, end-of-scene-scored scene via the existing
   *  `startDateEvent`/`endDateEvent` machinery — same low-stakes framing an AI-suggested hangout
   *  already gets (no hidden agenda, no walkout risk; that stays exclusive to a `'date'` card).
   *  'rest' spends an action but never touches `activeEvent` — no scene, no LLM call at all. */
  kind: 'hangout' | 'rest'
  /** Set only for 'meet' when a location could be resolved — fed into `updateScene({ location })`
   *  after the event starts, the one piece `startDateEvent` itself doesn't already do. */
  location?: string
  disabled?: boolean
  disabledReason?: string
}

type PlannerCharacter = Pick<Character, 'card' | 'schedule' | 'frequentedLocations' | 'homeLocation'>
type PlannerWorld = Pick<WorldCard, 'currentDay' | 'currentPhaseIndex'>

/** Best-guess "where would I actually find them" for the Meet activity: their own scheduled spot
 *  for this exact phase if authored, else a frequented spot, else home, else unset entirely (a
 *  generic "Meet {name}" with nothing to bias the scene location toward). Never a hard gate —
 *  presence status (busy/asleep/traveling) is left for the opener's own prompt context to react
 *  to narratively, same as everywhere else presence already works this way. */
function resolveMeetLocation(character: PlannerCharacter, day: number, phaseIndex: number): string | undefined {
  const presence = getCurrentActivity(character.schedule, day, phaseIndex)
  return presence.location || character.frequentedLocations?.[0] || character.homeLocation || undefined
}

/**
 * The day planner's fixed menu — always exactly these three, in this order. No AI call: every
 * field comes from data already in memory, so opening the panel costs nothing until the player
 * actually commits to an activity. A solo "go somewhere with no character present" option (the
 * TODO's "Go to the library" example) is deliberately not offered yet — it needs a plausible
 * place-name source this pass doesn't have a clean deterministic answer for.
 */
export function buildDayPlannerActivities(character: PlannerCharacter, world: PlannerWorld): DayPlannerActivity[] {
  const day = world.currentDay ?? 0
  const phaseIndex = world.currentPhaseIndex ?? 0
  const name = character.card.name
  const outOfEnergy = getEnergyRemaining(day, phaseIndex) <= 0
  const disabledReason = outOfEnergy ? 'No actions left today — rest to start a new day.' : undefined
  const location = resolveMeetLocation(character, day, phaseIndex)

  return [
    {
      id: 'meet',
      label: location ? `Meet ${name} at ${location}` : `Meet ${name}`,
      kind: 'hangout',
      location,
      disabled: outOfEnergy,
      disabledReason,
    },
    {
      id: 'text',
      label: `Text ${name}`,
      kind: 'hangout',
      disabled: outOfEnergy,
      disabledReason,
    },
    {
      id: 'rest',
      label: 'Rest',
      kind: 'rest',
    },
  ]
}

/** Builds the `DateEventCard` for a chosen 'hangout' activity. Always `kind: 'hangout'` — never
 *  `'date'`, since a planner-picked activity is deliberately the low-stakes sibling (no hidden
 *  agenda, no AI-detected-dealbreaker walkout risk); an AI-suggested `'date'` card stays the only
 *  door into that higher-stakes version. */
export function dateEventCardForActivity(activity: DayPlannerActivity, characterName: string): DateEventCard {
  const description =
    activity.id === 'meet'
      ? activity.location
        ? `${characterName} spends this part of the day with you at ${activity.location}.`
        : `${characterName} spends this part of the day with you.`
      : `A quick text exchange with ${characterName}.`
  const objectiveTitle = activity.id === 'meet' ? `Spend time with ${characterName}` : `Check in with ${characterName}`
  return {
    id: `day-planner-${Date.now()}`,
    title: activity.label,
    description,
    objectiveTitle,
    objectiveDescription: description,
    kind: 'hangout',
  }
}
