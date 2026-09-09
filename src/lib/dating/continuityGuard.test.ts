import { describe, expect, it } from 'vitest'
import { describeContinuityBreak, detectContinuityBreak, type ContinuityFacts } from './continuityGuard'

const CHAR = 'Sumire'
const USER = 'Kai'

const check = (reply: string, facts: ContinuityFacts = {}) => detectContinuityBreak(reply, facts, CHAR, USER)

const LOCATIONS = ['Bedroom', 'Kitchen', 'Classroom', 'Café']
const PHASES = ['morning', 'afternoon', 'evening', 'night']

describe('detectContinuityBreak — clothing', () => {
  const off: ContinuityFacts = { clothing: { char: ['top'] } }

  it('catches a reply taking off something already off', () => {
    const found = check('She lets him pull her shirt off over her head again.', off)
    expect(found?.kind).toBe('clothing')
    expect(found?.expected).toContain(CHAR)
  })

  it('catches it through a different verb and a different word for the same layer', () => {
    expect(check('He peels her blouse away from her shoulders.', off)?.kind).toBe('clothing')
    expect(check('She tugs her sweater off.', off)?.kind).toBe('clothing')
  })

  it('leaves a layer that is genuinely still on alone', () => {
    expect(check('She slips her skirt off.', off)).toBeUndefined()
  })

  it('leaves a mention with no removal in it alone', () => {
    expect(check('Her shirt is somewhere on the floor by the door.', off)).toBeUndefined()
  })

  it('keeps the two sides apart, and skips a mention whose owner cannot be resolved', () => {
    // "his own" belongs to whoever the sentence's subject is — unresolvable, so never flagged.
    expect(check('He pulls his own shirt off.', off)).toBeUndefined()
    // The player's layer is tracked separately and only flagged against the player's own state.
    expect(check('He pulls your shirt off.', { clothing: { user: ['top'] } })?.kind).toBe('clothing')
    expect(check('He pulls your shirt off.', off)).toBeUndefined()
  })

  it('skips a mention whose owner is ambiguous rather than guessing a side', () => {
    expect(check('A shirt gets pulled off and dropped.', off)).toBeUndefined()
  })

  it('is undefined when no clothing state is tracked yet', () => {
    expect(check('She pulls her shirt off.')).toBeUndefined()
  })
})

describe('detectContinuityBreak — location', () => {
  const here: ContinuityFacts = { location: 'Bedroom', knownLocations: LOCATIONS }

  it('catches the scene being placed somewhere it is not', () => {
    const found = check('They end up in the kitchen, backed against the counter.', here)
    expect(found?.kind).toBe('location')
    expect(found?.expected).toContain('Bedroom')
  })

  it('leaves the current location alone, however it is phrased', () => {
    expect(check('The bedroom is dark enough that she can pretend.', here)).toBeUndefined()
    expect(check('Here in the bedroom, nothing has to be said.', here)).toBeUndefined()
  })

  it('leaves a bare mention with no preposition placing them there alone', () => {
    expect(check('She thinks about the kitchen and the mess she left.', here)).toBeUndefined()
  })

  it('needs a known vocabulary to compare against — an unknown noun is never a break', () => {
    expect(check('They end up in the observatory.', here)).toBeUndefined()
  })
})

describe('detectContinuityBreak — time', () => {
  const atNight: ContinuityFacts = { timePhase: 'night', knownTimePhases: PHASES }

  it('catches a different phase asserted as the present one', () => {
    const found = check('The morning light catches her shoulder.', atNight)
    expect(found?.kind).toBe('time')
    expect(found?.expected).toContain('night')
  })

  it('leaves a reference to another day alone', () => {
    expect(check('She says it again tomorrow morning, probably.', atNight)).toBeUndefined()
    expect(check('This morning she would have said no.', atNight)).toBeUndefined()
    expect(check('He has until morning to decide.', atNight)).toBeUndefined()
  })

  it('leaves the current phase alone', () => {
    expect(check('The night is not going anywhere.', atNight)).toBeUndefined()
  })
})

describe('detectContinuityBreak — ordering and edges', () => {
  it('reports the clothing break first when a reply manages more than one', () => {
    const found = check('He pulls her shirt off in the kitchen.', {
      clothing: { char: ['top'] },
      location: 'Bedroom',
      knownLocations: LOCATIONS,
    })
    expect(found?.kind).toBe('clothing')
  })

  it('is undefined for an empty reply, and for a reply with nothing to check against', () => {
    expect(check('   ', { clothing: { char: ['top'] } })).toBeUndefined()
    expect(check('She laughs at that.')).toBeUndefined()
  })
})

describe('describeContinuityBreak', () => {
  it('quotes the offending phrase and what is true instead', () => {
    const found = check('She lets him pull her shirt off again.', { clothing: { char: ['top'] } })!
    const described = describeContinuityBreak(found)
    expect(described).toContain('shirt')
    expect(described).toContain('already had that off')
  })
})
