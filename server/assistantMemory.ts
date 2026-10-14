// The Assistant's long-term notes: short facts about the user and their projects that survive across conversations.

import { appSettingsStore, newId } from './db.ts'
import type { ToolDef } from './mcpProtocol.ts'

const SETTINGS_ID = 'assistant-memory'
export const MAX_NOTES = 40
const MAX_NOTE_LENGTH = 300

export interface MemoryNote {
  id: string
  text: string
  createdAt: number
}

export function readNotes(): MemoryNote[] {
  const row = appSettingsStore.get(SETTINGS_ID)
  return Array.isArray(row?.notes) ? (row!.notes as MemoryNote[]) : []
}

function writeNotes(notes: MemoryNote[]): void {
  if (appSettingsStore.get(SETTINGS_ID)) appSettingsStore.update(SETTINGS_ID, { notes, updatedAt: Date.now() })
  else appSettingsStore.insert({ id: SETTINGS_ID, notes, updatedAt: Date.now() })
}

/** Saves a note; a near-identical existing note is refreshed instead of duplicated. */
export function addNote(text: string): MemoryNote {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE_LENGTH)
  if (!clean) throw new Error('The note is empty.')
  const notes = readNotes()
  const dup = notes.find((n) => n.text.toLowerCase() === clean.toLowerCase())
  if (dup) return dup
  const note = { id: newId().slice(0, 8), text: clean, createdAt: Date.now() }
  writeNotes([...notes, note].slice(-MAX_NOTES))
  return note
}

export function removeNote(id: string): boolean {
  const notes = readNotes()
  const next = notes.filter((n) => n.id !== id)
  if (next.length === notes.length) return false
  writeNotes(next)
  return true
}

export const MEMORY_TOOLS: ToolDef<unknown>[] = [
  {
    name: 'remember',
    title: 'Remember something',
    description: 'Save one short, durable fact for future conversations (a preference, a project detail, a decision). Do not save secrets or passing details.',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'One sentence' } }, required: ['note'] },
    annotations: { readOnlyHint: true }, // changes only the Assistant's own notes, so it is allowed in read-only mode
    async run(a) {
      const note = addNote(typeof a.note === 'string' ? a.note : '')
      return { text: `Remembered (${note.id}): ${note.text}` }
    },
  },
  {
    name: 'forget',
    title: 'Forget a note',
    description: 'Remove a saved note by its id (see the notes list in the system prompt or recall).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Note id' } }, required: ['id'] },
    annotations: { readOnlyHint: true }, // changes only the Assistant's own notes, so it is allowed in read-only mode
    async run(a) {
      return removeNote(typeof a.id === 'string' ? a.id : '') ? { text: 'Forgotten.' } : { text: 'There is no note with that id.', isError: true }
    },
  },
  {
    name: 'recall',
    title: 'List saved notes',
    description: 'List everything saved in long-term memory.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run() {
      const notes = readNotes()
      return { text: notes.length ? notes.map((n) => `${n.id}: ${n.text}`).join('\n') : 'No saved notes.' }
    },
  },
]
