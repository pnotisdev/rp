import { WORLD_TEMPLATES, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'

export function WorldTemplateGallery({
  onChoose,
  onClose,
}: {
  onChoose: (template: WorldTemplateId) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <h2 className="mb-1 text-sm font-semibold text-text">Start a new world</h2>
        <p className="mb-4 text-xs text-text-muted">
          Picks a sensible starting point — which editor tabs show up, and a nudge for the rules field.
          Nothing here is locked in; change it any time from the world's Overview tab.
        </p>
        <div className="space-y-3">
          {WORLD_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onChoose(t.id)}
              className="w-full rounded-xl bg-bg-sunken p-4 text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="text-sm font-semibold text-text">{t.label}</div>
              <div className="text-xs text-text-muted">{t.blurb}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
