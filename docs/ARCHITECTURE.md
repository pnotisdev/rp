# Architecture

One Node process serves an Express API (`server/`) and, in production, the built React client. Everything is stored in a SQLite file under `data/` (Node's built-in `node:sqlite`), with images and audio as real files beside it. The browser talks to the model backend directly.

## Client: `src/`

| Path | Role |
| --- | --- |
| `App.tsx` | Shell: sidebar, the active view, global dialogs, hotkeys |
| `components/<area>/` | UI by area: `chat`, `characters`, `worlds`, `personas`, `worldinfo` (the Lorebooks page), `gallery`, `assistant`, `extensions`, `settings`, `layout` (sidebar, command palette) |
| `components/ui/` | The shared kit: `ViewShell`, `EditorShell`, `Modal`, `Section`, `Field`, `Button`, `DropZone`, `MenuButton`, … Build screens from these, with semantic colour tokens (`bg-bg-elevated`, `border-border`, `text-text-muted`, `bg-accent`) and no ad-hoc shadows or pills |
| `components/*/editor/` | The big editors (character, world) are a state hook (`use…Editor.ts`) plus one file per tab; each tab takes the hook's return value `f` |
| `lib/api/` | `client.ts` (REST resources), model backends (KoboldCpp, OpenAI-compatible, image, voice) |
| `lib/characters/` | Card spec, SillyTavern import/export, PNG card reader/writer, packs, bulk import |
| `lib/io/` | Download and file-picking helpers, the persona/world export envelope |
| `lib/worldinfo/` | Lorebook activation, scope, facts, lorebook import/export |
| `lib/dating/`, `lib/world/`, `lib/persona/`, `lib/vn/` | The simulation: relationship stats, scenes, calendar and triggers, the live persona engine, visual-novel presentation |
| `lib/prompt/` | Prompt building, instruct templates, summarising |
| `lib/store/` | Zustand stores (settings, toasts, confirm); defaults and theme tokens live in `useSettingsStore.ts`; `looks.ts`, `fonts.ts` and `paletteGen.ts` define the Looks, font stacks and the one-hue palette generator. The product name is `lib/brand.json` |
| `lib/hooks/` | `useChatSession` (the chat engine), theme, auto-config |
| `styles/globals.css` | Theme tokens (light and dark), base styles, VN-only effects |

## Server: `server/`

`index.ts` boots; `app.ts` holds the REST routes; `db.ts` the schema and JSON-blob storage (most new fields need no migration); `avatars.ts` image files; `extensions.ts`, `mcp*.ts`, `agentTools.ts` the extension host and the MCP server; `workspace.ts` and `assistantMemory.ts` the Assistant's own file, web and memory tools (kept out of MCP); `imageProxies.ts` the relay for ComfyUI and NovelAI, which send no CORS headers; `seed*.ts` bundled content. Register a literal route (`/api/messages/search`) before a same-prefix `/:id` route.

## Conventions

- **Where things go:** pure logic in `lib/` with a sibling `*.test.ts`; UI in `components/<area>/`; one component per file.
- **Chat-scoped tables:** a new one must be added to the character-delete cascade, the chat-delete cascade, `BACKUP_STORES` and chat forking in `server/app.ts`.
- **Import/export:** cards via `lib/characters`, lorebooks via `lib/worldinfo/lorebookIo.ts`, personas and worlds via `lib/io/transfer.ts`.
- **Checks:** `npm run typecheck`, `npm test`, `npm run build`. `noUnusedLocals` is on.
- **Comments:** one line each; say why, not what.
