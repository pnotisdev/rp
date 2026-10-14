import { useRef } from 'react'
import { FilePlus2, LayoutTemplate, Sparkles, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'

export type NewCharacterStart = 'blank' | 'template' | 'generate'

function Option({ icon: Icon, title, hint, onClick }: { icon: LucideIcon; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-bg-sunken"
    >
      <Icon size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-text-muted" />
      <span>
        <span className="block text-[13px] font-medium text-text">{title}</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
    </button>
  )
}

/** The four ways to make a character. Importing opens the file picker; the rest open the editor. */
export function NewCharacterDialog({ onClose, onStart, onImport }: { onClose: () => void; onStart: (start: NewCharacterStart) => void; onImport: (files: File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <Modal onClose={onClose} title="New character" size="md">
      <div className="space-y-2">
        <Option icon={FilePlus2} title="Blank" hint="Write the card yourself." onClick={() => onStart('blank')} />
        <Option icon={LayoutTemplate} title="From a template" hint="Start from a ready-made archetype." onClick={() => onStart('template')} />
        <Option icon={Sparkles} title="Generate with AI" hint="Describe them and let the model draft the card." onClick={() => onStart('generate')} />
        <Option icon={Upload} title="Import cards" hint="PNG or JSON cards from SillyTavern and others, or an rp pack. Pick several at once." onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".png,.json"
          className="hidden"
          onChange={(e) => e.target.files?.length && onImport(Array.from(e.target.files))}
        />
      </div>
    </Modal>
  )
}
