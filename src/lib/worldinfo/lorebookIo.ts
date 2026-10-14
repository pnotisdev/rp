// Lorebook import (V2 books, SillyTavern World Info JSON, card PNG/JSON) and SillyTavern-style export.
import { normalizeLorebook, type Lorebook } from '@/lib/characters/cardSpec'
import { readCharacterFromPng } from '@/lib/characters/png'
import { downloadJsonFile, readJsonFile } from '@/lib/io/transfer'

/** Finds a lorebook in a card (V1/V2/V3), a bare `character_book`, or a World Info export. */
export function lorebookFromJson(raw: unknown): Lorebook | undefined {
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return undefined
  const data = (o.data as Record<string, unknown> | undefined) ?? o
  return normalizeLorebook(data.character_book ?? (o.entries ? o : undefined))
}

export async function importLorebookFile(file: File): Promise<Lorebook> {
  const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
  const book = lorebookFromJson(isPng ? await readCharacterFromPng(file) : await readJsonFile(file))
  if (!book || book.entries.length === 0) throw new Error(`No lorebook entries found in ${file.name}`)
  return { ...book, name: book.name || file.name.replace(/\.[^.]+$/, '') }
}

const ST_POSITION = { before_char: 0, after_char: 1, at_depth: 4, outlet: 7 } as const
const ST_LOGIC = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 } as const

/** The book as a SillyTavern World Info file (entries keyed by uid), which ST and this app both re-import. */
export function lorebookToStJson(book: Lorebook) {
  const entries: Record<string, unknown> = {}
  book.entries.forEach((e, i) => {
    const uid = e.id ?? i
    entries[String(uid)] = {
      uid,
      key: e.keys,
      keysecondary: e.secondary_keys ?? [],
      comment: e.comment ?? '',
      content: e.content,
      constant: e.constant,
      selective: e.selective,
      order: e.insertion_order,
      position: ST_POSITION[e.position ?? 'before_char'],
      disable: !e.enabled,
      depth: e.depth ?? 4,
      probability: e.probability ?? 100,
      useProbability: e.probability !== undefined,
      caseSensitive: !!e.case_sensitive,
      group: e.group ?? '',
      ...(e.groupWeight !== undefined ? { groupWeight: e.groupWeight } : {}),
      groupOverride: !!e.groupOverride,
      useGroupScoring: e.useGroupScoring ?? null,
      sticky: e.sticky ?? null,
      cooldown: e.cooldown ?? null,
      delay: e.delay ?? null,
      selectiveLogic: ST_LOGIC[e.selectiveLogic ?? 'and_any'],
      scanDepth: e.scanDepth ?? null,
      matchWholeWords: e.matchWholeWords ?? null,
      excludeRecursion: !!e.excludeRecursion,
      preventRecursion: !!e.preventRecursion,
      delayUntilRecursion: !!e.delayUntilRecursion,
      ignoreBudget: !!e.ignoreBudget,
      outletName: e.outletName ?? '',
    }
  })
  return { name: book.name, entries }
}

export function downloadLorebook(book: Lorebook) {
  downloadJsonFile(lorebookToStJson(book), book.name || 'lorebook')
}
