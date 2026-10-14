// Token probabilities of a reply: parsing what KoboldCpp reports, and a small in-memory store the message viewer reads.

export interface TokenCandidate {
  token: string
  /** Natural-log probability. */
  logprob: number
}

export interface TokenProb extends TokenCandidate {
  /** The most likely alternatives at this step, best first. */
  top: TokenCandidate[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const candidate = (v: unknown): TokenCandidate | null =>
  isRecord(v) && typeof v.token === 'string' && typeof v.logprob === 'number' ? { token: v.token, logprob: v.logprob } : null

const candidates = (v: unknown): TokenCandidate[] => (Array.isArray(v) ? v.flatMap((c) => candidate(c) ?? []) : [])

/** KoboldCpp's `/api/extra/last_logprobs`: OpenAI-shaped `content` entries, or parallel `tokens`/`logprobs`/`top_logprobs` arrays. Anything else gives an empty list. */
export function parseKoboldLogprobs(raw: unknown): TokenProb[] {
  if (!isRecord(raw)) return []
  const root = isRecord(raw.logprobs) ? raw.logprobs : raw
  if (Array.isArray(root.content)) {
    return root.content.flatMap((c): TokenProb[] => {
      const own = candidate(c)
      if (!own) return []
      const top = candidates(isRecord(c) ? c.top_logprobs : undefined)
      return [{ ...own, top: top.length ? top : [own] }]
    })
  }
  const tokens = root.tokens
  const logprobs = root.logprobs
  if (!Array.isArray(tokens) || !Array.isArray(logprobs)) return []
  const tops = Array.isArray(root.top_logprobs) ? root.top_logprobs : []
  return tokens.flatMap((t, i): TokenProb[] => {
    const lp = logprobs[i]
    if (typeof t !== 'string' || typeof lp !== 'number') return []
    const alt = tops[i]
    // A parallel top list is either a list of candidates or a `{token: logprob}` map.
    const top = Array.isArray(alt)
      ? candidates(alt)
      : isRecord(alt)
        ? Object.entries(alt).flatMap(([token, v]) => (typeof v === 'number' ? [{ token, logprob: v }] : []))
        : []
    return [{ token: t, logprob: lp, top: (top.length ? top : [{ token: t, logprob: lp }]).sort((a, b) => b.logprob - a.logprob) }]
  })
}

export const probabilityOf = (logprob: number): number => Math.exp(logprob)

/** The tokens shown as written: the SentencePiece and byte-level space and newline markers become real characters. */
export const displayToken = (token: string): string => token.replace(/^[▁Ġ]/, ' ').replace(/Ċ/g, '\n')

const LIMIT = 40
const store = new Map<string, TokenProb[]>()

/** Probabilities for the latest replies, by message id. Held in memory only: they are for looking at, not for saving. */
export const tokenProbStore = {
  get: (id: string): TokenProb[] | undefined => store.get(id),
  set(id: string, probs: TokenProb[]): void {
    store.delete(id)
    store.set(id, probs)
    while (store.size > LIMIT) store.delete(store.keys().next().value as string)
  },
  clear: (): void => store.clear(),
}
