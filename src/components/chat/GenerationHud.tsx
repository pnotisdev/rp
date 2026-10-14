import type { GenerationStats } from '@/lib/hooks/useChatSession'
import type { DriveState } from '@/lib/persona/drive'

/** Section 15's "Generation HUD" — live feedback while (and just after) the model is working, distinct from `showTokenCounts`'… */
// Slowest ms per prompt token seen this session (a cold read); a much faster first token means the cache was reused.
let coldMsPerToken = 0
const labelled = new WeakMap<GenerationStats, string | null>()

// Judged against earlier replies only, so the first sample (the baseline) gets no label.
function cacheLabel(stats: GenerationStats): string | null {
  if (!stats.measured || stats.contextUsed < 1500) return null
  if (labelled.has(stats)) return labelled.get(stats)!
  const msPerToken = stats.firstTokenMs / stats.contextUsed
  const baseline = coldMsPerToken
  coldMsPerToken = Math.max(coldMsPerToken, msPerToken)
  const label = baseline < 0.1 ? null : msPerToken < baseline * 0.35 ? 'cache reused' : msPerToken > baseline * 0.7 ? 'full prompt re-read' : null
  labelled.set(stats, label)
  return label
}

export function GenerationHud({ stats, variant = 'default' }: { stats: GenerationStats | null; variant?: 'default' | 'vn' }) {
  if (!stats) return null
  const tone = variant === 'vn' ? 'text-white/55' : 'text-text-muted'
  const cache = cacheLabel(stats)
  const contextPct = stats.contextBudget > 0 ? Math.min(100, Math.round((stats.contextUsed / stats.contextBudget) * 100)) : 0
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-[11px] ${tone} ${
        variant === 'vn' ? 'px-4' : 'mx-auto w-full max-w-chat px-4'
      }`}
      aria-live="polite"
    >
      <span>{stats.tokensPerSec.toFixed(1)} tok/s</span>
      <span>{(stats.firstTokenMs / 1000).toFixed(2)}s to first token</span>
      <span>
        {stats.contextUsed} / {stats.contextBudget} tok ({contextPct}% context)
      </span>
      {cache && <span title="Whether the model reused its cache or re-read the whole prompt. A slow first token can also be queueing behind background checks.">{cache}</span>}
      {!stats.measured && <span className="italic opacity-70">streaming…</span>}
    </div>
  )
}

/** Live persona engine readout: what the code side decided for her last turn. */
export function DriveReadout({ state, variant = 'default' }: { state: DriveState | undefined; variant?: 'default' | 'vn' }) {
  if (!state || state.turn === 0) return null
  const tone = variant === 'vn' ? 'text-white/55' : 'text-text-muted'
  const scored = (state.hits ?? 0) + (state.misses ?? 0)
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5 text-[11px] ${tone} ${variant === 'vn' ? 'px-4' : 'mx-auto w-full max-w-chat px-4'}`}
      title="Live persona engine: rolled in code each turn, then handed to the model as a short status note."
    >
      <span>energy {Math.round(state.energy)}</span>
      <span>bored {state.boredom}</span>
      {state.fixation && <span>on her mind: {state.fixation.topic}</span>}
      {state.lastImpulseId && <span>last bit: {state.lastImpulseId.replace(/^idle_/, 'idle ').replace(/_/g, ' ')}</span>}
      {scored > 0 && <span>landed {state.hits ?? 0}/{scored}</span>}
      {state.gateUntilTurn !== undefined && state.turn < state.gateUntilTurn && <span>bits paused</span>}
    </div>
  )
}
