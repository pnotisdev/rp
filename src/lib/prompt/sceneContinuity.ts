// A short, always-computed ledger of concrete scene facts — location, time, who's present, what's
// currently happening, and open threads — in one compact block, instead of the same facts being
// scattered thinly across several separate styleGuidance lines. Resolves to '' (contributes
// nothing) when none of the facts are actually known, same as every other optional guidance line.

export interface SceneContinuityFacts {
  location?: string
  /** A short "{weekday} {phase}" phrase, e.g. "Sunday night" — not the full weather/holiday paragraph, which reaches the prompt separately. */
  timePhase?: string
  /** Everyone else actually present in the scene, by name — empty for an ordinary one-on-one chat. */
  presentNames?: string[]
  /** What's physically happening right now, if anything specific is tracked (an intimacy scene, a live date/hangout). */
  currentActivity?: string
  /** Unresolved facts the story hasn't closed yet. */
  openThreads?: string[]
}

export function sceneContinuityNote(facts: SceneContinuityFacts): string {
  const whereWhen = [facts.location ? `at ${facts.location}` : '', facts.timePhase ?? ''].filter(Boolean).join(', ')
  const lines = [
    whereWhen ? `Scene: ${whereWhen}.` : '',
    facts.presentNames?.length ? `Also present: ${facts.presentNames.join(', ')}.` : '',
    facts.currentActivity ? `Currently: ${facts.currentActivity}.` : '',
    facts.openThreads?.length ? `Open threads: ${facts.openThreads.join('; ')}.` : '',
  ].filter(Boolean)
  return lines.join(' ')
}
