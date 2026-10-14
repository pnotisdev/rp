import { isRemoved, LAYER_WORDS, type ClothingLayer, type ClothingSide, type ClothingState } from '@/lib/dating/clothing'

// The other half of the scene state block

export interface ContinuityBreak {
  kind: 'clothing' | 'location' | 'time'
  /** The phrase in the reply that contradicts the state, for the toast and the correction directive. */
  quote: string
  /** What the engine knows to be true instead. */
  expected: string
}

export interface ContinuityFacts {
  clothing?: ClothingState
  /** The location the scene is actually at, e.g. "Bedroom". */
  location?: string
  /** Every other location this world knows about — the closed vocabulary a contradiction is drawn from. */
  knownLocations?: string[]
  /** Current phase of day: morning / afternoon / evening / night. */
  timePhase?: string
  /** The full phase vocabulary, so a contradiction is only ever flagged against a known alternative. */
  knownTimePhases?: string[]
}

/** Verbs that actually take a garment off, as opposed to merely mentioning it. */
const REMOVAL_CUES = [
  'pull', 'pulls', 'pulled', 'pulling',
  'peel', 'peels', 'peeled', 'peeling',
  'slip', 'slips', 'slipped', 'slipping',
  'take', 'takes', 'took', 'taking',
  'tug', 'tugs', 'tugged', 'tugging',
  'strip', 'strips', 'stripped', 'stripping',
  'shrug', 'shrugs', 'shrugged', 'shrugging',
  'unhook', 'unhooks', 'unhooked', 'unhooking',
  'unclasp', 'unclasps', 'unclasped', 'unclasping',
  'unbutton', 'unbuttons', 'unbuttoned', 'unbuttoning',
  'unzip', 'unzips', 'unzipped', 'unzipping',
  'remove', 'removes', 'removed', 'removing',
  'discard', 'discards', 'discarded',
  'off', 'away',
]

/** How far either side of a garment word a removal cue still counts as acting on it. */
const CUE_WINDOW = 34

/** Whose garment a mention is, read off the possessive right before it. */
function sideOfMention(before: string, charName: string, userName: string): ClothingSide | undefined {
  const tail = before.slice(-40).toLowerCase()
  if (/\bown\s+(\w+\s+){0,1}$/.test(tail)) return undefined
  if (/\b(your|my)\s+(\w+\s+){0,2}$/.test(tail) || tail.includes(userName.toLowerCase())) return 'user'
  if (/\b(her|his|their|its)\s+(\w+\s+){0,2}$/.test(tail) || tail.includes(charName.toLowerCase())) return 'char'
  return undefined
}

function hasRemovalCue(window: string): boolean {
  return REMOVAL_CUES.some((cue) => new RegExp(`\\b${cue}\\b`).test(window))
}

/** A reply taking off something the engine knows is already off. */
function detectClothingBreak(
  reply: string,
  clothing: ClothingState | undefined,
  charName: string,
  userName: string,
): ContinuityBreak | undefined {
  if (!clothing) return undefined
  const lower = reply.toLowerCase()
  for (const layer of Object.keys(LAYER_WORDS) as ClothingLayer[]) {
    for (const word of LAYER_WORDS[layer]) {
      let from = 0
      for (;;) {
        const at = lower.indexOf(word, from)
        if (at === -1) break
        from = at + word.length
        const before = reply.slice(Math.max(0, at - CUE_WINDOW), at)
        const window = `${before} ${reply.slice(at, at + word.length + CUE_WINDOW)}`.toLowerCase()
        if (!hasRemovalCue(window)) continue
        const who = sideOfMention(before, charName, userName)
        if (!who || !isRemoved(clothing, who, layer)) continue
        return {
          kind: 'clothing',
          quote: reply.slice(Math.max(0, at - 24), at + word.length + 16).trim(),
          expected: `${who === 'char' ? charName : userName} already had that off earlier in this scene`,
        }
      }
    }
  }
  return undefined
}

/** A named location that isn't the one the scene is at, reached by an explicit preposition rather than mentioned in passing. */
function detectLocationBreak(reply: string, facts: ContinuityFacts): ContinuityBreak | undefined {
  if (!facts.location || !facts.knownLocations?.length) return undefined
  const current = facts.location.toLowerCase()
  for (const candidate of facts.knownLocations) {
    const name = candidate.toLowerCase()
    if (!name || name === current || current.includes(name) || name.includes(current)) continue
    const match = new RegExp(`\\b(?:in|at|inside|into|on)\\s+(?:the\\s+|her\\s+|his\\s+|their\\s+|your\\s+|my\\s+)?${escapeRegex(name)}\\b`, 'i').exec(reply)
    if (match) {
      return { kind: 'location', quote: match[0], expected: `the scene is at ${facts.location}` }
    }
  }
  return undefined
}

/** Words that make a time-of-day mention a reference to some other day rather than a claim about now. */
const TIME_REFERENCE_GUARDS = ['tomorrow', 'yesterday', 'last', 'next', 'this', 'every', 'each', 'by', 'until', 'since', 'that']

/** A different phase of day asserted as the present one. */
function detectTimeBreak(reply: string, facts: ContinuityFacts): ContinuityBreak | undefined {
  if (!facts.timePhase || !facts.knownTimePhases?.length) return undefined
  const current = facts.timePhase.toLowerCase()
  for (const phase of facts.knownTimePhases) {
    const name = phase.toLowerCase()
    if (!name || current.includes(name)) continue
    const match = new RegExp(`\\b(\\w+)\\s+(${escapeRegex(name)})\\b|\\b(${escapeRegex(name)})\\b`, 'i').exec(reply)
    if (!match) continue
    const preceding = (match[1] ?? '').toLowerCase()
    if (TIME_REFERENCE_GUARDS.includes(preceding)) continue
    return { kind: 'time', quote: match[0].trim(), expected: `it is ${facts.timePhase} right now` }
  }
  return undefined
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The first continuity break in a reply, or `undefined` when it reads clean. */
export function detectContinuityBreak(
  reply: string,
  facts: ContinuityFacts,
  charName: string,
  userName: string,
): ContinuityBreak | undefined {
  if (!reply.trim()) return undefined
  return (
    detectClothingBreak(reply, facts.clothing, charName, userName) ??
    detectLocationBreak(reply, facts) ??
    detectTimeBreak(reply, facts)
  )
}

/** One-line summary of a break, for the toast and the retry's correction directive. */
export function describeContinuityBreak(breakFound: ContinuityBreak): string {
  return `"${breakFound.quote}" contradicts the scene, ${breakFound.expected}`
}
