import { describe, expect, it } from 'vitest'
import {
  advanceIntimacyScene,
  arousalOf,
  resolveIntimacyChoice,
  sceneResolveSnapshot,
  startOrShiftIntimacyScene,
  stageOf,
  type IntimacyScene,
  parseIntimacyObservation,
  type IntimacySceneContext,
  type IntimacyTurnObservation,
} from './intimacyScene'
import { BRANCHING_SCENARIO } from './scenarios'
import { CHOICE_DEFAULT_AFTER_TURNS, RESOLVE_STAGE } from './intimacyStages'
import { detectContinuityBreak } from './continuityGuard'
import { sceneStateBlock } from '@/lib/prompt/sceneStateBlock'

// End-to-end validation of the whole engine running together, as opposed to each module's own unit
// tests: one scene played turn by turn from the click that starts it to the choice that ends it, on
// the real branching scenario, with the real meter, the real floors, and the real graph. What this
// catches that the unit tests can't is the integration — a floor that is individually correct but
// unreachable in practice, a branch that never actually gets raised in a real run, a scenario whose
// arousal gates can't be cleared by the activity weights the catalog really ships.

/** A committed, escalating turn — the shape of a scene actually going somewhere. */
const pushing = (regions: IntimacyTurnObservation['regionsTouched'] = ['lips']): IntimacyTurnObservation => ({
  engagement: 'engaged',
  intensityDelta: 1,
  hesitationSignalled: false,
  stageCompleteSignalled: false,
  regionsTouched: regions,
  clothingRemoved: [],
})

/** An ordinary, established pairing — nothing about the character is doing the work in these runs. */
const ctx: IntimacySceneContext = {
  graph: BRANCHING_SCENARIO,
  pace: 'neutral',
  comfort: 70,
  chemistry: 70,
  relationship: { stats: {}, flags: [], commitment: 'dating', day: 40, firedTriggerIds: [] } as never,
}

/** A scene being played: turns advance the counter the same way a real session's reply count does. */
class Run {
  scene: IntimacyScene | null
  turn: number

  constructor(activityWeight = 6) {
    this.turn = 0
    this.scene = startOrShiftIntimacyScene('kissing her neck', 'kissing_spot', 0, null, activityWeight, BRANCHING_SCENARIO, 1)
  }

  /** Plays `count` turns, stopping early if the scene resolves. */
  play(count: number, obs: IntimacyTurnObservation = pushing()): this {
    for (let i = 0; i < count && this.scene; i += 1) {
      this.turn += 1
      this.scene = advanceIntimacyScene(this.scene, obs, this.turn, ctx)
    }
    return this
  }

  /** Answers an open branch by label, the way the panel's button does. */
  choose(label: string): this {
    const option = this.scene?.pendingChoice?.options.find((o) => o.label === label)
    expect(option, `no option labelled "${label}"`).toBeTruthy()
    this.scene = resolveIntimacyChoice(this.scene!, option!.edgeTo, this.turn, BRANCHING_SCENARIO)
    return this
  }

  get stageId(): string | undefined {
    return this.scene?.stageId
  }

  get arousal(): number {
    return this.scene ? arousalOf(this.scene).value : 0
  }

  /** Plays until a branch is open, or fails after `cap` turns — proves a gate is actually reachable. */
  playToChoice(cap = 20, obs: IntimacyTurnObservation = pushing()): this {
    for (let i = 0; i < cap && this.scene && !this.scene.pendingChoice; i += 1) this.play(1, obs)
    expect(this.scene?.pendingChoice, `no branch raised within ${cap} turns`).toBeTruthy()
    return this
  }
}

