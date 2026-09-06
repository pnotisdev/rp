#!/usr/bin/env node
// Generate transparent expression sprites (and alternate outfits) for any rp character, via the
// local ComfyUI. Optionally push them straight into the character in the rp app.
//
//   node tools/comfy/make-sprites.mjs --spec tools/comfy/characters/sumire.json
//   node tools/comfy/make-sprites.mjs --spec ... --outfit casual
//   node tools/comfy/make-sprites.mjs --spec ... --outfit all --apply
//   node tools/comfy/make-sprites.mjs --spec ... --only neutral,happy,angry --seed 777
//   node tools/comfy/make-sprites.mjs --scaffold kestrel [--from-rp <uuid>]
//   node tools/comfy/make-sprites.mjs --list
//
// Per sprite:  ComfyUI txt2img (grey bg, fixed seed)  ->  _matte.py (BiRefNet + decontaminate)
// ->  <key>.png   where <key> is "<expression>" for the base look or "<outfitId>--<expression>"
// for an outfit — exactly the keys rp's Character.sprites map uses (src/lib/vn/outfits.ts).
//
// Needs: ComfyUI running (Comfy Desktop -> local install), and the toolchain venv's Python for
// the matte ($MATTE_PYTHON / derived from $REMBG_BIN / the venv fallback). --apply also needs the
// rp dev server ($RP_API, default http://127.0.0.1:3001). No npm deps.

import { readFile, writeFile, mkdir, access, rm, cp, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { spawn } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const RP_API = (process.env.RP_API || 'http://127.0.0.1:3001').replace(/\/+$/, '')
// Last-resort guesses for a rembg-equipped Python, tried only after $MATTE_PYTHON, $REMBG_BIN and a
// bare `python` on PATH: the `~/.venvs/comfy-mcp` toolchain venv this repo's README suggests making.
const HOME = process.env.USERPROFILE || process.env.HOME || ''
const VENV_PY_FALLBACKS = HOME
  ? [
      join(HOME, '.venvs', 'comfy-mcp', 'Scripts', 'python.exe'), // Windows
      join(HOME, '.venvs', 'comfy-mcp', 'bin', 'python'), // macOS / Linux
    ]
  : []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exists = (p) => access(p).then(() => true, () => false)

const HELP = `make-sprites.mjs — transparent sprite + outfit generator for rp characters

generate:
  --spec <file>        character spec (tools/comfy/characters/<name>.json)   [required]
  --outfit <id|all>    also render this outfit (spec.outfits[].id), or every outfit. default: base only
  --only a,b,c         subset of the 21 expression ids
  --seed <n>           override spec.seed for this run
  --out <dir>          output dir (default: tools/comfy/out/<name>/, or the live sprite dir with --apply)
  --apply              push the generated sprites into the character in the rp app (backs up first)
  --no-matte           keep the grey background
  --keep-raw           keep the pre-matte <key>.raw.png
  --dry-run            print the prompts, generate nothing
  --comfy <url>        default http://127.0.0.1:8188
  --matte-python <p>   python (with rembg) for _matte.py  (default $MATTE_PYTHON -> venv)
  --matte-model <m>    rembg model for the matte  (default birefnet-general)

scaffold / info:
  --scaffold <name> [--from-rp <uuid>]   create tools/comfy/characters/<name>.json
  --list                                 print the expression ids
`

function parseArgs(argv) {
  const a = {
    comfy: 'http://127.0.0.1:8188',
    mattePython: process.env.MATTE_PYTHON || (process.env.REMBG_BIN ? process.env.REMBG_BIN.replace(/rembg(\.exe)?$/i, 'python$1') : null),
    matteModel: 'birefnet-general',
    matte: true, outfitArg: null, apply: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const val = () => argv[++i]
    if (k === '--spec') a.spec = val()
    else if (k === '--outfit') a.outfitArg = val()
    else if (k === '--only') a.only = val().split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--seed') a.seed = Number(val())
    else if (k === '--out') a.out = val()
    else if (k === '--apply') a.apply = true
    else if (k === '--comfy') a.comfy = val().replace(/\/+$/, '')
    else if (k === '--matte-python') a.mattePython = val()
    else if (k === '--matte-model') a.matteModel = val()
    else if (k === '--workflow') a.workflow = val()
    else if (k === '--scaffold') a.scaffold = val()
    else if (k === '--from-rp') a.fromRp = val()
    else if (k === '--no-matte') a.matte = false
    else if (k === '--keep-raw') a.keepRaw = true
    else if (k === '--list') a.list = true
    else if (k === '--dry-run') a.dryRun = true
    else if (k === '-h' || k === '--help') a.help = true
  }
  return a
}

// ---- subprocess / matte -------------------------------------------------

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', rej)
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').pop() || ''}`))))
  })
}

