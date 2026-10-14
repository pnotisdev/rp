# Catalog additions — items, gifts, toys, positions, activities

Written 2026-09-11, from a read of `dating/gifts.ts`, `dating/items.ts`, `dating/intimacyCatalog.ts`,
`dating/kinks.ts` and `types.ts`. Sections 1–6 are **pure data** against schemas that already exist —
drop-in array entries, no new machinery. Section 7 is the safety plumbing the explicit additions
depend on. Section 8 is what needs real code.

> **Status, 2026-09-11.** Steps 1-7 of the suggested order at the bottom are **implemented**: the
> kink tags and the seven new kink ids (§8), `DEFAULT_ITEM_CATALOG` (§1), the gift additions (§2),
> the `affection` category and its non-explicit ladder plus the clothed position tier (§5, §6), both
> re-gates (§5), the toys and the upper bands (§3, §5, §6), `requiresBackground` (§9.2), and
> `ItemEffect.multi` (§9.1). The catalog went 37 entries -> 108. **Still open:** the rest of §9 (the
> `random` effect, clearing a `relationshipWarning`, keepsakes, shop restock, gift wrapping, the two
> authoring assists). **§10 shipped too**, as a wardrobe shop rather than the item effect this
> document proposed — see the note under §10 for why that was the better half of the idea.
>
> Two things changed shape during implementation and are described where they happened:
> `requiresEagerness` (§8.3) became a real field rather than a suggestion, and the `affection`
> category (§6) turned out to be load-bearing — without it every non-explicit entry would have been
> hidden behind the explicit dial, which is exactly backwards.

Entries marked **(exists)** are already in the catalog and are listed only so the tables read as a
complete picture of a category rather than a diff.

---

## 0. Where the gaps actually are

Four things stand out reading the catalogs against the code that consumes them:

- **The Items shelf is empty by default.** `getItemCatalog` is `world?.items ?? []` — there is no
  `DEFAULT_ITEM_CATALOG` the way there is a `DEFAULT_GIFT_CATALOG`. So the whole `ItemEffect` engine
  (relationship nudge / scene flag / coins), plus the Bag panel and the Shop's Items section, are
  invisible on a fresh install unless a world author writes items by hand. Highest-value gap, and it
  costs one array.
- **Six gifts is too few for taste to mean anything.** `giftPreferences` scores a gift per character
  and the shop reveals a taste only after it's been given. With 6 entries across 9 tags, authored
  preferences have almost nothing to discriminate between, and `giftRepetitionMultiplier` starts
  punishing repeats before there's an alternative to switch to. The tag→icon table in
  `catalogVisuals.ts` already knows `luck`, `music`, `creative`, `ticket` and `casual` — no gift uses
  any of them.
- **The catalogs skew late.** Almost everything in `intimacyCatalog.ts` sits at 55+ warmth. The
  0–35 band — the part of a playthrough most players actually spend time in — has 3 kissing spots and
  nothing else, and there is nothing at all in the "clothed, charged, not yet sex" register.
- **Half the catalog is invisible to the limits system.** See §8 — this is the one that gates
  whether the explicit additions below are safe to ship.

**The budget these prices sit in:** coins come from stage milestones (+15), an accepted commitment
ask (+25), a completed objective (+12), and date/hangout scoring (`affection delta × 2`), starting
from 24. So a common should be 3–8, uncommon 9–14, rare 15–22, epic 25–35.

---

## 1. Items — a default catalog

New `DEFAULT_ITEM_CATALOG` in `items.ts`, with `getItemCatalog` falling back to it the way
`getGiftCatalog` already does. `ItemDef` is `{ id, name, rarity, price, tags, description?, effect }`;
`ItemEffect` is `relationship` / `flag` / `currency` — every row fits as-is.

### Everyday consumables (the low band the catalog is missing)

| id | name | rarity | price | effect |
|---|---|---|---|---|
| `canned-coffee` | Canned Coffee | common | 4 | comfort +3 |
| `shared-umbrella` | Convenience Store Umbrella | common | 5 | comfort +4 |
| `hand-warmer` | Hand Warmer | common | 4 | comfort +3 |
| `spare-hair-tie` | Spare Hair Tie | common | 3 | trust +3 |
| `clean-notes` | Someone's Clean Notes | common | 5 | respect +4 |
| `melon-bread` | Melon Bread | common | 4 | comfort +3 |
| `throat-lozenges` | Throat Lozenges | common | 4 | trust +3 |

