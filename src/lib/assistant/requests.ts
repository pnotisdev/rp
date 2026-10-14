/** Recognising the two things the assistant can *make* rather than just answer: a roleplay character, and a long-form story. */

export type ProducerKind = 'character' | 'story'

/** A verb that means "bring this into existence", as opposed to discussing it. */
const MAKE = String.raw`(?:generate|create|make|design|build|write|draft|come up with|invent|give me)`

/** "a character", "an OC", "a companion for me" — the object of a character request. */
const CHARACTER_OBJECT = String.raw`(?:\w+\s+){0,6}?(?:character|oc|npc|companion|persona|protagonist|villain|waifu|husbando)`

const CHARACTER_PATTERNS = [
  new RegExp(String.raw`\b${MAKE}\b[^.?!]{0,80}?\b${CHARACTER_OBJECT}\b`, 'i'),
  // "generate a 3000 year old white hair elf for me" — a species/archetype noun with no "character".
  new RegExp(
    String.raw`\b${MAKE}\b[^.?!]{0,80}?\b(?:elf|elven|orc|dwarf|vampire|demon|angel|witch|wizard|mage|sorcerer|knight|samurai|ninja|android|robot|werewolf|dragon|fae|fairy|catgirl|nekomimi|succubus|god|goddess|priestess|assassin|mercenary|pirate|alien)\b`,
    'i',
  ),
  /\b(?:character|oc) (?:card|sheet)\b/i,
]

const STORY_PATTERNS = [
  // "chapters" is one of the object nouns rather than a pattern of its own
  new RegExp(
    String.raw`\b${MAKE}\b[^.?!]{0,80}?\b(?:story|novel|novella|book|fanfic|fanfiction|tale|saga|screenplay|chapters?)\b`,
    'i',
  ),
  /\bchapter[- ]by[- ]chapter\b/i,
  /\b(?:full|complete|whole|entire|long)[- ](?:story|novel|book)\b/i,
]

/** What this message is asking to have made, or `undefined` for ordinary conversation. */
export function detectProducer(text: string): ProducerKind | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  // Questions *about* the subject aren't requests to produce one: "what makes a good character?", "how would you write a story like that?".
  if (
    /^(?:what|which|why|is it|are there|do you think|can you explain|tell me about)\b/i.test(trimmed) ||
    /^how\s+(?:come|would|do|does|did|can|could|should|much|many)\b/i.test(trimmed)
  ) {
    return undefined
  }
  if (STORY_PATTERNS.some((re) => re.test(trimmed))) return 'story'
  if (CHARACTER_PATTERNS.some((re) => re.test(trimmed))) return 'character'
  return undefined
}

/** Player-facing label for the offer chip. */
export const PRODUCER_LABEL: Record<ProducerKind, string> = {
  character: 'Build this as a character',
  story: 'Write this as a full story',
}

/** One line under the chip saying what pressing it will actually do. */
export const PRODUCER_DETAIL: Record<ProducerKind, string> = {
  character:
    'Runs the full character build (card, profile, wardrobe, lore) and offers to save it to your library for roleplay.',
  story: 'Plans a chapter outline first, then writes each chapter in order, keeping continuity across them.',
}
