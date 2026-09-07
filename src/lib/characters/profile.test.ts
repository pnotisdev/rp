import { describe, expect, it } from 'vitest'
import { buildCharacterProfileNote } from './profile'
import { blankCharacterData, type Character } from './cardSpec'

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    card: blankCharacterData('Test'),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('buildCharacterProfileNote', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildCharacterProfileNote(character())).toBeUndefined()
  })

  it('folds occupation and workplace into one line', () => {
    const note = buildCharacterProfileNote(character({ occupation: 'barista', workplace: 'Sakura Hill Cafe' }))
    expect(note).toContain('Works as barista at Sakura Hill Cafe')
  })

  it('lists boundaries in full, uncapped, regardless of count', () => {
    const boundaries = Array.from({ length: 20 }, (_, i) => `Limit ${i}`)
    const note = buildCharacterProfileNote(character({ boundaries }))
    for (const b of boundaries) expect(note).toContain(b)
  })

  it('caps likes to the first 8 rather than growing without bound', () => {
    const likes = Array.from({ length: 20 }, (_, i) => `Like ${i}`)
    const note = buildCharacterProfileNote(character({ likes }))
    expect(note).toContain('Like 0')
    expect(note).toContain('Like 7')
    expect(note).not.toContain('Like 8')
    expect(note).not.toContain('Like 19')
  })

  it('caps goals to the first 5', () => {
    const goals = Array.from({ length: 10 }, (_, i) => `Goal ${i}`)
    const note = buildCharacterProfileNote(character({ goals }))
    expect(note).toContain('Goal 4')
    expect(note).not.toContain('Goal 5')
  })

  it('caps frequented locations to the first 5', () => {
    const frequentedLocations = Array.from({ length: 10 }, (_, i) => `Spot ${i}`)
    const note = buildCharacterProfileNote(character({ frequentedLocations }))
    expect(note).toContain('Spot 4')
    expect(note).not.toContain('Spot 5')
  })

  it('caps social connections to the first 6', () => {
    const socialConnections = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Person ${i}`, relation: 'friend' }))
    const note = buildCharacterProfileNote(character({ socialConnections }))
    expect(note).toContain('Person 5')
    expect(note).not.toContain('Person 6')
  })

  it('folds an authored voice fingerprint in as its own sentence, not merged into life context', () => {
    const note = buildCharacterProfileNote(
      character({
        occupation: 'barista',
        voiceFingerprint: { verbalTics: ['well', 'you know'], catchphrases: ["it's not like i"] },
      }),
    )
    expect(note).toContain('Works as barista')
    expect(note).toContain('Speech patterns to stay consistent with')
    expect(note).toContain('"well"')
    expect(note).toContain('"you know"')
    expect(note).toContain(`"it's not like i"`)
  })

  it('adds a compact "Voice check" reminder restating only the top catchphrase and tic, separate from the full note', () => {
    const note = buildCharacterProfileNote(
      character({ voiceFingerprint: { verbalTics: ['well', 'you know'], catchphrases: ["it's not like i", 'obviously'] } }),
    )
    expect(note).toContain('Voice check, every single reply')
    expect(note).toContain('reach for "it\'s not like i" again')
    expect(note).toContain('keep the "well" tic alive')
    // Only the *first* of each list is restated in the compact reminder, not the full set.
    const reminderLine = note!.split('\n').find((l) => l.startsWith('Voice check'))!
    expect(reminderLine).not.toContain('obviously')
    expect(reminderLine).not.toContain('you know')
  })

  it('does not repeat a detailed register in the reminder when a tic or catchphrase already anchors it', () => {
    const note = buildCharacterProfileNote(
      character({
        voiceFingerprint: {
          verbalTics: ['well'],
          dialectNotes: 'formal under pressure',
        },
      }),
    )!
    const reminderLine = note.split('\n').find((line) => line.startsWith('Voice check'))!
    expect(note).toContain('formal under pressure')
    expect(reminderLine).not.toContain('formal under pressure')
  })

  it('folds the register into the reminder when there is no catchphrase or tic to restate', () => {
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { dialectNotes: 'clipped, never contracts a verb' } }))
    expect(note).toContain('Voice check, every single reply')
    expect(note).toContain('clipped, never contracts a verb')
  })

  it('never flattens into generic prose is the closing instruction on the reminder line', () => {
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { catchphrases: ['you are impossible'] } }))
    expect(note).toContain('Never let this quietly flatten into generic prose.')
  })

  it('includes dialect notes and sentence rhythm when authored', () => {
    const note = buildCharacterProfileNote(
      character({
        voiceFingerprint: { dialectNotes: 'clipped, never contracts a verb', sentenceRhythm: 'Short, clipped sentences.' },
      }),
    )
    expect(note).toContain('clipped, never contracts a verb')
    expect(note).toContain('Short, clipped sentences.')
  })

  it('caps verbal tics and catchphrases in the note rather than growing without bound', () => {
    const verbalTics = Array.from({ length: 10 }, (_, i) => `tic${i}`)
    const catchphrases = Array.from({ length: 10 }, (_, i) => `phrase ${i}`)
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { verbalTics, catchphrases } }))
    expect(note).toContain('"tic5"')
    expect(note).not.toContain('"tic6"')
    expect(note).toContain('"phrase 4"')
    expect(note).not.toContain('"phrase 5"')
  })

  it('returns undefined for an empty voice fingerprint object with nothing set', () => {
    expect(buildCharacterProfileNote(character({ voiceFingerprint: {} }))).toBeUndefined()
  })

  it('folds a "when_then" behavioral rule into a "When X: Y." line', () => {
    const note = buildCharacterProfileNote(
      character({ behavioralRules: [{ id: 'r1', kind: 'when_then', when: 'he brings up her sister', then: 'she deflects with a joke' }] }),
    )
    expect(note).toContain('Behavioral rules, authored for this character and followed exactly as written:')
    expect(note).toContain('When he brings up her sister: she deflects with a joke.')
  })

  it('folds a "never" behavioral rule into a "Never: Y." line, ignoring any `when`', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'never', when: 'ignored', then: 'initiate a kiss first' }] }))
    expect(note).toContain('Never: initiate a kiss first.')
    expect(note).not.toContain('ignored')
  })

  it('falls back to "it comes up" when a when_then rule has no when text authored', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'when_then', then: 'she goes quiet' }] }))
    expect(note).toContain('When it comes up: she goes quiet.')
  })

  it('drops rules with blank `then` text and returns undefined if none remain', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'never', then: '   ' }] }))
    expect(note).toBeUndefined()
  })

  it('caps behavioral rules to the first 10', () => {
    const behavioralRules = Array.from({ length: 15 }, (_, i) => ({ id: String(i), kind: 'never' as const, then: `rule ${i}` }))
    const note = buildCharacterProfileNote(character({ behavioralRules }))
    expect(note).toContain('rule 9')
    expect(note).not.toContain('rule 10')
  })

  it('still returns a note when only the voice fingerprint is set, with no life-context fields at all', () => {
    const note = buildCharacterProfileNote(character({ voiceFingerprint: { dialectNotes: 'blunt, one-word answers' } }))
    expect(note).toBe(
      'Speech patterns to stay consistent with, every turn: dialect/register: blunt, one-word answers.\n' +
        'Voice check, every single reply no matter how long this chat has run: blunt, one-word answers. Never let this quietly flatten into generic prose.',
    )
  })
})