### Repair and pressure-release

`tension` is the one dimension where **down** is good, and nothing currently moves it deliberately.

| id | name | rarity | price | effect |
|---|---|---|---|---|
| `apology-cake` | Apology Cake | uncommon | 9 | tension −8 |
| `long-walk` | A Long Walk Home | uncommon | 10 | tension −6 + comfort +3 (needs `multi`, §8.1) |
| `honest-letter` | An Honest Letter | rare | 16 | trust +8 |

### Flag setters — the ones that move the story, not the numbers

A flag is a *permission* rather than a stat: it gates gallery CGs, outfits and intimacy entries.

| id | name | rarity | price | effect |
|---|---|---|---|---|
| `festival-tickets` | Festival Ticket Pair | uncommon | 12 | flag `first_date` |
| `matching-keychain` | Matching Keychain | rare | 18 | flag `promise` |
| `sealed-letter` | Sealed Confession Letter | epic | 28 | flag `confession` |

### Coin sources

| id | name | rarity | price | effect |
|---|---|---|---|---|
| `part-time-shift` | A Picked-Up Shift | common | 0 | currency +12 |
| `lucky-envelope` | Lucky Envelope | uncommon | 10 | currency +25 (dull until `random`, §8.1) |

A zero-price item is a *job*, not a purchase — worth checking the Buy button copes with `price: 0`.

---

## 2. Gifts — widening the taste space

Chosen so **every tag in `TAG_ICONS` has at least two gifts**, which is what makes an authored
`giftPreferences` discriminating and stops half the icon vocabulary going unused.

| id | name | rarity | price | tags | fills |
|---|---|---|---|---|---|
| `omamori-charm` | Omamori Charm | common | 5 | `luck`, `cute` | first `luck` |
| `four-leaf-clover` | Pressed Four-Leaf Clover | uncommon | 9 | `luck`, `personal` | second `luck` |
| `mixtape` | A Made Playlist | common | 6 | `music`, `personal` | second `music` |
| `concert-ticket` | Concert Ticket | rare | 17 | `music`, `ticket`, `event` | first `ticket` |
| `aquarium-pass` | Aquarium Day Pass | uncommon | 11 | `ticket`, `casual` | first `casual` |
| `sketchbook` | Good Sketchbook | uncommon | 10 | `creative`, `thoughtful` | first `creative` |
| `paint-set` | Small Paint Set | uncommon | 12 | `creative`, `personal` | second `creative` |
| `convenience-snacks` | Armful of Convenience-Store Snacks | common | 4 | `casual`, `sweet` | second `casual` |
| `poetry-collection` | Worn Poetry Collection | uncommon | 11 | `book`, `elegant` | second `book` |
| `fountain-pen` | Fountain Pen | rare | 16 | `elegant`, `thoughtful` | second `elegant` |
| `knit-scarf` | Hand-Knit Scarf | rare | 15 | `personal`, `comfort`, `romance` | second `comfort` |
| `plush-keepsake` | Ridiculous Plush | common | 5 | `cute`, `comfort` | second `cute` |
| `star-projector` | Star Projector | rare | 19 | `romance`, `thoughtful` | — |
| `couple-ring` | Simple Couple Ring | epic | 30 | `romance`, `elegant` | top of the ladder |

At 20 gifts, `giftPreferences` becomes real per-character authoring work — worth pairing with a
"generate gift preferences" assist, which `characters/aiAssist.ts` is already the right home for.

---

## 3. Toys

Existing catalog is 8. `price` is meaningful here (toys are owned via `Chat.toyInventory`); a toy
without a price is treated as free/pre-owned.

