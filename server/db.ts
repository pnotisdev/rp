import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const dataDir = path.resolve(__dirname, '..', 'data')
export const avatarsDir = path.join(dataDir, 'avatars')
fs.mkdirSync(avatarsDir, { recursive: true })

// Node's built-in SQLite (stable API since v22.5, run behind --experimental-sqlite until it's
// unflagged) — replaces better-sqlite3, whose prebuilt native binary crashed the process outright
// (STATUS_ACCESS_VIOLATION) on some Windows/Node combinations, this one included. Being built
// into Node itself instead of a separately-downloaded .node binary avoids that whole class of bug.
export const db = new DatabaseSync(path.join(dataDir, 'rp.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/**
 * Fold the write-ahead log back into rp.db so the main database file is self-contained and
 * current. WAL writes are already durable on disk (in rp.db-wal); this just means the primary
 * file alone is enough for a manual copy/backup. Called on clean server shutdown.
 */
export function checkpointDb(): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    worldId TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_characters_updatedAt ON characters(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_characters_worldId ON characters(worldId);

  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    characterId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_characterId ON chats(characterId);
  CREATE INDEX IF NOT EXISTS idx_chats_updatedAt ON chats(updatedAt);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chatId_createdAt ON messages(chatId, createdAt);

  CREATE TABLE IF NOT EXISTS world_info_books (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS instruct_templates (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_objectives_chatId_status ON objectives(chatId, status);

  CREATE TABLE IF NOT EXISTS relationship_events (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_relationship_events_chatId_createdAt ON relationship_events(chatId, createdAt);

  CREATE TABLE IF NOT EXISTS chat_facts (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_facts_chatId_createdAt ON chat_facts(chatId, createdAt);
`)

type Row = Record<string, unknown>

// Every value that actually reaches a bind site here is a string, number, or null (ids,
// timestamps, a JSON blob) — this is a type-only cast, not a runtime coercion.
function bind(v: unknown): SQLInputValue {
  return v as SQLInputValue
}

interface ColumnSpec {
  name: string
}

/**
 * A table where a few fields get real (indexed/queryable) SQLite columns and
 * everything else rides along as one JSON blob column. This mirrors exactly what
 * the old IndexedDB store already did (whole objects, a couple of indexed keys) — a
 * full relational schema isn't warranted for a single-user local app, but plain
 * flat files can't be queried or sorted, which is why this sits in between.
 */
const SQL_CLAUSE_KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IS', 'NULL', 'ASC', 'DESC', 'IN', 'LIKE'])

/**
 * Every current where/orderBy call site is a hardcoded literal, so this isn't exploitable
 * today — but nothing stops a future call site from building one out of a request field,
 * and column/clause identifiers can't be parameterized with `?` placeholders. Reject any
 * identifier-shaped token that isn't one of this table's own columns or a known-safe
 * SQL keyword, so that class of bug can't become a real SQL injection later.
 */
function assertSafeClause(kind: 'where' | 'orderBy', clause: string, columnNames: string[]): void {
  const allowedIdentifiers = new Set(['id', ...columnNames])
  const tokens = clause.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  for (const token of tokens) {
    if (allowedIdentifiers.has(token) || SQL_CLAUSE_KEYWORDS.has(token.toUpperCase())) continue
    throw new Error(`Unsafe SQL ${kind} clause: unrecognized identifier "${token}"`)
  }
}

function createStore(table: string, columns: ColumnSpec[]) {
  const columnNames = columns.map((c) => c.name)
  const insertColumns = ['id', ...columnNames, 'data']
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
  )
  const updateStmt = db.prepare(
    `UPDATE ${table} SET ${[...columnNames, 'data'].map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  )
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`)
  const getStmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`)

  function fromRow(row: Row): Row {
    const blob = JSON.parse(row.data as string) as Row
    const result: Row = { id: row.id, ...blob }
    for (const name of columnNames) result[name] = row[name]
    return result
  }

  function blobOf(obj: Row): string {
    const rest = { ...obj }
    delete rest.id
    for (const name of columnNames) delete rest[name]
    return JSON.stringify(rest)
  }

  return {
    list(opts?: { where?: string; params?: unknown[]; orderBy?: string }): Row[] {
      if (opts?.where) assertSafeClause('where', opts.where, columnNames)
      if (opts?.orderBy) assertSafeClause('orderBy', opts.orderBy, columnNames)
      let sql = `SELECT * FROM ${table}`
      if (opts?.where) sql += ` WHERE ${opts.where}`
      if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`
      const rows = db.prepare(sql).all(...(opts?.params ?? []).map(bind)) as Row[]
      return rows.map(fromRow)
    },
    get(id: string): Row | undefined {
      const row = getStmt.get(id) as Row | undefined
      return row ? fromRow(row) : undefined
    },
    insert(obj: Row): Row {
      insertStmt.run(bind(obj.id), ...columnNames.map((c) => bind(obj[c] ?? null)), blobOf(obj))
      return obj
    },
    update(id: string, patch: Row): Row | undefined {
      const existing = getStmt.get(id) as Row | undefined
      if (!existing) return undefined
      const merged: Row = { ...fromRow(existing), ...patch, id }
      updateStmt.run(...columnNames.map((c) => bind(merged[c] ?? null)), blobOf(merged), id)
      return merged
    },
    remove(id: string): void {
      deleteStmt.run(id)
    },
    /** Deletes every row in this table — used only by full-database restore. */
    clear(): void {
      db.exec(`DELETE FROM ${table}`)
    },
  }
}

export const characterStore = createStore('characters', [{ name: 'worldId' }, { name: 'createdAt' }, { name: 'updatedAt' }])
export const personaStore = createStore('personas', [{ name: 'createdAt' }])
export const chatStore = createStore('chats', [{ name: 'characterId' }, { name: 'createdAt' }, { name: 'updatedAt' }])
export const messageStore = createStore('messages', [{ name: 'chatId' }, { name: 'createdAt' }])
export const worldInfoBookStore = createStore('world_info_books', [{ name: 'createdAt' }])
export const presetStore = createStore('presets', [{ name: 'createdAt' }])
export const themeStore = createStore('themes', [{ name: 'createdAt' }])
export const instructTemplateStore = createStore('instruct_templates', [{ name: 'createdAt' }])
export const worldStore = createStore('worlds', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const objectiveStore = createStore('objectives', [
  { name: 'chatId' },
  { name: 'status' },
  { name: 'createdAt' },
  { name: 'updatedAt' },
])
export const relationshipEventStore = createStore('relationship_events', [{ name: 'chatId' }, { name: 'createdAt' }])
export const chatFactStore = createStore('chat_facts', [{ name: 'chatId' }, { name: 'createdAt' }])

export function newId(): string {
  return crypto.randomUUID()
}
