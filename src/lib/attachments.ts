import { fileToDataUrl } from '@/lib/characters/importExport'

export interface PendingImageAttachment {
  kind: 'image'
  name: string
  /** data: URL, for the composer/message preview thumbnail. */
  dataUrl: string
  /** Same image, base64 only (no data: prefix) — what the API actually wants. */
  base64: string
}

export interface PendingFileAttachment {
  kind: 'file'
  name: string
  text: string
}

export type PendingAttachment = PendingImageAttachment | PendingFileAttachment

const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.tsv',
  '.log',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.html',
  '.css',
  '.yml',
  '.yaml',
  '.xml',
]

const MAX_FILE_TEXT_CHARS = 20_000

export async function readAttachment(file: File): Promise<PendingAttachment> {
  if (file.type.startsWith('image/')) {
    const dataUrl = await fileToDataUrl(file)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return { kind: 'image', name: file.name, dataUrl, base64 }
  }

  const looksTexty =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
  if (!looksTexty) {
    throw new Error(
      `"${file.name}" isn't a supported type yet — attach images, or plain text/code/markdown files.`,
    )
  }
  let text = await file.text()
  if (text.length > MAX_FILE_TEXT_CHARS) {
    text = text.slice(0, MAX_FILE_TEXT_CHARS) + '\n[…truncated]'
  }
  return { kind: 'file', name: file.name, text }
}

/** Appends attached file contents to the message text so they flow through the normal prompt pipeline. */
export function composeMessageText(baseText: string, attachments: PendingAttachment[]): string {
  const fileBlocks = attachments
    .filter((a): a is PendingFileAttachment => a.kind === 'file')
    .map((a) => `\n\n--- Attached file: ${a.name} ---\n${a.text}`)
  return baseText + fileBlocks.join('')
}

export function collectImageBase64(attachments: PendingAttachment[]): string[] {
  return attachments.filter((a): a is PendingImageAttachment => a.kind === 'image').map((a) => a.base64)
}
