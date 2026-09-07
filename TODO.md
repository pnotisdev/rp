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

- [x] **Establishing background so VN mode is never blank.** Shipped — `WorldCard.defaultBackgroundId`
      (author picks the opening shot, set from a star toggle on each Scenes-tab thumbnail); `VNStage`
      falls back to it whenever the tagged background is missing *or* still locked. Plus a
      deterministic `matchBackgroundKeyword` pass (`src/lib/vn/backgrounds.ts`) that runs in
      `createChat`'s no-model branch and fills gaps in the model-based one. `src/lib/types.ts`
      (`WorldCard`), `src/components/chat/VNStage.tsx`, `src/lib/chat/createChat.ts`,
      `src/components/worlds/WorldsView.tsx`.
- [x] **Text presentation — the single biggest "VN vs chat" lever.** Shipped — a per-character
      typewriter reveal (`useTypewriterReveal`), skipped entirely for a message id already watched
      streaming in live (only a static/reopened line ever animates), instant with `reducedMotion`
      or the speed slider at 0. A ▼ glyph appears inline right after a reply finishes typing.
      Click-anywhere-on-scene skips an in-progress reveal (harmless no-op otherwise — nested
      buttons still get their own click first). Dialogue box now auto-scrolls to keep the growing
      edge in view. "Dismiss choices" (there's no separate choice-menu state to dismiss today) not
      done. New "VN text speed" slider in Settings → Appearance (`vnTextSpeedMs`).
      `src/lib/hooks/useTypewriterReveal.ts`, `src/components/chat/VNStage.tsx`,
      `src/lib/store/useSettingsStore.ts`, `src/components/settings/ThemeEditor.tsx`,
      `src/styles/globals.css`.
- [x] **A real ADV textbox.** Shipped — an inset highlight + a soft drop shadow give the panel a
      defined edge against a dark scene (`bg-black/75`, up from `/65`); the dialogue box is a fixed
      height now (`h-[40vh] sm:h-[22vh] md:h-[26vh]`), not `max-h`, so a one-line reply and a
      ten-line one occupy the same footprint instead of the panel jumping between turns; the text
      itself caps at `max-w-3xl`, centered, so it doesn't run the full width on an ultra-wide
      monitor. `src/components/chat/VNStage.tsx`.
- [x] **Minimal VN quick menu.** Shipped — History (the existing log toggle, relabeled) · Auto ·
      Skip · Hide-UI, icon-only, in the top-right row. *Skip* reuses the typewriter's own
      skip/complete. *Hide-UI* hides everything but the background/sprites/CG, restored by clicking
      anywhere on the scene (universal VN convention, no on-screen hint needed). *Auto* — see the
      dedicated bullet below, since it turned out to need real design (VN autoplay implies a new
      generation each turn, unlike a real VN's pre-written lines).
      `src/components/chat/VNStage.tsx` top bar.
- [x] **In-chat VN⇄Chat toggle in the header.** Shipped — a `Drama` icon in `ChatToolbar`
      (`priority: 'primary-desktop'`) writes a per-chat `assistOverrides.visualNovelMode`, clearing
      it back to inherit when it would just match the global default. Works in both the chrome
      header and VN mode's glass pill.
- [x] **`visualNovelMode: 'auto'`** — Shipped, per-chat and global both (a third settings state,
      not just world-template-seeded). Resolves live via `isVnReady` (character has sprites, world
      has scene backgrounds) in `ChatWindow`, so 'auto' is never a blank void. The Visual Novel
      world template now seeds 'auto' instead of a hard `true`, for the same reason.
      `src/lib/store/useSettingsStore.ts`, `src/lib/world/worldTemplates.ts`,
      `src/components/chat/ChatWindow.tsx`, `src/lib/vn/artHint.ts` (`isVnReady`),
      `src/components/settings/ThemeEditor.tsx`, `src/components/chat/RelationshipPanel.tsx`.
- [x] **Auto-advance (the quick menu's "Auto")** — shipped as real VN autoplay: once a reply
      finishes typing, after a pause scaled to its length, sends the "Let time pass" quick reply for
      you. Off by default, never persisted (always resets to off on a chat switch); never auto-picks
      an AI-suggested choice (a real decision point always waits for the player); stops itself on a
      live date/event, a failed generation, or after a capped 5 turns / 10 minutes, so leaving it on
      by accident can't run away unattended. A pulsing accent dot marks it active.
      `src/components/chat/ChatWindow.tsx` (`handleAutoAdvanceFire`), `VNStage.tsx`.
- [~] **Sprite staging.** Partial — a cast member now slides+fades in the first time they appear
      (including a chat's very first render) and out again when they leave the roster, kept mounted
      a beat longer under `phase="exiting"` to have something to animate. Explicit left/center/right
      positioning (Ren'Py `show X at left`) not done — it needs a real position concept the model
      would have to tag (a prompt-format change), which is a bigger, riskier change than a
      presentation-only pass should make; today's side-by-side flex layout is the implicit
      equivalent for group scenes. `src/components/chat/VNStage.tsx` (`VNCharacterSprite`),
      `src/styles/globals.css` (`vn-sprite-enter`/`vn-sprite-exit`).
- [x] **CG reveal ceremony.** Shipped — a brief fade+scale-in beat (`.vn-cg-reveal`) when a
      `triggeredCg` first surfaces, plus a one-time "New in Gallery" toast (with the reward chime),
      fired once per CG id per component instance rather than every re-render it keeps showing.
      `src/components/chat/VNStage.tsx`, `src/styles/globals.css`.
- [x] **VN choice menu style.** Shipped as a new Settings → Appearance choice, `vnChoiceStyle`:
      "Docked" (today's pill row, default) or "Centered" — a full-stage, scene-dimmed, stacked
      choice screen for AI-suggested choices specifically (quick replies always stay docked; picking
      one for you isn't a real decision point). `src/components/chat/VNCenteredChoices.tsx` (new),
      `VNStage.tsx`, `src/lib/store/useSettingsStore.ts`, `src/components/settings/ThemeEditor.tsx`.
- [x] **Mobile VN pass.** Shipped — the ADV textbox fix above already gives mobile its ~40vh
      dialogue box; `ChoiceList`'s and `QuickReplyBar`'s `'vn'` variants are a horizontal scroller
      below `sm` (wrap normally at `sm:` and up) instead of wrapping to several lines; intent chips
      collapse behind a small "Intent" disclosure toggle on mobile only (always visible on desktop,
      no toggle chrome there at all). `src/components/chat/VNStage.tsx`, `ChoiceList.tsx`,
      `QuickReplyBar.tsx`, `Composer.tsx`.
- [x] **Per-line voice.** Shipped, both halves — a manual "read this line aloud" button in the
      utility-controls row, plus an "Auto-voice" toggle next to it that speaks each new reply
      unprompted once it finishes typing. Both reuse the same TTS stack/settings Companion mode
      uses (provider/key/voice, character voice override). Auto-voice turned out not to carry
      Auto-advance's runaway-cost risk on reconsideration — it only ever narrates a reply that
      already happened (from a manual send, a quick reply, or Auto-advance itself), never triggers
      a new generation on its own — so it needs none of that feature's safety caps; off by default
      is the only rail it needs. `src/components/chat/VNStage.tsx`.
- [x] **A few more expression slots** — shipped `disgust` / `confusion` / `pain` / `relief` (21 → 25),
      additive with same-family fallback chains. `src/lib/vn/expressions.ts`.

---

## Tier 2 — Onboarding & the "which mode am I in" thread

Live finding: `WelcomeView` H1 is "A local-first roleplay client for KoboldCpp"; the connection
card only talks about starting KoboldCpp + `--host 0.0.0.0`; the port probe only checks KoboldCpp
ports — **no mention that a hosted key works**, even though OpenAI/OpenRouter/NovelAI are fully
supported (`ConnectionSettings.tsx`, ROADMAP #121–123).

- [x] **Rewrite the connection card as two paths: local model *or* hosted key.** Shipped — a
      "Local model" / "Hosted API key" chip pair at the top of the card switches between the
      original KoboldCpp form and a fully inline hosted form (provider dropdown — including
      NovelAI, folded in as one more provider — API key, model, Test connection), reusing
      `useHostedBackendStatus` and a `HostedConnectionStatus` now shared with Settings → Connection
      (`src/components/settings/HostedConnectionStatus.tsx`) so the two surfaces can't disagree.
      Switching paths writes straight to the same settings Settings → Connection reads, and never
      touches the other path's already-entered values. `src/components/chat/WelcomeView.tsx`.
- [x] **Soften the Kobold-specific framing.** Shipped — H1 subtitle is now "A local-first roleplay
      client. Bring your own model — running locally, or a hosted API key"; the offline card no
      longer implies KoboldCpp-only.
- [x] **A "pick how you want to play" step** — Satisfied by Tier 3a's Mode picker: `NewChatDialog`
      now offers the 3 modes with one line each (the template's own blurb), defaulting sensibly, so
      the first chat already starts in the right mode without a separate onboarding step for it.
      See Tier 3a's "Mode picker in `NewChatDialog`" bullet for the implementation.
- [x] **Fix the pre-hydration flash** — shipped. `WelcomeView` holds a skeleton for the "first
      chat" card until the `characters` query resolves, instead of flashing the no-characters branch.
- [x] **Post-first-chat tips** — Shipped. A dismissible card floats in once there's an actual
      completed reply: "Turn on Visual Novel mode" (a live action link, not just text — clicking it
      toggles VN on for the chat right there) when VN is off, and "Bind a world" when the character
      has none, side by side when both apply. One-time, ever — dismissing it is permanent
      (`firstReplyTipDismissed`), not a per-chat nag. `src/components/chat/ChatWindow.tsx`,
      `src/lib/store/useSettingsStore.ts`.
- [x] **Named progression framing** — Shipped for the Generation tab specifically (its ~16
      sections are the depth this item was about): a new `SettingsEyebrow` divider groups them
      under "Basics" (the toggles/sliders everyone touches), "Authoring" (system prompt, writing
      style, prompt sections, instruct template), and "Power user" (raw sampler fields, presets,
      regex scripts) — so the dating-sim / instruct-template / regex depth reads as optional rungs
      to climb, not one flat wall of equally-weighted cards. `src/components/ui/SettingsEyebrow.tsx`
      (new), `src/components/settings/SamplingControls.tsx`.
- [x] **"What these do" explainer for the mode toggles"** — Substantially already covered by the
      existing "Plain chat vs. dating sim" `Section` at the top of the Generation tab (predates this
      TODO pass — explains relationship tracking / choices / VN mode and the world-template
      relationship in plain language already), and now further closed by Tier 3a's Mode picker,
      which makes the *mode* do the bundling directly instead of requiring the toggles to be
      understood individually. `src/components/settings/SamplingControls.tsx`.

---

## Tier 3 — Unify "play style", and give the dating sim a game loop

### 3a. One "play style" concept, everywhere

The 4 templates exist but are a property of the **world** — unreachable without making a world
first. A character with no world falls through to `dating_sim` (full mechanics). `NewChatDialog`
has no mode picker. The per-chat override is 3 buried `<select>`s in Relationship → More.

- [x] **Mode picker in `NewChatDialog`** — Shipped. 3 chips (down to 3 after Slice of Life merged
      into Freeform — see this section's own bullet below), defaulting to the bound world's template
      (or `dating_sim`), re-defaulting on character switch until deliberately touched. Writes
      `Chat.assistOverrides` (the explicit pick now wins over the bound world's own template) + a
      `Chat.mode` label, surfaced as a chip in the chat header, VN HUD, and chat-list row, and
      editable afterward from Relationship → More (label only — doesn't retroactively touch
      `assistOverrides`). Decouples "how I play" from "did I build a world."
      `src/components/chat/NewChatDialog.tsx`, `src/lib/chat/createChat.ts`, `src/lib/types.ts`
      (`Chat.mode`), `src/components/chat/ChatWindow.tsx`, `VNStage.tsx`, `ChatsPanel.tsx`,
      `RelationshipPanel.tsx`.
- [x] **Expand what a mode bundles** beyond {editor tabs} + {3 booleans}. Shipped — a chat's mode
      now also seeds a `systemPromptId` (Freeform → "Balanced"; Dating Sim/Visual Novel leave it
      unset, same as they already left every other assist untouched), `slowBurnPacing`, intent
      chips on/off, and whether the date/event button shows — all four riding on the same
      "disables relationship assists" opinion the template already stated, resolved through
      `builder.ts`'s existing character → chat → global precedence chain via a new
      `chatSystemPrompt` input. The quick-reply *set* itself (as opposed to whether a mode's
      romance-flavored quick actions show at all, which the existing booleans already cover) was
      not touched — no per-mode custom reply lists exist today, and inventing one felt like a
      separate feature rather than "expand the bundle." `src/lib/world/worldTemplates.ts`
      (`assistOverridesForTemplate`), `src/lib/types.ts` (`Chat.assistOverrides`),
      `src/lib/prompt/builder.ts`, `src/lib/hooks/useChatSession.ts`, `ChatWindow.tsx`.
- [x] **Surface the mode** — Shipped as part of the Mode picker bullet above (this was written as
      its own item before that pass, but landed in the same change): a chip in the chat header, VN
      HUD, and chat-list row. `src/components/chat/ChatWindow.tsx`, `ChatsPanel.tsx`, `VNStage.tsx`.
- [x] **Name the seed world** — Shipped, plus the second seed. `server/seedContent.ts`'s original
      world now carries `template: 'dating_sim'` explicitly; a second seed, "The Wayfarer's Rest"
      (Freeform: a text-only innkeeper NPC, lorebook-driven, no gift economy) ships alongside it so
      Freeform is visible from first run too, not just inferred from the picker's blurb. Back-filled
      for installs that already ran the original seed, same pattern as the starter persona.
      `server/seedContent.ts`, `server/seed.ts`.
- [x] **Slice of Life is underpowered** — resolved by merging it into Freeform (asked the user;
      "merge" was the recommended and chosen option over "leave it" or "build it 3b's loop now" —
      simplest, no half-built feature, and Freeform's "no romance mechanics" framing already covered
      what it was for). Removed as an offered template (`WorldTemplateId`, `WORLD_TEMPLATES`, the
      gallery, the mode picker, `HIDDEN_TABS`) rather than left to bit-rot alongside a real loop.
      Existing data isn't migrated — a `RETIRED_TEMPLATE_ALIASES` map plus a new
      `normalizeWorldTemplateId()` treats any already-stored `template: 'slice_of_life'` /
      `Chat.mode: 'slice_of_life'` exactly as Freeform everywhere it's read (hidden tabs, assist
      bundling, the chat header/VN HUD/chat-list label, the world editor's Template chip, and the
      Relationship panel's Play-style select all show/behave as Freeform, live-verified against a
      hand-seeded legacy-value world/chat); a new chat or a re-saved world writes the canonical
      `'freeform'` id going forward, so real installs self-heal over time with no destructive
      rewrite needed. `src/lib/world/worldTemplates.ts`, `src/lib/chat/createChat.ts`,
      `src/components/worlds/WorldsView.tsx`, `src/components/chat/NewChatDialog.tsx`,
      `src/components/chat/RelationshipPanel.tsx`.

### 3b. A game loop — the biggest differentiator vs. SillyTavern

The world clock + energy budget exist but **only advance from a button in the world editor**. There
is no reason for the player to care about time. Persona / Stardew / Mystic Messenger all make time
a resource you spend. This is the direction that turns "a chat with stats" into "a dating sim you
play."

- [x] **"Plan your day" loop.** Shipped — a new "Plan your day" toolbar entry (same gating as
      "Start a date or event": hidden for `dateModeOptOut`/`showDateEventButton: false`, plus no
      bound world at all) opens a between-scenes screen: current day/phase/weather/energy
      (`getCalendarInfo`/`describeWeather`/`getEnergyRemaining`, the same read-only display
      `WorldsView`'s Clock tab already had, just reused here) and a fixed, deterministic 3-item
      menu — **Meet {name} at {location}** (location resolved from `getCurrentActivity`'s schedule
      entry for this exact phase, else a `frequentedLocations` entry, else `homeLocation`, else
      omitted), **Text {name}**, and **Rest** — no AI call to populate the menu, so opening the
      panel costs nothing until an activity is actually picked. Meet/Text build a deterministic
      `DateEventCard` (`kind: 'hangout'`, never `'date'` — no hidden agenda/walkout risk) and hand
      it to the *existing*, unmodified `startDateEvent`/`endDateEvent` pipeline (energy spend,
      objective, live scored scene, gallery/coin/milestone handling all reused as-is), then
      additionally call the existing `updateScene({ location })` — the one genuinely missing piece
      the live/scored machinery had (nothing set `Chat.scene.location` before this). Rest spends the
      same one energy unit/advances the same one phase but opens no scene and makes no LLM call at
      all — the always-free, always-available default. Reopening the planner while a hangout/date
      is already live shows a redirect ("wrap that up first") into the existing live
      `DateEventPanel` rather than a second "end this scene" UI. **Deliberately not built**: a solo
      "Go to {a place}" option with no bound character present (the TODO's "Go to the library"
      example) — it needs a plausible place-name source (lorebook? world description?) this pass
      didn't have a clean deterministic answer for; left as explicit future scope, not half-built.
      Live-verified end-to-end against the real seeded Sumire chat (schedule-driven location
      resolution across two different phases, energy/clock spend, `activeEvent`/`scene.location`
      wiring, the live-redirect state, and the gating hidden-for-Freeform case), not just unit
      tests. `src/lib/world/dayPlanner.ts` (new), `src/components/chat/DayPlannerPanel.tsx` (new),
      `src/lib/hooks/useChatSession.ts` (`runDayPlannerActivity`), `src/components/chat/ChatWindow.tsx`.
- [x] **Birthdays & key dates** — Shipped. `Character.birthday` (a day-of-year, 0–111, set via a
      `CharacterEditor` "Life & background" field with a live "→ Spring, day 15" hint) drives an
      8× `giftBirthdayMultiplier` that bypasses (not stacks with) the usual repetition scaling —
      live-verified end-to-end against the real seeded Sumire chat (a gift that would've scored 2
      affection landed at 16) — plus a `birthdayGiftGuidance` reaction line that replaces the
      normal taste-based one, and a Relationship-panel Shop banner so the player notices the window
      at all. "Mentions it's coming up" reuses the existing ambient-hook system wholesale: two new
      `AmbientEventKind`s (`'birthday'` today, same unconditional priority `'holiday'` already gets;
      `'birthday_soon'` 1–7 days out, a normal probabilistic candidate) — no new firing/delivery
      logic needed. Commitment anniversaries needed one new field, `RelationshipTrack`/
      `Chat.commitmentStartedDay`, stamped once the first time a relationship moves off `'none'`
      (never overwritten by a later tier change) — the "day we got together," not "the day we last
      leveled up." The "calendar view" landed as a sorted key-dates list (`CalendarPanel`, in the
      toolbar overflow) rather than a full month grid — birthdays, per-relationship anniversaries,
      and the world's 4 fixed holidays (newly exported as `ALL_HOLIDAYS` rather than duplicated),
      each ranked by days-until via one shared `daysUntilAnnualDate` helper; live-verified showing
      all three kinds correctly ranked. **Deliberately not built**: a solo "visit a place with no
      character present" key date — no clean deterministic place-name source existed for it.
      `src/lib/world/calendar.ts`, `src/lib/characters/cardSpec.ts`, `src/lib/dating/gifts.ts`,
      `src/lib/world/ambientEvents.ts`, `src/lib/types.ts`, `src/lib/dating/stage.ts`,
      `src/lib/hooks/useChatSession.ts`, `src/components/chat/CalendarPanel.tsx` (new),
      `src/components/characters/CharacterEditor.tsx`, `src/components/chat/RelationshipPanel.tsx`,
      `src/components/chat/ChatWindow.tsx`. Also fixed in passing: `server/app.ts`'s
      `POST`/`PUT /api/characters` routes explicitly allowlist/normalize every stored field rather
      than passing the body through — `birthday` silently vanished on save until it was added there
      too, caught by live verification (not the unit tests, which mock the API layer).
- [x] **Heart / milestone events** — Shipped as a new `TriggerAction` kind, `start_scene`, rather
      than a parallel `triggerStage`/`triggerFlags` system: `TriggerCondition` already covered "a
      warmth stage or scene-flag combination" more richly than that framing imagined (plus
      commitment level, world-clock day, another rule having fired), so the entire gap was one
      action that hands a `DateEventCard` to the existing `startDateEvent`/`endDateEvent` live-scene
      pipeline. Built as `kind: 'hangout'` (not `'milestone'` — `isLiveScene` only ever treats
      `'date'`/`'hangout'` as a genuinely live scene, so `'milestone'` would've sat in `activeEvent`
      without the per-turn-judge-skip, live-rapport HUD, or `DateEventPanel` live view actually
      applying), with a new `DateEventCard.free` flag so a world-triggered scene the player didn't
      choose to spend a day's action on doesn't cost one — `startDateEvent`'s energy check/spend now
      both skip under `free`, surgically, with everything else in that function untouched. Fires
      from `updateAffectionFromReply` (the post-reply trigger call site, evaluated against the turn's
      freshly-computed stats) via the same `startDateEventRef` indirection the marriage/moving-in
      auto-scene already relies on; at most one `start_scene` per turn if two rules happen to
      satisfy together. Authoring lives in the existing `TriggerActionRows` editor (World → Dating
      sim → Rules) — title/description/objective/optional-objective-detail, `backgroundId`
      deliberately left out to keep the form lean (the scene's own `<<scene:>>` tag sets one once it
      starts, like any other scene). Also fixed in passing: `server/app.ts`'s `normalizeTriggers` was
      silently dropping `trigger_fired` conditions and `social_reaction`/`style_guidance` actions
      (a whole authored rule vanishes if any one action in it doesn't survive normalization) — a
      pre-existing gap in the exact function this feature needed to extend anyway, caught by testing
      the new `start_scene` action's own round-trip. Live-verified end-to-end: authored a rule
      through the real World editor, confirmed the new action option/form renders and saves, and
      confirmed it survives a full reload (the previously-broken path) with the summary line reading
      correctly. **Not verified live**: the actual runtime firing (`evaluateTriggers` →
      `startDateEventRef` → `activeEvent`) needs a completed reply to judge, which needs a real LLM
      backend this dev environment doesn't have — covered instead by `triggers.test.ts`'s
      unit tests (one-shot firing, action shape) plus code review of the small, well-precedented glue.
      `src/lib/world/triggers.ts`, `src/lib/types.ts` (`DateEventCard.free`),
      `src/lib/hooks/useChatSession.ts`, `src/components/worlds/TriggerRows.tsx`, `server/app.ts`.
- [x] **Gift cadence + progressive taste reveal** — Shipped, both halves, no new stored field for
      either. The soft cap is turn-windowed (`GIFT_CADENCE_WINDOW_TURNS`, mirroring
      `RECIPROCITY_WINDOW_TURNS`'s shape) rather than literally day-bound: the world clock only
      advances when the player deliberately spends a day-planner action or a date/event, not with
      elapsed turns, so a literal day cap would rarely engage and wouldn't apply at all to a
      worldless chat — a turn window over the already-tracked `giftLog` achieves Stardew's actual
      "don't gift-spam" goal everywhere instead. `giftCadenceMultiplier` dampens a positive delta
      multiplicatively alongside (not replacing) the existing `giftRepetitionMultiplier` — they
      dampen two different things, giving *anything* too often vs. giving the *same* gift too often
      — and, like repetition, is bypassed entirely on the character's actual birthday. Also gained a
      matching `giftReactionGuidance` narrative branch, since every other dampening path already had
      one. Taste reveal is derived, not tracked: "discovered" is just `giftsGiven[id] > 0` on the
      viewed character's own track (already there), and `giftTasteLabel` only ever shows the two
      tiers this file already treats as meaningful elsewhere (`>= 2` loved, `<= -0.5` mismatch) —
      nothing in-between gets a badge. Live-verified end-to-end against the real seeded Sumire chat:
      gave 3 gifts in quick succession and confirmed the affection delta shrank exactly as
      hand-computed at each step (2, then 2 with cadence alone at ×0.5 since it was a different
      gift, then 0 with cadence at ×0.2), confirmed the Shop tab showed "Sumire loves this" only for
      the discovered `>= 2` gift and no badge at all for the discovered-but-middling one, and
      confirmed a birthday gift afterward still landed at the full ×8 despite 3 recent gifts on
      record (cadence correctly bypassed, same as repetition already was).
      `src/lib/dating/gifts.ts`, `src/lib/hooks/useChatSession.ts`,
      `src/components/chat/RelationshipPanel.tsx` (Shop tab).
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
- [x] **Sticky settings tab strip** — shipped (reworked after a first pass looked bad: the scroll
      container's top padding was offsetting the stick point, leaving a gap that scrolled content
      bled through). Now the "Settings" heading scrolls away and only the tab strip pins — opaque
      `bg-bg` + a `pb` shelf, container `pt` moved onto the heading. Verified desktop + mobile.
      `src/components/settings/SettingsView.tsx`.
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

~~The one slice that moves all four of the original questions at once~~ — **all four shipped**:

1. [x] `WorldCard.defaultBackgroundId` + VNStage fallback + `matchBackgroundKeyword` pass
   → VN mode is never a black void (Tier 1).
2. [x] Mode picker in `NewChatDialog` writing `assistOverrides` + a mode chip in the header
   → "play style" is a real, visible per-chat choice (Tier 3a).
3. [x] In-chat VN⇄Chat toggle in `ChatToolbar` (Tier 1).
4. [x] Rewrite the `WelcomeView` connection card for local-**or**-hosted (Tier 2).

Tiers 1, 2, and 3a are now complete (Tier 1's "Sprite staging" stays intentionally partial — see its
own bullet for what's deliberately not done). Next candidate slice: Tier 3b's day-planner loop (the
biggest differentiator vs. SillyTavern, but also the largest single build in this file — the pieces
it strings together already exist), or picking off a smaller Tier 4/5/6 item first.