| id | label | minWarmth | minCommitment | price | kinks |
|---|---|---|---|---|---|
| `toy-massage-oil` **(exists)** | massage oil | 55 | — | 8 | `gentle` ← *untagged today* |
| `toy-feather` **(exists)** | a feather tickler | 55 | — | 8 | `sensory_play` |
| `toy-ice` **(exists)** | ice, traced slowly | 75 | dating | 12 | `sensory_play` |
| `toy-body-paint` **(exists)** | body paint or chocolate | 75 | dating | 18 | `sensory_play` ← *untagged today* |
| `toy-blindfold` **(exists)** | a blindfold | 75 | dating | 15 | `sensory_play`, `bondage` |
| `toy-vibrator` **(exists)** | a vibrator | 90 | dating | 30 | `toys` |
| `toy-silk-ties` **(exists)** | silk ties | 90 | exclusive | 25 | `bondage` |
| `toy-handcuffs` **(exists)** | playful handcuffs | 90 | exclusive | 25 | `bondage` |
| `toy-warming-gel` | warming gel | 55 | — | 8 | `sensory_play` |
| `toy-scarf-eyes` | a scarf over the eyes | 55 | — | 6 | `sensory_play` |
| `toy-sensory-kit` | a sensory kit (blindfold, feather, ice) | 75 | dating | 26 | `sensory_play`, `bondage` |
| `toy-wax-candle` | a low-temperature candle | 75 | dating | 14 | `sensory_play` |
| `toy-mirror` | a mirror, placed deliberately | 75 | dating | 16 | `voyeurism` |
| `toy-wand` | a wand massager | 90 | dating | 32 | `toys`, `overstimulation` |
| `toy-remote` | something they hold the remote to | 90 | exclusive | 34 | `toys`, `exhibitionism` |
| `toy-collar` | a soft collar | 90 | exclusive | 20 | `bondage` |
| `toy-rope` | soft rope | 90 | exclusive | 22 | `bondage` |
| `toy-cuff-set` | a padded cuff set | 90 | exclusive | 28 | `bondage` |
| `toy-under-bed` | an under-the-bed set | 90 | exclusive | 30 | `bondage` |
| `toy-spreader` | a spreader bar | 90 | exclusive | 26 | `bondage`, `rough` |
| `toy-plug` | a plug, worked up to | 90 | exclusive | 24 | `toys`, `anal` |

**Sensory kit note:** it's a bundle of three things that already exist separately, so the interesting
design question is whether owning it should mark `toy-blindfold` / `toy-feather` / `toy-ice` as owned
too. Cheapest honest answer: yes, and price it at a small discount on buying all three (26 vs 35).
That needs one branch in the buy-toy path, not a schema change.

---

## 4. Kissing spots

11 entries, but only 3 under 35 warmth — the same skew as everywhere else. These fill the low band
and add a couple at the top.

| id | label | minWarmth | minCommitment | regions |
|---|---|---|---|---|
| `kiss-nose` | the tip of the nose | 15 | — | `face` |
| `kiss-knuckles` | knuckles | 15 | — | `hands` |
| `kiss-hairline` | hairline | 15 | — | `face`, `hair` |
| `kiss-palm` | the palm of the hand | 35 | — | `hands` |
| `kiss-shoulder-clothed` | shoulder, through a sleeve | 35 | — | `shoulders` |
| `kiss-scar` | a scar they don't talk about | 55 | — | varies — a per-character authored spot would be better |
| `kiss-hip` | hipbone | 75 | dating | `hips`, `waist` |
| `kiss-spine` | down the spine | 90 | dating | `back` |

Existing: `kiss-forehead`, `kiss-cheek`, `kiss-hand` (15) · `kiss-temple`, `kiss-neck` (35) ·
`kiss-jaw`, `kiss-collarbone`, `kiss-wrist` (55) · `kiss-ear`, `kiss-shoulder` (75) ·
`kiss-thigh` (90, dating).

`kiss-scar` is the interesting one: it wants to point at something the *character card* established
rather than a fixed body part, which no other entry does. Worth either dropping it or letting an
entry name a card field to reference — the second is a real feature, not a catalog row.

---

## 5. Positions

Existing catalog is 9 and almost all of it is 75+/dating. Two gaps: the **clothed-but-charged** tier
that bridges kissing and sex, and the **location-tied** ones. Gates below are re-proposed as a whole
ladder rather than per-entry, since "keep gates honest" only works if the whole column is consistent.

### Clothed / partial — 55, no commitment floor

The tier that doesn't exist today. All of these are things that can happen with clothes on, which is
what makes them the right rung between a kiss and a bed.

