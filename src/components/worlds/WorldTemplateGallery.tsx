import { WORLD_TEMPLATES, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Modal } from '@/components/ui/Modal'

export function WorldTemplateGallery({
  onChoose,
  onClose,
}: {
  onChoose: (template: WorldTemplateId) => void
  onClose: () => void
}) {
  return (
    <Modal
      onClose={onClose}
      title="Start a new world"
      description="Picks a sensible starting point — which editor tabs show up, and a nudge for the rules field. Nothing here is locked in; change it any time from the world's Overview tab."
      size="lg"
    >
      <div className="space-y-3">
        {WORLD_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onChoose(t.id)}
            className="w-full rounded-xl bg-bg-sunken p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="text-sm font-semibold text-text">{t.label}</div>
            <div className="mt-0.5 text-xs text-text-muted">{t.blurb}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
