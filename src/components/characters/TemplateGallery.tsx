import type { CharacterCardData } from '@/lib/characters/cardSpec'
import { STARTER_TEMPLATES } from '@/lib/characters/starterTemplates'
import { Modal } from '@/components/ui/Modal'

export function TemplateGallery({
  onChoose,
  onClose,
}: {
  onChoose: (card: CharacterCardData) => void
  onClose: () => void
}) {
  return (
    <Modal
      onClose={onClose}
      title="Start from a template"
      description="A finished card to try right away, or tweak into something new — nothing's locked in."
      size="lg"
    >
      <div className="space-y-3">
        {STARTER_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onChoose(t.card)}
            className="w-full rounded-xl bg-bg-sunken p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="text-sm font-semibold text-text">{t.card.name}</div>
            <div className="mt-0.5 text-xs text-text-muted">{t.blurb}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