async function resolveMattePython(explicit) {
  for (const c of [explicit, 'python', 'python3', ...VENV_PY_FALLBACKS]) {
    if (!c) continue
    try { await run(c, ['-c', 'import rembg']); return c } catch {}
  }
  return null
}

async function matte(python, inPath, outPath, model) {
  await run(python, [join(HERE, '_matte.py'), inPath, outPath, model])
}

// ---- ComfyUI -----------------------------------------------------------

async function comfyReachable(base) {
  try { return (await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) })).ok } catch { return false }
}

async function queuePrompt(base, workflow) {
  const r = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'rp-make-sprites' }) })
  const body = await r.json()
  if (!r.ok) throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(body?.node_errors ?? body)}`)
  return body.prompt_id
}

async function waitForResult(base, promptId, timeoutMs = 20 * 60_000) {
  const start = Date.now()
  for (;;) {
    const entry = (await (await fetch(`${base}/history/${promptId}`)).json())[promptId]
    if (entry) {
      if (!entry.status?.completed) {
        const msg = (entry.status?.messages ?? []).map((m) => JSON.stringify(m)).join(' ')
        throw new Error(`generation failed: ${entry.status?.status_str ?? '?'} ${msg}`)
      }
      const images = []
      for (const out of Object.values(entry.outputs ?? {})) for (const img of out.images ?? []) images.push(img)
      return images
    }
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for ComfyUI')
    await sleep(2500)
  }
}

async function downloadImage(base, img, destPath) {
  const u = new URL(`${base}/view`)
  u.searchParams.set('filename', img.filename)
  u.searchParams.set('subfolder', img.subfolder ?? '')
  u.searchParams.set('type', img.type ?? 'output')
  const r = await fetch(u)
  if (!r.ok) throw new Error(`could not fetch ${img.filename} (${r.status})`)
  await writeFile(destPath, Buffer.from(await r.arrayBuffer()))
}

// ---- prompt / workflow -------------------------------------------------

function buildPositive(spec, expressionTags, outfitPrompt) {
  let s = spec.positive
  s = s.replaceAll('{{expression}}', expressionTags)
  s = s.replaceAll('{{outfit}}', outfitPrompt || spec.outfit || '')
  s = s.replaceAll('{{framing}}', spec.framing || 'headshot')
  if (!spec.positive.includes('{{expression}}')) s = `${s.replace(/,\s*$/, '')}, ${expressionTags}`
  return s
}

function fillWorkflow(base, spec, seed, positive) {
  const wf = JSON.parse(JSON.stringify(base))
  const set = (n, k, v) => { if (wf[n]?.inputs) wf[n].inputs[k] = v }
  set('1', 'unet_name', spec.model)
  set('5', 'width', spec.width)
  set('5', 'height', spec.height)
  set('6', 'text', positive)
  set('7', 'text', spec.negative)
  set('4', 'seed', seed)
  set('4', 'steps', spec.steps)
  set('4', 'cfg', spec.cfg)
  set('4', 'sampler_name', spec.sampler)
  set('4', 'scheduler', spec.scheduler)
  return wf
}

// which (outfitId, prompt) pairs to render this run. base is always '' id.
function outfitsToRender(spec, outfitArg) {
  const base = { id: '', label: 'base', prompt: spec.outfit || '' }
  if (!outfitArg) return [base]
  const defined = spec.outfits ?? []
  if (outfitArg === 'all') return [base, ...defined]
  const one = defined.find((o) => o.id === outfitArg)
  if (!one) throw new Error(`outfit "${outfitArg}" not in spec.outfits (${defined.map((o) => o.id).join(', ') || 'none'})`)
  return [one]
}

const keyFor = (outfitId, expr) => (outfitId ? `${outfitId}--${expr}` : expr)

// ---- scaffold --------------------------------------------------------

async function scaffold(name, fromRp) {
  const dest = join(HERE, 'characters', `${name}.json`)
  if (await exists(dest)) throw new Error(`${dest} already exists`)
  const tpl = JSON.parse(await readFile(join(HERE, 'characters', '_template.json'), 'utf8'))
  tpl.name = name
  if (fromRp) {
    try {
      const c = await (await fetch(`${RP_API}/api/characters/${fromRp}`)).json()
      tpl.characterId = c.id
      tpl.name = (c.card?.name || name).toLowerCase()
      const hint = [c.card?.description, c.appearance, c.card?.personality].filter(Boolean).join('\n\n')
      if (hint) tpl.note = `CARD HINT (turn into tags, then delete this):\n${hint}\n\n---\n${tpl.note}`
    } catch (e) {
      console.warn(`could not reach rp API at ${RP_API} (${e.message}) — scaffolding blank`)
    }
  }
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, JSON.stringify(tpl, null, 2) + '\n')
  console.log(`created ${dest}\nedit "positive" with ${tpl.name}'s appearance tags, set a "seed", then:`)
  console.log(`  node tools/comfy/make-sprites.mjs --spec tools/comfy/characters/${name}.json`)
}

