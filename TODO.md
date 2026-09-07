# RP Suite — TODO

A prioritized, actionable list from a full codebase re-read (Sept 2026) plus a competitor/genre
survey. Complements `ROADMAP.md` (which is now mostly a changelog): this is the "what next and why"
list, grouped by tier. References point at the file to start in.

Inspiration drawn from: SillyTavern / RisuAI / AI Dungeon / Backyard AI (feature parity);
Ren'Py conventions, Persona 5 confidants, Stardew Valley relationships, Mystic Messenger,
Doki Doki Literature Club, Monster Prom (game feel).

The engine underneath is already deep — mood / need / fear / desire / plans / beliefs / expectations
/ momentum / rebuff / intimacy-scene state machine. The gaps are almost all **presentation, first
contact, and game loop**, not simulation.

---

## Tier 1 — Make VN mode actually feel like a visual novel

Live finding: with the seeded world (12 real backgrounds) and no model connected, turning on VN
mode shows a **near-black void with a floating sprite**. `scene.background` is only ever set by a
model reply's `<<scene:>>` tag or `detectGreetingScene` (needs a model). This is the first thing a
new user sees if they flip the headline feature. Everything here is presentation, no simulation risk.

- [ ] **Establishing background so VN mode is never blank.** Add `WorldCard.defaultBackgroundId`
      (author picks the opening shot); `VNStage` falls back to it whenever there's no valid scene
      tag — also covers the model omitting a tag or picking a locked one. Plus a deterministic
      keyword pass in `detectGreetingScene`'s no-model branch (match greeting text against
      background labels/ids). Files: `src/lib/vn/placeholder.ts`, `src/components/chat/VNStage.tsx`
      (`bgStyle`), `src/lib/vn/sceneVision.ts`, `src/lib/types.ts` (`WorldCard`).
- [ ] **Text presentation — the single biggest "VN vs chat" lever.** Typewriter reveal (per-char,
      respects `reducedMotion`), a ▼ "next" glyph when a reply is complete, click-anywhere-on-scene
      to advance / dismiss choices / skip the reveal. Text-speed slider in Settings → Appearance.
      Files: `src/components/chat/VNStage.tsx` dialogue box (`max-h-[22vh]` block), `globals.css`.
