import { useState } from 'react'
import { displayToken, probabilityOf, type TokenProb } from '@/lib/api/logprobs'

/** A reply's tokens tinted by how sure the model was of each; click one to see what else it nearly wrote. */
export function TokenProbabilities({ probs }: { probs: TokenProb[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const chosen = selected === null ? null : probs[selected]
  return (
    <details className="mt-2 rounded-lg bg-bg-sunken px-3 py-2 text-xs text-text-muted">
      <summary className="cursor-pointer select-none">Token probabilities ({probs.length})</summary>
      <div className="mt-2 whitespace-pre-wrap break-words font-mono leading-relaxed text-text">
        {probs.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(selected === i ? null : i)}
            title={`${(probabilityOf(p.logprob) * 100).toFixed(1)}%`}
            style={{ backgroundColor: `rgb(var(--c-warning) / ${((1 - probabilityOf(p.logprob)) * 0.6).toFixed(2)})` }}
            className={`whitespace-pre-wrap rounded-sm ${selected === i ? 'outline outline-1 outline-accent' : ''}`}
          >
            {displayToken(p.token) || ' '}
          </button>
        ))}
      </div>
      {chosen && (
        <ul className="mt-2 space-y-0.5 font-mono">
          {chosen.top.slice(0, 8).map((c, i) => (
            <li key={i} className={`flex justify-between gap-4 ${c.token === chosen.token ? 'text-accent' : ''}`}>
              <span className="whitespace-pre">{JSON.stringify(displayToken(c.token))}</span>
              <span className="tabular-nums">{(probabilityOf(c.logprob) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