| id | label | minWarmth | minCommitment |
|---|---|---|---|
| `pos-lap-clothed` | pulled into their lap, still dressed | 55 | — |
| `pos-pinned-standing` | pinned standing, fully clothed | 55 | — |
| `pos-chair-straddle` | straddling them in a chair | 55 | — |
| `pos-spooning` **(exists)** | spooning | **55 → 35** | **dating → none** |

**Re-gate proposed:** spooning is the one position that is entirely innocent with clothes on, and
gating it behind a commitment tier reads wrong — it's the "early dating" entry in your list. 35 and
no commitment floor.

### Early–mid — 55–75, dating

| id | label | minWarmth | minCommitment |
|---|---|---|---|
| `pos-missionary` **(exists)** | missionary | 75 | dating |
| `pos-missionary-hooked` | missionary, legs hooked | 75 | dating |
| `pos-cowgirl` **(exists)** | them on top | 75 | dating |
| `pos-face-to-face` **(exists)** | in their lap, face to face | 75 | dating |
| `pos-face-to-face-slow` | face to face, slow | 75 | dating |
| `pos-doggy` **(exists)** | from behind | 75 | dating |
| `pos-chest-to-back` | from behind, chest to back | 75 | dating |
| `pos-spooning-deep` | spooning, slow and deep | 75 | dating |
| `pos-edge-of-bed` | on the edge of the bed, you standing | 75 | dating |
| `pos-side-by-side` | on your sides, face to face | 75 | dating |
| `pos-against-wall` **(exists)** | against the wall | **90 → 75** | **exclusive → dating** |
| `pos-wall-one-leg` | against the wall, one leg up | 75 | dating |

**Re-gate proposed:** against-the-wall at 90/exclusive is stricter than missionary while being no
more exposed — it's a mid-tier position, not a late one. 75/dating.

### Riskier and location-tied — 90, exclusive

The distinguishing feature of this tier isn't intensity, it's **exposure** (somewhere you could be
caught) or **trust** (something that needs real coordination to be safe).

| id | label | minWarmth | minCommitment | note |
|---|---|---|---|---|
| `pos-desk` | bent over the desk | 90 | exclusive | riskier setting, per your gate note |
| `pos-table` | on the table | 90 | exclusive | |
| `pos-window` | against the window | 90 | exclusive | should also set/require an exposure flag |
| `pos-bath-edge` | the edge of the bath | 90 | exclusive | location-tied — see below |
| `pos-shower-bench` | the shower bench | 90 | exclusive | location-tied |
| `pos-onsen-edge` | the edge of the onsen | 90 | exclusive | location-tied |
| `pos-carry` | standing, carried | 90 | exclusive | |
| `pos-prone` | face down, flat | 90 | exclusive | |
| `pos-lotus` | seated, wrapped around each other | 90 | exclusive | |
| `pos-standing-behind` | standing, from behind | 90 | exclusive | |
| `pos-reverse-cowgirl` **(exists)** | reverse cowgirl | 90 | exclusive | |
| `pos-legs-over-shoulders` **(exists)** | legs over shoulders | 90 | exclusive | your "folded" |
| `pos-full-nelson` | full nelson | 90 | exclusive | **trust-gated — see §8.3** |
| `pos-sixty-nine` **(exists)** | 69 | 90 | exclusive | |

**Location-tied entries want a real gate, not a warmth number.** `pos-bath-edge` / `pos-shower-bench`
/ `pos-onsen-edge` / `pos-desk` / `pos-window` are nonsense in the wrong room. `IntimacyUnlockable`
has no location field today; adding `requiresBackground?: string[]` and filtering against the
resolved scene background (`vn/resolveBackground.ts` now returns exactly that) is the clean fix —
see §8.2. Until then they should sit at 90/exclusive and rely on the model not to place them
absurdly, which it sometimes will.

---

## 6. Activities

The biggest category and the one with the widest range. Ordered as a genuine ladder, because that's
what `minWarmth` is for and the current catalog jumps straight to 55.

### Non-explicit — 15–35, no commitment floor

None of this exists today, and it's the register most of a playthrough lives in. All of these want
`arousalWeight: 1` so they read as tenderness rather than escalation.

