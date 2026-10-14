// Headless script runtimes: one hidden sandboxed iframe + Worker per enabled extension script, plus hook entry points.

import { createBridge } from './bridge'
import { loadBundle } from './bundleCache'
import { registerChannel } from './events'
import { IFRAME_SANDBOX, buildScriptDoc } from './frameDoc'
import { applyInputHooks, applyOutputHooks, collectContextSections, hookedRunners, type ContextSection, type HookContext, type HookReply, type HookRunner } from './hookPipeline'
import { appHostApi } from './hostApi'
import { logExtension } from './logStore'
import { resolveSettings, type ExtensionRecord, type HookName, type ToolSpec } from './manifest'

const STARTUP_MS = 4000
const MAX_RESTARTS = 3

function toClonable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

export class ScriptRuntime implements HookRunner {
  record: ExtensionRecord
  private source: string
  private frame: HTMLIFrameElement | null = null
  private port: MessagePort | null = null
  private loaded = false
  private disposed = false
  private restarts = 0
  private nextId = 1
  private pending = new Map<number, { resolve: (r: HookReply) => void; timer: ReturnType<typeof setTimeout> }>()
  private ready: Promise<void> = Promise.resolve()
  private unregister: (() => void) | null = null
  private events = new Set<string>()

  constructor(record: ExtensionRecord, source: string) {
    this.record = record
    this.source = source
    this.start()
  }

  private info() {
    const m = this.record.manifest
    return {
      api: 1,
      surface: 'script',
      extension: { id: m.id, name: m.name, version: m.version },
      permissions: this.record.grants,
      settings: resolveSettings(m, this.record.settings),
      dark: false,
    }
  }

  private start(): void {
    this.loaded = false
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', IFRAME_SANDBOX)
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none'
    frame.srcdoc = buildScriptDoc(this.source)
    this.ready = new Promise<void>((resolve) => {
      frame.addEventListener('load', () => {
        if (this.disposed) return
        if (this.loaded) {
          logExtension(this.record.id, 'error', 'The script frame navigated away and was stopped.', 'script')
          this.dispose()
          return
        }
        this.loaded = true
        const channel = new MessageChannel()
        this.port = channel.port1
        const bridge = createBridge({
          extId: this.record.id,
          extName: this.record.manifest.name,
          host: appHostApi,
          grants: () => this.record.grants,
          settings: () => resolveSettings(this.record.manifest, this.record.settings),
          subscribe: (event) => this.events.add(event),
        })
        channel.port1.onmessage = (ev: MessageEvent) => this.onMessage(ev.data as Record<string, unknown>, bridge)
        frame.contentWindow?.postMessage({ t: 'init', info: this.info() }, '*', [channel.port2])
        resolve()
      })
    })
    document.body.appendChild(frame)
    this.frame = frame
    this.unregister = registerChannel({
      extId: this.record.id,
      events: this.events,
      deliver: (event, payload) => this.port?.postMessage({ t: 'event', event, payload: toClonable(payload) }),
    })
  }

  private onMessage(m: Record<string, unknown>, bridge: ReturnType<typeof createBridge>): void {
    if (!m || typeof m !== 'object') return
    if (m.t === 'call') {
      const id = m.id
      bridge.handle(String(m.method), m.params).then(
        (result) => this.port?.postMessage({ t: 'result', id, result: toClonable(result) }),
        (err: unknown) => this.port?.postMessage({ t: 'result', id, error: err instanceof Error ? err.message : String(err) }),
      )
    } else if (m.t === 'log') {
      logExtension(this.record.id, String(m.level), String(m.text), 'script')
    } else if (m.t === 'hookResult' || m.t === 'toolResult') {
      const entry = this.pending.get(m.id as number)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(m.id as number)
      if (m.skipped) entry.resolve({ skipped: true })
      else if (typeof m.error === 'string') entry.resolve({ ok: false, error: m.error })
      else entry.resolve({ ok: true, value: m.result })
    }
  }

