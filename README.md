# RP Suite

A local-first roleplay client for [KoboldCpp](https://github.com/LostRuins/koboldcpp). Character cards, World Info, and full sampler control like SillyTavern, but built around a real dating-sim and visual novel layer underneath, and a much calmer interface on top.

<p align="center">
  <img src="screenshots/rp-visual-novel-chat.png" alt="Visual novel style chat with a character sprite over a classroom background" width="820">
</p>

## What this is

rp is a chat frontend for locally hosted language models, talking directly to KoboldCpp's own API rather than an OpenAI-style chat-completions endpoint. It imports SillyTavern-format character cards, understands World Info lorebooks, and gives you the same low-level sampler and instruct-template control that SillyTavern users are used to.

What it adds on top is a simulation layer that treats a roleplay less like a text box and more like an ongoing relationship: affection and six relationship dimensions tracked per character, a world clock with seasons and weather, gift economies, gallery unlocks, scheduled characters who can text you first, and a visual novel presentation mode with sprites, expressions, and backgrounds that react to what's actually happening in the scene.

Everything runs on your machine. Characters, chats, worlds and personas are stored in a local SQLite database, not a cloud account, and the app never talks to anything except the KoboldCpp instance you point it at.

## Why it exists

SillyTavern is powerful but it looks and feels like a tool built by and for people who don't mind fighting their UI. This project keeps the parts of that power worth keeping (card compatibility, lorebooks, sampler settings) and rebuilds the rest around two ideas: the interface should get out of the way, and a roleplay with a character should be able to have actual stakes and continuity instead of resetting to zero every session.

Concretely that means:

- **Local and private.** No accounts, no telemetry, no cloud sync. Your characters and conversations live in a `data/` folder on your own disk.
- **Built for one model server.** Not a universal adapter for every API under the sun. Everything is written against KoboldCpp specifically, including streaming, vision, and abort handling, so it can lean on what that server actually supports instead of the lowest common denominator.
- **Simulation over improvisation.** Relationship changes, scene outcomes, and gallery unlocks are decided by small, validated model calls that the app judges and applies deterministically, not by hoping the model remembers to move a number on its own.
- **Quiet by default.** Large negative space, a single accent color, soft corners, no wall of buttons. The interface is meant to feel closer to a well-made reading app than a control panel.

## Who it's for

Anyone who already uses SillyTavern or a similar local roleplay tool and wants the same card ecosystem with a cleaner interface and a deeper simulation underneath. Also for anyone who wants a visual novel style dating sim that runs entirely on their own hardware, with their own choice of model, rather than a fixed set of routes written by someone else.

It assumes you're comfortable running a local model server. This is not a hosted product and there is no cloud fallback if you don't have a GPU or a model to point it at.

## Features

- **Character cards.** Import SillyTavern V2/V3 cards, or write and edit them directly, with AI-assisted field generation if you want a starting point.
- **World Info.** Full lorebook support: probability, inclusion groups, regex keys, recursive scanning, delay activation.
- **Worlds.** A shared setting per group of characters, with its own rules, a day/night/season clock, weather, and scene backgrounds.
- **Relationship simulation.** Affection plus six tracked dimensions (trust, chemistry, comfort, respect, curiosity, tension), scored by the model after each turn and applied by the app, never a raw number the model can just declare on its own.
- **Dates and hangouts.** Start a live, scored scene with a character. A date carries real stakes, including a private hidden agenda for the character and the possibility they walk out. A hangout is the same idea with the stakes turned off.
- **Gifts, gallery, and gold.** A gift economy with per-character preferences, and CG gallery entries that unlock from affection or story flags.
- **Visual novel mode.** Full-bleed scene view with character sprites, expressions, and backgrounds that shift with the conversation, picked by the model from what you've uploaded.
- **Proactive characters.** Give a character a weekly schedule and let them message you first when they'd plausibly be free, instead of only ever waiting on you to open the app.
- **Companion mode.** A hands-free voice conversation mode: talk, the app transcribes it, the character replies, and it's read back out loud.
- **Everything local.** SQLite on disk, avatars and sprites as real files, one `data/` folder you can back up or move as you like.

## Screenshots

<table>
<tr>
<td width="50%">
<img src="screenshots/rp-homescreen.png" alt="Welcome screen on first run">
<p align="center"><em>First run: connected to a model, one character ready to go.</em></p>
</td>
<td width="50%">
<img src="screenshots/rp-character-creation-screen.png" alt="Character editor">
<p align="center"><em>Writing a character: description, personality, scenario, opening line.</em></p>
</td>
</tr>
<tr>
<td width="50%">
<img src="screenshots/rp-character-sprites.png" alt="Character expression sprites grid">
<p align="center"><em>21 expression slots per character for visual novel mode.</em></p>
</td>
<td width="50%">
<img src="screenshots/rp-world-creation-screen.png" alt="World editor">
<p align="center"><em>A world: setting, hard rules, and which tabs it exposes.</em></p>
</td>
</tr>
</table>

<p align="center">
  <img src="screenshots/rp-world-background-scenes.png" alt="World scene backgrounds grid, gated by relationship warmth" width="820">
  <br>
  <em>Scene art per location, unlocked as a relationship warms up.</em>
</p>

## Getting started

You'll need:

- [Node.js](https://nodejs.org/) 22.5 or later. The built-in SQLite support this project uses (`node:sqlite`) needs at least that version; it's developed and tested on Node 24.
- [KoboldCpp](https://github.com/LostRuins/koboldcpp) running somewhere reachable, with a model loaded. This is the only backend rp speaks to. A vision-capable model (loaded with an mmproj file) unlocks the optional image-aware features, but isn't required.

Then:

```bash
git clone https://github.com/pnotisdev/rp.git
cd rp
npm install
npm run dev
```

This starts the Vite dev server on `http://localhost:5173` and a local Express + SQLite API server on port 3001, proxied through the same origin. Open the app, go to Settings, and point the connection at your KoboldCpp instance (`http://localhost:5001` by default). On first run the app seeds one demo character and world so there's something to open immediately.

Everything is stored in `data/` at the project root, a plain SQLite database plus avatar and sprite files. Back it up, move it, or delete it to start fresh; nothing else on your machine is touched.

Other commands worth knowing:

```bash
npm run build       # type-check and produce a production build
npm run typecheck   # type-check only, no build
npm test            # run the test suite once
npm run test:watch  # run it in watch mode
```

## Contributing

This is a hobby project built and maintained mostly with the help of Claude Code, and [ROADMAP.md](ROADMAP.md) is the living record of that: every shipped feature, why it exists, and what's still open, kept in sync with the actual code rather than written once and left to rot.

If you want to contribute:

1. Read `ROADMAP.md` first. It's the real source of truth for what exists and what's planned, not this file.
2. Keep changes typed and tested. `npm run typecheck` and `npm test` should both pass before you open a pull request.
3. If you touch anything a model actually talks to (prompts, sampler params, judge calls), verify it against a real running KoboldCpp instance, not just the type checker. A change that looks correct on paper can still read wrong to a model.
4. Small, focused pull requests are much easier to review than large ones. If you're planning something big, open an issue first so it doesn't collide with work already in progress.

Bug reports and feature requests are welcome even without code attached. A clear description of what you expected versus what happened is worth more than a vague one.

## License

MIT. See [LICENSE](LICENSE).

## Credits and inspirations

Built by [pnotisdev](https://github.com/pnotisdev), with Claude Code doing most of the actual typing.

- [SillyTavern](https://github.com/SillyTavern/SillyTavern), for proving what a deep local roleplay client could look like, and for the character card and World Info formats this app reads directly.
- [KoboldCpp](https://github.com/LostRuins/koboldcpp), the model server this entire project is built around.
- The broader local-model and visual novel communities whose card formats, conventions, and expectations this project tries to meet rather than reinvent.
