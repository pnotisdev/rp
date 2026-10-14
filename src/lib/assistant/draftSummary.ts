// What a character draft holds, grouped by build stage, for the review card.

import { OPTIONAL_STAGES, STAGE_LABELS, type DraftSections, type OptionalStage } from '@/lib/characters/generateFullCharacter'
import { giftById } from '@/lib/dating/gifts'
import { getCalendarInfo } from '@/lib/world/calendar'

export interface DraftSection {
  stage: OptionalStage
  label: string
  /** Empty when the stage failed or has not run. */
  rows: { label: string; value: string }[]
}

type Row = [label: string, value: string | undefined]

const joined = (items?: readonly string[]) => items?.join(', ') ?? ''
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** The keys of a score map that hold exactly this score, as words. */
const scoredAt = (scores: Partial<Record<string, number>> | undefined, value: number) =>
  Object.entries(scores ?? {})
    .filter(([, v]) => v === value)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ')

export function describeDraft(draft: DraftSections): DraftSection[] {
  const { card, profile: p, bonds: b, outfits, characterBook, extras: x = {} } = draft
  const voice = x.voiceFingerprint
  const scored = Object.entries(x.giftPreferences ?? {})
  const gifts = (keep: (score: number) => boolean) =>
    scored
      .filter(([, score]) => keep(score))
      .map(([id, score]) => `${giftById(id)?.name ?? id} (${score > 0 ? '+' : ''}${score})`)
      .join(', ')
  const born = x.birthday === undefined ? undefined : getCalendarInfo(x.birthday)

  const rows: Record<OptionalStage, Row[]> = {
    greetings: (card.alternate_greetings ?? []).map((g, i): Row => [`Greeting ${i + 1}`, g]),
    profile: [
      ['Occupation', p?.occupation],
      ['Workplace', p?.workplace],
      ['Home', p?.homeLocation],
      ['Frequents', joined(p?.frequentedLocations)],
      ['Likes', joined(p?.likes)],
      ['Goals', joined(p?.goals)],
      ['Boundaries', joined(p?.boundaries)],
      ['Love language', p?.loveLanguage],
    ],
    bonds: [
      ['Gifts they love', joined(b?.giftLikes)],
      ['Gifts that fall flat', joined(b?.giftDislikes)],
      ['Loves the weather', joined(b?.weatherLoves)],
      ['Hates the weather', joined(b?.weatherHates)],
      ...(b?.relationshipStarters ?? []).map((s): Row => [`Start: ${s.label}`, s.blurb]),
    ],
    social: [
      ...(x.socialConnections ?? []).map((c): Row => [c.name, [c.relation, c.notes].filter(Boolean).join('. ')]),
      ...(x.behavioralRules ?? []).map((r): Row => (r.kind === 'never' ? ['Never', r.then] : ['When', `${r.when}: ${r.then}`])),
    ],
    voice: [
      ['Verbal tics', joined(voice?.verbalTics)],
      ['Catchphrases', joined(voice?.catchphrases)],
      ['Dialect', voice?.dialectNotes],
      ['Rhythm', voice?.sentenceRhythm],
      ['Sound effects', joined(x.sfxWords)],
    ],
    gifts: [
      ['Favorites', gifts((s) => s > 0)],
      ['Dislikes', gifts((s) => s < 0)],
    ],
    worldsim: [
      ...(x.schedule ?? []).map((s): Row => [
        `${capital(s.phase)}${s.days?.length ? ` (${s.days.map((d) => d.slice(0, 3)).join(', ')})` : ''}`,
        `${s.status}: ${s.activity}${s.location ? `, ${s.location}` : ''}`,
      ]),
      ['Birthday', born ? `${capital(born.season)} ${born.dayOfSeason}` : ''],
      ['Texts first', x.outreach?.frequency],
    ],
    drive: x.drive
      ? [
          ['Engine', 'Off. Switch it on in World sim.'],
          ['Chaos', `${Math.round(x.drive.chaosBase * 100)}%`],
          ['Resting energy', `${x.drive.energyBase} of 10`],
          ['Fixations', joined(x.drive.fixations)],
          ['Loves', joined(x.drive.loves)],
          ['Bored by', joined(x.drive.boredBy)],
          ['Bits', joined(x.drive.motifs)],
        ]
      : [],
    intimacy: [
      ['Sensitive', scoredAt(x.touchProfile?.sensitivity, 3)],
      ['Unresponsive', scoredAt(x.touchProfile?.sensitivity, 0)],
      ['Off limits', joined(x.touchProfile?.offLimits)?.replace(/_/g, ' ')],
      ['Likes', scoredAt(x.kinkProfile?.valence, 2)],
      ['Dislikes', scoredAt(x.kinkProfile?.valence, -1)],
      ['Hard limits', joined(x.kinkProfile?.hardLimits)?.replace(/_/g, ' ')],
      ['Voice under strain', x.explicitVoiceNote],
    ],
    outfits: [['Outfits', (outfits ?? []).map((o) => o.label ?? o.id).join(', ')]],
    lore: (characterBook?.entries ?? []).map((e): Row => [e.keys.slice(0, 3).join(', '), e.content]),
  }

  return OPTIONAL_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    rows: rows[stage].flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : [])),
  }))
}
