import { describe, expect, it } from 'vitest'
import { sceneContinuityNote } from './sceneContinuity'

describe('sceneContinuityNote', () => {
  it('returns an empty string when nothing is known', () => {
    expect(sceneContinuityNote({})).toBe('')
  })

  it('combines location and time into one "Scene:" clause', () => {
    const note = sceneContinuityNote({ location: 'the school library', timePhase: 'Sunday night' })
    expect(note).toBe('Scene: at the school library, Sunday night.')
  })

  it('includes location alone when time is unknown, and vice versa', () => {
    expect(sceneContinuityNote({ location: 'the cafe' })).toBe('Scene: at the cafe.')
    expect(sceneContinuityNote({ timePhase: 'Monday morning' })).toBe('Scene: Monday morning.')
  })

  it('names everyone else present, distinct from the two speaking', () => {
    expect(sceneContinuityNote({ presentNames: ['Yuki', 'Ren'] })).toBe('Also present: Yuki, Ren.')
  })

  it('omits the "present" clause entirely for an ordinary one-on-one chat', () => {
    expect(sceneContinuityNote({ presentNames: [] })).toBe('')
  })

  it('names the current tracked activity', () => {
    expect(sceneContinuityNote({ currentActivity: 'using a vibrator on Sumire' })).toBe(
      'Currently: using a vibrator on Sumire.',
    )
  })

  it('names open threads', () => {
    expect(sceneContinuityNote({ openThreads: ['forgot her birthday', 'still owes him an apology'] })).toBe(
      'Open threads: forgot her birthday; still owes him an apology.',
    )
  })

  it('combines every known fact into one block, in a fixed order', () => {
    const note = sceneContinuityNote({
      location: 'the rooftop',
      timePhase: 'Friday evening',
      presentNames: ['Yuki'],
      currentActivity: 'a first date',
      openThreads: ['forgot her birthday'],
    })
    expect(note).toBe(
      'Scene: at the rooftop, Friday evening. Also present: Yuki. Currently: a first date. Open threads: forgot her birthday.',
    )
  })
})
