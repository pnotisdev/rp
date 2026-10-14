// Turns text into vectors through any OpenAI-style `/v1/embeddings` endpoint (KoboldCpp with an embeddings model, llama.cpp, Ollama, LM Studio, OpenAI, OpenRouter...).

export interface EmbeddingConfig {
  /** Server address. A trailing `/v1` is fine. */
  baseUrl: string
  apiKey: string
  /** Model name for servers that need one; empty leaves it out. */
  model: string
}

const BATCH = 16
const TIMEOUT_MS = 60_000

/** The embeddings URL for a base address, whether or not it already ends in `/v1`. */
export function embeddingsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return /\/v1$/i.test(base) ? `${base}/embeddings` : `${base}/v1/embeddings`
}

async function embedBatch(cfg: EmbeddingConfig, input: string[], signal?: AbortSignal): Promise<number[][]> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(embeddingsUrl(cfg.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ input, ...(cfg.model ? { model: cfg.model } : {}) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`The embeddings server answered ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as { data?: { embedding?: unknown; index?: number }[] }
  const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const vectors = rows.map((r) => r.embedding)
  if (vectors.length !== input.length || !vectors.every((v): v is number[] => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number'))) {
    throw new Error('The embeddings server did not return one vector per text. Is an embeddings model loaded?')
  }
  return vectors
}

/** One vector per text, in order. Empty strings are not sent. */
export async function embedTexts(cfg: EmbeddingConfig, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!cfg.baseUrl.trim()) throw new Error('Set an embeddings server address first (Settings, Generation, Documents and memory search).')
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await embedBatch(cfg, texts.slice(i, i + BATCH), signal)))
  }
  return out
}
