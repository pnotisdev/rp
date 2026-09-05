import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — no published types; see the README this package ships (checked directly,
// not from secondhand docs): `new SentencePieceProcessor()`, `await load(path)`, `encodeIds(text)`.
import { SentencePieceProcessor } from '@agnai/sentencepiece-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * NovelAI's text-generation `input` field isn't plain text — it's the prompt tokenized with
 * NovelAI's own tokenizer, then base64-packed as raw token-id bytes (see `novelaiTokens.ts`).
 * Clio and Kayra both use "NerdStash", a SentencePiece model NovelAI publishes themselves
 * (huggingface.co/NovelAI/nerdstash-tokenizer-v1 for Clio, -v2 for Kayra) — the exact two `.model`
 * files bundled in `server/tokenizers/`. This runs server-side (mirroring where SillyTavern does
 * the equivalent work) rather than in the browser bundle, both because loading a ~1MB WASM
 * tokenizer + two ~1MB model files into the Vite client bundle for a niche, opt-in backend is
 * wasteful, and because `@agnai/sentencepiece-js` (Emscripten/WASM, but built assuming Node's
 * `fs` for loading `.model` files) is the same npm package SillyTavern itself uses for this.
 *
 * Erato (NovelAI's newest model) deliberately isn't supported here — it uses a different,
 * Llama-3-family tokenizer, a separate code path (`@agnai/web-tokenizers`, JSON-based BPE, not
 * SentencePiece) with no confirmed source for its exact tokenizer file found while building this.
 * `tokenizerForModel` returns `null` for it, and the caller (server/app.ts's `/api/novelai/tokenize`)
 * turns that into a clear 400 rather than silently mis-tokenizing.
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
