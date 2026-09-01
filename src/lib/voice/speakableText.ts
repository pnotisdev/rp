/** Strips roleplay formatting that reads badly out loud — *actions*, stray markdown — before handing text to TTS. */
export function toSpeakableText(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
