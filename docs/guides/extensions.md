# Building extensions for Hakoniwa

An extension is a small package of files that adds something to the app: a panel in the chat, a minigame, a background script that edits prompts or replies, or a theme that restyles everything. Extensions run in a sandbox and can only do what the user allows.

You can write one by hand in the in-app **Studio** (Extensions, then New), import a `.rpext.json` file, or have an AI agent write one through MCP (see the end of this page).

## The shape of an extension

Everything is described by a **manifest** plus a set of files.

```json
{
  "id": "dice-tray",
  "name": "Dice Tray",
  "version": "1.0.0",
  "description": "Roll dice and post the result to the chat.",
  "author": "you",
  "glyph": "⚄",
  "api": 1,
  "permissions": ["chat.write"],
  "panels": [
    { "id": "tray", "title": "Dice", "glyph": "⚄", "entry": "panel.html", "slots": ["chat", "view"] }
  ],
  "script": "main.js",
  "hooks": ["context"],
  "tools": [],
  "theme": { "css": "theme.css" },
  "settings": [
    { "key": "announce", "type": "boolean", "label": "Post rolls to the chat", "default": true }
  ]
}
```

| Field | Notes |
| --- | --- |
| `id` | 3-40 characters: lowercase letters, digits and dashes. Stable forever. |
| `version` | Semantic version, for example `1.0.0`. |
| `api` | The extension API version. Currently `1`. |
| `permissions` | What the extension asks for. Nothing is granted until the user approves. |
| `panels` | UI. Each has an `entry` HTML file and `slots`: `view` (its own screen), `chat` (the chat dock), `hud` (a floating overlay in the chat). HUD panels also take `anchor` (`top-left`, `top-right`, `bottom-left`, `bottom-right`) and `width`. |
| `script` | A background script file (no DOM). Needed for hooks and tools. |
| `hooks` | Any of `input`, `context`, `output`. Needs `script` and the `hooks` permission. |
| `tools` | Functions the AI can call. Needs `script` and the `tools.provide` permission. |
| `theme` | `{ "css": "path.css" }`. Needs the `ui.theme` permission. |
| `settings` | Values the user can edit: `text`, `number`, `boolean` or `select` (with `options`). |

Files are plain text (`.html`, `.js`, `.css`, `.json`, `.svg`, `.md`, `.txt`) or binary (images, audio) stored as base64. Paths are relative, with no `..`.

### A bundle file

To share an extension, export it as a single JSON file:

```json
{
  "format": "rp-extension",
  "version": 1,
  "manifest": { "...": "..." },
  "files": { "panel.html": "<h1>Hello</h1>", "logo.png": { "base64": "iVBORw0..." } }
}
```

## The sandbox

Panels and scripts run in an isolated iframe with **no network access**, no cookies, and no access to the app's page. That means:

- `fetch`, `XMLHttpRequest`, `WebSocket` and remote `<script>`/`<img>` URLs do not work. Bundle what you need, or inline it as a `data:` URL.
- `localStorage`, `sessionStorage` and `indexedDB` are blocked. Use `rp.storage`.
- `alert`, `confirm` and `prompt` are blocked. Build the dialog in the page.
- Everything the extension can do goes through the `rp` object below, and each call is checked against the permissions the user granted.

Panels get the app's colors automatically as CSS variables, so plain HTML already matches the theme.

## Permissions

| Permission | Allows |
| --- | --- |
| `chat.read` | Read the open chat's messages, character, persona and world. |
| `chat.write` | Add messages and send replies as the user. |
| `state.read` | Read relationship stats, stage, flags, coins, inventory and the world clock. |
| `state.write` | Set flags, add coins and hand over items. |
| `lore.read` | Read lorebooks and remembered facts. |
| `lore.write` | Add and remove lorebook entries and remembered facts. |
| `characters.read` | List the character library. |
| `generate` | Ask the user's model to write text. |
| `hooks` | Rewrite messages, replies and the prompt. |
| `tools.provide` | Let the AI call functions the extension defines. |
| `ui.theme` | Apply CSS to the whole app. |

Ask for the least you need. The user sees this list before turning the extension on.

## The `rp` API

Available as `window.rp` in panels and as `rp` in scripts. Every method returns a promise.

```js
const info = await rp.ready   // { api, surface, extension, permissions, settings, dark }
```

