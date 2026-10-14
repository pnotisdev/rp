import { Section } from '@/components/ui/Section'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'
import type { EditorState } from './useWorldEditor'

export function LoreTab({ f }: { f: EditorState }) {
  const { name, description, rules, lorebook, setLorebook } = f
  return (
    <Section
      title="World lore"
      description="Keyword- or always-on entries about this setting, shared by every character living here."
      surface="bare"
    >
      <LorebookEditor
        book={lorebook}
        onChange={setLorebook}
        aiContext={{ name, description, extra: rules ? `World rules: ${rules}` : undefined }}
      />
    </Section>
  )
}
