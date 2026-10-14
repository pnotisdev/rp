import {
  Cake,
  
  
  
  Gift,
  Heart,
  
  
  
  
  Package,
  
  Shirt,
  
  
  
  Wand2,
  
} from 'lucide-react'
import { giftTasteLabel } from '@/lib/dating/gifts'
import { itemEffectSummary } from '@/lib/dating/items'
import {
  formatCommitmentStatus,
  
  
  
  
  
  
  
  
} from '@/lib/dating/stage'
import { daysUntilAnnualDate } from '@/lib/world/calendar'
import { Section } from '@/components/ui/Section'
import { CatalogAction, CatalogCard } from '@/components/ui/CatalogCard'
import { catalogIcon } from '@/lib/dating/catalogVisuals'
import { CustomizeLink } from './helpers'
import type { EditorState } from './useRelationshipPanel'

export function ShopTab({ f }: { f: EditorState }) {
  const { chat, world, onBuyGift, onBuyItem, onNavigateToWorld, viewingCharacter, track, inventory, itemInventory, toyInventory, giftCatalog, itemCatalog, buyingToyId, toyCatalogAll, unlockedToyIds, allowedCategories, buyingOutfitId, handleBuyOutfit, handleBuyToy, outfitsForSale } = f
  return (
    <div className="space-y-4">
      {viewingCharacter?.birthday !== undefined &&
        world &&
        daysUntilAnnualDate(world.currentDay ?? 0, viewingCharacter.birthday) === 0 && (
          <div className="flex items-center gap-2.5 rounded-xl bg-romance/10 px-3 py-2.5 text-sm text-romance">
            <Cake size={16} strokeWidth={1.75} className="shrink-0" />
            <span>
              It's {viewingCharacter.card.name}'s birthday today — a gift lands far harder than usual.
            </span>
          </div>
        )}
      <Section
        title="Gifts"
        description={`Given in person, in the scene. ${viewingCharacter?.card.name ?? 'They'} reacts to what you pick.`}
        icon={Gift}
        surface="sunken"
        contentClassName="!p-3"
      >
        <div className="space-y-1.5">
          {giftCatalog.map((gift) => {
            const qty = inventory[gift.id] ?? 0
            // Progressive taste reveal: only once this exact gift has actually been given at
            // least once — the shop never spoils an authored preference up front.
            const discovered = (track.giftsGiven?.[gift.id] ?? 0) > 0
            const tasteLabel = discovered ? giftTasteLabel(viewingCharacter?.card.name ?? '', viewingCharacter?.giftPreferences?.[gift.id] ?? 0) : ''
            return (
              <CatalogCard
                key={gift.id}
                icon={catalogIcon(gift.tags)}
                name={gift.name}
                tone={gift.rarity}
                owned={qty}
                meta={gift.rarity === 'common' ? gift.tags.join(', ') : `${gift.rarity} · ${gift.tags.join(', ')}`}
                note={tasteLabel || undefined}
                action={
                  <CatalogAction
                    label="Buy"
                    price={gift.price}
                    onClick={() => onBuyGift(gift.id)}
                    disabled={(chat.giftCoins ?? 0) < gift.price}
                  />
                }
              />
            )
          })}
        </div>
      </Section>

      {itemCatalog.length > 0 && (
        <Section
          title="Items"
          icon={Package}
          description="Bought here, used from the Bag for an immediate effect."
          surface="sunken"
          contentClassName="!p-3"
        >
          <div className="space-y-1.5">
            {itemCatalog.map((item) => (
              <CatalogCard
                key={item.id}
                icon={catalogIcon(item.tags, Package)}
                name={item.name}
                tone={item.rarity}
                owned={itemInventory[item.id] ?? 0}
                meta={itemEffectSummary(item)}
                action={
                  // A zero-price item is a job, not a purchase (`part-time-shift` pays coins
                  // *in*) — "Buy 0 ◆" reads as a bug, so it gets a free action's treatment.
                  <CatalogAction
                    label={item.price > 0 ? 'Buy' : 'Take'}
                    price={item.price > 0 ? item.price : undefined}
                    onClick={() => onBuyItem(item.id)}
                    disabled={(chat.giftCoins ?? 0) < item.price}
                  />
                }
              />
            ))}
          </div>
        </Section>
      )}

      {outfitsForSale.length > 0 && (
        <Section
          title="Wardrobe"
          icon={Shirt}
          description={`Outfits ${viewingCharacter?.card.name ?? 'they'} can wear once you've bought them. Changes what you actually see on the scene, not just what the story says.`}
          surface="sunken"
          contentClassName="!p-3"
        >
          <div className="space-y-1.5">
            {outfitsForSale.map(({ outfit, price, owned, warmthShort, missingFlags }) => (
              <CatalogCard
                key={outfit.id}
                icon={Shirt}
                name={outfit.label}
                tone="intimate"
                locked={!owned && (warmthShort || missingFlags.length > 0)}
                owned={owned ? 1 : 0}
                meta={
                  owned
                    ? warmthShort
                      ? `Bought — shows at ${outfit.unlockAffection} warmth`
                      : missingFlags.length > 0
                        ? `Bought — still needs ${missingFlags.join(', ').replace(/_/g, ' ')}`
                        : 'Hers to wear'
                    : warmthShort
                      ? `Needs ${outfit.unlockAffection} warmth`
                      : missingFlags.length > 0
                        ? `Needs ${missingFlags.join(', ').replace(/_/g, ' ')}`
                        : 'Available now'
                }
                action={
                  owned ? undefined : (
                    <CatalogAction
                      label={buyingOutfitId === outfit.id ? 'Buying…' : 'Buy'}
                      price={price}
                      tone="romance"
                      onClick={() => handleBuyOutfit(outfit.id)}
                      disabled={buyingOutfitId === outfit.id || (chat.giftCoins ?? 0) < price}
                    />
                  )
                }
              />
            ))}
          </div>
        </Section>
      )}

      {allowedCategories.includes('toy') && toyCatalogAll.length > 0 && (
        <Section
          title="Toys"
          icon={Wand2}
          description="Warmth and commitment decide which of these are buyable. Also reachable from Unlocks once one is eligible."
          surface="sunken"
          contentClassName="!p-3"
        >
          <div className="space-y-1.5">
            {toyCatalogAll.map((toy) => {
              const owned = (toyInventory[toy.id] ?? 0) > 0
              const eligible = unlockedToyIds.has(toy.id)
              const price = toy.price ?? 0
              return (
                <CatalogCard
                  key={toy.id}
                  icon={Heart}
                  name={toy.label}
                  tone="intimate"
                  locked={!eligible}
                  owned={owned ? 1 : 0}
                  meta={
                    eligible
                      ? owned
                        ? 'Yours — use it from Unlocks'
                        : price > 0
                          ? 'Available now'
                          : 'Free'
                      : `Unlocks at ${toy.minWarmth} warmth${toy.minCommitment ? ` and ${formatCommitmentStatus(toy.minCommitment)}` : ''}`
                  }
                  action={
                    owned ? undefined : (
                      <CatalogAction
                        label={buyingToyId === toy.id ? 'Buying…' : 'Buy'}
                        price={price > 0 ? price : undefined}
                        tone="romance"
                        onClick={() => handleBuyToy(toy.id)}
                        disabled={!eligible || buyingToyId === toy.id || (chat.giftCoins ?? 0) < price}
                      />
                    )
                  }
                />
              )
            })}
          </div>
        </Section>
      )}

      <div className="flex justify-end">
        <CustomizeLink world={world} onNavigateToWorld={onNavigateToWorld} />
      </div>
    </div>
  )
}