| Call | Needs | Returns |
| --- | --- | --- |
| `rp.notify(text, kind?)` | none | Shows a toast. `kind`: `info`, `success`, `error`. |
| `rp.log(...args)` | none | Writes to the extension's console. `console.log` works too. |
| `rp.resize(height)` | none | Panels only: request a height in pixels. |
| `rp.close()` | none | Panels only: close the panel. |
| `rp.settings.all()` | none | The current values of your declared settings. |
| `rp.storage.get(key, scope?)` | none | The stored value or `null`. |
| `rp.storage.set(key, value, scope?)` | none | Saves any JSON value (up to 256 KB). |
| `rp.storage.remove(key, scope?)` | none | Deletes a key. |
| `rp.storage.keys(scope?)` | none | All keys in a scope. |
| `rp.chat.info()` | `chat.read` | `{ chatId, title, characterId, characterName, personaName, worldId, worldName, mode }` or `null`. |
| `rp.chat.messages(limit?)` | `chat.read` | Recent `{ id, role, name, text, createdAt }`, where role is `user` or `char`. |
| `rp.chat.append(text, { as })` | `chat.write` | Adds a message without generating a reply. `as`: `char` (default) or `user`. |
| `rp.chat.send(text)` | `chat.write` | Sends as the user and waits for the reply. Only works while the chat is on screen. |
| `rp.state.get()` | `state.read` | `{ affection, warmth, stage, stats, flags, commitment, coins, inventory, day, phase }`. |
| `rp.state.setFlag(flag, on?)` | `state.write` | Sets or clears a scene flag. |
| `rp.state.addCoins(n)` | `state.write` | Adds (or subtracts) coins. |
| `rp.state.giveItem(id, count?)` | `state.write` | Adds a world item or gift to the inventory. |
| `rp.lore.books()` | `lore.read` | `[{ id, name, entries }]`. |
| `rp.lore.entries(bookId)` | `lore.read` | The book's entries. |
| `rp.lore.add(bookId, { keys, content, comment? })` | `lore.write` | Adds an entry. |
| `rp.lore.remove(bookId, entryId)` | `lore.write` | Removes an entry. |
| `rp.facts.list()` | `lore.read` | The chat's remembered facts. |
| `rp.facts.add(text, importance?)` | `lore.write` | Remembers a fact (importance 0 to 1). |
| `rp.characters.list()` | `characters.read` | `[{ id, name, tags }]`. |
| `rp.generate(prompt, opts?)` | `generate` | A string from the user's model. `opts`: `system`, `maxTokens`, `temperature`. |
| `rp.on(event, fn)` | see below | Subscribes. Returns an unsubscribe function. |

**Storage scopes:** `global` (default), `chat` (the open chat), `character` (the open chat's character), `world` (that character's world). Chat, character and world data is deleted along with them and copied when a chat is forked.

**Events:**

| Event | Needs | Payload |
| --- | --- | --- |
| `message` | `chat.read` | `{ id, chatId, role, name, text, createdAt }` for each new message. |
| `chat` | none | `{ chatId }` when a different chat is opened. |
| `turn` | `chat.read` | `{ phase: "start" | "end", chatId }` around each reply. |
| `state` | `state.read` | The new `rp.state.get()` value when it changes. |
| `theme` | none | `{ tokens, dark }` when the app theme changes (panels restyle themselves). |
| `settings` | none | The new settings values. |

Calls are rate-limited (for example 20 writes per 10 seconds, 6 `generate` calls per minute), so do not loop on them.

## Styling panels

The theme colors are CSS variables holding space-separated RGB: `--c-bg`, `--c-bg-elevated`, `--c-bg-sunken`, `--c-border`, `--c-text`, `--c-text-muted`, `--c-accent`, `--c-accent-text`, `--c-danger`, `--c-success`, `--c-warning`. Use them as `rgb(var(--c-accent))` or with alpha, `rgb(var(--c-accent) / .2)`.

A small kit is already loaded: `.rp-card`, `.rp-sunken`, `.rp-btn` (add `primary`, `ghost`, `round`), `.rp-input`, `.rp-chip`, `.rp-bar` (with an `<i>` child), `.rp-stack`, `.rp-row`, `.rp-wrap`, `.rp-grow`, `.rp-center`, `.rp-muted`, `.rp-label`, `.rp-big`.

HUD panels size to their content automatically. Avoid `vh` units there, because the page height would depend on itself.

## Scripts and hooks

A script runs in a background worker (no `document`, no `window`). Register hooks with `rp.hook`:

```js
// input: runs before the player's message is stored and sent
rp.hook('input', ({ text }) => text.replace(/\bsecret\b/gi, '[redacted]'))
//   return a string, { text }, or { cancel: true, reason: "..." } to stop the send

// context: add lines to the prompt for this turn
rp.hook('context', async ({ lastUserText }) => {
  const quests = (await rp.storage.get('quests', 'chat')) || []
  if (!quests.length) return null
  return { label: 'quests', text: 'Open quests:\n' + quests.map((q) => '- ' + q).join('\n') }
})
//   return a string, { text, label? }, { sections: [...] }, an array, or null

// output: runs on the finished reply, after the app's own cleanup
rp.hook('output', ({ text, characterName }) => text.replace(/\s+([,.!?])/g, '$1'))
```

Every hook receives `{ chatId, characterName, personaName }` plus `text` (or `lastUserText`). Hooks **fail open**: an error or a timeout (1.5 seconds, 2.5 for `context`) is logged and the turn carries on unchanged. Declare each hook in the manifest's `hooks` list and request the `hooks` permission.

