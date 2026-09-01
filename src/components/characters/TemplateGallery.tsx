import type { CharacterCardData } from '@/lib/characters/cardSpec'
import { STARTER_TEMPLATES } from '@/lib/characters/starterTemplates'
import { Button } from '@/components/ui/Button'

export function TemplateGallery({
  onChoose,
  onClose,
}: {
  onChoose: (card: CharacterCardData) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-elevated p-7 themed-shadow">
        <h2 className="mb-1 text-sm font-semibold text-text">Start from a template</h2>
        <p className="mb-4 text-xs text-text-muted">
          A finished card to try right away, or tweak into something new — nothing's locked in.
        </p>
        <div className="space-y-3">
          {STARTER_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onChoose(t.card)}
              className="w-full rounded-xl bg-bg-sunken p-4 text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="text-sm font-semibold text-text">{t.card.name}</div>
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