  private async request(kind: 'hook' | 'tool', body: Record<string, unknown>, timeoutMs: number): Promise<HookReply> {
    if (this.disposed) return { ok: false, error: 'the script is not running' }
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, STARTUP_MS))])
    if (!this.port || this.disposed) return { ok: false, error: 'the script did not start' }
    const id = this.nextId++
    return new Promise<HookReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: `timed out after ${timeoutMs} ms` })
        this.restart()
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.port!.postMessage({ t: kind, id, ...body })
    })
  }

  callHook(name: HookName, payload: unknown, timeoutMs: number): Promise<HookReply> {
    return this.request('hook', { name, payload: toClonable(payload) }, timeoutMs)
  }

  callTool(name: string, args: unknown, timeoutMs = 8000): Promise<HookReply> {
    return this.request('tool', { name, args: toClonable(args) }, timeoutMs)
  }

  /** Replaces a stuck frame; gives up after a few restarts until the extension changes. */
  private restart(): void {
    this.teardown('The script stopped responding and was restarted.')
    this.restarts++
    if (this.restarts > MAX_RESTARTS) {
      logExtension(this.record.id, 'error', 'The script kept hanging, so it was stopped. Edit the extension to try again.', 'script')
      this.disposed = true
      return
    }
    this.start()
  }

  private teardown(warning?: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, error: warning ?? 'the script was stopped' })
    }
    this.pending.clear()
    this.unregister?.()
    this.unregister = null
    this.port?.close()
    this.port = null
    this.frame?.remove()
    this.frame = null
    if (warning) logExtension(this.record.id, 'warn', warning, 'script')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.teardown()
  }

  get running(): boolean {
    return !this.disposed
  }
}

// ---- Manager ----

const runtimes = new Map<string, { runtime: ScriptRuntime; version: string }>()
let chain: Promise<void> = Promise.resolve()

async function syncNow(records: ExtensionRecord[]): Promise<void> {
  const wanted = new Map(records.filter((r) => r.enabled && r.manifest.script).map((r) => [r.id, r]))
  for (const [id, entry] of runtimes) {
    if (!wanted.has(id)) {
      entry.runtime.dispose()
      runtimes.delete(id)
    }
  }
  for (const record of wanted.values()) {
    const version = `${record.rev}`
    const existing = runtimes.get(record.id)
    if (existing && existing.version === version && existing.runtime.running) {
      existing.runtime.record = record
      continue
    }
    existing?.runtime.dispose()
    runtimes.delete(record.id)
    try {
      const bundle = await loadBundle(record)
      const source = bundle.files[record.manifest.script!]
      if (typeof source !== 'string') throw new Error(`script file "${record.manifest.script}" is missing`)
      runtimes.set(record.id, { runtime: new ScriptRuntime(record, source), version })
    } catch (e) {
      logExtension(record.id, 'error', `Could not start the script: ${e instanceof Error ? e.message : String(e)}`, 'script')
    }
  }
}

/** Starts, restarts and stops script runtimes to match the installed extensions. Calls are serialized. */
export function syncExtensionRuntimes(records: ExtensionRecord[]): Promise<void> {
  chain = chain.then(() => syncNow(records)).catch(() => {})
  return chain
}

export function stopAllExtensionRuntimes(): void {
  for (const entry of runtimes.values()) entry.runtime.dispose()
  runtimes.clear()
}

const runners = (): ScriptRuntime[] => [...runtimes.values()].map((e) => e.runtime)
const logHook = (extId: string, level: 'warn' | 'error', text: string) => logExtension(extId, level, text, 'hook')

/** Cheap check so hot paths skip all async work when no extension has this hook. */
export function hasHook(name: HookName): boolean {
  return hookedRunners(runners(), name).length > 0
}

export const runInputHooks = (text: string, ctx: HookContext) => applyInputHooks(runners(), text, ctx, logHook)
export const runOutputHooks = (text: string, ctx: HookContext) => applyOutputHooks(runners(), text, ctx, logHook)
export const runContextHooks = (ctx: HookContext & { lastUserText: string }): Promise<ContextSection[]> => collectContextSections(runners(), ctx, logHook)

export interface ProvidedTool {
  extId: string
  extName: string
  spec: ToolSpec
}

export function listProvidedTools(): ProvidedTool[] {
  return runners()
    .filter((r) => r.record.enabled && r.record.grants.includes('tools.provide'))
    .flatMap((r) => r.record.manifest.tools.map((spec) => ({ extId: r.record.id, extName: r.record.manifest.name, spec })))
}

export async function callProvidedTool(extId: string, name: string, args: unknown): Promise<HookReply> {
  const runtime = runtimes.get(extId)?.runtime
  if (!runtime || !runtime.record.grants.includes('tools.provide') || !runtime.record.manifest.tools.some((t) => t.name === name)) {
    return { ok: false, error: `No tool "${name}" is available from "${extId}"` }
  }
  return runtime.callTool(name, args)
}
