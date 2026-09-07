#!/usr/bin/env node
// Generate day/night background pairs for rp's VN locations, via the local ComfyUI.
//
//   node tools/comfy/make-backgrounds.mjs
//   node tools/comfy/make-backgrounds.mjs --only classroom,library
//   node tools/comfy/make-backgrounds.mjs --dry-run
//
// Per location: ComfyUI txt2img (day, fixed seed) -> <id>_day.png, then upload that render back
// into ComfyUI and img2img it (same seed, denoise 0.85, lighting tokens swapped) -> <id>_night.png.
// Spec: tools/comfy/backgrounds/locations.json (prefix/negative/seed/size shared, per-location tags
// + day/night lighting suffix). No npm deps — needs ComfyUI running (Comfy Desktop -> local install).

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const HELP = `make-backgrounds.mjs — day/night background generator for rp locations

  --only a,b,c     subset of location ids (see tools/comfy/backgrounds/locations.json)
  --out <dir>      output dir (default: tools/comfy/out/backgrounds/)
  --comfy <url>    default http://127.0.0.1:8188
  --dry-run        print the prompts, generate nothing
`

function parseArgs(argv) {
  const a = { comfy: 'http://127.0.0.1:8188' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const val = () => argv[++i]
    if (k === '--only') a.only = val().split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--out') a.out = val()
    else if (k === '--comfy') a.comfy = val().replace(/\/+$/, '')
    else if (k === '--dry-run') a.dryRun = true
    else if (k === '-h' || k === '--help') a.help = true
  }
  return a
}

// ---- ComfyUI -----------------------------------------------------------

async function comfyReachable(base) {
  try { return (await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) })).ok } catch { return false }
}

async function queuePrompt(base, workflow) {
  const r = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'rp-make-backgrounds' }) })
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
  const buf = Buffer.from(await r.arrayBuffer())
  await writeFile(destPath, buf)
  return buf
}

// stage a local render back into ComfyUI's input/ so a later LoadImage node can reference it.
async function uploadImage(base, buf, filename) {
  const form = new FormData()
  form.append('image', new Blob([buf], { type: 'image/png' }), filename)
  form.append('overwrite', 'true')
  const r = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  const body = await r.json()
  if (!r.ok) throw new Error(`upload failed: ${JSON.stringify(body)}`)
  return body.name
}

// ---- workflow ------------------------------------------------------

function fillDay(base, spec, positive) {
  const wf = JSON.parse(JSON.stringify(base))
  const set = (n, k, v) => { if (wf[n]?.inputs) wf[n].inputs[k] = v }
  set('5', 'width', spec.width)
  set('5', 'height', spec.height)
  set('6', 'text', positive)
  set('7', 'text', spec.negative)
  set('4', 'seed', spec.seed)
  return wf
}

function fillNight(base, spec, positive, imageName) {
  const wf = JSON.parse(JSON.stringify(base))
  const set = (n, k, v) => { if (wf[n]?.inputs) wf[n].inputs[k] = v }
  set('10', 'image', imageName)
  set('6', 'text', positive)
  set('7', 'text', spec.negative)
  set('4', 'seed', spec.seed)
  return wf
}

// ---- main ---------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(HELP)

  const spec = JSON.parse(await readFile(join(HERE, 'backgrounds', 'locations.json'), 'utf8'))
  const dayBase = JSON.parse(await readFile(join(HERE, 'anima-bg-txt2img.api.json'), 'utf8'))
  const nightBase = JSON.parse(await readFile(join(HERE, 'anima-bg-img2img.api.json'), 'utf8'))
  const locations = args.only ? spec.locations.filter((l) => args.only.includes(l.id)) : spec.locations
  const unknown = (args.only ?? []).filter((id) => !spec.locations.some((l) => l.id === id))
  if (unknown.length) console.warn(`unknown location ids ignored: ${unknown.join(', ')}`)

  const outDir = resolve(args.out || join(HERE, 'out', 'backgrounds'))
  console.log(`locations : ${locations.length} (x2 = ${locations.length * 2} renders)`)
  console.log(`seed      : ${spec.seed}   size: ${spec.width}x${spec.height}`)
  console.log(`out       : ${outDir}\n`)

  if (args.dryRun) {
    for (const loc of locations) {
      console.log(`--- ${loc.id}_day ---\n${spec.prefix}, ${loc.tags}, ${loc.day}\n`)
      console.log(`--- ${loc.id}_night ---\n${spec.prefix}, ${loc.tags}, ${loc.night}\n`)
    }
    return
  }
  if (!(await comfyReachable(args.comfy))) { console.error(`ComfyUI not reachable at ${args.comfy}`); process.exit(1) }
  await mkdir(outDir, { recursive: true })

  const failures = []
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]
    const label = `[${String(i + 1).padStart(2)}/${locations.length}] ${loc.id.padEnd(20)}`
    const t0 = Date.now()
    try {
      const dayPositive = `${spec.prefix}, ${loc.tags}, ${loc.day}`
      const dayWf = fillDay(dayBase, spec, dayPositive)
      const dayImages = await waitForResult(args.comfy, await queuePrompt(args.comfy, dayWf))
      if (!dayImages.length) throw new Error('no day image in result')
      const dayPath = join(outDir, `${loc.id}_day.png`)
      const dayBuf = await downloadImage(args.comfy, dayImages[0], dayPath)
      const uploadedName = await uploadImage(args.comfy, dayBuf, `rp-bg-${loc.id}.png`)

      const nightPositive = `${spec.prefix}, ${loc.tags}, ${loc.night}`
      const nightWf = fillNight(nightBase, spec, nightPositive, uploadedName)
      const nightImages = await waitForResult(args.comfy, await queuePrompt(args.comfy, nightWf))
      if (!nightImages.length) throw new Error('no night image in result')
      await downloadImage(args.comfy, nightImages[0], join(outDir, `${loc.id}_night.png`))

      console.log(`${label} ok   (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    } catch (err) {
      console.error(`${label} FAILED: ${err.message}`)
      failures.push(loc.id)
    }
  }

  console.log()
  if (failures.length) {
    console.log(`${failures.length} failed: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log(`done — ${locations.length * 2} images in ${outDir}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
