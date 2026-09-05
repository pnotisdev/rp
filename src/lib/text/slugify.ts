/**
 * Turns a free-typed label into a safe, filename/prompt-token-safe id: lowercase, hyphenated,
 * deduplicated against `existingIds` with a numeric suffix on collision. Shared by custom
 * expressions (`vn/expressions.ts`) and custom scene backgrounds (`vn/backgrounds.ts`) — both need
 * exactly the same guarantee, since the id becomes an uploaded-art filename key and (for
 * expressions) a literal token in the model's own prompt.
 */
export function slugifyId(label: string, existingIds: string[], fallback = 'item'): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || fallback
  if (!existingIds.includes(base)) return base
  let i = 2
  while (existingIds.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}
