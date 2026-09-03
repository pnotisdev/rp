import type { GenerationStats } from '@/lib/hooks/useChatSession'

/**
 * Section 15's "Generation HUD" — live feedback while (and just after) the model is working,
 * distinct from `showTokenCounts`' per-message-after-the-fact count. Gated behind the
 * `showGenerationHud` setting (Settings → Appearance, next to `showTokenCounts`), since not every
 * user wants a stats strip competing for attention next to the composer.
 */
export function GenerationHud({ stats, variant = 'default' }: { stats: GenerationStats | null; variant?: 'default' | 'vn' }) {
  if (!stats) return null
  const tone = variant === 'vn' ? 'text-white/55' : 'text-text-muted'
  const contextPct = stats.contextBudget > 0 ? Math.min(100, Math.round((stats.contextUsed / stats.contextBudget) * 100)) : 0
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1 text-[11px] ${tone}`} aria-live="polite">
      <span>{stats.tokensPerSec.toFixed(1)} tok/s</span>
      <span>{(stats.firstTokenMs / 1000).toFixed(2)}s to first token</span>
      <span>
        {stats.contextUsed} / {stats.contextBudget} tok ({contextPct}% context)
      </span>
      {!stats.measured && <span className="italic opacity-70">streaming…</span>}
    </div>
  )
}
