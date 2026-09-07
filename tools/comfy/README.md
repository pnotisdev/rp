# rp asset generation — ComfyUI + Anima

Generate transparent **expression sprites** (and alternate **outfits**) for any rp character:
one fixed-seed anime portrait, 21 expression variants, transparent background, optionally pushed
straight onto the character in the rp app.

```bash
# 21 sprites for the base look, review them in tools/comfy/out/sumire/
node tools/comfy/make-sprites.mjs --spec tools/comfy/characters/sumire.json

# base + every outfit, pushed onto the character
node tools/comfy/make-sprites.mjs --spec tools/comfy/characters/sumire.json --outfit all --apply
```

| file | what |
|---|---|
| `make-sprites.mjs` | the generator (Node, no npm deps) |
| `characters/<name>.json` | one per character — prompt, seed, outfits |
| `characters/_template.json` | starting point for a new character |
| `expression-prompts.json` | 21 `DEFAULT_EXPRESSIONS` ids → danbooru expression tags |
| `_matte.py` | background cutter (BiRefNet + decontaminate), run by the script |
| `anima-txt2img.api.json` | base workflow the script fills in |
| `anima-txt2img.ui.json` | same graph, **openable in ComfyUI** to watch / tweak |
| `anima-expression-edit.*` | alt pipeline: *edit* one existing portrait (Cosmos reference + edit LoRA) |

---

## How it works

