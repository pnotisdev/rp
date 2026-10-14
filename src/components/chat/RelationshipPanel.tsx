import {
  Heart,
  
  
  
  
  
  
  
  
  
  
  
  
} from 'lucide-react'
import {
  formatRelationshipStage,
  
  
  
  
  
  
  
} from '@/lib/dating/stage'
import { describeInitiativeBalance, describeMomentum } from '@/lib/dating/momentum'
import { isRebuffActive } from '@/lib/dating/rebuff'
import { getScenarioCatalog, scenarioById } from '@/lib/dating/scenarios'
import { SceneStateCard } from '@/components/chat/SceneStateCard'
import { StageLabel, StageMeter } from '@/components/ui/Stage'
import { Modal } from '@/components/ui/Modal'
import { TabRail } from '@/components/ui/TabRail'
import { CoinBalance } from '@/components/ui/CatalogCard'
import { OverviewTab } from './relationship/OverviewTab'
import { UnlocksTab } from './relationship/UnlocksTab'
import { ShopTab } from './relationship/ShopTab'
import { MoreTab } from './relationship/MoreTab'
import { useRelationshipPanel } from './relationship/useRelationshipPanel'
import { RelationshipPanelProps } from './relationship/helpers'

export function RelationshipPanel({
  chat,
  character,
  participantCharacters = [],
  world,
  onClose,
  onBuyGift,
  onBuyItem,
  onBuyToy,
  onBuyOutfit,
  onAskCommitment,
  onInitiateFirstTime,
  onEndRelationship,
  onNavigateToWorld,
  onIntimacyAction,
  onIntimacyChoice,
  charReplyCount,
  personaName = 'You',
}: RelationshipPanelProps) {
  const f = useRelationshipPanel({ chat, character, participantCharacters, world, onClose, onBuyGift, onBuyItem, onBuyToy, onBuyOutfit, onAskCommitment, onInitiateFirstTime, onEndRelationship, onNavigateToWorld, onIntimacyAction, onIntimacyChoice, charReplyCount, personaName })
  const { trackedCharacters, viewingId, setViewingId, viewingCharacter, track, warmth, nextMilestone, relationshipStage, pendingChoiceEdge, afterglowRemaining, viewingScene, pendingChoice, handleChoice, setTab, hasShop, tabs, activeTab } = f

  return (
    <Modal
      onClose={onClose}
      title="Relationship"
      size="3xl"
      scrollable
      compact
      // The one number a shop should never bury
      headerExtra={hasShop ? <CoinBalance coins={chat.giftCoins ?? 0} /> : undefined}
    >
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned: never scrolls away, regardless of which tab below is open. */}
      <div className="shrink-0">
      {trackedCharacters.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-bg-sunken p-1">
          {trackedCharacters.map((c) => (
            <button
              key={c.id}
              onClick={() => setViewingId(c.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                viewingCharacter?.id === c.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {c.avatarDataUrl && (
                <img src={c.avatarDataUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
              )}
              <span className="truncate">{c.card.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pinned above the tabs: who this is, bond/warmth, current emotional read, and the at-risk banner if any. */}
      <div className="mb-3 rounded-xl bg-bg-sunken p-3">
        <div className="flex items-center gap-3">
          {viewingCharacter?.avatarDataUrl ? (
            <img
              src={viewingCharacter.avatarDataUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-romance/25"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-romance/12 text-romance">
              <Heart size={20} strokeWidth={1.75} fill="currentColor" fillOpacity={0.25} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* The VN HUD's own Bond row, same label treatment and same meter (`ui/Stage`) — the two
                are the same components now rather than two drifting copies of one look. */}
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm text-text">{viewingCharacter?.card.name ?? 'Relationship'}</span>
              <span className="truncate text-xs font-semibold capitalize text-romance">
                {formatRelationshipStage(relationshipStage)}
              </span>
              <span className="ml-auto shrink-0 text-sm tabular-nums text-text">{warmth}</span>
            </div>
            <StageMeter value={warmth} className="mt-1.5" />
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-text-muted">
              <StageLabel>{nextMilestone ? 'Next' : 'Bond'}</StageLabel>
              {nextMilestone
                ? `${formatRelationshipStage(nextMilestone.stage)} at ${nextMilestone.at}`
                : 'Max stage reached'}
            </p>
          </div>
        </div>
        {(track.mood || track.currentNeed || describeMomentum(track.momentum) || describeInitiativeBalance(track.initiativeBalance)) && (
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-text-muted">
            Right now:{' '}
            {[
              track.mood ?? '',
              track.currentNeed ? `could use more ${track.currentNeed}` : '',
              describeMomentum(track.momentum) ?? '',
              describeInitiativeBalance(track.initiativeBalance) ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
            {'. '}A passing read, separate from the bond above.
          </p>
        )}
        {viewingScene && (
          // The full engine-tracked scene, in the VN HUD's own idiom (`SceneStateCard`)
          <div className="mt-3 border-t border-bg-elevated pt-3">
            <SceneStateCard
              scene={viewingScene}
              viewingId={viewingId}
              nameOf={(id) => trackedCharacters.find((c) => c.id === id)?.card.name ?? 'Someone else'}
              userName={personaName}
              charReplyCount={charReplyCount}
              graph={scenarioById(getScenarioCatalog(world), viewingScene.scenarioId)}
            />
          </div>
        )}
        {afterglowRemaining !== null && (
          // Says what's true, not what to do — the window scores what the player does with it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-romance">
            Still in the hours after being intimate. {afterglowRemaining} more{' '}
            {afterglowRemaining === 1 ? 'reply' : 'replies'} before it settles into how it felt.
          </p>
        )}
        {!!track.discoveredRegions?.length && (
          // The discovery loop (`dating/touch.ts`): what the player has learned this character
          // actually responds to. Says what was found, not what to do with it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-romance">
            You've learned they respond to: {track.discoveredRegions.map((r) => r.replace(/_/g, ' ')).join(', ')}.
          </p>
        )}
        {isRebuffActive(track.recentRebuff, charReplyCount) && (
          // Same restraint as the afterglow line above: says what's true, not what to do about it.
          <p className="mt-2 border-t border-bg-elevated pt-2 text-xs italic text-text-muted">
            Still a little guarded since {track.recentRebuff!.kind === 'commitment' ? 'the last ask' : 'last time'} was put off
            {track.recentRebuff!.severity === 'backfire' ? '. That one genuinely stung' : ''}.
          </p>
        )}
      </div>

      {pendingChoice && (
        <div className="mb-3 rounded-xl bg-romance/10 p-3 ring-1 ring-romance/30">
          <div className="text-sm font-semibold text-romance">The scene is waiting on you</div>
          <p className="mt-1 text-xs text-text-muted">
            It won't move past this on its own. Pick where it goes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingChoice.options.map((option) => (
              <button
                key={option.id}
                onClick={() => handleChoice(option.id)}
                disabled={!!pendingChoiceEdge}
                className="rounded-lg border border-romance/40 bg-bg-elevated px-3 py-1.5 text-xs font-medium text-romance transition-colors hover:bg-romance/15 disabled:opacity-50"
              >
                {pendingChoiceEdge === option.id ? 'Working…' : option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {track.relationshipWarning && (
        <div className="mb-3 rounded-xl bg-danger/10 p-3 ring-1 ring-danger/30">
          <div className="text-sm font-semibold text-danger">On the rocks</div>
          <p className="mt-1 text-xs text-text-muted">
            {track.relationshipWarning.reason.charAt(0).toUpperCase() + track.relationshipWarning.reason.slice(1)} if this
            isn't resolved soon, the relationship will break on its own.
          </p>
        </div>
      )}

      <TabRail items={tabs} value={activeTab} onChange={setTab} className="mb-3" />
      </div>

      {/* The only part that scrolls — bounded by the Modal's max-height regardless of tab content. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {activeTab === 'overview' && <OverviewTab f={f} />}

      {activeTab === 'unlocks' && <UnlocksTab f={f} />}

      {activeTab === 'shop' && hasShop && <ShopTab f={f} />}

      {activeTab === 'more' && <MoreTab f={f} />}
      </div>
    </div>
    </Modal>
  )
}

