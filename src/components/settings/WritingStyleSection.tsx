import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { RegexScript } from '@/lib/types'
import { Section } from '@/components/ui/Section'
import { TextAreaField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'

/** Stable id for the regex rule `avoidEmDashes` manages, so toggling it on/off never fights a
 *  user's own rule that happens to also target em dashes. */
const EM_DASH_SCRIPT_ID = 'builtin-avoid-em-dash'

const STARTER_STYLE_NOTES =
  "Write like a person, not like an AI assistant. Avoid telltale AI phrasing: \"it's not just X, it's Y\", " +
  'rule-of-three lists, excessive parallelism, hedging words like "perhaps" or "arguably", and overwrought ' +
  'or purple prose. Vary sentence length. Prefer plain, concrete language over grand abstractions.'

export function WritingStyleSection() {
  const avoidEmDashes = useSettingsStore((s) => s.avoidEmDashes)
  const setAvoidEmDashes = useSettingsStore((s) => s.setAvoidEmDashes)
  const styleGuidance = useSettingsStore((s) => s.styleGuidance)
  const setStyleGuidance = useSettingsStore((s) => s.setStyleGuidance)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const setRegexScripts = useSettingsStore((s) => s.setRegexScripts)

  // Belt and suspenders: the toggle also steers the prompt (see useChatSession's styleGuidance),
  // but a model won't always follow a style instruction perfectly, so this also keeps a managed
  // regex rule in sync that strips any em dash that slips through anyway — applied to both what's
  // displayed and what's fed back into future prompts, so one slip doesn't compound over the chat.
  const toggleAvoidEmDashes = (v: boolean) => {
    setAvoidEmDashes(v)
    const withoutManaged = regexScripts.filter((s) => s.id !== EM_DASH_SCRIPT_ID)
    if (v) {
      const managed: RegexScript = {
        id: EM_DASH_SCRIPT_ID,
        name: 'Avoid em dashes (managed)',
        find: '\\s*—\\s*',
        replace: ', ',
        target: 'both',
        enabled: true,
      }
      setRegexScripts([...withoutManaged, managed])
    } else {
      setRegexScripts(withoutManaged)
    }
  }

  return (
    <Section
      title="Writing style"
      description="Steers every reply's prose, on top of whatever this character's own voice already is. Injected right before generation, the same slot as an active objective or relationship nudge — the closer to generation an instruction sits, the more reliably a model actually follows it."
      surface="bare"
    >
      <Toggle
        checked={avoidEmDashes}
        onChange={toggleAvoidEmDashes}
        label="Avoid em dashes"
        description="Steers the model away from them, and also strips any that slip through via a managed regex rule (Settings → Generation → Regex scripts)"
      />
      <TextAreaField
        label="Additional style notes"
        hint="Freeform, applies to every chat. Keep it short — a long block competes with the character's own voice for attention."
        rows={3}
        value={styleGuidance}
        onChange={(e) => setStyleGuidance(e.target.value)}
        actions={
          <Button variant="ghost" onClick={() => setStyleGuidance(STARTER_STYLE_NOTES)}>
            Use suggested starter
          </Button>
        }
      />
    </Section>
  )
}