// ---- apply to rp ----------------------------------------------------

async function applyToRp(spec, outDir, renderedKeys, renderedOutfitIds) {
  if (!spec.characterId) throw new Error('spec has no "characterId" — cannot --apply. Add the rp character uuid.')
  const url = `${RP_API}/api/characters/${spec.characterId}`
  const char = await (await fetch(url)).json()
  if (char.error || !char.id) throw new Error(`rp character ${spec.characterId} not found at ${RP_API}`)

  // 1. back up + copy the freshly generated PNGs into the live sprite dir. The backup goes to
  //    tools/comfy/backups/, NOT inside data/ — Vite watches data/avatars and a batch copy into a
  //    sibling dir there is enough to crash its file watcher (EBUSY).
  const liveDir = join(REPO, 'data', 'avatars', 'characters', spec.characterId, 'sprites')
  if (await exists(liveDir)) {
    const bak = join(HERE, 'backups', `${spec.name}-sprites-${Date.now()}`)
    await mkdir(dirname(bak), { recursive: true })
    await cp(liveDir, bak, { recursive: true })
    console.log(`backed up existing sprites -> ${bak}`)
  }
  await mkdir(liveDir, { recursive: true })
  if (resolve(outDir) !== resolve(liveDir)) {
    for (const f of await readdir(outDir)) if (f.endsWith('.png') && !f.endsWith('.raw.png')) await cp(join(outDir, f), join(liveDir, f))
  }

  // 2. MERGE new keys into Character.sprites (keep every existing entry so pruneUnreferencedFiles
  //    on the server doesn't delete art we didn't touch), then PUT.
  const sprites = { ...(char.sprites ?? {}) }
  const bust = Date.now()
  for (const key of renderedKeys) sprites[key] = `/avatars/characters/${spec.characterId}/sprites/${key}.png?t=${bust}`

  // 3. register any new outfits (merge with existing, keep gates from the spec)
  const outfits = [...(char.outfits ?? [])]
  for (const id of renderedOutfitIds) {
    if (!id || outfits.some((o) => o.id === id)) continue
    const def = (spec.outfits ?? []).find((o) => o.id === id)
    outfits.push({ id, label: def?.label || id, ...(def?.unlockAffection ? { unlockAffection: def.unlockAffection } : {}), ...(def?.manualOnly ? { manualOnly: true } : {}) })
  }

  // only send `outfits` when there's something to register — an empty array round-trips as
  // undefined on the server and there's no reason to touch the field for a base-only run.
  const body = outfits.length ? { sprites, outfits } : { sprites }
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const updated = await res.json()
  if (!res.ok) throw new Error(`PUT failed: ${JSON.stringify(updated)}`)
  console.log(`applied: ${renderedKeys.length} sprite keys${outfits.length ? `; outfits [${(updated.outfits ?? []).map((o) => o.id).join(', ')}]` : ''}`)
}

