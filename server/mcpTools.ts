// MCP tools, resources and prompts: library access through the app's own REST routes, plus extension authoring.

import fs from 'node:fs'
import { BRAND, BRAND_ID } from '../src/lib/brand.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { characterStore, chatFactStore, chatStore, messageStore, newId, personaStore, worldInfoBookStore, worldStore } from './db.ts'
import * as ext from './extensions.ts'
import { STARTER_KINDS, starterBundle, type StarterKind } from '../src/lib/extensions/starter.ts'
import type { JsonSchema, McpConfig, PromptDef, ResourceDef, ResourceTemplateDef, ToolDef, ToolOutput } from './mcpProtocol.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

type Row = Record<string, unknown>
export type Rest = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<unknown>
export interface McpContext {
  rest: Rest
  readOnly: boolean
}

/** Calls the app's own REST API so tools share its validation and side effects. */
export function restClient(base: string): Rest {
  return async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 204) return null
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!res.ok) {
      const reason = parsed && typeof parsed === 'object' && typeof (parsed as Row).error === 'string' ? ((parsed as Row).error as string) : text.slice(0, 200)
      throw new Error(`${method} ${route} failed (${res.status}): ${reason}`)
    }
    return parsed
  }
}

// ---- Small helpers ----

const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra })
const num = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'number', description, ...extra })
const bool = (description: string): JsonSchema => ({ type: 'boolean', description })
const list = (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description })
const shape = (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema => ({
  type: 'object',
  properties,
  required,
  ...(description ? { description } : {}),
})

const enc = encodeURIComponent
const json = (value: unknown): ToolOutput => ({ text: JSON.stringify(value, null, 2) })
const iso = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : undefined)
const clean = (v: unknown, max = 20_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const has = (a: Row, key: string) => a[key] !== undefined
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback)

function strings(v: unknown, max = 50, len = 500): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim().slice(0, len))
    .slice(0, max)
}

function snippet(text: unknown, n = 140): string {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function must(row: Row | undefined, what: string, id: unknown): Row {
  if (!row) throw new Error(`No ${what} with id "${String(id)}". Use the matching list tool to find ids.`)
  return row
}

type ToolInput = Omit<ToolDef<McpContext>, 'annotations'> & { annotations?: ToolDef<McpContext>['annotations'] }

const reader = (def: ToolInput): ToolDef<McpContext> => ({ ...def, annotations: { readOnlyHint: true, openWorldHint: false, ...def.annotations } })

const writer = (def: ToolInput): ToolDef<McpContext> => ({
  ...def,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, ...def.annotations },
  run: async (args, ctx) => {
    if (ctx.readOnly) return { text: 'Agent access is read-only right now. The user can allow changes in Settings, Agents.', isError: true }
    return def.run(args, ctx)
  },
})

// ---- Lorebook entries ----

const POSITIONS = ['before_char', 'after_char', 'at_depth']

const ENTRY_PROPS: Record<string, JsonSchema> = {
  keys: list(str('A trigger word or phrase'), 'Words that make this entry appear when they show up in the chat. Required unless constant is true.'),
  content: str('The text added to the prompt when the entry fires. Write it as plain facts.'),
  comment: str('A short title for the author. Not sent to the model.'),
  constant: bool('Always include this entry, regardless of keys. Use sparingly.'),
  secondary_keys: list(str('A word'), 'With selective true, one of these must also match.'),
  selective: bool('Require a secondary key match as well as a primary one.'),
  insertion_order: num('Lower numbers are placed first. Default 100.'),
  position: str('Where it goes in the prompt.', { enum: POSITIONS }),
  depth: num('For position at_depth: how many messages up from the latest.'),
  probability: num('0 to 100 chance that a keyword match fires. Default always.'),
  enabled: bool('Set false to keep the entry but switch it off.'),
}

const ENTRY_SCHEMA = shape(ENTRY_PROPS, ['content'])

