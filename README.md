# RP Suite

A local-first, character-centric roleplay frontend for [KoboldCpp](https://github.com/LostRuins/koboldcpp) — built to grow from a SillyTavern-style chat client into a full visual-novel and dating-sim suite, without ever leaving your machine.

## Goals

Most roleplay frontends treat every conversation the same way: one text box, one system prompt, one running transcript. RP Suite starts from a different premise — a "character" should be able to support the full range of how people actually want to use one:

- **Plain assistant chat** — just talk to a model.
- **Freeform roleplay** — an open-ended story with a persistent character and world.
- **A visual novel** — backgrounds, sprites, and expressions that react to the scene, not just scrolling text.
- **A dating sim** — a relationship that actually tracks affection, remembers gifts and milestones, and unlocks content as it deepens.
- **A lore/worldbuilding companion** — a character used as a reference for a setting rather than someone to date.

The long-term goal (tracked in [ROADMAP.md](ROADMAP.md)) is to make that whole spectrum genuinely authorable: characters with schedules, memory, and moods that can reach out on their own, worlds with their own economy and relationship rules, and none of it locked behind a hosted service. Everything — chats, characters, worlds, avatars, sprites — lives in one SQLite file and a folder of images on your disk. There's no account, no cloud sync, and no telemetry; the only network calls this app makes are to the local KoboldCpp server you point it at (and, optionally, a TTS/STT provider you configure yourself).

## Features today

- **Chat** — streamed generation, swipes/regeneration, editable messages, message forking (branch a chat at any message without losing the original), impersonation, and image/text attachments.
- **Visual Novel mode** — full-bleed scene backgrounds and character sprites that change with the model's tagged mood/location, with a collapsible backlog for the classic transcript view.
- **Dating-sim mechanics** — an affection meter with authorable per-world stage thresholds, a gift economy with a per-world catalog and per-character preferences, unlockable CG galleries, branching scene-memory flags, date/event scenarios tied to the objective system, and relationship-starter presets for seeding a chat's backstory.
- **Characters & worlds** — full card editors (SillyTavern V2-compatible), per-character sprites/expressions and TTS voice overrides, per-world lorebooks and backgrounds, and portable `.rppack.json` character packs that bundle everything (sprites, gallery, gift preferences, bound world) into one shareable file.
- **World Info / lorebooks** — keyword or always-on entries, scoped to a character or shared globally across chats.
- **Companion mode** — hands-free voice conversation (STT in, TTS out) with barge-in support.
- **Personas** — multiple player identities to chat as.
- **Themes** — full color/layout customization, exportable and shareable.
- **Data ownership** — one-click full backup/restore of the entire install, independent of the per-character pack export.

See [ROADMAP.md](ROADMAP.md) for what's implemented vs. still open, including the larger living-world dating-sim expansion (calendar/energy/weather simulation, live scored dates, proactive character texts, and more).

## Architecture

- **Client**: React + TypeScript + Vite + Tailwind, in `src/`.
- **Server**: a small local Express API in `server/`, storing everything in a single SQLite database (`data/rp.db`, via Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)) plus uploaded images under `data/avatars/`.
- **Model backend**: [KoboldCpp](https://github.com/LostRuins/koboldcpp), talked to directly over HTTP from the browser — this app is a frontend, not an inference server.

In development, Vite (port `5173`) proxies `/api` and `/avatars` to the local Express server (port `3001`), so the browser only ever talks to one origin.

## Getting started

**Prerequisites**

- Node.js 22.5+ (this project uses Node's built-in SQLite module, run behind the `--experimental-sqlite` flag until it's unflagged in a future Node release — already wired into the `dev:server` script).
- A running [KoboldCpp](https://github.com/LostRuins/koboldcpp) instance with a model loaded.

**Run it**

```bash
npm install
npm run dev
```

This starts the Vite dev server and the local API server together. Open `http://localhost:5173`, then set your KoboldCpp URL in Settings → Connection (defaults to `http://localhost:5001`).

**Scripts**

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the client (Vite) and local API server together, with hot reload. |
| `npm run build` | Type-checks and builds a production client bundle. |
| `npm run typecheck` | Type-checks the client, server, and Vite config. |
| `npm run preview` | Serves the production build locally. |

## Project layout

```
src/
  components/   UI, grouped by feature (chat, characters, worlds, settings, ...)
  lib/          Client-side logic: API client, prompt building, dating-sim rules,
                character card spec, VN scene tagging, voice providers, hooks
server/
  app.ts        Express routes (REST API over the SQLite store)
  db.ts         SQLite schema and generic per-table store
  avatars.ts    Image upload handling
data/           SQLite database + uploaded images (gitignored, created on first run)
ROADMAP.md      Living to-do list — what's done, what's planned, and why
```

## Privacy & data

Everything this app knows about your characters, chats, and worlds stays in `data/` on your own disk. There is no server-side account system and no analytics. If you use the optional cloud TTS/STT providers in Settings → Voice, audio is sent to whichever provider you configure there — everything else stays local.
