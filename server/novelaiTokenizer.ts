import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — no published types for @agnai/sentencepiece-js.
import { SentencePieceProcessor } from '@agnai/sentencepiece-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Tokenizes text server-side for NovelAI's backend: its `input` field wants the prompt pre-tokenized
 * and base64-packed (see `novelaiTokens.ts`). Clio and Kayra both use "NerdStash", a SentencePiece
 * model bundled as `.model` files in `server/tokenizers/`. Runs server-side rather than in the
 * browser bundle since the WASM tokenizer + model files are large for a niche, opt-in backend.
 * Erato isn't supported (different tokenizer family) — `tokenizerForModel` returns `null` for it.
 */
export type NovelAITokenizerId = 'nerdstash_v1' | 'nerdstash_v2'

const MODEL_FILES: Record<NovelAITokenizerId, string> = {
  nerdstash_v1: path.join(__dirname, 'tokenizers', 'nerdstash-v1.model'),
  nerdstash_v2: path.join(__dirname, 'tokenizers', 'nerdstash-v2.model'),
}

/** Loaded lazily, once per tokenizer id, and cached for the life of the server process. */
const processors = new Map<NovelAITokenizerId, Promise<SentencePieceProcessor>>()

function getProcessor(id: NovelAITokenizerId): Promise<SentencePieceProcessor> {
  let loading = processors.get(id)
  if (!loading) {
    loading = (async () => {
      const spp = new SentencePieceProcessor()
      await spp.load(MODEL_FILES[id])
      return spp as SentencePieceProcessor
    })()
    processors.set(id, loading)
  }
  return loading
}

/** Which tokenizer a NovelAI model id needs, or `null` for a model this app doesn't support tokenizing (Erato, or anything unrecognized). */
export function tokenizerForModel(model: string): NovelAITokenizerId | null {
  const m = model.toLowerCase()
  if (m.includes('kayra')) return 'nerdstash_v2'
  if (m.includes('clio')) return 'nerdstash_v1'
  return null
}

/** Encodes `text` into NovelAI token ids for the given tokenizer. */
export async function encodeTokens(text: string, tokenizerId: NovelAITokenizerId): Promise<number[]> {
  const spp = await getProcessor(tokenizerId)
  return spp.encodeIds(text) as number[]
}