/** Builds a stored lorebook entry from loose agent input, failing loudly on entries that could never fire. */
function entryFrom(raw: unknown, id: number, label: string): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`)
  const e = raw as Row
  const content = clean(e.content)
  if (!content) throw new Error(`${label} needs non-empty "content"`)
  const constant = e.constant === true
  const keys = strings(e.keys, 30, 100)
  if (!constant && keys.length === 0) throw new Error(`${label} needs "keys" (trigger words) or "constant": true`)
  const position = typeof e.position === 'string' && POSITIONS.includes(e.position) ? e.position : 'before_char'
  const entry: Row = {
    id,
    keys,
    secondary_keys: strings(e.secondary_keys, 30, 100),
    comment: clean(e.comment, 200),
    content,
    constant,
    selective: e.selective === true,
    insertion_order: clamp(e.insertion_order, -10_000, 10_000, 100),
    enabled: e.enabled !== false,
    position,
    case_sensitive: false,
    activationMode: constant ? 'always' : 'keyword',
    extensions: {},
  }
  if (position === 'at_depth') entry.depth = clamp(e.depth, 0, 100, 4)
  if (typeof e.probability === 'number') entry.probability = clamp(e.probability, 0, 100, 100)
  return entry
}

/** Applies only the fields an agent supplied onto an existing entry. */
function patchEntry(existing: Row, changes: Row, label: string): Row {
  const next: Row = { ...existing }
  if (has(changes, 'content')) {
    const content = clean(changes.content)
    if (!content) throw new Error(`${label}: "content" cannot be empty`)
    next.content = content
  }
  if (has(changes, 'keys')) next.keys = strings(changes.keys, 30, 100)
  if (has(changes, 'secondary_keys')) next.secondary_keys = strings(changes.secondary_keys, 30, 100)
  if (has(changes, 'comment')) next.comment = clean(changes.comment, 200)
  if (has(changes, 'selective')) next.selective = changes.selective === true
  if (has(changes, 'enabled')) next.enabled = changes.enabled !== false
  if (has(changes, 'insertion_order')) next.insertion_order = clamp(changes.insertion_order, -10_000, 10_000, 100)
  if (has(changes, 'probability')) next.probability = clamp(changes.probability, 0, 100, 100)
  if (has(changes, 'position') && typeof changes.position === 'string' && POSITIONS.includes(changes.position)) next.position = changes.position
  if (has(changes, 'depth')) next.depth = clamp(changes.depth, 0, 100, 4)
  if (has(changes, 'constant')) {
    next.constant = changes.constant === true
    next.activationMode = next.constant ? 'always' : 'keyword'
  }
  if (!next.constant && (next.keys as string[]).length === 0) throw new Error(`${label} would have no keys and is not constant, so it could never fire`)
  return next
}

const nextEntryId = (entries: Row[]) => entries.reduce((max, e, i) => Math.max(max, typeof e.id === 'number' ? e.id : i), -1) + 1

interface LoreRef {
  owner: string
  id: string
  title: string
  entries: Row[]
  save(entries: Row[]): Promise<void>
}

const BLANK_BOOK = { name: '', entries: [] as Row[], token_budget: 512, scan_depth: 8 }

function loreRef(a: Row, ctx: McpContext): LoreRef {
  const owner = a.owner
  const id = clean(a.id, 80)
  if (owner === 'world') {
    const w = must(worldStore.get(id), 'world', id)
    const book = (w.lorebook as Row | undefined) ?? { ...BLANK_BOOK }
    return {
      owner,
      id,
      title: String(w.name),
      entries: ((book.entries as Row[] | undefined) ?? []).map((e) => ({ ...e })),
      save: async (entries) => void (await ctx.rest('PUT', `/api/worlds/${enc(id)}`, { lorebook: { ...book, entries } })),
    }
  }
  if (owner === 'character') {
    const c = must(characterStore.get(id), 'character', id)
    const card = c.card as Row
    const book = (card.character_book as Row | undefined) ?? { ...BLANK_BOOK }
    return {
      owner,
      id,
      title: String(card.name),
      entries: ((book.entries as Row[] | undefined) ?? []).map((e) => ({ ...e })),
      save: async (entries) => void (await ctx.rest('PUT', `/api/characters/${enc(id)}`, { card: { ...card, character_book: { ...book, entries } } })),
    }
  }
  if (owner === 'book') {
    const b = must(worldInfoBookStore.get(id), 'lorebook', id)
    const book = b.book as Row
    return {
      owner,
      id,
      title: String(b.name),
      entries: ((book.entries as Row[] | undefined) ?? []).map((e) => ({ ...e })),
      save: async (entries) => void (await ctx.rest('PUT', `/api/world-info-books/${enc(id)}`, { book: { ...book, entries } })),
    }
  }
  throw new Error('"owner" must be "world", "character" or "book" (a standalone lorebook)')
}

const entryView = (e: Row) => ({
  id: e.id,
  keys: e.keys,
  secondary_keys: (e.secondary_keys as string[] | undefined)?.length ? e.secondary_keys : undefined,
  comment: e.comment || undefined,
  content: e.content,
  constant: e.constant === true || undefined,
  enabled: e.enabled === false ? false : undefined,
  position: e.position,
  insertion_order: e.insertion_order,
  probability: e.probability,
})

// ---- Characters ----

const CARD_TEXT = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions'] as const

const CHARACTER_PROPS: Record<string, JsonSchema> = {
  name: str('Display name.'),
  description: str('Who they are: appearance, background, role. Plain prose. {{char}} and {{user}} are filled in at chat time.'),
  personality: str('Temperament, speech style, quirks, what they want and fear.'),
  scenario: str('The default situation a new chat opens in.'),
  first_mes: str('The opening message the character sends, in their voice. One to four paragraphs.'),
  mes_example: str('Example dialogue showing their voice. Separate examples with a line containing <START>.'),
  alternate_greetings: list(str('An alternative opening message'), 'Other opening messages the user can pick from.'),
  tags: list(str('A tag'), 'Short lowercase tags such as "fantasy" or "slice-of-life".'),
  creator_notes: str('Notes for the card author. Not sent to the model.'),
  system_prompt: str('Optional per-character system prompt.'),
  post_history_instructions: str('Optional instructions placed after the chat history.'),
  world_id: str('Id of the world this character lives in (see list_worlds). Empty string removes the link.'),
  occupation: str('Job or role.'),
  workplace: str('Where they work or study.'),
  home_location: str('Where they live.'),
  frequented_locations: list(str('A place'), 'Other places they are often found.'),
  likes: list(str('A like'), 'Interests and hobbies.'),
  goals: list(str('A goal'), 'What they want or are working toward.'),
  boundaries: list(str('A boundary'), 'Hard limits, in character.'),
  love_language: str('How they feel most loved, for example "quality time".'),
  reply_format: str('"roleplay" for prose with narration (default), or "texting" for short chat bubbles.', { enum: ['roleplay', 'texting'] }),
}

function characterView(c: Row) {
  const card = (c.card as Row) ?? {}
  return {
    id: c.id,
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    alternate_greetings: card.alternate_greetings ?? [],
    tags: card.tags ?? [],
    creator_notes: card.creator_notes || undefined,
    system_prompt: card.system_prompt || undefined,
    post_history_instructions: card.post_history_instructions || undefined,
    world_id: c.worldId || undefined,
    occupation: c.occupation,
    workplace: c.workplace,
    home_location: c.homeLocation,
    frequented_locations: c.frequentedLocations,
    likes: c.likes,
    goals: c.goals,
    boundaries: c.boundaries,
    love_language: c.loveLanguage,
    reply_format: c.replyFormat,
    lore_entries: ((card.character_book as Row | undefined)?.entries as unknown[] | undefined)?.length ?? 0,
    has_portrait: Boolean(c.avatarDataUrl),
    updated_at: iso(c.updatedAt),
  }
}

/** Top-level Character fields (everything outside the portable card). */
function extrasFrom(a: Row): Row {
  const out: Row = {}
  if (has(a, 'world_id')) {
    const id = clean(a.world_id, 80)
    if (id) must(worldStore.get(id), 'world', id)
    out.worldId = id
  }
  if (has(a, 'occupation')) out.occupation = clean(a.occupation, 200)
  if (has(a, 'workplace')) out.workplace = clean(a.workplace, 200)
  if (has(a, 'home_location')) out.homeLocation = clean(a.home_location, 200)
  if (has(a, 'love_language')) out.loveLanguage = clean(a.love_language, 200)
  if (has(a, 'frequented_locations')) out.frequentedLocations = strings(a.frequented_locations)
  if (has(a, 'likes')) out.likes = strings(a.likes)
  if (has(a, 'goals')) out.goals = strings(a.goals)
  if (has(a, 'boundaries')) out.boundaries = strings(a.boundaries)
  if (has(a, 'reply_format')) out.replyFormat = a.reply_format === 'texting' ? 'texting' : null
  return out
}

function cardFrom(a: Row, base: Row): Row {
  const card: Row = { ...base }
  if (has(a, 'name')) {
    const name = clean(a.name, 120)
    if (!name) throw new Error('"name" cannot be empty')
    card.name = name
  }
  for (const key of CARD_TEXT) if (has(a, key)) card[key] = clean(a[key])
  if (has(a, 'alternate_greetings')) card.alternate_greetings = strings(a.alternate_greetings, 20, 5000)
  if (has(a, 'tags')) card.tags = strings(a.tags, 30, 40)
  return card
}

const blankCard = (): Row => ({
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '',
  extensions: {},
})

// ---- Worlds ----

const WORLD_TEMPLATES = ['freeform', 'visual_novel', 'dating_sim']

function worldView(w: Row) {
  const entries = ((w.lorebook as Row | undefined)?.entries as unknown[] | undefined) ?? []
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    rules: w.rules || undefined,
    template: w.template ?? 'dating_sim',
    lore_entries: entries.length,
    characters: characterStore.list({ where: 'worldId = ?', params: [w.id] }).map((c) => ({ id: c.id, name: (c.card as Row).name })),
    custom_scene_flags: w.customSceneFlags,
    items: (w.items as unknown[] | undefined)?.length ?? 0,
    gifts: (w.gifts as unknown[] | undefined)?.length ?? 0,
    triggers: (w.triggers as unknown[] | undefined)?.length ?? 0,
    current_day: w.currentDay ?? 0,
    updated_at: iso(w.updatedAt),
  }
}

// ---- Chats ----

function messageView(m: Row) {
  return { id: m.id, role: m.role === 'user' ? 'user' : 'character', name: m.name, text: m.text, at: iso(m.createdAt) }
}

function activeChat(id: unknown): Row {
  const chat = must(chatStore.get(clean(id, 80)), 'chat', id)
  if (chat.deletedAt) throw new Error('That chat is in the trash.')
  return chat
}

// ---- Extensions ----

/** After an agent changes code, the extension is switched off and its grants cleared so the user reviews it first. */
function lockForReview(id: string): string | undefined {
  const rec = ext.getExtension(id)
  if (!rec || (!rec.enabled && rec.grants.length === 0)) return undefined
  ext.updateExtension(id, { enabled: false, grants: [] })
  return 'The extension was switched off and its permissions were reset, so the user can review the new code before turning it back on.'
}

function extensionSummary(id: string) {
  const rec = ext.getExtension(id)
  if (!rec) throw new Error(`No extension "${id}". Use list_extensions to see what is installed.`)
  return {
    id: rec.id,
    name: rec.manifest.name,
    version: rec.manifest.version,
    description: rec.manifest.description,
    enabled: rec.enabled,
    permissions_requested: rec.manifest.permissions,
    permissions_granted: rec.grants,
    source: rec.source,
    revision: rec.rev,
    files: rec.fileCount,
    bytes: rec.totalBytes,
  }
}

function extensionGuide(): string {
  try {
    return fs.readFileSync(path.resolve(here, '..', 'docs', 'guides', 'extensions.md'), 'utf8')
  } catch {
    return 'The extension guide (docs/guides/extensions.md) is not part of this install. The manifest format is: id, name, version, api 1, permissions, panels, script, hooks, tools, theme, settings. Use lint_extension to check your work.'
  }
}

export const DATA_MODEL_GUIDE = `# ${BRAND.name} data model for agents

