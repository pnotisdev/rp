# Assistant character auto-fill: spec and to-do

Goal: the user types one sentence in the Assistant ("a quiet night-shift librarian with a dry sense of humor and a secret") and gets a draft card with every editor tab filled in, no chip click and no form editing. They look it over and save it with one click. The same pipeline backs the editor's "Generate with AI" button and lets the Assistant re-do one section of an existing character later.

Decisions (user, 2026-10-14): show the card first and save on one click; no adult gate on the intimacy stage; the live persona engine never turns itself on.

Status (2026-10-14): phase 2 is built and unit-tested except the optional `world` step; it has not been run live or checked in the browser. Phases 0 and 1 are built, unit-tested and run against the live Gemma 4 12B (changelog #155). Phase 2 is next. Where the build differs from the text below: the gift stage is called `gifts` and fills a template (the model invents gifts when asked for a free-form map); weather stays in the `bonds` stage (it already drafted it) and `worldsim` is schedule, birthday and outreach; `dateModeOptOut` and `replyLength` are never set automatically (`auto` is right for a card with example dialogue); the free detector contributes verbal tics, rhythm and punctuation habits but not catchphrases.

How to use: paste the block under "Prompt" into a new session, then work the phases in order. Do not commit; the user commits.

---

## Prompt (paste this)

You are working in E:\code\rp (Hakoniwa, a local-first roleplay frontend). Read `docs/planning/assistant-character-autofill.md` fully, then implement phase 1, run its checks, and stop for review before phase 2.

Context you must respect:
- The model is a local Gemma 4 12B behind KoboldCpp, so every generation call must be small, JSON-shaped, validated, and retried once. Never ask it for one giant card.
- Plain-text tool calls render only `name: type` plus the first sentence of a description ([tools.ts:45](../../src/lib/assistant/tools.ts)), so a nested object argument looks like `object` with no shape. Do not rely on the model filling nested JSON through a tool signature.
- Generation runs in the browser (the model client and settings live there). Server tools cannot call the model. Follow the `generate_image` precedent: a client-side tool handled in [toolbox.ts](../../src/lib/assistant/toolbox.ts).
- The server already normalizes every character field in `POST/PUT /api/characters` ([app.ts:477](../../server/app.ts)). Save through `charactersApi`; do not add new server routes for storage.
- Keep comments to one line. Test files go under E:\code\rp and are deleted afterwards. Use `rp-sandbox` and `rp-mock-llm` for end-to-end runs. Never touch the user's real `data/`.

---

## What existed before phase 1 (verified in code)

| Piece | State |
|---|---|
| Chip "Build this as a character" | Only runs if clicked; Enter sends a plain chat message ([AssistantView.tsx:393](../../src/components/assistant/AssistantView.tsx)) |
| `draftFullCharacter` | Stages: card, profile, bonds, outfits, lore ([generateFullCharacter.ts](../../src/lib/characters/generateFullCharacter.ts)) |
| Card stage fields | name, description, personality, scenario, first_mes, mes_example, creator_notes, tags. No alternate_greetings |
| Save mapping | Duplicated in [saveCharacter.ts](../../src/lib/assistant/saveCharacter.ts) and [CharacterEditor.tsx:91](../../src/components/characters/CharacterEditor.tsx) |
| Tool route | `create_character` / `update_character` in [mcpTools.ts:522](../../server/mcpTools.ts) cover the card, alternate greetings, Life & background, `world_id`, `reply_format`. Nothing for dating, world sim, voice, advanced |
| Reply cap with tools off | 900 tokens ([useAssistant.ts:27](../../src/lib/assistant/useAssistant.ts)) |
| Known bug | `weatherLoves`/`weatherHates` are sent top-level but the server reads `weatherPreferences: {loves, hates}`; weather is silently dropped, and `saveCharacter.test.ts:68` asserts the wrong shape |

Editor field to storage key, for everything the pipeline must reach:

| Tab | Fields (storage key) |
|---|---|
| Identity | card.name/description/personality/scenario/first_mes/alternate_greetings/mes_example/tags/creator_notes, `worldId` |
| Life & background | occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, birthday (0-111), socialConnections, behavioralRules |
| Visual novel | sprites, spriteUnlocks, spriteVariants, customExpressions, outfits |
| Dating sim | gallery, giftPreferences (per gift id, -2..3), giftLikes, giftDislikes, loveLanguage, relationshipStarters, dateModeOptOut, touchProfile, kinkProfile |
| World sim | weatherPreferences, schedule, outreach, drive |
| Voice | voice (provider, voiceId), voiceFingerprint, sfxWords, explicitVoiceNote |
| Advanced | card.system_prompt, card.post_history_instructions, instructTemplateId, replyLength |

---

## Design

1. One pipeline, many entry points. Extend `draftFullCharacter` with new stages. A single `draftToCharacterInput(draft)` replaces both duplicated mappings and is the only place that knows storage keys.
2. Stages stay small: one JSON object per call, 300-700 tokens, the card summary as an identical prefix across stages (cache friendly on KoboldCpp), stage instructions last. Each stage uses `resolveAssistShaping`, `parseLenientJson`, enum filtering (like `weatherList` in [aiAssist.ts:399](../../src/lib/characters/aiAssist.ts)), clamps, one retry on parse failure. A failed stage never aborts the run; it lands in `failedStages` (existing pattern).
3. Auto trigger, no clicks:
   - Assistant message matches `detectProducer` as `character` and the new setting `assistantAutoBuild` is on (default on): run the pipeline directly and attach the draft card to the thread. Nothing is written to the library until the user clicks Save (the existing `saveCharacter` flow, which stamps `savedCharacterId`). The chip remains when the setting is off.
   - With Tools on, a client-side tool `build_character` does the same for a model that decides to call it. It only produces the draft; the tool result is a short text summary (stages done, stages failed, "draft is waiting for the user to save") so the model can answer in prose.
   - `edit_character_section` re-runs one stage against an existing character (loads it, passes current values as context, patches only that section). It is a write tool, so it goes through the existing approval prompt (`confirm: true`, which `assistantAutoApprove` can waive), and the prompt shows the before and after of the section.
4. External MCP clients (port 3002) handle nested JSON fine, so `create_character`/`update_character` there may expose the nested sections with full schemas. The in-app agent sees them collapsed, which is why the staged tools exist.

### Stage specs (field, output shape, validation)

| Stage | Output | Validation and rules |
|---|---|---|
| `greetings` | `alternate_greetings`: 2-3 strings, each 1-3 short paragraphs, same `*action*` / "speech" convention as first_mes | Reject duplicates of first_mes; trim; max 5000 chars each |
| `social` | `socialConnections`: 2-4 `{name, relation, notes}`; `behavioralRules`: 3-6 `{kind: when_then\|never, when?, then}` | Use the server normalizers; at least one `never` rule; rules must be behavioural, not restated personality |
| `voice` | `voiceFingerprint {verbalTics, catchphrases, dialectNotes, sentenceRhythm}`, `sfxWords`, `replyLength` (brief\|moderate\|detailed or omit) | Run `detectVoiceFingerprint(card)` first (free, deterministic) and let the model fill only the gaps. Never set `voice.provider`/`voiceId` (depends on Settings → Voice) |
| `dating` | `giftPreferences` scored -2..3 for each gift from `getGiftCatalog(world)`; `dateModeOptOut` only if the brief says the character is not a romance option | Unknown gift ids dropped; default false for opt-out |
| `worldsim` | `weatherPreferences {loves, hates}` (disjoint, from `WEATHER_KINDS`); `schedule` 4-8 `{days?, phase: morning\|afternoon\|evening\|night, status: available\|busy\|sleeping\|traveling, activity, location?}`; `birthday` 0-111; `outreach.frequency` never\|rare\|normal\|eager | Schedule must cover sleeping and the occupation from the profile; use the seed in `server/seedTess.ts` as the few-shot for `drive` |
| `drive` | `{enabled, chaosBase 0-0.4, energyBase 0-10, fixations, loves, boredBy, motifs}` | `enabled` is always false in the draft; generate the lists so the user can switch it on in the editor |
| `intimacy` | `touchProfile {sensitivity 0-3 per BODY_REGIONS, offLimits, gated}`, `kinkProfile {valence -2..2 per BUILT_IN_KINKS, hardLimits}`, `explicitVoiceNote` | Runs with the other stages by default. Omit anything neutral; absent means neutral. See guardrails for the one skip rule |
| `visual` | expressions, outfit art, avatar | Phase 3, only when `imageBackendReady`; billed backends ask first (existing `confirm` rule) |
| `world` | `create_world` (existing tool) then set `worldId` and pass the world description as `worldTone` to every stage | Only when the request asks for a world; never silently create one |

### Guardrails (these are hard rules, not preferences)

- No adult gate: `intimacy` does not require the card to prove adulthood or the world to be a dating sim. One skip rule stays: if the card describes the character as under 18, skip the stage and say so in the result.
- Hard limits come only from the brief or the card's own boundaries. The model must not invent a hard limit that contradicts the brief, and must not drop one the brief states.
- Never auto-fill `system_prompt`, `instructTemplateId`, or apply "Maximum Immersion". A system prompt override replaces the default instruction entirely, and Maximum Immersion rewrites global settings. `post_history_instructions` only when the brief asks for a style rule.
- The Assistant never changes global settings (sampler, slow-burn, VN mode).
- Edits to an existing character keep the previous values of every field they touch, so the user can revert.

---

## To-do

### Phase 0: fix what is already wrong
- [x] `saveCharacter.ts` sends `weatherPreferences: {loves, hates}`; the test asserts the server's key. The return type is now `CharacterInput` (a partial `Character`), so a wrong key is a compile error.
- [x] Test that every key the mapping emits is read by the `POST /api/characters` handler (`saveCharacter.test.ts`, scrapes `server/app.ts`).
- [x] One mapping: `generatedToCharacterInput` (kept its name and file) serves the Assistant's Save and the editor's new `applyGenerated`.
- [x] Reply cap 900 to 2000 tokens. The card stage's 1200-token cap held: about 750 tokens used on four live briefs, so it is unchanged.

### Phase 1: the text stages, automatic
- [x] `greetings`, `social`, `voice`, `gifts`, `worldsim` stages with pure parsers and unit tests (`draftSections.ts`, `draftSections.test.ts`), one retry that tells the model why it was rejected.
- [x] `DraftSections` (shared by `FullCharacterDraft` and `GeneratedCharacter`) carries the new sections as `extras`; the editor's `applyGenerated` applies them.
- [x] `assistantAutoBuild` (default on); `submit` runs `produceCharacter` for a `character` match. A strip with "Send as plain chat" is the way out of a false match. The producers no longer ask for a chat reply first.
- [x] The draft card (`CharacterDraftCard.tsx`, `draftSummary.ts`) lists every stage as a collapsible block; failed ones say so and Save still works.
- [x] "Redo this section" per stage (`redoStage`, built on `runDraftStage`), hidden once the draft is saved.
- [x] Progress label per stage.
- [x] Gate by world: the editor passes `worldTone` and the world's gift catalog. The Assistant has no world until phase 2's `world` step.

### Phase 2: tools and editing
- [x] Client-side `build_character` tool (flat args: brief, world_id?, sections?) handled in `toolbox.ts`, listed only when Tools is not Off.
- [x] `edit_character_section(id, section, instruction)`: loads the character, runs one stage with current values as context, patches only that section, returns before and after.
- [x] Revert: store the previous values on the tool result message and add a Revert button.
- [x] Expose scalar fields (birthday, love_language, gift_likes, gift_dislikes, weather_loves, weather_hates, reply_length, outreach_frequency) on `create_character`/`update_character`; nested sections with full schemas for external MCP clients only.
- [x] `drive` and `intimacy` stages per the guardrails above, with tests for "absent means neutral", hard limits taken only from the brief, the under-18 skip, and `drive.enabled` always false.
- [ ] Optional: `world` step reusing `create_world`.
- [x] Editor safety: no guard existed. `PUT` takes `ifUpdatedAt` and answers 409; the editor sends it and asks before overwriting.

### Phase 3: art
- [ ] `visual` stage: expression set and outfit art through the existing image backend and `GenerateExpressionSetDialog` logic; billed backends ask before every picture.

### Checks for every phase
- [x] `npm run typecheck` and the whole test suite (phase 1: 165 files, 2700+ tests). There is no lint script.
- [x] Run in `rp-sandbox`, with the real KoboldCpp instead of `rp-mock-llm` (the mock cannot answer stage prompts): one sentence in the Assistant, no clicks, card shown, Redo, Save.
- [x] Open the saved character in the editor and compare each tab with the stage table; also the editor's own Generate with AI.
- [x] Real Gemma 4 12B runs with timings per stage (changelog #155 has the findings).
- [x] `docs/guides/assistant.md` and a `docs/history/changelog.md` entry.
- [x] Scratch files and the sandbox data deleted (repeat after each phase).

### Acceptance
Saying "create a night-shift librarian with a dry sense of humor and a secret" in the Assistant, with default settings, produces a draft card whose Identity (including alternate greetings), Life & background (including connections and rules), Dating sim (gift scores, relationship starters), World sim (weather, schedule, birthday, outreach) and Voice (fingerprint) sections are populated, with no clicks after Send. One click on Save puts it in the library with every tab filled. Advanced stays blank, `drive.enabled` is false, neutral intimacy values are absent, and any failed stage is named in the reply.
