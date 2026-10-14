// Studio AI help: describe a change, get back whole replacement files to apply to the draft.

import type { ChatBackend } from '@/lib/api/chatBackend'
import { BRAND } from '@/lib/brand'
import { generateWithTimeout, type AssistShaping } from '@/lib/api/generateWithTimeout'
import { isSafePath, isTextPath } from './manifest'

export interface StudioSnapshot {
  manifest: string
  files: Record<string, string>
}

export interface StudioChanges {
  manifest?: string
  files: Record<string, string>
}

const GUIDE_CUT = '## Using AI agents'
const FILE_CHAR_BUDGET = 12_000
const MAX_FILES_PER_REPLY = 12

/** The part of the developer guide a model needs to write code (drops the agent/MCP section). */
export function trimGuide(guide: string): string {
  const at = guide.indexOf(GUIDE_CUT)
  return (at === -1 ? guide : guide.slice(0, at)).trim()
}

/** Includes the smallest files first until the budget is spent, naming the rest so the model leaves them alone. */
export function describeFiles(current: StudioSnapshot): string {
  const entries = [['manifest.json', current.manifest] as const, ...Object.entries(current.files)]
  const byAscendingSize = [...entries].sort((a, b) => a[1].length - b[1].length)
  let used = 0
  const shown = new Set<string>()
  for (const [path, body] of byAscendingSize) {
    if (used + body.length > FILE_CHAR_BUDGET && shown.size > 0) continue
    shown.add(path)
    used += body.length
  }
  return entries
    .map(([path, body]) => (shown.has(path) ? `=== FILE: ${path} ===\n${body}\n=== END FILE ===` : `(${path} is ${body.length} characters and not shown. Do not rewrite it.)`))
    .join('\n\n')
}

export function buildStudioPrompt(request: string, current: StudioSnapshot, guide: string): string {
  return [
    `You edit extensions for ${BRAND.name}. Read the developer guide, then make the change the user asks for.`,
    `DEVELOPER GUIDE\n${trimGuide(guide)}`,
    `THE EXTENSION AS IT IS NOW\n${describeFiles(current)}`,
    `THE CHANGE TO MAKE\n${request.trim()}`,
    `HOW TO ANSWER
Reply with the complete new content of every file you change or add, each in exactly this form, and nothing else:
=== FILE: path/name.ext ===
(the whole file)
=== END FILE ===
Use "=== FILE: manifest.json ===" with the full JSON to change the manifest (new panels, permissions, settings, hooks). Do not include files you did not change. No markdown fences, no explanations. Keep the extension small, request only the permissions it needs, and every file a panel or script references must exist.`,
  ].join('\n\n')
}

/** Pulls file blocks out of a reply, ignoring unsafe paths and stripping stray code fences. */
export function parseStudioReply(reply: string): StudioChanges {
  const changes: StudioChanges = { files: {} }
  const re = /^=== FILE: (.+?) ===[ \t]*\r?\n([\s\S]*?)(?:\r?\n=== END FILE ===|(?![\s\S]))/gm
  for (const m of reply.matchAll(re)) {
    const path = m[1].trim()
    let body = m[2].replace(/^\s*```[\w-]*[ \t]*\r?\n/, '').replace(/\r?\n```\s*$/, '')
    body = body.replace(/\s+$/, '')
    if (path === 'manifest.json') changes.manifest = body
    else if (isSafePath(path) && isTextPath(path) && Object.keys(changes.files).length < MAX_FILES_PER_REPLY) changes.files[path] = body
  }
  return changes
}

export async function askStudio(
  client: ChatBackend,
  request: string,
  current: StudioSnapshot,
  opts: { guide: string; shaping?: AssistShaping; signal?: AbortSignal },
): Promise<StudioChanges & { raw: string }> {
  if (!request.trim()) throw new Error('Describe the change you want first.')
  const raw = await generateWithTimeout(
    client,
    {
      prompt: buildStudioPrompt(request, current, opts.guide),
      max_length: 3500,
      max_context_length: await client.getEffectiveMaxContext(),
      temperature: 0.4,
      top_p: 0.95,
      top_k: 0,
      min_p: 0.05,
      typical: 1,
      tfs: 1,
      rep_pen: 1.05,
      rep_pen_range: 1024,
      rep_pen_slope: 0.7,
    },
    'Studio AI',
    opts.signal,
    opts.shaping,
  )
  const changes = parseStudioReply(raw)
  if (changes.manifest === undefined && Object.keys(changes.files).length === 0) throw new Error("The model's reply had no files in it. Try rephrasing the request.")
  return { ...changes, raw }
}