| id | label | minWarmth | kinks |
|---|---|---|---|
| `act-hands-public` | holding hands in public | 15 | `gentle` |
| `act-earbuds` | sharing earbuds | 15 | `gentle` |
| `act-cooking` | cooking together | 15 | `gentle` |
| `act-hair-washing` | washing their hair | 35 | `gentle` |
| `act-slow-dance` | slow dancing at home | 35 | `gentle` |
| `act-falling-asleep` | falling asleep against them | 35 | `gentle` |
| `act-bath-together` | a bath together | 35 | `gentle` |

### Charged, not yet explicit — 55

| id | label | minWarmth | minCommitment | kinks |
|---|---|---|---|---|
| `act-massage` **(exists)** | a slow, sensual massage | 55 | — | `gentle` |
| `act-massage-more` | a massage that turns into more | 55 | — | `gentle` |
| `act-dirty-talk` **(exists)** | dirty talk | 55 | — | `dirty_talk` |
| `act-undressing-slowly` | undressing them slowly | 55 | — | `gentle` |
| `act-grinding` | grinding, still clothed | 55 | — | — |
| `act-dry-humping` | dry humping until it isn't | 55 | — | — |
| `act-marking` | hickeys and light bites | 55 | dating | `marking` |
| `act-aftercare` **(exists)** | quiet aftercare | 55 | — | `gentle` |

### Explicit — 75, dating

| id | label | minWarmth | minCommitment | kinks |
|---|---|---|---|---|
| `act-hands-on-them` | hands on them, watching the reaction | 75 | dating | — |
| `act-oral` | oral, slow and thorough | 75 | dating | `oral` |
| `act-mutual` | touching each other at the same time | 75 | dating | — |
| `act-mutual-watching` | watching each other do it | 75 | dating | `voyeurism` |
| `act-toy-tease` | teasing with a toy, nothing more yet | 75 | dating | `toys`, `edging` |
| `act-eye-contact` | not looking away the whole time | 75 | dating | — |
| `act-praise` **(exists)** | praise, when it counts | 75 | dating | `praise` |
| `act-shower` **(exists)** | showering together | 75 | dating | — |
| `act-morning-shower` | washing each other after | 75 | dating | `gentle` |
| `act-morning-after` **(exists)** | slow morning-after | 75 | dating | — |
| `act-roleplay` **(exists)** | acting out a fantasy | 75 | dating | `roleplay` |
| `act-roleplay-explicit` | a roleplay that stops pretending | 75 | dating | `roleplay` |

### Deeper — 90, exclusive

Everything in this tier needs a `kinks` tag **and** a per-character preference read, not a warmth
number alone. See §8.

| id | label | minWarmth | minCommitment | kinks |
|---|---|---|---|---|
| `act-edging` **(exists)** | teasing and edging | 90 | exclusive | `edging` |
| `act-begging` | edging until they beg | 90 | exclusive | `edging`, `degradation` |
| `act-dirty-talk-specific` | dirty talk that gets specific | 90 | exclusive | `dirty_talk` |
| `act-praise-during` | praise while it's happening | 90 | exclusive | `praise` |
| `act-overstimulation` | past the first one, and past asking | 90 | exclusive | `overstimulation` |
| `act-anal` | anal, with the patience it takes | 90 | exclusive | `anal` |
| `act-finish-on` | where it ends up | 90 | exclusive | `bodily_fluids` |
| `act-exhibitionism` **(exists)** | somewhere you could be overheard | 90 | exclusive | `exhibitionism` |
| `act-public-risk` | half-dressed, door unlocked, voices down | 90 | exclusive | `exhibitionism` |
| `act-recording` | a photo, or the camera left running | 90 | exclusive | `recording` |
| `act-full-night` | not stopping at once | 90 | exclusive | — |
| `act-second-round` | again, before either of you can talk | 90 | exclusive | — |

### Aftercare-adjacent

| id | label | minWarmth | minCommitment | kinks |
|---|---|---|---|---|
| `act-cleaning-up` | cleaning them up | 90 | exclusive | `bodily_fluids` |
| `act-aftershocks` | holding them through the aftershocks | 75 | dating | `gentle` |

**`arousalWeight` matters here.** `act-aftercare` is already weight 1 so it winds a scene down rather
than up; `act-aftershocks` and everything in the non-explicit tier should be too. The deeper tier
should sit at the category default or above.