## Characters
A character card holds: name, description, personality, scenario, first_mes (the opening message), mes_example (sample dialogue, examples separated by a line with <START>), alternate_greetings, tags. {{char}} and {{user}} are replaced with the names at chat time.
Good cards show rather than tell: concrete habits, a distinct speech pattern, a want and a fear. Write first_mes in the character's own voice and let it set the scene. Keep description factual and personality behavioural; avoid restating the same trait three ways.
Extras that feed the live engine: occupation, workplace, home_location, likes, goals, boundaries, love_language, reply_format ("texting" gives short chat bubbles).

## Worlds
A world is a shared setting: name, description (always sent for characters living there), rules (hard constraints the model must not contradict), template (freeform, visual_novel or dating_sim) and a lorebook. Characters join a world through world_id.

## Lorebooks
Entries are snippets of lore added to the prompt only when relevant. An entry has keys (trigger words), content, and optional secondary_keys, position, insertion_order, probability. Use constant:true only for a handful of always-true facts.
Three places hold lorebooks: a world (owner "world"), a character (owner "character") and standalone books (owner "book") that can be bound to worlds or characters.
Write entries as short, self-contained facts (40 to 150 words) with 3 to 8 specific keys. One idea per entry. Keys should be words a player would actually type: names, places, objects.

## Chats
Chats belong to a character. read_chat returns recent messages; remember_fact stores a durable fact the character recalls later; get_relationship reads affection, stage and flags.

