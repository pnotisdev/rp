/** Cheap fallback when the backend is unreachable, and for synchronous budget checks: ~4 chars/token. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4)
}
