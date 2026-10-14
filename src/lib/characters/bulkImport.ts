// Imports any mix of character cards (PNG/JSON, V1-V3) and rp packs, creating one character per file.
import { charactersApi } from '@/lib/api/client'
import type { Character } from './cardSpec'
import { importCharacterFile } from './importExport'
import { importCharacterPack, parseCharacterPackFile } from './pack'

export interface BulkImportResult {
  created: Character[]
  failed: { file: string; error: string }[]
}

export async function importCharacterFiles(files: File[]): Promise<BulkImportResult> {
  const result: BulkImportResult = { created: [], failed: [] }
  for (const file of files) {
    try {
      if (file.name.toLowerCase().endsWith('.json') && (await file.slice(0, 400).text()).includes('rp-character-pack')) {
        result.created.push((await importCharacterPack(await parseCharacterPackFile(file))).character)
        continue
      }
      const { card, avatarDataUrl, sprites, customExpressions } = await importCharacterFile(file)
      if (!card.name.trim()) throw new Error('The card has no name')
      result.created.push(await charactersApi.create({ card, avatarDataUrl, sprites, customExpressions }))
    } catch (e) {
      result.failed.push({ file: file.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
