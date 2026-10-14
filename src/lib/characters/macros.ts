export interface MacroContext {
  charName: string
  userName: string
}

/** Substitutes SillyTavern-style macros. */
export function substituteMacros(text: string, ctx: MacroContext): string {
  if (!text) return text
  const now = new Date()
  const replacements: Record<string, string> = {
    char: ctx.charName,
    user: ctx.userName,
    time: now.toLocaleTimeString(),
    date: now.toLocaleDateString(),
    newline: '\n',
  }
  return text.replace(/{{\s*([a-zA-Z_]+)\s*}}/g, (match, key: string) => {
    const k = key.toLowerCase()
    return k in replacements ? replacements[k] : match
  })
}
