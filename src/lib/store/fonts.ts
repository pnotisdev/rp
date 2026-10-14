// Font choices for the interface, message text and names: bundled or system fonts only, so everything works offline.

export type FontId = 'inter' | 'system' | 'rounded' | 'serif' | 'elegant' | 'typewriter' | 'mono'

export const FONT_STACKS: Record<FontId, string> = {
  inter: "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  rounded: "'Zen Maru Gothic', 'Inter Variable', ui-rounded, 'Hiragino Maru Gothic ProN', sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Charter, Georgia, 'Times New Roman', serif",
  elegant: "'Didot', 'Bodoni MT', 'Hoefler Text', 'Baskerville', Georgia, 'Times New Roman', serif",
  typewriter: "'American Typewriter', 'Courier Prime', 'Courier New', Courier, monospace",
  mono: "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
}

export const FONT_OPTIONS: { id: FontId; label: string }[] = [
  { id: 'inter', label: 'Inter' },
  { id: 'system', label: 'System' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'serif', label: 'Book serif' },
  { id: 'elegant', label: 'Elegant serif' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'mono', label: 'Monospace' },
]

export const isFontId = (v: unknown): v is FontId => typeof v === 'string' && v in FONT_STACKS