## Extensions
Read the extension guide resource before writing one. New extensions arrive switched off with no permissions; the user enables them in the app.
`

// ---- Tools ----

function tools(): ToolDef<McpContext>[] {
  return [
    reader({
      name: 'get_overview',
      title: 'Overview of the library',
      description: 'Counts and names of what the user has: characters, worlds, lorebooks, personas, chats and extensions. Call this first.',
      inputSchema: shape({}),
      run: async () => {
        const chats = chatStore.list().filter((c) => !c.deletedAt)
        return json({
          characters: characterStore.list({ orderBy: 'updatedAt DESC' }).slice(0, 60).map((c) => ({ id: c.id, name: (c.card as Row).name, world_id: c.worldId || undefined })),
          worlds: worldStore.list({ orderBy: 'updatedAt DESC' }).slice(0, 40).map((w) => ({ id: w.id, name: w.name })),
          lorebooks: worldInfoBookStore.list().slice(0, 40).map((b) => ({ id: b.id, name: b.name })),
          personas: personaStore.list().map((p) => ({ id: p.id, name: p.name })),
          chats: chats.length,
          extensions: ext.listExtensions().map((e) => ({ id: e.id, name: e.manifest.name, enabled: e.enabled })),
        })
      },
    }),

    reader({
      name: 'search_library',
      title: 'Search characters, worlds and lore',
      description: 'Finds characters, worlds and lorebook entries whose text contains the query (case-insensitive). Use it before creating something that may already exist.',
      inputSchema: shape({ query: str('Words to look for.'), limit: num('Maximum results, default 20.') }, ['query']),
      run: async (a) => {
        const q = clean(a.query, 200).toLowerCase()
        if (!q) throw new Error('"query" cannot be empty')
        const limit = clamp(a.limit, 1, 100, 20)
        const hits: Row[] = []
        const hit = (kind: string, id: unknown, name: unknown, where: string, text: unknown) => {
          if (hits.length < limit) hits.push({ kind, id, name, where, snippet: snippet(text) })
        }
        const holds = (v: unknown) => typeof v === 'string' && v.toLowerCase().includes(q)
        for (const c of characterStore.list()) {
          const card = c.card as Row
          const field = ['name', 'description', 'personality', 'scenario', 'first_mes'].find((k) => holds(card[k]))
          if (field) hit('character', c.id, card.name, field, card[field])
          else if ((card.tags as string[] | undefined)?.some(holds)) hit('character', c.id, card.name, 'tags', (card.tags as string[]).join(', '))
          scanEntries('character', c.id, card.name, (card.character_book as Row | undefined)?.entries)
        }
        for (const w of worldStore.list()) {
          const field = ['name', 'description', 'rules'].find((k) => holds(w[k]))
          if (field) hit('world', w.id, w.name, field, w[field])
          scanEntries('world', w.id, w.name, (w.lorebook as Row | undefined)?.entries)
        }
        for (const b of worldInfoBookStore.list()) scanEntries('book', b.id, b.name, (b.book as Row | undefined)?.entries)
        function scanEntries(owner: string, id: unknown, name: unknown, entries: unknown) {
          if (!Array.isArray(entries)) return
          for (const e of entries as Row[]) {
            if (holds(e.content) || holds(e.comment) || (e.keys as string[] | undefined)?.some(holds)) hit('lore_entry', id, name, `${owner} lorebook, entry ${String(e.id)}`, e.comment || e.content)
          }
        }
        return json({ count: hits.length, results: hits })
      },
    }),

    // Characters
    reader({
      name: 'list_characters',
      title: 'List characters',
      description: 'Lists characters with a one-line summary each. Filter by name text, tag or world.',
      inputSchema: shape({ query: str('Only characters whose name contains this text.'), tag: str('Only characters with this tag.'), world_id: str('Only characters living in this world.'), limit: num('Maximum results, default 50.') }),
      run: async (a) => {
        const q = clean(a.query, 100).toLowerCase()
        const tag = clean(a.tag, 40).toLowerCase()
        const rows = characterStore
          .list({ orderBy: 'updatedAt DESC' })
          .filter((c) => (!q || String((c.card as Row).name).toLowerCase().includes(q)) && (!tag || ((c.card as Row).tags as string[] | undefined)?.some((t) => t.toLowerCase() === tag)) && (!a.world_id || c.worldId === a.world_id))
          .slice(0, clamp(a.limit, 1, 200, 50))
        return json(rows.map((c) => ({ id: c.id, name: (c.card as Row).name, tags: (c.card as Row).tags ?? [], world_id: c.worldId || undefined, summary: snippet((c.card as Row).description) })))
      },
    }),
    reader({
      name: 'get_character',
      title: 'Read a character',
      description: 'Returns every text field of a character card plus its extras. Portrait and sprite images are not included.',
      inputSchema: shape({ id: str('Character id.') }, ['id']),
      run: async (a) => json(characterView(must(characterStore.get(clean(a.id, 80)), 'character', a.id))),
    }),
    writer({
      name: 'create_character',
      title: 'Create a character',
      description: 'Creates a new character card. Requires name, description and first_mes. Optionally embeds lore_entries (a private lorebook for this character). Returns the new id.',
      inputSchema: shape({ ...CHARACTER_PROPS, lore_entries: list(ENTRY_SCHEMA, 'Lorebook entries that belong to this character.') }, ['name', 'description', 'first_mes']),
      run: async (a, ctx) => {
        for (const key of ['name', 'description', 'first_mes']) if (!clean(a[key])) throw new Error(`"${key}" is required and cannot be empty`)
        const card = cardFrom(a, blankCard())
        if (Array.isArray(a.lore_entries) && a.lore_entries.length) {
          card.character_book = { name: `${String(card.name)} lore`, token_budget: 512, scan_depth: 8, entries: a.lore_entries.slice(0, 100).map((e, i) => entryFrom(e, i, `lore_entries[${i}]`)) }
        }
        const created = (await ctx.rest('POST', '/api/characters', { card, ...extrasFrom(a) })) as Row
        return json({ created: true, ...characterView(created) })
      },
    }),
    writer({
      name: 'update_character',
      title: 'Edit a character',
      description: 'Changes only the fields you pass. Arrays (tags, likes, goals…) are replaced as a whole. Use the lorebook tools to edit the character\'s lore.',
      inputSchema: shape({ id: str('Character id.'), ...CHARACTER_PROPS }, ['id']),
      run: async (a, ctx) => {
        const id = clean(a.id, 80)
        const current = must(characterStore.get(id), 'character', id)
        const card = cardFrom(a, current.card as Row)
        const updated = (await ctx.rest('PUT', `/api/characters/${enc(id)}`, { card, ...extrasFrom(a) })) as Row
        return json({ updated: true, ...characterView(updated) })
      },
    }),

    // Worlds
    reader({
      name: 'list_worlds',
      title: 'List worlds',
      description: 'Lists worlds (shared settings that characters can live in).',
      inputSchema: shape({ query: str('Only worlds whose name contains this text.') }),
      run: async (a) => {
        const q = clean(a.query, 100).toLowerCase()
        const rows = worldStore.list({ orderBy: 'updatedAt DESC' }).filter((w) => !q || String(w.name).toLowerCase().includes(q))
        return json(rows.map((w) => ({ id: w.id, name: w.name, template: w.template ?? 'dating_sim', summary: snippet(w.description), lore_entries: ((w.lorebook as Row | undefined)?.entries as unknown[] | undefined)?.length ?? 0 })))
      },
    }),
    reader({
      name: 'get_world',
      title: 'Read a world',
      description: 'Returns a world\'s description, rules, template and the characters who live there. Use get_lorebook (owner "world") for its lore entries.',
      inputSchema: shape({ id: str('World id.') }, ['id']),
      run: async (a) => json(worldView(must(worldStore.get(clean(a.id, 80)), 'world', a.id))),
    }),
    writer({
      name: 'create_world',
      title: 'Create a world',
      description: 'Creates a world: a setting with rules and a lorebook. Pass lore_entries to fill the lorebook in one call. Returns the new id.',
      inputSchema: shape(
        {
          name: str('World name.'),
          description: str('Setting, tone and general facts. Always sent to the model for characters in this world.'),
          rules: str('Hard constraints the model must never contradict (magic system, technology level, taboos).'),
          template: str('Play style: freeform (plain roleplay), visual_novel, or dating_sim (default).', { enum: WORLD_TEMPLATES }),
          lore_entries: list(ENTRY_SCHEMA, 'Lorebook entries for this world.'),
        },
        ['name', 'description'],
      ),
      run: async (a, ctx) => {
        if (!clean(a.name)) throw new Error('"name" is required')
        const entries = (Array.isArray(a.lore_entries) ? a.lore_entries : []).slice(0, 200).map((e, i) => entryFrom(e, i, `lore_entries[${i}]`))
        const created = (await ctx.rest('POST', '/api/worlds', {
          name: clean(a.name, 120),
          description: clean(a.description),
          rules: clean(a.rules),
          template: typeof a.template === 'string' && WORLD_TEMPLATES.includes(a.template) ? a.template : undefined,
          lorebook: { ...BLANK_BOOK, entries },
        })) as Row
        return json({ created: true, ...worldView(created) })
      },
    }),
    writer({
      name: 'update_world',
      title: 'Edit a world',
      description: 'Changes only the fields you pass. Use the lorebook tools to edit its lore.',
      inputSchema: shape({ id: str('World id.'), name: str('New name.'), description: str('New description.'), rules: str('New rules.'), template: str('Play style.', { enum: WORLD_TEMPLATES }) }, ['id']),
      run: async (a, ctx) => {
        const id = clean(a.id, 80)
        must(worldStore.get(id), 'world', id)
        const patch: Row = {}
        if (has(a, 'name')) patch.name = clean(a.name, 120) || undefined
        if (has(a, 'description')) patch.description = clean(a.description)
        if (has(a, 'rules')) patch.rules = clean(a.rules)
        if (typeof a.template === 'string' && WORLD_TEMPLATES.includes(a.template)) patch.template = a.template
        const updated = (await ctx.rest('PUT', `/api/worlds/${enc(id)}`, patch)) as Row
        return json({ updated: true, ...worldView(updated) })
      },
    }),

    // Lorebooks
    reader({
      name: 'list_lorebooks',
      title: 'List standalone lorebooks',
      description: 'Lists standalone lorebooks (world info books). Worlds and characters also carry their own lorebooks; read those with get_lorebook.',
      inputSchema: shape({}),
      run: async () =>
        json(
          worldInfoBookStore.list({ orderBy: 'createdAt' }).map((b) => ({
            id: b.id,
            name: b.name,
            entries: ((b.book as Row).entries as unknown[]).length,
            bound_world_ids: b.boundWorldIds,
            bound_character_ids: b.boundCharacterIds,
          })),
        ),
    }),
    writer({
      name: 'create_lorebook',
      title: 'Create a standalone lorebook',
      description: 'Creates a lorebook. With no world_ids or character_ids it is global, active in every chat.',
      inputSchema: shape(
        {
          name: str('Lorebook name.'),
          description: str('What the book covers.'),
          entries: list(ENTRY_SCHEMA, 'Initial entries.'),
          world_ids: list(str('A world id'), 'Only active in these worlds.'),
          character_ids: list(str('A character id'), 'Only active for these characters.'),
        },
        ['name'],
      ),
      run: async (a, ctx) => {
        const name = clean(a.name, 120)
        if (!name) throw new Error('"name" is required')
        const entries = (Array.isArray(a.entries) ? a.entries : []).slice(0, 200).map((e, i) => entryFrom(e, i, `entries[${i}]`))
        const created = (await ctx.rest('POST', '/api/world-info-books', {
          name,
          book: { ...BLANK_BOOK, name, description: clean(a.description, 500), entries },
          boundChatIds: [],
          boundCharacterIds: strings(a.character_ids, 100, 80),
          boundWorldIds: strings(a.world_ids, 100, 80),
        })) as Row
        return json({ created: true, id: created.id, name, entries: entries.length })
      },
    }),
    reader({
      name: 'get_lorebook',
      title: 'Read lorebook entries',
      description: 'Returns the entries of a world, character or standalone lorebook. Read before adding, so you do not repeat what exists.',
      inputSchema: shape({ owner: str('Where the lorebook lives.', { enum: ['world', 'character', 'book'] }), id: str('Id of the world, character or lorebook.'), query: str('Only entries mentioning this text.'), limit: num('Maximum entries, default 100.') }, ['owner', 'id']),
      run: async (a, ctx) => {
        const ref = loreRef(a, ctx)
        const q = clean(a.query, 100).toLowerCase()
        const matches = ref.entries.filter((e) => !q || String(e.content).toLowerCase().includes(q) || String(e.comment ?? '').toLowerCase().includes(q) || (e.keys as string[]).some((k) => k.toLowerCase().includes(q)))
        return json({ owner: ref.owner, id: ref.id, title: ref.title, total: ref.entries.length, entries: matches.slice(0, clamp(a.limit, 1, 500, 100)).map(entryView) })
      },
    }),
    writer({
      name: 'add_lore_entries',
      title: 'Add lorebook entries',
      description: 'Appends entries to a world, character or standalone lorebook. Up to 100 per call. Every entry needs keys or constant:true. Returns the new entry ids.',
      inputSchema: shape({ owner: str('Where the lorebook lives.', { enum: ['world', 'character', 'book'] }), id: str('Id of the world, character or lorebook.'), entries: list(ENTRY_SCHEMA, 'Entries to add.') }, ['owner', 'id', 'entries']),
      run: async (a, ctx) => {
        const ref = loreRef(a, ctx)
        const incoming = (a.entries as unknown[]).slice(0, 100)
        if (!incoming.length) throw new Error('"entries" is empty')
        let id = nextEntryId(ref.entries)
        const added = incoming.map((e, i) => entryFrom(e, id++, `entries[${i}]`))
        await ref.save([...ref.entries, ...added])
        return json({ added: added.length, entry_ids: added.map((e) => e.id), total: ref.entries.length + added.length, in: `${ref.owner} "${ref.title}"` })
      },
    }),
    writer({
      name: 'update_lore_entry',
      title: 'Edit a lorebook entry',
      description: 'Changes only the fields you pass on one entry.',
      inputSchema: shape({ owner: str('Where the lorebook lives.', { enum: ['world', 'character', 'book'] }), id: str('Id of the world, character or lorebook.'), entry_id: num('The entry id from get_lorebook.'), changes: shape(ENTRY_PROPS, [], 'Fields to change.') }, ['owner', 'id', 'entry_id', 'changes']),
      run: async (a, ctx) => {
        const ref = loreRef(a, ctx)
        const at = ref.entries.findIndex((e) => e.id === a.entry_id)
        if (at === -1) throw new Error(`No entry ${String(a.entry_id)} in that lorebook. Use get_lorebook to see entry ids.`)
        const next = [...ref.entries]
        next[at] = patchEntry(ref.entries[at], a.changes as Row, `entry ${String(a.entry_id)}`)
        await ref.save(next)
        return json({ updated: true, entry: entryView(next[at]) })
      },
    }),
    writer({
      name: 'remove_lore_entries',
      title: 'Remove lorebook entries',
      description: 'Deletes entries by id. This cannot be undone.',
      annotations: { destructiveHint: true },
      inputSchema: shape({ owner: str('Where the lorebook lives.', { enum: ['world', 'character', 'book'] }), id: str('Id of the world, character or lorebook.'), entry_ids: list(num('An entry id'), 'Ids to delete.') }, ['owner', 'id', 'entry_ids']),
      run: async (a, ctx) => {
        const ref = loreRef(a, ctx)
        const drop = new Set(a.entry_ids as number[])
        const kept = ref.entries.filter((e) => !drop.has(e.id as number))
        if (kept.length === ref.entries.length) throw new Error('None of those entry ids exist in that lorebook.')
        await ref.save(kept)
        return json({ removed: ref.entries.length - kept.length, remaining: kept.length })
      },
    }),

    // Personas
    reader({
      name: 'list_personas',
      title: 'List personas',
      description: 'Lists the user\'s personas (who they play as).',
      inputSchema: shape({}),
      run: async () => json(personaStore.list({ orderBy: 'createdAt' }).map((p) => ({ id: p.id, name: p.name, description: snippet(p.description, 200) }))),
    }),
    writer({
      name: 'create_persona',
      title: 'Create a persona',
      description: 'Creates a persona: the character the user plays as.',
      inputSchema: shape({ name: str('Persona name.'), description: str('Who they are, as the characters see them.') }, ['name']),
      run: async (a, ctx) => {
        const name = clean(a.name, 80)
        if (!name) throw new Error('"name" is required')
        const created = (await ctx.rest('POST', '/api/personas', { name, description: clean(a.description) })) as Row
        return json({ created: true, id: created.id, name })
      },
    }),
    writer({
      name: 'update_persona',
      title: 'Edit a persona',
      description: 'Changes only the fields you pass.',
      inputSchema: shape({ id: str('Persona id.'), name: str('New name.'), description: str('New description.') }, ['id']),
      run: async (a, ctx) => {
        const id = clean(a.id, 80)
        must(personaStore.get(id), 'persona', id)
        const patch: Row = {}
        if (has(a, 'name') && clean(a.name, 80)) patch.name = clean(a.name, 80)
        if (has(a, 'description')) patch.description = clean(a.description)
        await ctx.rest('PUT', `/api/personas/${enc(id)}`, patch)
        return json({ updated: true, id })
      },
    }),

    // Chats
    reader({
      name: 'list_chats',
      title: 'List chats',
      description: 'Lists chats, most recently active first.',
      inputSchema: shape({ character_id: str('Only chats with this character.'), limit: num('Maximum results, default 30.') }),
      run: async (a) => {
        const names = new Map(characterStore.list().map((c) => [c.id, (c.card as Row).name]))
        const rows = chatStore
          .list({ orderBy: 'updatedAt DESC' })
          .filter((c) => !c.deletedAt && (!a.character_id || c.characterId === a.character_id))
          .slice(0, clamp(a.limit, 1, 200, 30))
        return json(rows.map((c) => ({ id: c.id, title: c.title, character_id: c.characterId, character: names.get(c.characterId), mode: c.mode, stage: c.relationshipStage, updated_at: iso(c.updatedAt) })))
      },
    }),
    reader({
      name: 'read_chat',
      title: 'Read a chat',
      description: 'Returns the chat\'s long-term memory summary and its most recent messages in order. Page backwards with skip_recent.',
      inputSchema: shape({ chat_id: str('Chat id.'), limit: num('Messages to return, default 30, maximum 200.'), skip_recent: num('Skip this many of the newest messages first.') }, ['chat_id']),
      run: async (a) => {
        const chat = activeChat(a.chat_id)
        const all = messageStore.list({ where: 'chatId = ?', params: [chat.id], orderBy: 'createdAt' }).filter((m) => typeof m.text === 'string' && m.text.trim() && !m.failed)
        const skip = clamp(a.skip_recent, 0, all.length, 0)
        const limit = clamp(a.limit, 1, 200, 30)
        const slice = all.slice(Math.max(0, all.length - skip - limit), all.length - skip)
        return json({ chat_id: chat.id, title: chat.title, total_messages: all.length, memory_summary: chat.summary || undefined, messages: slice.map(messageView) })
      },
    }),
    reader({
      name: 'search_messages',
      title: 'Search all messages',
      description: 'Finds messages across every chat whose text contains the query. Newest first, at most 50.',
      inputSchema: shape({ query: str('Text to look for.') }, ['query']),
      run: async (a) => {
        const q = clean(a.query, 200).toLowerCase()
        if (!q) throw new Error('"query" cannot be empty')
        const hits = messageStore
          .list({ orderBy: 'createdAt DESC' })
          .filter((m) => String(m.text ?? '').toLowerCase().includes(q))
          .slice(0, 50)
        return json(hits.map((m) => ({ ...messageView(m), chat_id: m.chatId, text: snippet(m.text, 300) })))
      },
    }),
    writer({
      name: 'append_message',
      title: 'Add a message to a chat',
      description: 'Adds a message to the end of a chat without triggering a model reply. Use as "character" for narration or the character\'s lines, "user" for the player\'s.',
      inputSchema: shape({ chat_id: str('Chat id.'), text: str('Message text.'), as: str('Who says it. Default character.', { enum: ['character', 'user'] }) }, ['chat_id', 'text']),
      run: async (a, ctx) => {
        const chat = activeChat(a.chat_id)
        const text = clean(a.text, 50_000)
        if (!text) throw new Error('"text" cannot be empty')
        const asUser = a.as === 'user'
        const persona = chat.personaId ? personaStore.get(chat.personaId as string) : undefined
        const character = characterStore.get(chat.characterId as string)
        const message = { id: newId(), chatId: chat.id, role: asUser ? 'user' : 'char', name: asUser ? ((persona?.name as string | undefined) ?? 'You') : (((character?.card as Row | undefined)?.name as string | undefined) ?? 'Character'), text, createdAt: Date.now() }
        await ctx.rest('POST', '/api/messages', message)
        await ctx.rest('PUT', `/api/chats/${enc(String(chat.id))}`, {})
        return json({ added: true, message_id: message.id })
      },
    }),
    reader({
      name: 'list_facts',
      title: 'List remembered facts',
      description: 'Durable facts remembered for a chat, newest first.',
      inputSchema: shape({ chat_id: str('Chat id.') }, ['chat_id']),
      run: async (a) => {
        const chat = activeChat(a.chat_id)
        return json(chatFactStore.list({ where: 'chatId = ?', params: [chat.id], orderBy: 'createdAt DESC' }).map((f) => ({ id: f.id, text: f.text, active: f.active !== false, importance: f.importance, unresolved: f.unresolved })))
      },
    }),
    writer({
      name: 'remember_fact',
      title: 'Remember a fact in a chat',
      description: 'Stores a durable fact the character will recall in this chat, for example "Mara is allergic to cats". Keep each fact to one sentence.',
      inputSchema: shape({ chat_id: str('Chat id.'), text: str('The fact, one sentence.'), importance: num('0 to 1, how much it matters long-term. Default 0.5.') }, ['chat_id', 'text']),
      run: async (a, ctx) => {
        const chat = activeChat(a.chat_id)
        const text = clean(a.text, 500)
        if (!text) throw new Error('"text" cannot be empty')
        const created = (await ctx.rest('POST', '/api/chat-facts', { chatId: chat.id, text, importance: clamp(a.importance, 0, 1, 0.5), active: true })) as Row
        return json({ remembered: true, id: created.id })
      },
    }),
    reader({
      name: 'get_relationship',
      title: 'Read relationship state',
      description: 'The chat\'s relationship state: affection, stage, stats, commitment, scene flags, coins and current mood.',
      inputSchema: shape({ chat_id: str('Chat id.') }, ['chat_id']),
      run: async (a) => {
        const c = activeChat(a.chat_id)
        return json({
          chat_id: c.id,
          character_id: c.characterId,
          affection: c.affection ?? 0,
          stage: c.relationshipStage ?? 'near_strangers',
          stats: c.relationshipStats ?? {},
          commitment: c.commitmentStatus ?? 'none',
          scene_flags: c.sceneFlags ?? [],
          coins: c.giftCoins ?? 0,
          inventory: { ...((c.giftInventory as Row | undefined) ?? {}), ...((c.itemInventory as Row | undefined) ?? {}) },
          mood: c.mood,
          memory_summary: c.summary || undefined,
        })
      },
    }),

    // Extensions
    reader({
      name: 'get_extension_guide',
      title: 'Extension developer guide',
      description: 'The full guide to writing extensions: manifest, sandbox rules, permissions, the rp API, hooks, tools and themes. Read it before writing one.',
      inputSchema: shape({}),
      run: async () => ({ text: extensionGuide() }),
    }),
    reader({
      name: 'list_extensions',
      title: 'List extensions',
      description: 'Installed extensions with their state and the permissions they request.',
      inputSchema: shape({}),
      run: async () => json(ext.listExtensions().map((e) => extensionSummary(e.id))),
    }),
    reader({
      name: 'get_extension',
      title: 'Inspect an extension',
      description: 'Manifest, file list and lint findings for one extension.',
      inputSchema: shape({ id: str('Extension id.') }, ['id']),
      run: async (a) => {
        const id = clean(a.id, 60)
        const summary = extensionSummary(id)
        return json({ ...summary, manifest: ext.getExtension(id)?.manifest, files: ext.listFiles(id), lint: ext.lintExtension(id) })
      },
    }),
    reader({
      name: 'read_extension_file',
      title: 'Read an extension file',
      description: 'Returns the text of one file in an extension.',
      inputSchema: shape({ id: str('Extension id.'), path: str('File path such as panel.html.') }, ['id', 'path']),
      run: async (a) => {
        const file = ext.readFile(clean(a.id, 60), clean(a.path, 200))
        if (file.encoding === 'base64') return json({ path: file.path, binary: true, mime: file.mime, note: 'Binary file, not shown.' })
        return { text: file.content }
      },
    }),
    reader({
      name: 'scaffold_extension',
      title: 'Get a starter extension',
      description: 'Returns a working starter bundle (manifest and files) to adapt. It is not installed; pass the edited result to create_extension.',
      inputSchema: shape({ kind: str('What to start from.', { enum: STARTER_KINDS.map((k) => k.id) }), id: str('Extension id: lowercase letters, digits and dashes, 3 to 40 characters.'), name: str('Display name.'), description: str('One sentence.') }, ['kind', 'id', 'name']),
      run: async (a) => {
        const kind = STARTER_KINDS.find((k) => k.id === a.kind)
        if (!kind) throw new Error(`"kind" must be one of ${STARTER_KINDS.map((k) => k.id).join(', ')}`)
        return json(starterBundle({ id: clean(a.id, 40), name: clean(a.name, 60), description: clean(a.description, 200), kind: kind.id as StarterKind }))
      },
    }),
    writer({
      name: 'create_extension',
      title: 'Install an extension',
      description:
        'Installs (or replaces) an extension from a manifest and a map of file path to text content. It always arrives switched off with no permissions granted; tell the user to review and enable it in Extensions. Replacing an existing extension switches it off again. Returns lint findings: fix any errors and rewrite.',
      inputSchema: shape(
        {
          manifest: shape({}, [], 'The extension manifest. See get_extension_guide.'),
          files: shape({}, [], 'Map of file path to file text, for example {"panel.html": "<h1>Hi</h1>"}.'),
        },
        ['manifest', 'files'],
      ),
      run: async (a) => {
        const result = ext.installBundle({ format: 'rp-extension', version: 1, manifest: a.manifest, files: a.files }, 'agent')
        const id = result.record.id
        const locked = lockForReview(id)
        return json({
          installed: true,
          created: result.created,
          id,
          revision: result.record.rev,
          permissions_requested: result.record.manifest.permissions,
          warnings: result.warnings,
          lint: ext.lintExtension(id),
          note: locked ?? 'Installed switched off. The user must open Extensions, review the permissions and turn it on.',
        })
      },
    }),
    writer({
      name: 'write_extension_file',
      title: 'Write an extension file',
      description: 'Creates or replaces one text file in an extension. The extension is switched off for review if it was on.',
      inputSchema: shape({ id: str('Extension id.'), path: str('File path such as panel.html.'), content: str('Full file text.') }, ['id', 'path', 'content']),
      run: async (a) => {
        const id = clean(a.id, 60)
        const record = ext.writeFile(id, a.path, a.content)
        const locked = lockForReview(id)
        return json({ written: a.path, revision: record.rev, files: record.fileCount, lint: ext.lintExtension(id), note: locked })
      },
    }),
    writer({
      name: 'delete_extension_file',
      title: 'Delete an extension file',
      description: 'Deletes one file from an extension. Files referenced by the manifest cannot be deleted.',
      annotations: { destructiveHint: true },
      inputSchema: shape({ id: str('Extension id.'), path: str('File path.') }, ['id', 'path']),
      run: async (a) => {
        const id = clean(a.id, 60)
        const record = ext.deleteFile(id, clean(a.path, 200))
        return json({ deleted: a.path, files: record.fileCount, note: lockForReview(id) })
      },
    }),
    writer({
      name: 'update_extension_manifest',
      title: 'Replace an extension manifest',
      description: 'Replaces the manifest. Every file it references must already exist. The extension is switched off for review if it was on.',
      inputSchema: shape({ id: str('Extension id.'), manifest: shape({}, [], 'The full new manifest.') }, ['id', 'manifest']),
      run: async (a) => {
        const id = clean(a.id, 60)
        const record = ext.setManifest(id, a.manifest)
        const locked = lockForReview(id)
        return json({ updated: true, revision: record.rev, lint: ext.lintExtension(id), note: locked })
      },
    }),
    reader({
      name: 'lint_extension',
      title: 'Check an extension',
      description: 'Static checks: missing permissions, forbidden APIs, broken references. Run after every change.',
      inputSchema: shape({ id: str('Extension id.') }, ['id']),
      run: async (a) => {
        const findings = ext.lintExtension(clean(a.id, 60))
        return json({ ok: findings.every((f) => f.level !== 'error'), findings })
      },
    }),
  ]
}

// ---- Resources ----

function resources(): ResourceDef[] {
  return [
    { uri: 'rp://docs/extension-guide', name: 'Extension developer guide', description: 'How to write extensions: manifest, sandbox, permissions and the rp API.', mimeType: 'text/markdown', read: async () => extensionGuide() },
    { uri: 'rp://docs/data-model', name: 'Library data model', description: 'How characters, worlds and lorebooks are structured, with writing advice.', mimeType: 'text/markdown', read: async () => DATA_MODEL_GUIDE },
  ]
}

function templates(): ResourceTemplateDef<McpContext>[] {
  const match = (uri: string, kind: string) => new RegExp(`^rp://${kind}/([^/]+)$`).exec(uri)?.[1]
  return [
    {
      uriTemplate: 'rp://character/{id}',
      name: 'Character',
      description: 'One character card as JSON.',
      mimeType: 'application/json',
      read: async (uri) => {
        const id = match(uri, 'character')
        const row = id ? characterStore.get(decodeURIComponent(id)) : undefined
        return row ? JSON.stringify(characterView(row), null, 2) : undefined
      },
    },
    {
      uriTemplate: 'rp://world/{id}',
      name: 'World',
      description: 'One world with its lore entries as JSON.',
      mimeType: 'application/json',
      read: async (uri) => {
        const id = match(uri, 'world')
        const row = id ? worldStore.get(decodeURIComponent(id)) : undefined
        if (!row) return undefined
        const entries = (((row.lorebook as Row | undefined)?.entries as Row[] | undefined) ?? []).map(entryView)
        return JSON.stringify({ ...worldView(row), lorebook: entries }, null, 2)
      },
    },
    {
      uriTemplate: 'rp://extension/{id}',
      name: 'Extension',
      description: 'An installed extension\'s manifest and file list as JSON.',
      mimeType: 'application/json',
      read: async (uri) => {
        const id = match(uri, 'extension')
        const rec = id ? ext.getExtension(decodeURIComponent(id)) : undefined
        return rec ? JSON.stringify({ ...extensionSummary(rec.id), manifest: rec.manifest, files: ext.listFiles(rec.id) }, null, 2) : undefined
      },
    },
  ]
}

