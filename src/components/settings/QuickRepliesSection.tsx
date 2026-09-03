import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { newId } from '@/lib/id'
import type { QuickReply } from '@/lib/types'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import { TextField } from '@/components/ui/Field'

export function QuickRepliesSection() {
  const replies = useSettingsStore((s) => s.quickReplies)
  const setReplies = useSettingsStore((s) => s.setQuickReplies)

  const update = (id: string, patch: Partial<QuickReply>) =>
    setReplies(replies.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = () => setReplies([...replies, { id: newId(), label: 'New button', message: '' }])
  const remove = (id: string) => setReplies(replies.filter((r) => r.id !== id))

  return (
    <Section
      title="Quick replies"
      description="A fixed row of buttons above the composer, in every chat. Clicking one sends its message immediately, exactly as if you'd typed and sent it yourself — handy for narrative beats you reach for often, like skipping ahead or describing your surroundings."
      surface="bare"
    >
      <ListEditor
        items={replies}
        getKey={(r) => r.id}
        onAdd={add}
        onRemove={(r) => remove(r.id)}
        addLabel="Add quick reply"
        emptyHint="No quick replies configured. Add one to give yourself a one-click button for a line you send often."
        renderItem={(reply) => (
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[160px_1fr]">
            <TextField
              label="Button label"
              value={reply.label}
              onChange={(e) => update(reply.id, { label: e.target.value })}
              placeholder="Look around"
            />
            <TextField
              label="Message sent"
              value={reply.message}
              onChange={(e) => update(reply.id, { message: e.target.value })}
              placeholder="*takes a moment to look around*"
            />
          </div>
        )}
      />
    </Section>
  )
}
