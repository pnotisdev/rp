# RP Suite

A local-first, character-centric roleplay frontend for [KoboldCpp](https://github.com/LostRuins/koboldcpp). It started as a SillyTavern-style chat client and has grown into a full visual-novel and dating-sim suite, all running on your own machine.

## What it's for

Most roleplay frontends treat a character as one thing: a system prompt attached to a text box. In practice, people use a character card for several very different kinds of session, and this app tries to support all of them properly instead of picking one:

- Talking to a model like a plain assistant, no persona or story involved.
- Open-ended freeform roleplay with a persistent character and setting.
- A visual novel, where backgrounds and character sprites change with the scene instead of everything staying as scrolling text.
- A dating sim, where a relationship has real state: affection, trust, gifts remembered, milestones, content that unlocks as things progress, and even breakups if a relationship is neglected.
- A lore or worldbuilding reference, where the "character" is really a stand-in for a setting the player consults rather than someone they're dating.

The app doesn't force you into one mode. A character can be a plain chat partner in one conversation and a VN dating-sim lead in another; the mechanics are opt-in per world and per chat.

Two things guide how it's built. First, the model plays the character and the code runs the world: time passing, money, inventory, unlock gates, relationship math and stat deltas are all handled in plain TypeScript, never left for the model to just declare on its own. The model's job is dialogue and interpreting what happened in a scene, and a small validated judgment (say, "affection +2, a new scene flag fired") gets handed back to code that actually applies it. Second, nothing leaves your machine unless you explicitly configure it to. Chats, characters, worlds, avatars, sprites and CGs all live in a SQLite database and a folder of images on disk. There's no account system, no cloud sync and no telemetry. The only network calls this app makes on its own are to the local KoboldCpp server you point it at, plus a TTS/STT provider if you choose to configure one in Settings.

The longer-term direction (tracked in [ROADMAP.md](ROADMAP.md)) is a genuinely living world: characters with schedules and a sense of time passing, weather and a calendar shared across a world, and eventually characters that can reach out on their own instead of only ever responding when spoken to. Most of that groundwork already exists; what's still missing is documented honestly in the roadmap rather than glossed over here.

## Features today

**Chat**

Streamed generation, swipes and regeneration, editable messages, impersonation, and image/text attachments. You can fork a chat from any message, cloning its relationship, gift and gallery state into a brand-new chat without touching the original. Group chats let extra characters join alongside the primary one, with a "reply as" picker controlling whose turn it is. There's message search (instant within a chat, or a debounced search across every chat) and pinned/bookmarked messages, both with jump-to-message and a highlight. Chats export as a standalone, readable HTML transcript. An Author's Note can be injected at a few different positions in the prompt, and regex/find-and-replace scripts can rewrite text independently for what's displayed versus what the model actually sees.

**Visual novel mode**

Full-bleed scene backgrounds and character sprites change based on the mood and location the model tags in its own reply, with a crossfade between expressions and a collapsible backlog if you want the classic transcript view instead. There are 21 built-in expressions, covering general emotional range plus a dating-sim-appropriate love/arousal range, and you can add fully custom expressions per character on top of those. Importing a Character Card V3 (CCv3) file pulls in its portrait and expression assets automatically, mapping common emotion names onto this app's expression ids.

**Dating-sim mechanics**

Relationships track seven numbers, not one: affection plus trust, chemistry, comfort, respect, curiosity and tension, scored by an AI judgment pass after each reply. Those combine into a six-stage warmth ladder, from near strangers up to sweethearts. There's a gift economy with per-world catalogs and per-character preferences, authored likes/dislikes and a love language, and a separate item catalog with its own inventory view. CG galleries unlock as the relationship deepens, including a dedicated endings gallery. Branching scene-memory flags (a handful built in, plus fully custom ones you can author) drive deterministic content gating rather than relying on the model to remember what happened.

Date and event scenes score at the end rather than every turn, so a date reads as one scene instead of a string of independent judgments, and there's a global difficulty setting (Gentle, Normal, Harsh) that scales how forgiving that scoring is. On top of the warmth ladder there's a separate "define the relationship" track for commitment status, and a relationship under real, sustained strain can actually break up, with reconciliation possible afterward rather than the stat just sitting there stuck. Every relationship change is logged as an event, not just folded into a running total, and durable facts persist across a chat so the model doesn't have to re-derive what already happened. Milestones surface as toasts with a small keepsake memory attached, and a plain-language summary of where the relationship stands gets folded into the prompt itself, so the model's tone actually tracks the numbers instead of a raw score ever being shown to it.

**Living world**

Worlds run on a repeating calendar (four seasons of 28 days each) with weather that's deterministic and forecastable rather than randomized per view. A daily energy budget gets spent on actions like starting a date and resets on sleep. Characters can have schedules, and a presence badge in the chat header and chat list shows what a character is currently doing, the first real piece of characters having a life independent of whichever chat window happens to be open.

**Characters, worlds and lorebooks**

Card editors are SillyTavern V2-compatible and can read CCv3 cards, organized into tabs (Identity, Life & background, Visual novel, Dating sim, World sim, Voice, Advanced) rather than one long scrolling form. You can author life context directly: likes, goals, boundaries, social connections, occupation, home and frequented locations, all of which actually get folded into what the model knows about the character rather than sitting there as unused editor metadata. Characters can have their own sprite sets, a TTS voice override, and relationship-starter presets that seed a chat's backstory from the very first message. World Info/lorebooks support keyword, always-on and manual activation, probability, inclusion groups, regex keys, recursive scanning, and explicit scoping to specific characters or worlds rather than every book being global by default. A character (with its sprites, gallery, gift preferences and bound world) can be exported as a single `.rppack.json` file for sharing, separate from the plain SillyTavern PNG/JSON format this app also still reads and writes.

**Companion mode**

Hands-free voice conversation: speech-to-text in, text-to-speech out, with barge-in support so you can interrupt.

**Personas**

Multiple player identities to chat as. If you start a chat with no persona created yet, the app asks inline for a name and a line about who you are instead of silently telling the model your name is "You".

**Onboarding**

A fresh install lands on a Welcome screen rather than an empty app: it probes for KoboldCpp on the common local ports and offers a one-click connection, plus a bundled sample character you can start chatting with immediately. Empty states throughout the app (no characters, no worlds, no chats) point you at a clear next action instead of just saying "nothing here."

**Themes**

Full color and layout customization, with a few built-in presets (including Sakura and Neon Night) to start from, and the ability to export/import a theme.

**Data ownership**

One-click backup and restore of the entire install as a single file, restored atomically so a bad or partial file can't leave the database half-overwritten. This is separate from the per-character pack export above. The server also does a clean WAL checkpoint on shutdown, so a copy of `rp.db` by itself (without its sidecar files) is always a complete, valid backup.

See [ROADMAP.md](ROADMAP.md) for the full history and for what's honestly still missing: proactive, unprompted messages from characters, a genuinely live turn-by-turn date mode instead of an ordinary chat with scoring bolted on, per-world "templates" that pick which mechanics apply, and mobile/responsive support.

## Architecture

- **Client**: React, TypeScript, Vite and Tailwind, in `src/`.
- **Server**: a small local Express API in `server/`, storing everything in one SQLite database (`data/rp.db`, via Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html)) plus uploaded images under `data/avatars/`.
- **Model backend**: [KoboldCpp](https://github.com/LostRuins/koboldcpp), called directly over HTTP from the browser. This app is a frontend, not an inference server, and doesn't run or manage a model itself.
- **Tests**: `vitest`, covering the model-output repair heuristics, card normalization, World Info activation, prompt building, regex scripts, and dating-sim stage/calendar logic.

In development, Vite (port `5173`) proxies `/api` and `/avatars` to the local Express server (port `3001`), so the browser only ever talks to one origin.

## Getting started

**Prerequisites**

- Node.js 22.5 or newer. This project uses Node's built-in SQLite module, run behind the `--experimental-sqlite` flag until it's unflagged in a future Node release; that flag is already wired into the `dev:server` script.
- A running [KoboldCpp](https://github.com/LostRuins/koboldcpp) instance with a model loaded.

**Run it**

```bash
npm install
npm run dev
```

This starts the Vite dev server and the local API server together. Open `http://localhost:5173`. A fresh install lands on a Welcome screen that helps you connect to KoboldCpp (defaults to `http://localhost:5001`) and start your first chat with the bundled sample character.

**Scripts**

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the client (Vite) and local API server together, with hot reload. |
| `npm run build` | Type-checks and builds a production client bundle. |
| `npm run typecheck` | Type-checks the client, server, and Vite config. |
| `npm test` | Runs the test suite (`vitest run`). |
| `npm run test:watch` | Runs the test suite in watch mode. |
| `npm run preview` | Serves the production build locally. |

## Project layout

```
src/
  components/   UI, grouped by feature (chat, characters, worlds, worldinfo,
                personas, gallery, companion, settings, layout, ui)
  lib/          Client-side logic:
                api/          KoboldCpp + local REST API clients
                characters/   card spec (V2/V3), PNG embed, pack export/import
                dating/       gifts, stage/warmth math, commitment/breakup logic
                export/       HTML chat-transcript export
                hooks/        useChatSession and friends
                objectives/   date/event objective system
                prompt/       prompt assembly, instruct templates, choices
                store/        Zustand settings/UI state, theme presets
                text/         message segment parsing, regex scripts
                vn/           scene-tag parsing, expressions
                voice/        TTS/STT/VAD providers
                world/        calendar, weather, energy economy
                worldinfo/    lorebook activation and scope binding
server/
  app.ts          Express routes (REST API over the SQLite store)
  db.ts           SQLite schema and generic per-table store
  avatars.ts      Image upload handling and validation
  seedContent.ts  Bundled demo world/character shown on first run
data/             SQLite database and uploaded images (gitignored, created on first run)
seed/             Source art for the bundled demo content
ROADMAP.md        Living to-do list, what's done, what's planned, and why
```

## Privacy and data

Everything this app knows about your characters, chats and worlds stays in `data/` on your own disk. There's no server-side account system and no analytics. If you turn on one of the optional cloud TTS/STT providers in Settings → Voice, audio is sent to whichever provider you configure there. Everything else stays local.

### Where your data lives

Nothing that matters is kept in the browser. All content is written to disk by the local API server:

```
data/
  rp.db                     SQLite database: every character, chat, message, world,
                            lorebook, persona, objective, relationship event, chat fact,
                            and saved theme/preset. (rp.db-wal and rp.db-shm are SQLite's
                            write-ahead log; copy all three together, or stop the server
                            first, since it checkpoints on a clean Ctrl+C and folds them
                            back into rp.db.)
  avatars/
    characters/<id>/         avatar plus sprites/ and gallery/ for one character
    worlds/<id>/             avatar plus backgrounds/ for one world
    personas/<id>.<ext>      one image per persona
```

The only thing stored in the browser (`localStorage`, under the key `rp-settings`) is per-device UI preference: the KoboldCpp URL, which character/chat is currently active, theme colors, layout toggles, sampler defaults, and voice config. Clearing it resets those preferences but never touches your characters, chats or worlds. To move an install to another machine, use Settings → Data → Download backup for one JSON file with everything (images included), or just copy the `data/` folder directly.
