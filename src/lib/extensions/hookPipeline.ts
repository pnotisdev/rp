// Runs extension hooks in order. Hooks fail open: an error or timeout never changes the turn.

import type { ExtensionRecord, HookName } from './manifest'

export type HookReply = { ok: true; value: unknown } | { ok: false; error: string } | { skipped: true }

export interface HookRunner {
  record: Pick<ExtensionRecord, 'id' | 'enabled' | 'grants' | 'manifest'>
  callHook(name: HookName, payload: unknown, timeoutMs: number): Promise<HookReply>
}

export interface HookContext {
  chatId: string
  characterName: string
  personaName: string
}

export interface ContextSection {
  text: string
  label: string
}

export type LogFn = (extId: string, level: 'warn' | 'error', text: string) => void

export const HOOK_TIMEOUT_MS: Record<HookName, number> = { input: 1500, output: 1500, context: 2500 }
export const MAX_HOOK_TEXT = 20_000
export const MAX_SECTION_TEXT = 1200
export const MAX_SECTIONS_TOTAL = 3000

/** Runners allowed to run `name`: enabled, granted "hooks", and declared in the manifest — ordered by name for stable behavior. */
export function hookedRunners(runners: readonly HookRunner[], name: HookName): HookRunner[] {
  return runners
    .filter((r) => r.record.enabled && r.record.grants.includes('hooks') && r.record.manifest.hooks.includes(name))
    .sort((a, b) => a.record.manifest.name.localeCompare(b.record.manifest.name))
}

function textFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text
  return undefined
}

async function call(runner: HookRunner, name: HookName, payload: unknown, log: LogFn): Promise<HookReply> {
  const reply = await runner.callHook(name, payload, HOOK_TIMEOUT_MS[name]).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
  if ('ok' in reply && !reply.ok) log(runner.record.id, 'error', `${name} hook failed: ${reply.error}`)
  return reply
}

/** Pipes the player's text through each `input` hook; a hook may return `{ cancel: true, reason }` to stop the send. */
export async function applyInputHooks(
  runners: readonly HookRunner[],
  text: string,
  ctx: HookContext,
  log: LogFn,
): Promise<{ text: string; cancelled?: string }> {
  let current = text
  for (const runner of hookedRunners(runners, 'input')) {
    const reply = await call(runner, 'input', { text: current, ...ctx }, log)
    if (!('ok' in reply) || !reply.ok) continue
    const value = reply.value as { cancel?: unknown; reason?: unknown } | string | null
    if (value && typeof value === 'object' && value.cancel === true) {
      return { text: current, cancelled: typeof value.reason === 'string' && value.reason ? value.reason : `Cancelled by ${runner.record.manifest.name}` }
    }
    const next = textFrom(value)
    if (next !== undefined && next.trim() && next.length <= MAX_HOOK_TEXT) current = next
  }
  return { text: current }
}

/** Pipes the model's reply through each `output` hook; an empty or oversized result is ignored. */
export async function applyOutputHooks(runners: readonly HookRunner[], text: string, ctx: HookContext, log: LogFn): Promise<string> {
  let current = text
  for (const runner of hookedRunners(runners, 'output')) {
    const reply = await call(runner, 'output', { text: current, ...ctx }, log)
    if (!('ok' in reply) || !reply.ok) continue
    const next = textFrom(reply.value)
    if (next !== undefined && next.trim() && next.length <= MAX_HOOK_TEXT) current = next
  }
  return current
}

function sectionsFrom(value: unknown, label: string): ContextSection[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() ? [{ text: value.trim().slice(0, MAX_SECTION_TEXT), label }] : []
  if (Array.isArray(value)) return value.flatMap((v) => sectionsFrom(v, label))
  if (typeof value === 'object') {
    const o = value as { text?: unknown; label?: unknown; sections?: unknown }
    if (Array.isArray(o.sections)) return sectionsFrom(o.sections, label)
    if (typeof o.text === 'string' && o.text.trim()) {
      return [{ text: o.text.trim().slice(0, MAX_SECTION_TEXT), label: typeof o.label === 'string' && o.label.trim() ? `${label}: ${o.label.trim().slice(0, 40)}` : label }]
    }
  }
  return []
}

/** Collects the extra prompt sections `context` hooks want added this turn (capped in size and count). */
export async function collectContextSections(runners: readonly HookRunner[], ctx: HookContext & { lastUserText: string }, log: LogFn): Promise<ContextSection[]> {
  const out: ContextSection[] = []
  let total = 0
  for (const runner of hookedRunners(runners, 'context')) {
    const reply = await call(runner, 'context', ctx, log)
    if (!('ok' in reply) || !reply.ok) continue
    for (const section of sectionsFrom(reply.value, runner.record.manifest.name).slice(0, 4)) {
      if (total + section.text.length > MAX_SECTIONS_TOTAL) return out
      total += section.text.length
      out.push(section)
    }
  }
  return out
}
