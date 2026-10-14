// The product's name in one place: rename it in brand.json and every screen, prompt and message follows.

import brand from './brand.json' with { type: 'json' }

export const BRAND: { name: string; kanji: string; tagline: string; meaning: string } = brand

/** A lowercase id for the name, for places that need one (MCP server label, file prefixes). */
export const BRAND_ID = BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