describe('a full playthrough of the branching scenario', () => {
  it('holds the opening stage for its own turn floor before raising the first branch', () => {
    const run = new Run().play(2)
    expect(run.stageId).toBe('foreplay')
    expect(run.scene?.pendingChoice).toBeUndefined()
  })

  it('raises the first branch once the floor and the arousal gate are both actually clear', () => {
    const run = new Run().playToChoice()
    expect(run.stageId).toBe('foreplay')
    expect(run.scene?.pendingChoice?.options.map((o) => o.label)).toEqual([
      'Take it slower, with your mouth',
      'Move straight on',
    ])
  })

  it('runs the long branch end to end: foreplay, oral, together, finish, resolved', () => {
    const run = new Run().playToChoice().choose('Take it slower, with your mouth')
    expect(run.stageId).toBe('oral')
    expect(run.scene?.phase).toBe('peak')

    // Each of these stages exits on an auto edge, so the scene walks itself forward from here — and
    // stops on its own at the next thing that isn't the engine's to decide.
    run.playToChoice(20, pushing(['genitals']))
    expect(run.scene?.visitedStages).toEqual(['foreplay', 'oral', 'together', 'finish'])

    // The end is a branch too — the model never gets to decide how a scene finishes.
    expect(run.scene?.pendingChoice?.options.map((o) => o.label)).toEqual([
      'Finish together, inside',
      'Pull out first',
      'Not yet — draw it out',
    ])
    run.choose('Pull out first')
    expect(run.scene).toBeNull()
  })

  it('runs the short branch too, skipping the middle stage the player declined', () => {
    const run = new Run().playToChoice().choose('Move straight on')
    expect(run.stageId).toBe('together')
    run.playToChoice(20, pushing(['genitals']))
    expect(run.scene?.visitedStages).toEqual(['foreplay', 'together', 'finish'])
    expect(run.scene?.visitedStages).not.toContain('oral')
  })

  it("lets the closing branch send the scene back for more rather than only ending it", () => {
    const run = new Run().playToChoice().choose('Move straight on').playToChoice(20, pushing(['genitals']))
    run.choose('Not yet — draw it out')
    expect(run.stageId).toBe('together')
    expect(run.scene?.pendingChoice).toBeUndefined()
  })

  it('never ends the scene on a completion vote when the author made the ending a choice', () => {
    // Every single turn claims the scene just finished. Since this scenario's only resolve edges are
    // `choice`-mode, none of those votes may end anything — the scene has to arrive at the closing
    // branch and wait there, because how it ends is the player's decision and carries consequences.
    const finishing = { ...pushing(['genitals']), stageCompleteSignalled: true }
    const run = new Run()
    run.play(1, finishing)
    while (run.scene && !run.scene.pendingChoice) run.play(1, finishing)
    expect(run.scene, 'a vote must not end a scene whose ending the author gated').toBeTruthy()

    // It stops at the first branch; answer that and it must still stop again at the closing one.
    run.choose('Move straight on')
    while (run.scene && !run.scene.pendingChoice) run.play(1, finishing)
    expect(run.scene, 'a vote must not cross the closing branch either').toBeTruthy()
    expect(run.stageId).toBe('finish')
    expect(run.scene?.pendingChoice?.options).toHaveLength(3)
  })

  it("fires a closing branch's own default rather than re-asking the same question forever", () => {
    const run = new Run().playToChoice().choose('Move straight on').playToChoice(20, pushing(['genitals']))
    expect(run.scene?.pendingChoice?.defaultEdgeTo).toBe(RESOLVE_STAGE)
    // Nobody answers. The authored default ends the scene, instead of the branch being cleared and
    // raised again on a loop the player can never time out of.
    run.play(CHOICE_DEFAULT_AFTER_TURNS + 1, pushing(['genitals']))
    expect(run.scene).toBeNull()
  })

  it('takes a real number of turns to get through — a scene cannot be rushed to its end', () => {
    const run = new Run().playToChoice().choose('Move straight on').playToChoice(20, pushing(['genitals']))
    // Three engaged turns of foreplay, three of penetrative, and the closing stage's own beat, minimum.
    expect(run.turn).toBeGreaterThanOrEqual(7)
    expect(run.arousal).toBeGreaterThanOrEqual(78)
  })

  it('cannot cross a branch while it is open, however many turns are played into it', () => {
    const run = new Run().playToChoice()
    const stageAtBranch = run.stageId
    run.play(2)
    expect(run.stageId).toBe(stageAtBranch)
  })

  it('falls through to the authored default rather than stranding a player who never answered', () => {
    const run = new Run().playToChoice()
    expect(run.scene?.pendingChoice?.defaultEdgeTo).toBe('together')
    run.play(4)
    expect(run.stageId).toBe('together')
    expect(run.scene?.pendingChoice).toBeUndefined()
  })

  it('hands aftercare a snapshot that reflects the whole scene, not just its last stage', () => {
    const run = new Run().playToChoice().choose('Take it slower, with your mouth').playToChoice(20, pushing(['genitals']))
    const snapshot = sceneResolveSnapshot(run.scene!, run.turn)
    expect(snapshot.stages).toBe(4)
    expect(snapshot.turns).toBe(run.turn)
    expect(snapshot.arousal).toBeGreaterThanOrEqual(78)
  })

  it('stalls out instead of climbing when the replies stop going anywhere', () => {
    const stalling: IntimacyTurnObservation = { ...pushing([]), engagement: 'stalled', intensityDelta: 0 }
    const run = new Run().play(6, stalling)
    expect(run.stageId).toBe('foreplay')
    expect(run.arousal).toBe(0)
  })

  it('never routes a scene off its own graph — every stage it lands on is one the scenario declares', () => {
    const known = new Set([...BRANCHING_SCENARIO.stages.map((s) => s.id), RESOLVE_STAGE])
    const run = new Run()
    for (let i = 0; i < 30 && run.scene; i += 1) {
      run.play(1, pushing(['genitals']))
      if (run.scene?.pendingChoice) run.choose(run.scene.pendingChoice.options[0].label)
      if (run.scene) expect(known.has(stageOf(run.scene, BRANCHING_SCENARIO).id)).toBe(true)
    }
  })
})

