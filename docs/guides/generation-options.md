# Generation options

Where each SillyTavern-style option lives in Settings and in the editors.

## Sampler (Settings, Generation, Advanced mode)

Besides temperature, top-p/k, min-p, typical, tail-free, repetition penalty, DRY and mirostat: **Top A**, **XTC threshold and probability**, **dynamic temperature range and exponent**, **smoothing factor**, **top-n-sigma**, **guidance scale** with a **negative prompt** (KoboldCpp must be started with `--enableguidance`), **banned words and phrases**, **token bias** (`tokenId: bias`, ids belong to the loaded model), a **grammar**, the **sampler order**, and **DRY sequence breakers**. Fields left at 0 or empty are not sent, so they change nothing until you set them. They apply to KoboldCpp; the hosted (OpenAI-compatible) path keeps its own smaller set.

- **Starting point** now includes SillyTavern's six KoboldAI presets, unchanged.
- **Import JSON** accepts a SillyTavern sampler preset (KoboldAI or text-completion kind) and maps its names to these fields.
- `{{banned::word}}` in a card or prompt adds that word to the banned list for that reply.

## Reasoning

- **Show the model's reasoning** keeps a thinking model's reasoning in a collapsible block above its reply, live while it writes. Off hides it. It is never sent back to the model.
- **Reasoning format** and **starts with / ends with** are for a model whose tags are not `<think>`, Gemma 4's thought channel or gpt-oss's analysis channel, which are found automatically. A lone `</think>` (a template that opens the block in the prompt) is handled too.
- **Show token probabilities** asks KoboldCpp for each token's probability and shows it under new replies, tinted by confidence; click a token for the words it nearly wrote. Held in memory only, and KoboldCpp only. Not checked against a running KoboldCpp yet.

## Connection profiles (Settings, Connection, Profiles)

Save the current backend, address, model, key, instruct template, samplers and reasoning markers under a name, and switch back in one click. The profile that matches the live settings shows "In use". Saved keys stay in this browser, like the live one.

## System prompts and instruct templates

The system prompt picker has SillyTavern's twelve system prompt presets (Actor, Roleplay Simple/Detailed/Immersive, Neutral Chat, Lightning, Text Adventure, Writer Creative/Realistic, Assistant Simple/Expert, Chain of Thought), word for word. Its Blank preset is the default. SillyTavern's context (story string) presets are not copied: this app builds that block itself.

## Lorebook entries

Entries have the newer SillyTavern options, in the entry's Options:

- **Position: Outlet** with a name, placed by `{{outlet::name}}` instead of at a fixed spot.
- **Secondary key logic**: any, every, none, or not every secondary key.
- **Scan depth** per entry, and **whole words only**.
- In a group: **beats the rest of its group** and **most keys found wins**, besides the weight.
- **Recursion**: not triggered by other entries, does not trigger others, only triggered by other entries.
- **Ignore the token budget**.

They import from and export to SillyTavern World Info files and V2 cards, including the snake_case fields SillyTavern keeps in a card's `extensions`. Not copied: the SillyTavern positions above and below the author's note and example dialogue, per-entry depth roles, character filters and generation-type triggers.