Per sprite: **ComfyUI txt2img** (Anima model, the character's prompt with one expression in the
`{{expression}}` slot and one outfit in `{{outfit}}`, a **fixed seed** so the character stays
consistent, **flat grey background**) → **`_matte.py`** (BiRefNet mask → erode ~1px → remove the
grey backdrop's contribution from every edge pixel) → `<key>.png` (RGBA).

Grey, not white: on white the model's own anti-aliased hair edges are half white, which leaves a
bright halo, and a matte aggressive enough to kill it eats into her pale skin. On mid-grey both
hair and skin separate cleanly and the residual fringe is neutral and easy to subtract.

`<key>` is exactly what rp's `Character.sprites` map uses (`src/lib/vn/outfits.ts`):
`neutral`, `happy`, … for the base look, and `casual--neutral`, `pajamas--happy`, … for an outfit.

Models (already installed in the Comfy-UI local install): `ccDreamIsland_kirazuri_rotate` (an
Anima aesthetic merge) · `qwen_3_06b_base` text encoder (`cosmos` type) · `qwen_image_vae`.
`832×1216 · 30 steps · cfg 5 · dpmpp_2m`. ~60–90 s per sprite on the 2080 Ti → a full 21-set is
~25–30 min; base + 3 outfits is ~90 min.

---

## Add a character

```bash
node tools/comfy/make-sprites.mjs --scaffold kestrel --from-rp <character-uuid>
```
Creates `characters/kestrel.json`, pre-filled with her name/id + card text as a hint (needs the
rp dev server running for `--from-rp`). Then edit:

- **`positive`** — the character's look as **danbooru tags**, keeping the `{{expression}}`,
  `{{outfit}}` and `{{framing}}` slots. Anything the character *always* wears (a signature bow,
  glasses) goes in `positive`; swappable clothing goes in `outfit` / `outfits`.
- **`outfit`** — the default clothing tags (fills `{{outfit}}` for the base look).
- **`outfits`** — `[{ id, label, prompt, unlockAffection?, manualOnly? }]`. `prompt` replaces
  `{{outfit}}` for that look. `--apply` registers these on `Character.outfits` with their gates.
- **`seed`** — any fixed integer, locks the character across the set. A few big-change expressions
  (`laughing`, `surprised`) may drift; regenerate just those: `--only laughing,surprised --seed <n>`.
- **`framing`** — `headshot` (default) or `upper body` if you want outfits to show more.

---

## Push onto the character (`--apply`)

`--apply` copies the generated PNGs into `data/avatars/characters/<uuid>/sprites/`, **merges** the
new keys into `Character.sprites` (existing art is kept, not pruned), and registers any new
outfits on `Character.outfits`. It backs up the existing sprite dir to `tools/comfy/backups/`
first (outside `data/`, which Vite watches). Needs `characterId` in the spec and the rp dev
server ($RP_API, default `:3001`).

Without `--apply`, sprites just land in `tools/comfy/out/<name>/` for you to review, then drop into
the character editor's **Bulk upload by filename** (it maps `casual--happy.png` → the casual
outfit's happy expression automatically).

---

## Watch it in ComfyUI

The script uses ComfyUI's HTTP API — jobs run but don't draw on the canvas. **Workflow → Open →
`anima-txt2img.ui.json`** (also in ComfyUI's workflow list), then open the **Queue** tab — every
sprite shows there with its thumbnail as it's submitted.

---

## Options

```
--spec <file>        character spec (required)
--outfit <id|all>    also render an outfit / every outfit  (default: base only)
--only a,b,c         subset of expression ids
--seed <n>           override the spec seed
--out <dir>          output dir (default tools/comfy/out/<name>/)
--apply              push onto the rp character (backs up first)
--no-matte           keep the grey background
--keep-raw           keep the pre-matte <key>.raw.png
--dry-run / --list
--comfy <url>        default http://127.0.0.1:8188
--matte-python <p>   python with rembg for _matte.py  (default $MATTE_PYTHON → the venv)
--matte-model <m>    rembg model for the mask         (default birefnet-general)
```

---

## Comfy MCP (agent tools)

Claude can drive ComfyUI directly (list installed nodes/models, run/validate a workflow JSON, fetch
outputs) via the official [`comfy-mcp`](https://docs.comfy.org/agent-tools/mcp) server. Registered
project-wide in [`.mcp.json`](../../.mcp.json).

**Installed** (global env, `pip install "comfy-cli>=1.14.0" comfy-mcp`):
- `comfy-cli` 1.20.0 → `comfy set-default "E:\Comfy-Desktop\ComfyUI-Installs\Comfy-UI\ComfyUI"`
  points it at the existing Desktop install instead of creating a new workspace.
- `comfy-mcp` 0.10.0 → the MCP server binary, run over stdio by Claude Code.

Both talk to whatever ComfyUI is already running at `127.0.0.1:8188` (the Desktop app manages the
process; `comfy env` confirms `server.running: true` against that URL — no need for the MCP's own
`launch_comfyui`/`comfy launch` unless ComfyUI isn't up yet).

Tools exposed: `server_info`, `run_workflow`/`job_status`/`fetch_outputs`, `search_nodes`/`get_node`
(reads the live install, custom nodes included), `search_models`, `validate_workflow`,
`search_templates`/`fetch_template`, `launch_comfyui`/`stop_comfyui`.

New Claude Code session picks up `.mcp.json` automatically (approve it once when prompted to trust
project MCP servers).

---

## Backgrounds (day/night location art)

```bash
node tools/comfy/make-backgrounds.mjs                    # all locations, review in tools/comfy/out/backgrounds/
node tools/comfy/make-backgrounds.mjs --only classroom,library
node tools/comfy/make-backgrounds.mjs --dry-run           # print prompts, generate nothing
```

Per location: **txt2img** (day, fixed seed) → `<id>_day.png`, then that render is uploaded back into
ComfyUI and **img2img'd** (same seed, denoise 0.85, cfg 6.5, lighting tokens swapped) → `<id>_night.png`.
No ControlNet/LLLite — img2img alone held composition (desks, windows, shelving) reliably across the
day→night swing, which is the largest lighting delta this technique has to handle; smaller swings
(day→evening/overcast) would tolerate lower denoise.

- `backgrounds/locations.json` — shared prefix/negative/seed/size + per-location tags and day/night
  lighting suffix. Add a location by appending an entry; keep every window-bearing indoor location's
  night suffix explicit (`dark window, night sky outside, ...`) — without it the sampler tends to
  leave daylight glowing through the window untouched.
- `anima-bg-txt2img.api.json` / `anima-bg-img2img.api.json` — the two workflow templates the script
  fills in (landscape 1216×832, vs. the portrait sprite workflow above).

`@kantoku` + `score_9, score_8` in the shared prefix noticeably sharpens/flattens the render style
vs. plain `masterpiece, best quality` alone — worth keeping for backgrounds.
