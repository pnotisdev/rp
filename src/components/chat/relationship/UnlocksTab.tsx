import {
  CheckCircle2,
  
  
  
  
  
  ImageIcon,
  KeyRound,
  Lock,
  
  
  
  ShoppingBag,
  Star,
  Flag,
  
  
} from 'lucide-react'
import {
  formatCommitmentStatus,
  
  
  
  
  
  
  
  
} from '@/lib/dating/stage'
import {
  nextLockedInCategory,
  
} from '@/lib/dating/intimacyCatalog'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { INTIMACY_CATEGORY_ICONS } from '@/lib/dating/catalogVisuals'
import { ProgressRow, INTIMACY_CATEGORIES, CustomizeLink } from './helpers'
import type { EditorState } from './useRelationshipPanel'

export function UnlocksTab({ f }: { f: EditorState }) {
  const { chat, world, onNavigateToWorld, track, warmth, flags, toyInventory, upcoming, knownFlags, commitmentStatus, initiatingFirstTime, buyingToyId, pendingActionId, intimacyUnlocked, allowedCategories, canTakeFirstTime, handleUseIntimacyOption, handleBuyToy, handleInitiateFirstTime, nextSpriteUnlock, nextBackgroundUnlock } = f
  return (
    <div className="space-y-3">
      <Section
        title="Scene flags"
        icon={CheckCircle2}
        action={
          <span className="text-[11px] tabular-nums text-text-muted">
            {knownFlags.filter((f) => flags.has(f.id)).length}/{knownFlags.length}
          </span>
        }
        surface="sunken"
        contentClassName="!p-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {/* Earned vs not is the whole point of this list, so it's carried by a glyph as well
              as a tint — a colour difference alone read as decoration rather than progress. */}
          {knownFlags.map((f) => {
            const earned = flags.has(f.id)
            return (
              <span
                key={f.id}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                  earned ? 'bg-romance/15 text-romance' : 'bg-bg-elevated text-text-muted/70'
                }`}
              >
                {earned ? <CheckCircle2 size={11} strokeWidth={2.25} /> : <Lock size={10} strokeWidth={2.25} />}
                {f.label}
              </span>
            )
          })}
        </div>
      </Section>

      <Section
        title="Intimate unlocks"
        icon={KeyRound}
        description="Kissing spots, positions, toys, and other beats this relationship has earned. Click one and the model writes your move into it, adapted to where the scene is, for you to review in the composer before you send."
        surface="sunken"
        contentClassName="!p-3"
      >
        <div className="space-y-1.5">
          {INTIMACY_CATEGORIES.filter((c) => allowedCategories.includes(c.id)).map(({ id, label }) => {
            const items = intimacyUnlocked.filter((i) => i.category === id)
            const next = nextLockedInCategory(id, warmth, commitmentStatus, world)
            const CatIcon = INTIMACY_CATEGORY_ICONS[id] ?? Star
            return (
              <div key={id} className="rounded-lg border border-border bg-bg-elevated px-2.5 py-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                  <CatIcon size={12} strokeWidth={1.75} className="shrink-0 text-romance/70" />
                  {label}
                  {items.length > 0 && <span className="ml-auto tabular-nums">{items.length}</span>}
                </div>
                {items.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((i) => {
                      // An unpriced toy is treated as free/pre-owned; only a priced, not-yet-bought toy needs a purchase step.
                      const needsPurchase = i.category === 'toy' && (i.price ?? 0) > 0 && (toyInventory[i.id] ?? 0) <= 0
                      if (!needsPurchase) {
                        return (
                          <button
                            key={i.id}
                            onClick={() => handleUseIntimacyOption(i)}
                            disabled={!!pendingActionId}
                            title={`${i.label}. The model writes your move into it, adapted to the scene, for you to review`}
                            className="flex items-center gap-1.5 rounded-lg bg-romance/15 px-2 py-1 text-xs text-romance transition-colors first-letter:uppercase hover:bg-romance/25 disabled:opacity-40"
                          >
                            <Star size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                            {pendingActionId === i.id ? 'Writing…' : i.label}
                          </button>
                        )
                      }
                      return (
                        <button
                          key={i.id}
                          onClick={() => handleBuyToy(i.id)}
                          disabled={buyingToyId === i.id || (chat.giftCoins ?? 0) < (i.price ?? 0)}
                          title={`Buy ${i.label} for ${i.price} coins`}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-romance/80 ring-1 ring-romance/35 transition-colors first-letter:uppercase hover:bg-romance/10 disabled:opacity-40"
                        >
                          <ShoppingBag size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                          {buyingToyId === i.id ? 'Buying…' : `${i.label} · ${i.price}◆`}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted/70">Nothing unlocked yet.</div>
                )}
                {next && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                    <Lock size={10} strokeWidth={2.25} className="shrink-0 opacity-70" />
                    <span className="truncate first-letter:uppercase">{next.label}</span>
                    <span className="shrink-0 opacity-70">
                      at {next.minWarmth}
                      {next.minCommitment ? ` · ${formatCommitmentStatus(next.minCommitment)}` : ''}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {(canTakeFirstTime || track.firstIntimateSceneAt) && (
        <Section title="Milestone" icon={Flag} surface="sunken" contentClassName="!p-3">
          {track.firstIntimateSceneAt ? (
            <p className="text-xs text-text-muted">Already happened. Their first time together.</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-muted">Ready to take things all the way, for the first time.</p>
              <Button variant="primary" onClick={handleInitiateFirstTime} disabled={initiatingFirstTime}>
                {initiatingFirstTime ? 'Asking…' : 'First time together'}
              </Button>
            </div>
          )}
        </Section>
      )}

      <Section title="Coming up" icon={ImageIcon} surface="sunken" contentClassName="!p-3">
        <div className="space-y-1 text-xs text-text-muted">
          <ProgressRow icon={Star} label={nextSpriteUnlock ? `Expression: ${nextSpriteUnlock[0]}` : 'No locked expressions'} at={nextSpriteUnlock?.[1]} />
          <ProgressRow icon={ImageIcon} label={nextBackgroundUnlock ? `Background: ${nextBackgroundUnlock[0]}` : 'No locked backgrounds'} at={nextBackgroundUnlock?.[1]} />
          {upcoming.slice(0, 4).map((g) => (
            <ProgressRow
              key={g.id}
              icon={ImageIcon}
              label={`Gallery: ${g.title}${g.missingFlags.length > 0 ? ` · needs ${g.missingFlags.join(', ')}` : ''}`}
              at={g.missingAffection > 0 ? `+${g.missingAffection}` : undefined}
            />
          ))}
          {upcoming.length === 0 && <div>Everything unlocked for this character.</div>}
        </div>
      </Section>

      <div className="flex justify-end">
        <CustomizeLink world={world} onNavigateToWorld={onNavigateToWorld} />
      </div>
    </div>
  )
}
