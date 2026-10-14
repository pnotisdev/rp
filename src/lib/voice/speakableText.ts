/** Strips roleplay formatting that reads badly out loud — *actions*, `log lines`, stray markdown — before handing text to TTS. */
export function toSpeakableText(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/[_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
