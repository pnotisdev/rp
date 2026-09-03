import type { GiftItem, ItemDef } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface BagPanelProps {
  giftCatalog: GiftItem[]
  giftInventory: Record<string, number>
  itemCatalog: ItemDef[]
  itemInventory: Record<string, number>
  characterName: string
  onClose: () => void
  onGive: (gift: GiftItem) => void
  onUseItem: (item: ItemDef) => void
}

function effectSummary(item: ItemDef): string {
  const e = item.effect
  if (e.kind === 'currency') return `+${e.amount} coins`
  if (e.kind === 'flag') return `sets "${e.flag.replace('_', ' ')}"`
  return `${e.amount > 0 ? '+' : ''}${e.amount} ${e.dimension}`
}

/**
 * 10d's "Bag/inventory view" — distinct from the shops in `RelationshipPanel` (buying), this is
 * for using what you already own. Gifts here were previously only ever given through an AI
 * choice card, with no manual "give this now" control at all; giving still lands through the
 * exact same `sendUserMessage` gift-choice path a suggested choice uses. Items are a separate,
 * simpler case — an authored effect (10d's item catalog) applied immediately and deterministically,
 * no in-scene reaction needed, so "Use" doesn't touch the chat at all.
 */
export function BagPanel({
  giftCatalog,
  giftInventory,
  itemCatalog,
  itemInventory,
  characterName,
  onClose,
  onGive,
  onUseItem,
}: BagPanelProps) {
  const ownedGifts = giftCatalog.filter((g) => (giftInventory[g.id] ?? 0) > 0)
  const ownedItems = itemCatalog.filter((i) => (itemInventory[i.id] ?? 0) > 0)

  return (
    <Modal onClose={onClose} title="Bag" size="lg" scrollable>
        <p className="mb-3 text-xs text-text-muted">
          Gifts you already own — give one to {characterName} now, in person. Buy more from the relationship panel.
        </p>
        <div className="space-y-2 overflow-y-auto">
          {ownedGifts.map((gift) => (
            <div key={gift.id} className="flex items-center justify-between rounded-xl bg-bg-sunken p-3">
              <div>
                <div className="text-sm text-text">{gift.name}</div>
                <div className="text-xs text-text-muted">
                  {gift.rarity} • owned {giftInventory[gift.id]}
                </div>
              </div>
              <Button variant="primary" onClick={() => onGive(gift)}>
                Give
              </Button>
            </div>
          ))}
          {ownedGifts.length === 0 && (
            <div className="rounded-xl bg-bg-sunken p-4 text-xs text-text-muted">
              Nothing in your bag yet — buy a gift from the relationship panel first.
            </div>
          )}
        </div>

        {itemCatalog.length > 0 && (
          <>
            <p className="mt-5 mb-3 text-xs text-text-muted">
              Items — used on the spot for their effect, not given in a scene.
            </p>
            <div className="space-y-2 overflow-y-auto">
              {ownedItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl bg-bg-sunken p-3">
                  <div>
                    <div className="text-sm text-text">{item.name}</div>
                    <div className="text-xs text-text-muted">
                      {item.rarity} • owned {itemInventory[item.id]} • {effectSummary(item)}
                    </div>
                  </div>
                  <Button variant="primary" onClick={() => onUseItem(item)}>
                    Use
                  </Button>
                </div>
              ))}
              {ownedItems.length === 0 && (
                <div className="rounded-xl bg-bg-sunken p-4 text-xs text-text-muted">
                  No items owned yet — buy one from the relationship panel first.
                </div>
              )}
            </div>
          </>
        )}
    </Modal>
  )
}
