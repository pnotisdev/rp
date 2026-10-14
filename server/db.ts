import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// RP_DATA_DIR points the whole server at a throwaway data folder (see scripts/dev-sandbox.mjs).
export const dataDir = process.env.RP_DATA_DIR ? path.resolve(process.env.RP_DATA_DIR) : path.resolve(__dirname, '..', 'data')
export const avatarsDir = path.join(dataDir, 'avatars')
fs.mkdirSync(avatarsDir, { recursive: true })

// Node's built-in SQLite (stable API since v22.5, run behind --experimental-sqlite until it's unflagged)
export const db = new DatabaseSync(path.join(dataDir, 'rp.db'))
// Must be the very first statement on this connection, before anything else touches the file.
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/** Fold the write-ahead log back into rp.db so the main database file is self-contained and current. */
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

  -- Plain assistant conversations. Deliberately not the chats table, which requires a characterId
  -- and carries the whole relationship track; an assistant thread has neither. Messages live in the
  -- row's own JSON rather than in the messages table, since a thread is read front to back and is
  -- never searched per-message or forked mid-way.
  CREATE TABLE IF NOT EXISTS assistant_threads (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
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

  -- Machine-local app state (agent access token and switches). Deliberately outside backup/restore.
  CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS extensions (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS extension_files (
    id TEXT PRIMARY KEY,
    extId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_extension_files_extId ON extension_files(extId);

  CREATE TABLE IF NOT EXISTS extension_data (
    id TEXT PRIMARY KEY,
    extId TEXT NOT NULL,
    scope TEXT NOT NULL,
    scopeId TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_extension_data_ext ON extension_data(extId, scope, scopeId);
  CREATE INDEX IF NOT EXISTS idx_extension_data_scope ON extension_data(scope, scopeId);

  CREATE TABLE IF NOT EXISTS vector_chunks (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scopeId TEXT NOT NULL,
    source TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vector_chunks_scope ON vector_chunks(scope, scopeId, source);
`)

type Row = Record<string, unknown>

// Every value that actually reaches a bind site here is a string, number, or null (ids, timestamps, a JSON blob)
function bind(v: unknown): SQLInputValue {
  return v as SQLInputValue
}

interface ColumnSpec {
  name: string
}

/** A table where a few fields get real (indexed/queryable) SQLite columns and everything else rides along as one JSON blob column. */
const SQL_CLAUSE_KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IS', 'NULL', 'ASC', 'DESC', 'IN', 'LIKE'])

/** Every current where/orderBy call site is a hardcoded literal */
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
export const assistantThreadStore = createStore('assistant_threads', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const worldStore = createStore('worlds', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const objectiveStore = createStore('objectives', [
  { name: 'chatId' },
  { name: 'status' },
  { name: 'createdAt' },
  { name: 'updatedAt' },
])
export const relationshipEventStore = createStore('relationship_events', [{ name: 'chatId' }, { name: 'createdAt' }])
export const chatFactStore = createStore('chat_facts', [{ name: 'chatId' }, { name: 'createdAt' }])
export const appSettingsStore = createStore('app_settings', [{ name: 'updatedAt' }])
export const vectorChunkStore = createStore('vector_chunks', [{ name: 'scope' }, { name: 'scopeId' }, { name: 'source' }, { name: 'createdAt' }])
export const extensionStore = createStore('extensions', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const extensionFileStore = createStore('extension_files', [{ name: 'extId' }, { name: 'updatedAt' }])
export const extensionDataStore = createStore('extension_data', [
  { name: 'extId' },
  { name: 'scope' },
  { name: 'scopeId' },
  { name: 'updatedAt' },
])

/** Runs `fn` inside one SQLite transaction; rolls back and rethrows on failure. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function newId(): string {
  return crypto.randomUUID()
}