---

## 7. Scene flags

`SCENE_FLAGS` has five. Each new one is a gate that gallery CGs, outfits and catalog entries can hang
off, so they're cheap to add and expensive to leave out:

`first_fight`, `reconciled`, `met_family`, `stayed_over`, `said_i_love_you`, `moved_in`,
`long_distance`, `public_together`, `first_holiday`, `shared_secret`, `first_time_anal`,
`recorded_something`.

The last two exist specifically so a §5 "deeper" entry can require a *prior* first time rather than a
warmth number — "you've done this before" is a better gate for a repeat than any threshold.

`said_i_love_you` is conspicuously missing given `confession` exists; those are different beats and
most stories hit both.

---

## 8. The limits plumbing these depend on

**This is the part to do first, before any of §3–§6 ships.**

### 8.1 Every new entry must be added to `BUILT_IN_ENTRY_KINKS`

`kinks.ts` enforces hard limits structurally, and the doc comment is explicit about why: *"a model
cannot write toward content it was never shown."* `selectableIntimacyOptions` drops an entry whose
kinks include a hard limit, so it is never rendered, never traversable, and its `promptNote` never
enters context.

That enforcement reads `intimacyEntryKinks(option)` → the entry's own `kinks`, else
`BUILT_IN_ENTRY_KINKS[option.id]`, else **`[]`**. An empty array means `isAnyHardLimit` returns false
— so **an untagged entry can never be excluded by any hard limit.** The table currently covers 15 of
the 30 built-ins; `toy-body-paint`, `toy-massage-oil`, `pos-doggy`, `act-shower`, `act-morning-after`
and the rest are untagged and therefore unfilterable today.

For the existing gentle entries that's a small gap. For `act-recording`, `act-anal`,
`act-overstimulation`, `act-finish-on` and `pos-full-nelson` it is the entire safety mechanism, and
adding them untagged would put the riskiest content on the one path where limits are inert. Every
row in §3–§6 above carries its kinks column for this reason.

### 8.2 New kink ids

`KinkId` is deliberately open (`string & {}`), so these work immediately — but they should go in
`BUILT_IN_KINKS` so the character editor actually offers them as authorable limits:

`anal`, `marking`, `overstimulation`, `bodily_fluids`, `recording`, `voyeurism`, `degradation`.

Without `recording` in that list, no author can set it as a hard limit, and `act-recording` ships
ungateable. Same for `anal` and `act-anal`.

### 8.3 Two entries that want more than a kink tag

- **`act-recording`** is the one entry here whose fiction has a real-world analogue that's harmful
  when it isn't consensual, and "she agreed at 90 warmth" is a weak stand-in for that. Suggest: gate
  it on a `recorded_something` flag that can only be set by an explicit in-scene agreement beat,
  rather than on warmth at all — the flag *is* the consent record. Cheapest version: require
  `minCommitment: 'exclusive'` **and** an authored `kinkValence('recording') >= 1`, so a neutral
  character never sees it. Neutral is not permission, which `kinkValence`'s own doc already says.
- **`pos-full-nelson`** and `act-overstimulation` both describe someone with reduced ability to stop
  what's happening. The catalog already has the right instinct in `explicitSceneGuidance`'s
  consent-tension clause; these two should carry a `promptNote` that explicitly keeps the character
  able to end it, so the prose can't drift into something non-consensual by momentum.

Neither is a reason not to add them. They're a reason to add them with the gate the rest of this
codebase already builds for.

---

## 9. What needs code, not data

1. **Widen `ItemEffect`** — all additive, no existing row changes:
   `{ kind: 'multi', effects: ItemEffect[] }` (the two-part consumables in §1),
   `{ kind: 'outfit', outfitId }` / `{ kind: 'background', backgroundId }` (§10),
   `{ kind: 'random', pool: ItemEffect[] }`. One branch each in `itemEffectSummary` and
   `useChatSession`'s use-item path.
2. **`IntimacyUnlockable.requiresBackground?: string[]`** — filters the location-tied positions in §5
   against the resolved scene background. `resolveSceneBackground` already returns an id for every
   scene, including guessed ones, so the data is there.
