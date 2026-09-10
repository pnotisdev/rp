import { Backpack, Package } from 'lucide-react'
import type { GiftItem, ItemDef } from '@/lib/types'
import { catalogIcon } from '@/lib/dating/catalogVisuals'
import { itemEffectSummary } from '@/lib/dating/items'
import { CatalogAction, CatalogCard } from '@/components/ui/CatalogCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Section } from '@/components/ui/Section'

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

/**
 * 10d's "Bag/inventory view" — distinct from the shops in `RelationshipPanel` (buying), this is
 * for using what you already own. Gifts here were previously only ever given through an AI
 * choice card, with no manual "give this now" control at all; giving still lands through the
 * exact same `sendUserMessage` gift-choice path a suggested choice uses. Items are a separate,
 * simpler case — an authored effect (10d's item catalog) applied immediately and deterministically,
 * no in-scene reaction needed, so "Use" doesn't touch the chat at all.
 *
 * Shares `CatalogCard` with the shop, so an item looks the same wherever you meet it.
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
  const empty = ownedGifts.length === 0 && ownedItems.length === 0

  return (
    <Modal
      onClose={onClose}
      title="Bag"
      description={`What you're carrying. Give ${characterName} a gift in person, or use an item on the spot.`}
      size="lg"
      scrollable
    >
      <div className="flex-1 space-y-5 overflow-y-auto">
        {empty && (
          <EmptyState>
            <span className="mb-2 flex justify-center text-text-muted">
              <Backpack size={22} strokeWidth={1.5} />
            </span>
            Nothing in your bag yet. Buy a gift or an item from the Relationship panel's Shop tab first.
          </EmptyState>
        )}

        {ownedGifts.length > 0 && (
          <Section title="Gifts" description={`Handed over in the scene — ${characterName} reacts.`} surface="bare">
            <div className="space-y-2">
              {ownedGifts.map((gift) => (
                <CatalogCard
                  key={gift.id}
                  icon={catalogIcon(gift.tags)}
                  name={gift.name}
                  tone={gift.rarity}
                  owned={giftInventory[gift.id]}
                  meta={gift.rarity === 'common' ? gift.tags.join(', ') : `${gift.rarity} · ${gift.tags.join(', ')}`}
                  action={<CatalogAction label="Give" tone="romance" onClick={() => onGive(gift)} />}
                />
              ))}
            </div>
          </Section>
        )}

        {ownedItems.length > 0 && (
          <Section title="Items" description="Used on the spot for their effect, not given in a scene." surface="bare">
            <div className="space-y-2">
              {ownedItems.map((item) => (
                <CatalogCard
                  key={item.id}
                  icon={catalogIcon(item.tags, Package)}
                  name={item.name}
                  tone={item.rarity}
                  owned={itemInventory[item.id]}
                  meta={itemEffectSummary(item)}
                  action={<CatalogAction label="Use" onClick={() => onUseItem(item)} />}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </Modal>
  )
}