// ---- Prompts ----

function prompts(): PromptDef[] {
  const user = (text: string) => [{ role: 'user' as const, text }]
  return [
    {
      name: 'create_character',
      title: 'Design a character',
      description: 'Develops a character concept into a full card and saves it.',
      arguments: [
        { name: 'concept', description: 'The idea, in a sentence or two.', required: true },
        { name: 'world_id', description: 'Optional world for the character to live in.' },
      ],
      get: (a) =>
        user(
          `Create a character for ${BRAND.name} from this concept: ${a.concept}\n\nFirst read the rp://docs/data-model resource and call search_library to avoid duplicates${a.world_id ? `, then get_world for world ${a.world_id}` : ''}. Write a card with a distinct voice: a specific description, a behavioural personality, a scenario, a first_mes that opens a scene in their voice, and a short mes_example. Add three to six lore_entries only if the character has facts that deserve their own triggers. Save it with create_character${a.world_id ? ` using world_id ${a.world_id}` : ''}, then summarise what you made.`,
        ),
    },
    {
      name: 'create_world',
      title: 'Build a world',
      description: 'Develops a setting with rules and a populated lorebook.',
      arguments: [{ name: 'concept', description: 'The setting idea.', required: true }],
      get: (a) =>
        user(
          `Build a world for ${BRAND.name} from this concept: ${a.concept}\n\nRead rp://docs/data-model first. Write a description (setting, tone, daily life) and rules (hard constraints). Then write 15 to 30 lorebook entries covering places, factions, notable people, customs and objects, each with 3 to 8 specific keys. Save everything in one create_world call, then list what you created.`,
        ),
    },
    {
      name: 'expand_lore',
      title: 'Expand a lorebook',
      description: 'Adds new entries that fit what a world or character already has.',
      arguments: [
        { name: 'world_id', description: 'The world whose lorebook to extend.', required: true },
        { name: 'focus', description: 'What to add more of, for example "the northern guilds".' },
      ],
      get: (a) =>
        user(
          `Extend the lorebook of world ${a.world_id}${a.focus ? ` with more about: ${a.focus}` : ''}.\n\nCall get_world and get_lorebook (owner "world") first, and do not repeat existing entries or contradict them. Add 8 to 15 new entries with add_lore_entries, each a short self-contained fact with specific keys.`,
        ),
    },
    {
      name: 'story_recap',
      title: 'Recap a chat and save memories',
      description: 'Reads a chat, writes a recap and stores the durable facts.',
      arguments: [{ name: 'chat_id', description: 'The chat to recap.', required: true }],
      get: (a) =>
        user(
          `Read chat ${a.chat_id} with read_chat (page back until you have the whole story if needed) and call list_facts. Write a short recap, then store five to ten durable facts that are not already remembered using remember_fact: promises, secrets, preferences, relationships. One sentence each.`,
        ),
    },
    {
      name: 'build_extension',
      title: 'Build an extension',
      description: 'Designs, writes and lints a small extension.',
      arguments: [{ name: 'idea', description: 'What the extension should do.', required: true }],
      get: (a) =>
        user(
          `Build a ${BRAND.name} extension: ${a.idea}\n\nRead rp://docs/extension-guide first. Keep it small and request the fewest permissions. Start from scaffold_extension, then install with create_extension and fix every lint error with write_extension_file. Finish by telling me which permissions it asks for and why, and remind me it is installed switched off.`,
        ),
    },
  ]
}

export const MCP_INSTRUCTIONS = [
  `${BRAND.name} is a local roleplay and interactive-fiction app. These tools read and build the user's library.`,
  '- Call get_overview first, and search_library before creating anything that may already exist.',
  '- Characters need name, description and first_mes (the opening message, in their voice).',
  '- Lorebook entries fire when their keys appear in the chat: give each specific keys and one idea. Use constant:true rarely.',
  '- Read rp://docs/data-model for writing advice and get_extension_guide before writing an extension.',
  '- Extensions you install arrive switched off with no permissions. Tell the user to review and enable them in the app.',
  '- You cannot delete characters, worlds or chats. Ask the user to do that in the app.',
].join('\n')

export function createMcpConfig(version: string): McpConfig<McpContext> {
  return {
    serverInfo: { name: BRAND_ID, version },
    instructions: MCP_INSTRUCTIONS,
    tools: tools(),
    resources: resources(),
    templates: templates(),
    prompts: prompts(),
  }
}
