import {
  Gauge,
  
  Heart,
  
  
  
  
  
  
  
  
  
  
  
  
} from 'lucide-react'
import {
  commitmentTierThreshold,
  
  
  formatCommitmentStatus,
  
  
  
  
  
  lowestWarmthDimension,
  
  
} from '@/lib/dating/stage'
import { StageLabel } from '@/components/ui/Stage'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { DIMENSION_ICONS } from '@/lib/dating/catalogVisuals'
import { ALL_STAT_KEYS, DIMENSION_LABELS } from './helpers'
import type { EditorState } from './useRelationshipPanel'

export function OverviewTab({ f }: { f: EditorState }) {
  const { viewingCharacter, track, affection, stats, milestones, commitmentStatus, nextTier, nextTierLockReason, eligibleForNextTier, asking, ending, handleAsk, handleEnd, nextTierAskAttempts } = f
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg-sunken p-3">
        <div>
          <StageLabel>Status</StageLabel>
          <div className="text-sm capitalize text-text">{formatCommitmentStatus(commitmentStatus)}</div>
          {track.breakupCount ? (
            <div className="mt-0.5 text-[11px] text-text-muted">
              Broken up before ({track.breakupCount}×). Trust, comfort, and chemistry still carry that scar.
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {commitmentStatus !== 'none' && (
            <Button variant="ghost" onClick={handleEnd} disabled={ending}>
              {ending ? 'Ending…' : 'End things'}
            </Button>
          )}
          {nextTier &&
            (eligibleForNextTier ? (
              <div className="flex flex-col items-end gap-1">
                <Button variant="primary" onClick={handleAsk} disabled={asking}>
                  {asking ? 'Asking…' : `Ask to be ${formatCommitmentStatus(nextTier)}`}
                </Button>
                {/* After a few deflects, point at whichever tracked dimension is lagging behind. */}
                {nextTierAskAttempts >= 3 && (
                  <p className="max-w-[16rem] text-right text-[11px] text-text-muted">
                    Deflected {nextTierAskAttempts}× so far. {viewingCharacter?.card.name ?? 'their'}{' '}
                    {DIMENSION_LABELS[lowestWarmthDimension(stats)].toLowerCase()} has been trailing the rest; worth warming that up before asking again.
                  </p>
                )}
              </div>
            ) : (
              <div className="text-right text-xs text-text-muted">
                {/* Once warmth is met, the lock is physical — say so instead of repeating a cleared number. */}
                {nextTierLockReason === 'kiss'
                  ? `Kiss ${viewingCharacter?.card.name ?? 'them'} first`
                  : nextTierLockReason === 'first_time'
                    ? 'Share a first time together first'
                    : `${formatCommitmentStatus(nextTier)} unlocks at ${commitmentTierThreshold(nextTier, milestones)} warmth`}
              </div>
            ))}
        </div>
      </div>

      <Section title="Relationship stats" icon={Gauge} surface="sunken" contentClassName="!p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ALL_STAT_KEYS.map((key) => {
            const value = key === 'affection' ? affection : stats[key]
            const DimIcon = DIMENSION_ICONS[key] ?? Heart
            // Tension isn't a "more is better" dimension, so it stays neutral rather than romance-tinted.
            const neutral = key === 'tension'
            return (
              <div key={key} className="rounded-lg border border-border bg-bg-elevated px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-text-muted">
                  <DimIcon size={12} strokeWidth={1.75} className={`shrink-0 ${neutral ? '' : 'text-romance/70'}`} />
                  <span className="truncate">{DIMENSION_LABELS[key]}</span>
                  <span className="ml-auto tabular-nums text-text">{value}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-bg-sunken">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${neutral ? 'bg-text-muted/50' : 'bg-romance/70'}`}
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