## Tools

Expose functions the AI can call. Declare them in the manifest and implement them in the script:

```json
{ "tools": [{ "name": "roll_dice", "description": "Roll dice, for example 2d6.",
  "parameters": { "type": "object", "properties": { "notation": { "type": "string" } }, "required": ["notation"] } }] }
```

```js
rp.tool('roll_dice', ({ notation }) => {
  const [n, sides] = notation.split('d').map(Number)
  return Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides))
})
```

Requires the `tools.provide` permission. A tool must return JSON-serializable data within 8 seconds. Enabled extensions' tools are offered to the **Assistant** (Tools: Look or Look and change), named `<extension-id>.<tool>`; they are not called during roleplay chats.

## Themes

A theme extension is just CSS plus `"permissions": ["ui.theme"]`. Remote `@import` and `url(http...)` are stripped for safety. Target the stable hooks instead of internal class names:

| Selector | What it is |
| --- | --- |
| `[data-rp-part="sidebar"]` | The navigation column. |
| `[data-rp-part="chat-header"]` | The chat header. |
| `[data-rp-part="message"]` (with `data-role`) | One chat message. |
| `[data-rp-part="composer"]` | The message box. |
| `[data-rp-part="modal"]` | Dialogs. |
| `[data-rp-part="dock"]` | The extension dock. |

The color variables above are also available to the page itself, so `rgb(var(--c-accent))` works in a theme.

## Bundled examples

Install these from Extensions, then open one in the Studio to read how it is built.

| Extension | What it does | Uses |
| --- | --- | --- |
| Slash Commands | `/roll`, `/me`, `/ooc`, `/gm`, `/time`, `/remember`, `/note` in the message box; standing notes the AI sees every turn | `input` + `context` hooks, a tool |
| Adventure Kit | A tabletop sheet (HP/MP, stats, d20 checks, inventory, conditions). The AI sees it and updates it with `[HP -3]` tags | `context` + `output` hooks, a panel and a HUD |
| Lorekeeper | Reads the chat every few replies, proposes codex entries for review, feeds matching ones back into the prompt | `turn` event, `generate`, `context` hook |
| Fate Oracle | Yes/no oracle with a chaos factor, random events, scene checks, threads and cast; queued results reach the AI on its next reply | `context` + `output` hooks, tools |
| Language Lab | Practice a language at your level with glosses and tips; harvest vocabulary into a spaced-repetition deck | `context` hook, `generate`, global storage |
| Story Insights | Reply length, who writes more, dialogue vs action, favourite words, a repetition radar | `chat.read` only, a panel and a HUD |
| Dice Tray, Quest Journal, Relationship Ring, Tic-Tac-Toe, Focus Desk, Midnight Glass | Smaller examples of each surface | |

## Patterns from the bundled examples

- **A panel and a script share state through `rp.storage`.** The panel writes, the script reads in a hook (Fate Oracle queues an event that the next `context` hook injects).
- **Share logic by pasting the same source into both files** when you build the bundle; the examples keep it in one TypeScript string (`examples/*Lib.ts`) and concatenate it into the panel and the script.
- **Put structured output at the start of a reply.** The app trims a reply that stops mid-sentence before `output` hooks run, so a trailing `[HP -3]` line is cut off; a leading one survives (Adventure Kit).
- **Keep hooks fast.** They fail open after 1.5 seconds (2.5 for `context`): no `rp.generate` inside a hook. Do slow work on an event such as `turn`, or in the panel (Lorekeeper).
- **`context` sections are capped** (1200 characters each, 3000 in total). Rank and trim what you inject.

## Tips

- Always `await rp.ready` before reading `rp.info`.
- Save state as you go with `rp.storage`; a panel can be closed at any time.
- Declare every permission your code uses. The Studio's checker (and `lint_extension` over MCP) flags a call whose permission is missing.
- Keep panels light. A panel that loops forever can freeze the page.
- For anything that needs the user's attention, use `rp.notify`; it is rate-limited so it cannot spam.

## Using AI agents (MCP)

Hakoniwa can expose itself as an MCP server, so Claude Code, Claude Desktop, ChatGPT or any MCP client can read and write your characters, worlds and lorebooks, and write extensions directly.

1. Open **Settings, Agents** and turn on "Allow AI agents to connect". Copy the setup snippet for your client.
2. The agent sees tools such as `create_character`, `create_world`, `add_lore_entries`, `create_extension`, `write_extension_file` and `lint_extension`, plus this guide as `get_extension_guide`.
3. Extensions an agent installs arrive **turned off**. Review the code and permissions in Extensions, then switch them on.

A good prompt: "Read the extension guide, then build a Potion Brewer minigame for my dice-tray style dock. Keep it under 150 lines, lint it, and tell me what permissions it needs."