3. **Let an item clear a `relationshipWarning`** — the at-risk banner is currently something you can
   only write your way out of; `honest-letter` wants to be a second route.
4. **Keepsakes — a held item, not a consumed one.** A new `equipped` slot with a passive modifier
   (a charm that softens rebuffs, a ring that slows warmth decay). Open question: per character or
   per chat.
5. **Shop restock / rotation** on `world.currentDay`, which only advances on deliberate day-planner
   actions — so a "this week's stock" rotation would have a natural cadence.
6. **Gift wrapping** as a cheap multiplier on an existing gift; gives the 0–5 coin range something to
   sell and interacts well with `giftBirthdayMultiplier`.
7. **A "generate gift preferences" assist** (§2) and a **"generate kink profile" assist** (§8) — 20
   gifts and 18 kinks is more per-character authoring than anyone will do by hand, and an unauthored
   kink profile is all-neutral, which §8.3 relies on *not* being the case.

---

## 10. Outfits as purchasable

`Character.outfits` exists and is gated by affection / scene flags / `manualOnly`. Nothing in the
shop touches it. A swimsuit you buy *before* the beach date is the most game-feeling thing on this
list.

**It needs less than this document originally claimed.** `Outfit.requiredFlags` already exists and
`isOutfitUnlocked` already enforces it, so an outfit can be sold *today* with no schema change at
all: author a custom scene flag on the world, put it in the outfit's `requiredFlags`, and sell an
item whose effect is `{ kind: 'flag', flag: thatFlag }`. That path is live as of the `multi` work —
nothing further is required to ship a purchasable swimsuit.

A dedicated `{ kind: 'outfit', outfitId }` effect would be duplicate machinery for a slightly nicer
authoring experience (no flag indirection, and the shop could show the outfit's real label and art).
Worth doing eventually, not worth doing first. The same reasoning applies to `World.backgrounds`,
which has no equivalent flag gate and so genuinely would need a new effect kind.

**Shipped 2026-09-11 — the wardrobe shop, which took the better half of that idea.** Rather than an
item that grants an outfit, the outfit is the product: `Outfit.price` makes it purchasable and
`isOutfitUnlocked` holds it locked until bought, on top of any existing warmth/flag gate. Ownership
is a reserved scene flag (`owned-outfit:<id>`) rather than a new `Chat` field, because every reader
of `isOutfitUnlocked` already threads `chat.sceneFlags` — so the gate needed no plumbing, and the
prefix keeps the marker out of the judge's vocabulary (`relationshipAssist.ts` offers only
`SCENE_FLAGS` plus a world's own) and out of the panel's flag row (`combinedSceneFlags`).

The Shop grows a **Wardrobe** section derived from the *character* rather than a fixed catalog,
since an outfit is art: only outfits that are priced *and* have sprites drawn are ever offered,
because buying one with no art would unlock a wardrobe state that renders as nothing.

**The thing to know before authoring any of this:** an outfit only exists if the character has
`outfit--expression` sprites uploaded for it. A "catgirl outfit" is not content this app can ship —
it is art per character. For wearables with no art, §3's wearable block is the other answer: they
are `toy`-category props that exist in the prose, priced and owned exactly like every other toy.

---

## Suggested order

1. **§8 first** — the kink tags and the new kink ids. Everything explicit below depends on it, and
   it's an afternoon.
2. `DEFAULT_ITEM_CATALOG` (§1) — an entire feature is dark without it, and it's one array.
3. Gift additions (§2) — makes taste discovery work as designed.
4. The non-explicit activity ladder and clothed position tier (§5, §6) — fills the band people
   actually play in, and it's the part that changes how the whole game paces.
5. Re-gates: spooning down, against-the-wall down (§5).
6. Toys, explicit activities, upper-band positions (§3, §5, §6).
7. `requiresBackground` (§9.2), then outfits-as-purchasable (§10).

Every entry in §3–§6 still needs its `actionText` (player-facing, first person, `{char}` templated)
and `promptNote` (model-facing, physical, concrete) hand-written in the register the existing entries
use, plus a `regions` row in `BUILT_IN_ENTRY_REGIONS`. Those two prose fields are what make the
catalog feel authored rather than generated — worth writing by hand rather than templating, which is
also why this list stops at ids and gates.