describe('the state block and the continuity check, over a played scene', () => {
  // Built the way a real turn builds it — through the parser, from a raw judge payload — so the
  // layer vocabulary is enforced here rather than assumed.
  const undressing = parseIntimacyObservation({
    ...pushing(['chest']),
    clothingRemoved: [
      { who: 'char', layer: 'top' },
      // Not a layer, a garment word. The parser drops it rather than inventing a sixth layer.
      { who: 'char', layer: 'bra' },
    ],
  })!

  it('states back exactly what the engine tracked, and nothing it did not', () => {
    const run = new Run().play(2, undressing)
    const block = sceneStateBlock({
      charName: 'Sumire',
      userName: 'You',
      location: 'Bedroom',
      timePhase: 'Sunday night',
      day: 34,
      activity: run.scene!.activityLabel,
      sceneTurns: run.turn,
      clothing: run.scene!.clothing,
      contactRegions: run.scene!.contactRegions,
      arousalBand: 'warming',
    })
    expect(block).toContain('Location: Bedroom, Sunday night, Day 34')
    expect(block).toContain('top off')
    expect(block).toContain('In contact: chest')
    // The judge's unknown 'bra' layer was dropped rather than guessed into the ledger.
    expect(block).not.toContain('bra')
  })

  it('catches a reply undressing something the played scene already took off', () => {
    const run = new Run().play(2, undressing)
    const found = detectContinuityBreak(
      'She pulls her shirt off again, breath catching.',
      { clothing: run.scene!.clothing },
      'Sumire',
      'You',
    )
    expect(found?.kind).toBe('clothing')
    expect(found?.expected).toContain('Sumire')
  })

  it('leaves a reply that stays inside the tracked state alone', () => {
    const run = new Run().play(2, undressing)
    const found = detectContinuityBreak(
      'Her hand slides up your back, nails catching.',
      { clothing: run.scene!.clothing },
      'Sumire',
      'You',
    )
    expect(found).toBeUndefined()
  })
})