- [ ] **A real ADV textbox.** Today it's `bg-black/65` + a hairline — on a dark scene it merges
      with the sprite area. Give it a defined edge (inner border, frosted fill, a fixed height that
      doesn't jump between short and long replies), and cap dialogue line-width so it doesn't run
      the full ultra-wide. `src/components/chat/VNStage.tsx`.
- [ ] **Minimal VN quick menu** (Ren'Py convention, but *pared down* — most VNs over-stuff it):
      History · Auto · Skip · Hide-UI, as a compact icon row where the lone `Log` button is now.
      - *Auto*: auto-advance after a reply, timed to text length.
      - *Skip*: jump the typewriter / scroll to the latest message instantly.
      - *Hide-UI*: click to hide the textbox and see the full sprite/CG (universal VN feature,
        trivial — toggle a class on the panel).
      `src/components/chat/VNStage.tsx` top bar.
- [x] **In-chat VN⇄Chat toggle in the header.** Shipped — a `Drama` icon in `ChatToolbar`
      (`priority: 'primary-desktop'`) writes a per-chat `assistOverrides.visualNovelMode`, clearing
      it back to inherit when it would just match the global default. Works in both the chrome
      header and VN mode's glass pill.
- [ ] **`visualNovelMode: 'auto'`** per-chat/global — VN on only once the character has sprites
      *and* the scene has a background. Never a black void, never a plain assistant character
      full-screen. `src/lib/store/useSettingsStore.ts`, `src/lib/world/worldTemplates.ts`,
      `ChatWindow.tsx`.
- [ ] **Sprite staging** (Ren'Py `show X at left`). Left/center/right slots for the solo sprite and
      per-speaker positions in group scenes; slide/fade entrance when a speaker first appears, exit
      when they leave. `src/components/chat/VNStage.tsx` (`VNCharacterSprite`, `slotWidthClass`).
- [ ] **CG reveal ceremony.** When a `triggeredCg` fires, a brief full-screen reveal beat + a
      "new in Gallery" toast, instead of the CG just quietly replacing the background.
      `src/components/chat/VNStage.tsx`, `src/lib/store/useToastStore.ts`.
- [ ] **VN choice menu style.** Optional centered VN-style choice list (stacked, scene-dimmed)
      instead of the bottom pills. `src/components/chat/ChoiceList.tsx` (`variant="vn"`).
- [ ] **Mobile VN pass.** At 375px the dialogue box clips at the top and sprite/choices/intent-chips
      fight for height. Fixed ~40vh dialogue, choices as a horizontal scroller or overlay, intent
      chips behind a toggle. `src/components/chat/VNStage.tsx`.
- [ ] **Per-line voice (optional).** VN mode "read this line aloud" / auto-voice using the existing
      TTS stack (`src/lib/voice/ttsProviders.ts`, already wired for Companion mode).
- [x] **A few more expression slots** — shipped `disgust` / `confusion` / `pain` / `relief` (21 → 25),
      additive with same-family fallback chains. `src/lib/vn/expressions.ts`.

---

## Tier 2 — Onboarding & the "which mode am I in" thread

Live finding: `WelcomeView` H1 is "A local-first roleplay client for KoboldCpp"; the connection
card only talks about starting KoboldCpp + `--host 0.0.0.0`; the port probe only checks KoboldCpp
ports — **no mention that a hosted key works**, even though OpenAI/OpenRouter/NovelAI are fully
supported (`ConnectionSettings.tsx`, ROADMAP #121–123).

- [~] **Rewrite the connection card as two paths: local model *or* hosted key.** Partial — the
      offline card now names LM Studio / Ollama / OpenAI-compatible alongside KoboldCpp and links
      to Settings → Connection for hosted providers (OpenRouter free tier called out). Still open:
      a fully inline hosted-key form (provider dropdown + key + model + test) so the user never
      leaves the welcome screen. `src/components/chat/WelcomeView.tsx`.
- [x] **Soften the Kobold-specific framing.** Shipped — H1 subtitle is now "A local-first roleplay
      client. Bring your own model — running locally, or a hosted API key"; the offline card no
      longer implies KoboldCpp-only.
- [ ] **A "pick how you want to play" step** — the four modes (Freeform RP · Visual Novel ·
      Dating Sim · Slice of Life) with one line each, so the first chat starts in the right mode.
      This is the same concept as world templates and per-chat overrides — see Tier 3.
- [x] **Fix the pre-hydration flash** — shipped. `WelcomeView` holds a skeleton for the "first
      chat" card until the `characters` query resolves, instead of flashing the no-characters branch.
- [ ] **Post-first-chat tips** — a dismissible card after the first reply: "Turn on Visual Novel
      mode" / "Bind a world for backgrounds & the clock" — the two changes that most alter the
      experience.
- [ ] **Named progression framing** (AI Dungeon: Beginner writes a prompt → Intermediate adds
      lore/notes → Advanced builds worlds → Expert authors scripts). Even just section eyebrows in
      Settings ("Basics" / "Authoring" / "Power user") so the dating-sim / instruct-template /
      regex / world-sim depth reads as *optional rungs*, not a wall. (ROADMAP §13 open item.)
- [ ] **"What these do" explainer for the mode toggles** — the last open ROADMAP §13 item. Largely
      solved by making the mode *do* the bundling (Tier 3), so the individual toggles become
      "advanced" and rarely touched.

---

## Tier 3 — Unify "play style", and give the dating sim a game loop

### 3a. One "play style" concept, everywhere

The 4 templates exist but are a property of the **world** — unreachable without making a world
first. A character with no world falls through to `dating_sim` (full mechanics). `NewChatDialog`
has no mode picker. The per-chat override is 3 buried `<select>`s in Relationship → More.

- [ ] **Mode picker in `NewChatDialog`** — 4 chips, defaulting to the bound world's template (or a
      global default). Writes `Chat.assistOverrides` (already the mechanism) + a `Chat.mode` label
      for display. Decouples "how I play" from "did I build a world."
      `src/components/chat/NewChatDialog.tsx`, `src/lib/chat/createChat.ts`.
- [ ] **Expand what a mode bundles** beyond {editor tabs} + {3 booleans}: also preset the
      system-prompt preset (Slice of Life → "Cozy", Freeform → "Balanced"), `slowBurnPacing`,
      intent chips on/off, whether the date/event button shows, the quick-reply set.
      `src/lib/world/worldTemplates.ts` (`assistOverridesForTemplate`).
- [ ] **Surface the mode** — a chip in the chat header + VN HUD + chat-list row.
      `src/components/chat/ChatWindow.tsx`, `ChatsPanel.tsx`, `VNStage.tsx`.
- [ ] **Name the seed world** (`template: 'dating_sim'` in `server/seedContent.ts`) and ship a
      second seed (a Freeform or Slice-of-Life world) so the concept is visible from first run.
- [ ] **Slice of Life is underpowered** — it keeps the world clock but has no distinct loop. Either
      merge it into Freeform or give it the ambient-events / schedule loop from 3b.

### 3b. A game loop — the biggest differentiator vs. SillyTavern

The world clock + energy budget exist but **only advance from a button in the world editor**. There
is no reason for the player to care about time. Persona / Stardew / Mystic Messenger all make time
a resource you spend. This is the direction that turns "a chat with stats" into "a dating sim you
play."

- [ ] **"Plan your day" loop.** A between-scenes screen: current day/phase/weather/energy, the
      character's schedule presence, and a short list of things to do — "Meet {name} at the café" /
      "Go to the library" / "Text her" / "Rest". Picking one spends energy, sets the scene
      location, runs as a scored hangout, and advances the clock. The pieces exist
      (`getEnergyRemaining`, `advancePhase`, `startDateEvent`, `getCurrentActivity`,
      `DateEventCard`); the loop that strings them together doesn't.
      Files: `src/lib/world/calendar.ts`, `src/lib/hooks/useChatSession.ts` (`startDateEvent`),
      a new `src/components/chat/DayPlannerPanel.tsx`.
- [ ] **Birthdays & key dates** (Stardew's single biggest gift multiplier; Persona). Add
      `Character.birthday` (day in the 112-day calendar), an 8× gift bonus on the day, the
      character mentions it's coming up / thanks you, and a calendar view marking birthdays and
      commitment anniversaries. The calendar already exists — this is a field + a multiplier + a
      view. `src/lib/characters/cardSpec.ts`, `src/lib/dating/gifts.ts`,
      `src/lib/world/calendar.ts`, a `CalendarPanel`.
- [ ] **Heart / milestone events** (Stardew heart events; Persona confidant side-stories). Authored
      scene beats that fire at a warmth stage or scene-flag combination — a scripted scene the
      *character* initiates, richer than the current `Trigger` "notify" / "remember" actions. Reuse
      `DateEventCard` with a `triggerStage`/`triggerFlags` and let the world author write the
      premise. `src/lib/world/triggers.ts`, `src/lib/types.ts` (`DateEventCard`), `WorldsView.tsx`.
- [ ] **Gift cadence + progressive taste reveal** (Stardew: one gift/day, taste learned over time).
      A soft daily-gift cap (the `giftLog` recency data is already there), and the gift-shop UI
      shows "you've learned she loves X" as you discover it rather than listing all authored likes
      up front. `src/lib/dating/gifts.ts`, `src/components/chat/RelationshipPanel.tsx` (Shop tab).
- [ ] **Real-time cadence for proactive characters** (Mystic Messenger chatrooms). Outreach (#102)
      is wall-clock-silence-driven; extend it with schedule-tied "she's free now, she messaged you"
      windows and a missed-window concept, plus a firmer unread treatment (badge → a proper
      notification card in the chat list). `src/lib/dating/outreach.ts`,
      `src/lib/hooks/useOutreachTick.ts`, `ChatsPanel.tsx`.
- [ ] **Relationship journal / confidant page** (Persona confidant screen). A per-character page:
      what you've learned about them (likes/goals discovered), milestones hit, memories pinned,
      next unlock and what it needs. `RelationshipPanel` is close but reads as a transactional
      control panel, not a keepsake. `src/components/chat/RelationshipPanel.tsx`.
- [ ] **Jealousy / rivalry in group scenes** (Monster Prom; otome). Multi-character tracking exists
      (#118); "spending an evening with one in front of another" tension does not. A light rapport
      penalty + a `jealousy` flag already in `SCENE_FLAGS` that isn't mechanically wired.
      `src/lib/dating/stage.ts`, `useChatSession.ts` (`updateAffectionFromReply`).
- [ ] **Route / campaign structure (bigger).** Mystic Messenger's 11-day arc with a goal and a
      deadline. A world could carry an optional `campaign` — a premise, a day count, a win
      condition (reach a stage, hit N flags) — giving a run a shape and an ending beyond "keep
      chatting." Revisit after the day-planner loop exists.

---

## Tier 4 — Competitive parity & authoring

- [ ] **RisuAI-style inline asset embeds** — `{{image::name}}` / character "sends a photo" mid-chat,
      driven by triggers or regex. One of RisuAI's most-loved features and a natural fit here
      (triggers + regex + per-character assets all exist). Add `Character.assets` and a render pass
      in `MessageBubble` / `VNStage` / transcript export. `src/lib/characters/cardSpec.ts`,
      `src/lib/text/messageText.tsx`, `src/lib/world/triggers.ts`.
- [ ] **Do / Say / Narrate input modes** (AI Dungeon). A composer mode chip that folds a light
      prefix hint into the turn — reduces ambiguity for a new user typing plain text. ROADMAP §15.
      `src/components/chat/Composer.tsx`, `src/lib/prompt/builder.ts` (`renderTurn`).
- [ ] **Scenario templates with fill-in-the-blank placeholders** (AI Dungeon scenarios). A reusable
      start package (world + character(s) + opening premise + persona nudge) that asks the player a
      couple of short questions on start and substitutes the answers into the opening. Mad-libs
      simple; turns "recreate the same opening for a new save" into picking a template. ROADMAP §15.
      Build on `starterTemplates.ts` + `WorldTemplateGallery.tsx` + `relationshipStarters`.
- [ ] **Save slots / named state snapshots** distinct from chat history (Ren'Py save/load; ROADMAP
      §12). A full-state snapshot (relationship, inventory, calendar, flags) a player returns to —
      VN players expect this and forking isn't the same mental model.
      `server/app.ts` (a snapshot table), a `SaveSlotsPanel`.
- [ ] **Chat folders / tags** (SillyTavern; AI Dungeon "adventures"). ROADMAP §14 open; its own
      authoring surface, not a row-menu addition. `src/components/chat/ChatsPanel.tsx`, `types.ts`.
- [ ] **Story-branch tree view** (ROADMAP §12). Forking works; there's no visualization of a chat's
      branch history. Closer to a save-tree browser than the flat list-with-badges.
- [ ] **Combinatorial character creation** (AI Dungeon character creator; partly seeded by the
      trait-picker in commit `485fc67`). A third "New character" path: pick from small independent
      trait lists (archetype / occupation / quirk / relationship-to-player) and have the model
      assemble the card. `src/components/characters/GenerateCharacterDialog.tsx`,
      `src/lib/characters/traitPresets.ts`.
- [ ] **User-authored scripting, Output hook first** (AI Dungeon; RisuAI CBS). Pure
      `(text, state) => { text, state }` run after generation, sandboxed (Web Worker, no fetch/DOM),
      with a test panel. Regex scripts are already the stateless special case of this. ROADMAP §15 —
      big, needs a real sandbox answer; scope tightly.
- [ ] **On-demand in-chat scene snapshot** (AI Dungeon "See"). A chat-level "snapshot this moment"
      that generates an image into the transcript (not a persistent slot), reusing the
      `ImageBackend` abstraction that already exists. ROADMAP §15.

---

## Tier 5 — Red string between settings & pages (IA polish)

- [ ] **Split the Generation settings tab** (~16 stacked sections today) into "Generation"
      (sampler, presets, context, instruct template, prompt sections, system prompt, writing style)
      and "Roleplay" (relationship tracking, choices, objectives, memory, quick replies, slow-burn,
      intimacy). The "Plain chat vs dating sim" wall of text becomes the short intro to "Roleplay."
      `src/components/settings/SettingsView.tsx`, `SamplingControls.tsx`.
- [x] **Sticky settings tab strip** — shipped. The heading + tab strip stick to the top of the
      scroll container (edge-bleeding opaque background) so switching tabs from deep in a long tab
      no longer means scrolling up. `src/components/settings/SettingsView.tsx`.
- [x] **Flip the Connection tab** — shipped. "Chat generation backend" (the provider picker + any
      hosted config) is now first; "KoboldCpp connection" follows, with copy updated to match the
      new order. Both still always visible. `src/components/settings/ConnectionSettings.tsx`.
- [ ] **Settings search** — a filter box that hides `Section`s not matching a keyword (every
      `Section` already has a title + description string), or index setting names in Cmd-K.
- [ ] **Shared `<InheritableField>`** — a wrapper showing "inherited from World · override" for the
      values that cascade (intimacy: global/world; instruct template: global/character; VN + assists:
      global/world-template/chat) instead of explaining precedence only in hint prose.
- [ ] **More cross-links** — mode chip → world template picker; locked VN background → world Scenes
      tab; "relationship tracking is off" state → the toggle; CharacterEditor VN tab → world Scenes.

---

## Tier 6 — Smaller polish

- [ ] Sprite/CG: a subtle "focus" scene-dim while the composer is focused (draws the eye to input).
- [ ] `WorldCard` "opening line/scene" author field so a fresh chat's first screen is directed, not
      guessed. Overlaps with the Tier 1 default-background item.
- [ ] Persona ↔ character "compatibility" nudge (Persona same-arcana bonus) — persona interests
      matching a character's `likes` gives a small warmth modifier.
- [ ] Backlog drawer styled as a translucent VN log with per-speaker colors, not the plain
      `bg-bg/95` panel. `src/components/chat/VNStage.tsx` (`showLog` block), `MessageLog.tsx`.
- [ ] Expression-set generation from one reference image already exists (#125) — surface it more
      prominently in the empty VN state, alongside `vnArtHint`.
- [ ] Gallery: a "music room" tab listing a world's uploaded BGM tracks (Ren'Py convention) — the
      tracks already exist per-world. `src/components/gallery/GalleryView.tsx`.

---

## Start here

The one slice that moves all four of the original questions at once:

1. `WorldCard.defaultBackgroundId` + VNStage fallback + `detectGreetingScene` keyword pass
   → VN mode is never a black void (Tier 1).
2. Mode picker in `NewChatDialog` writing `assistOverrides` + a mode chip in the header
   → "play style" is a real, visible per-chat choice (Tier 3a).
3. In-chat VN⇄Chat toggle in `ChatToolbar` (Tier 1).
4. Rewrite the `WelcomeView` connection card for local-**or**-hosted (Tier 2).

All shippable without a model backend to test against except (4), which the roadmap already
verified once against OpenRouter.
