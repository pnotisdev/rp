// Hard limits and off-limit regions, taken only from what the brief or the character's own boundaries say outright.

import { BODY_REGIONS, type BodyRegion } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS } from '@/lib/dating/kinks'

const words = (id: string) => id.replace(/_/g, '[ _-]')

// shortcut: "never says no to X" reads as a limit on X; that only restricts, and the card shows it, so fix it in the editor.
const AFTER_LIST = String.raw`\b(?:hard limits?|off[- ]limits?)\b[^.;\n]{0,80}?`
const AFTER_REFUSAL = String.raw`\b(?:absolutely (?:no|not)|never (?:do(?:es)?|allows?|wants?|accepts?|tolerates?)|will not (?:do|allow|accept|tolerate)|won'?t (?:do|allow|accept|tolerate)|refuses?|doesn'?t (?:do|allow|accept|tolerate)|no)\b[^.;\n]{0,24}?`
const NO_TOUCH = String.raw`\b(?:no|never|don'?t|doesn'?t|won'?t|not)\b[^.;\n]{0,16}?\b(?:touch\w*|kiss\w*|grab\w*)\b[^.;\n]{0,16}?`

/** What the text names as a hard limit (kinks) or as off limits to touch (regions). Anything it only implies is left out. */
export function statedLimits(source: string): { regions: BodyRegion[]; kinks: string[] } {
  const kink = (id: string) => new RegExp(`(?:${AFTER_LIST}|${AFTER_REFUSAL})\\b${words(id)}\\b`, 'i')
  const region = (id: string) =>
    new RegExp(`${NO_TOUCH}\\b${words(id)}\\b|\\b${words(id)}\\b[^.;\\n]{0,12}?\\boff[- ]limits?\\b|\\boff[- ]limits?\\b\\W{0,4}[^.;\\n]{0,16}?\\b${words(id)}\\b`, 'i')
  return {
    regions: BODY_REGIONS.filter((r) => r !== 'other' && region(r).test(source)),
    kinks: BUILT_IN_KINKS.filter((k) => kink(k).test(source)),
  }
}
