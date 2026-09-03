import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { PROMPT_SECTION_LABELS, type PromptSectionId } from '@/lib/prompt/builder'
import { Section } from '@/components/ui/Section'
import { Toggle } from '@/components/ui/Toggle'

const SECTION_DESCRIPTIONS: Record<PromptSectionId, string> = {
  system: 'The character\'s own system prompt, or a generic "stay in character" line if they don\'t have one.',
  summary: 'The running long-term memory summary, once a chat has grown enough to need one.',
  world: 'The bound world\'s description, rules, and current time/weather/mood line.',
  description: 'The character\'s description, personality, scenario, and any authored profile fields (likes, goals, schedule…).',
  participants: 'The roster line for other characters present in a group chat.',
  persona: 'A short "About {{user}}" line built from the active persona\'s description.',
  examples: "The character's example dialogue (mes_example) — useful for voice, costly in tokens.",
}

const SECTION_ORDER: PromptSectionId[] = ['system', 'description', 'world', 'persona', 'participants', 'summary', 'examples']

/**
 * Section 13's instruct-template-manager part (c): `builder.ts`'s fixed prompt sections were all
 * unconditionally on (`includeExamples` existed but nothing ever set it) — this exposes each as a
 * toggle. Reordering isn't exposed here, deliberately — see `builder.ts`'s own note on why several
 * of these are order-coupled to world-info/author-note placement in ways a flat drag-and-drop
 * would silently break.
 */
export function PromptSectionsSection() {
  const promptSections = useSettingsStore((s) => s.promptSections)
  const setPromptSectionEnabled = useSettingsStore((s) => s.setPromptSectionEnabled)

  return (
    <Section
      title="Prompt sections"
      description="What goes into every generation, beyond the conversation itself — turn off anything you don't need to save tokens or simplify the prompt."
      surface="bare"
    >
      <div className="divide-y divide-border rounded-xl bg-bg-elevated px-5">
        {SECTION_ORDER.map((id) => (
          <Toggle
            key={id}
            checked={promptSections[id] ?? true}
            onChange={(v) => setPromptSectionEnabled(id, v)}
            label={PROMPT_SECTION_LABELS[id]}
            description={SECTION_DESCRIPTIONS[id]}
          />
        ))}
      </div>
    </Section>
  )
}