// ---- main ---------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(HELP)

  const exprMap = JSON.parse(await readFile(join(HERE, 'expression-prompts.json'), 'utf8')).expressions
  const allIds = Object.keys(exprMap)
  if (args.list) return console.log(allIds.join('\n'))
  if (args.scaffold) return scaffold(args.scaffold, args.fromRp)
  if (!args.spec) { console.error('--spec is required\n'); return console.log(HELP) }

  const spec = JSON.parse(await readFile(resolve(args.spec), 'utf8'))
  const baseWorkflow = JSON.parse(await readFile(args.workflow ? resolve(args.workflow) : join(HERE, 'anima-txt2img.api.json'), 'utf8'))
  const seed = Number.isFinite(args.seed) ? args.seed : spec.seed
  const unknown = (args.only ?? []).filter((id) => !(id in exprMap))
  if (unknown.length) console.warn(`unknown expression ids ignored: ${unknown.join(', ')}`)
  const ids = args.only ? args.only.filter((id) => id in exprMap) : allIds
  const outfits = outfitsToRender(spec, args.outfitArg)

  const outDir = resolve(args.out || join(HERE, 'out', spec.name))

  console.log(`character : ${spec.name}`)
  console.log(`seed      : ${seed}`)
  console.log(`outfits   : ${outfits.map((o) => o.id || 'base').join(', ')}`)
  console.log(`sprites   : ${ids.length} expressions x ${outfits.length} = ${ids.length * outfits.length}`)
  console.log(`matte     : ${args.matte ? `${args.matteModel} + decontaminate` : 'OFF'}`)
  console.log(`out       : ${outDir}${args.apply ? '   (+ --apply to the rp character)' : ''}\n`)

  if (args.dryRun) {
    for (const o of outfits) for (const id of ids) console.log(`--- ${keyFor(o.id, id)} ---\n${buildPositive(spec, exprMap[id], o.prompt)}\n`)
    return
  }
  if (!(await comfyReachable(args.comfy))) { console.error(`ComfyUI not reachable at ${args.comfy}`); process.exit(1) }
  if (args.matte) {
    args.mattePython = await resolveMattePython(args.mattePython)
    if (!args.mattePython) { console.error(`no python with rembg found — pass --matte-python <path>, set $MATTE_PYTHON, or --no-matte`); process.exit(1) }
  }

  await mkdir(outDir, { recursive: true })
  const failures = []
  const doneKeys = []
  const jobs = outfits.flatMap((o) => ids.map((id) => ({ o, id })))
  for (let i = 0; i < jobs.length; i++) {
    const { o, id } = jobs[i]
    const key = keyFor(o.id, id)
    const label = `[${String(i + 1).padStart(2)}/${jobs.length}] ${key.padEnd(22)}`
    const t0 = Date.now()
    try {
      const wf = fillWorkflow(baseWorkflow, spec, seed, buildPositive(spec, exprMap[id], o.prompt))
      const images = await waitForResult(args.comfy, await queuePrompt(args.comfy, wf))
      if (!images.length) throw new Error('no image in result')
      const finalPath = join(outDir, `${key}.png`)
      if (args.matte) {
        const raw = join(outDir, `${key}.raw.png`)
        await downloadImage(args.comfy, images[0], raw)
        await matte(args.mattePython, raw, finalPath, args.matteModel)
        if (!args.keepRaw) await rm(raw, { force: true })
      } else {
        await downloadImage(args.comfy, images[0], finalPath)
      }
      doneKeys.push(key)
      console.log(`${label} ok   (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    } catch (err) {
      console.error(`${label} FAILED: ${err.message}`)
      failures.push(key)
    }
  }

  console.log()
  if (args.apply && doneKeys.length) {
    try { await applyToRp(spec, outDir, doneKeys, [...new Set(outfits.map((o) => o.id))]) } catch (e) { console.error(`--apply failed: ${e.message}`); failures.push('apply') }
  }
  if (failures.length) {
    console.log(`${failures.length} failed: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log(`done — ${doneKeys.length} sprites in ${outDir}${args.apply ? ' (applied)' : ''}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
