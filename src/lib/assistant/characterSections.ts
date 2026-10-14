// Maps a saved character to the draft the stages read, and each stage to the stored fields it owns, so one section can be rewritten and put back.

import type { Character } from '@/lib/characters/cardSpec'
import type { DraftSections, OptionalStage } from '@/lib/characters/generateFullCharacter'

/** The stored fields each stage owns. A `card.` prefix means the field lives inside the portable card. */
export const SECTION_KEYS: Record<OptionalStage, readonly string[]> = {
  greetings: ['card.alternate_greetings'],
  profile: ['occupation', 'workplace', 'homeLocation', 'frequentedLocations', 'likes', 'goals', 'boundaries', 'loveLanguage'],
  bonds: ['giftLikes', 'giftDislikes', 'relationshipStarters', 'weatherPreferences'],
  social: ['socialConnections', 'behavioralRules'],
  voice: ['voiceFingerprint', 'sfxWords'],
  gifts: ['giftPreferences'],
  worldsim: ['schedule', 'birthday', 'outreach'],
  drive: ['drive'],
  intimacy: ['touchProfile', 'kinkProfile', 'explicitVoiceNote'],
  outfits: ['outfits'],
  lore: ['card.character_book'],
}

const PROFILE_KEYS = SECTION_KEYS.profile as readonly (keyof Character)[]
const EXTRA_KEYS = ['socialConnections', 'behavioralRules', 'voiceFingerprint', 'sfxWords', 'giftPreferences', 'schedule', 'birthday', 'outreach', 'drive', 'touchProfile', 'kinkProfile', 'explicitVoiceNote'] as const

/** A saved character in the shape the stages read. `brief` is what the writer asked for this time; it is the only place stated limits can come from besides the character's own boundaries. */
export function characterToDraft(c: Character, brief?: string): DraftSections {
  const text = (k: keyof Character) => (typeof c[k] === 'string' ? (c[k] as string) : '')
  const list = (k: keyof Character) => (Array.isArray(c[k]) ? (c[k] as string[]) : [])
  const hasProfile = PROFILE_KEYS.some((k) => (Array.isArray(c[k]) ? (c[k] as unknown[]).length : c[k]))
  return {
    card: c.card,
    ...(hasProfile
      ? {
          profile: {
            occupation: text('occupation'),
            workplace: text('workplace'),
            homeLocation: text('homeLocation'),
            frequentedLocations: list('frequentedLocations'),
            likes: list('likes'),
            goals: list('goals'),
            boundaries: list('boundaries'),
            loveLanguage: text('loveLanguage'),
          },
        }
      : {}),
    ...(c.giftLikes?.length || c.giftDislikes?.length
      ? { bonds: { giftLikes: c.giftLikes ?? [], giftDislikes: c.giftDislikes ?? [], weatherLoves: c.weatherPreferences?.loves ?? [], weatherHates: c.weatherPreferences?.hates ?? [], relationshipStarters: c.relationshipStarters ?? [] } }
      : {}),
    outfits: c.outfits ?? null,
    characterBook: c.card.character_book ?? null,
    extras: Object.fromEntries(EXTRA_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])),
    ...(brief ? { brief } : {}),
    ...(c.worldId ? { worldId: c.worldId } : {}),
  }
}

/** One stage's stored values, read from a character or from a patch input. A missing plain field is `null`, which the server reads as "clear it". */
export function sectionValues(stage: OptionalStage, source: Partial<Character> & { card: Character['card'] }): Record<string, unknown> {
  const record = source as unknown as Record<string, unknown>
  return Object.fromEntries(
    SECTION_KEYS[stage].map((k) => (k.startsWith('card.') ? [k, (source.card as unknown as Record<string, unknown>)[k.slice(5)]] : [k, record[k] ?? null])),
  )
}

/** The body for `PUT /api/characters/:id` that writes these values. Card fields are merged into the card as it is now. */
export function patchBody(current: Character, values: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  let card: Record<string, unknown> | undefined
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith('card.')) card = { ...(card ?? (current.card as unknown as Record<string, unknown>)), [k.slice(5)]: v }
    else body[k] = v
  }
  return card ? { ...body, card } : body
}

/** Short readable text for a set of values: what the approval prompt and the tool result show. */
export function describeValues(values: Record<string, unknown>, max = 700): string {
  const lines = Object.entries(values).map(([k, v]) => `${k.replace(/^card\./, '')}: ${v === null || v === undefined ? '(empty)' : JSON.stringify(v)}`)
  const all = lines.join('\n')
  return all.length > max ? `${all.slice(0, max)}...` : all
}
