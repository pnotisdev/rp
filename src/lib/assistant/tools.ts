// Plain-text tool use for the Assistant: works on any local model, no native function calling needed.

import { parseLenientJson } from '@/lib/jsonRepair'
import type { GeneratedCharacter } from './thread'

export interface AgentTool {
  name: string
  title: string
  description: string
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  /** True when calling it changes something. */
  write: boolean
  /** True when the user should approve each call (file edits, commands). */
  confirm?: boolean
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

/** What it takes to put a changed character section back as it was. */
export interface ToolUndo {
  characterId: string
  name: string
  section: string
  /** The section's stored values before the change (keys prefixed `card.` live inside the card). */
  before: Record<string, unknown>
  reverted?: boolean
}

export interface ToolResult {
  text: string
  isError: boolean
  /** Pictures for a vision model, as data URLs. */
  images?: string[]
  /** A character draft for the thread to show as a card. */
  draft?: GeneratedCharacter
  /** Set when the call changed a saved character and can be reverted. */
  undo?: ToolUndo
}

const RESULT_CHAR_LIMIT = 6000
/** Results older than the last few steps are shortened in the prompt; the model already acted on them. */
const OLD_RESULT_CHAR_LIMIT = 500

/** Hides the long tail of tools from a small model: it picks better from a short, relevant list. */
export function toolList(tools: AgentTool[], allowWrites: boolean): AgentTool[] {
  return tools.filter((t) => allowWrites || !t.write)
}

function signature(tool: AgentTool): string {
  const required = new Set(tool.inputSchema.required ?? [])
  const args = Object.entries(tool.inputSchema.properties ?? {})
    .map(([name, p]) => `${name}${required.has(name) ? '' : '?'}: ${p.type ?? 'any'}`)
    .join(', ')
  return `${tool.name}(${args})`
}

export function toolInstructions(tools: AgentTool[]): string {
  const lines = tools.map((t) => `- ${signature(t)}: ${t.description.split('. ')[0].replace(/\.$/, '')}`)
  return [
    'You can use tools to look at and change things. To use one, reply with exactly one block and nothing else:',
    '<tool_call>{"name": "tool_name", "arguments": {"arg": "value"}}</tool_call>',
    'The result comes back in a <tool_result> block. Use as many tools as you need, one per reply. When you are done, answer the user in plain prose without any tool_call block, and say what you did.',
    'How to work: look before you change (list or search, then read). Never invent ids or file contents: look them up. Make the smallest edit that does the job. After changing something, read it back to check. If a tool returns an error, read it and fix the cause instead of repeating the call. If a picture was attached to a result, you can see it.',
    'Tools:',
    ...lines,
  ].join('\n')
}

/** Gemma writes its own `<|tool_call>call:name{key:<|"|>value<|"|>}<tool_call|>` form; this turns it into plain JSON. */
function nativeCandidate(reply: string): { name: string; json: string } | null {
  const m = /<\|tool_call>\s*call:([\w.-]+)\s*(\{[\s\S]*?\})\s*(?:<tool_call\|>|$)/i.exec(reply)
  if (!m) return null
  const json = m[2].replace(/<\|"\|>/g, '"').replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
  return { name: m[1], json }
}

/** Finds a tool call in a reply: tagged, native, fenced or bare JSON. Returns null when the reply is a normal answer. */
export function parseToolCall(reply: string): ToolCall | null {
  const native = nativeCandidate(reply)
  if (native) {
    try {
      const parsed = parseLenientJson(native.json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const o = parsed as Record<string, unknown>
        // The model sometimes nests my own format inside the native wrapper.
        if (typeof o.name === 'string' && (o.arguments !== undefined || native.name === 'tool_call')) {
          const args = o.arguments ?? {}
          return { name: o.name, arguments: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} }
        }
        return { name: native.name, arguments: o }
      }
    } catch {
      // Fall through to the other shapes.
    }
  }
  const tagged = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/i.exec(reply)?.[1]
  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i.exec(reply)?.[1]
  const bare = /^\s*(\{[\s\S]*\})\s*$/.exec(reply)?.[1]
  for (const candidate of [tagged, fenced, bare]) {
    if (!candidate) continue
    try {
      const parsed = parseLenientJson(candidate.trim())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const o = parsed as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name : typeof o.tool === 'string' ? o.tool : ''
      if (!name) continue
      const args = o.arguments ?? o.args ?? o.parameters ?? {}
      return { name, arguments: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} }
    } catch {
      // Not JSON; try the next shape.
    }
  }
  return null
}

export function formatToolResult(name: string, result: ToolResult, opts: { short?: boolean } = {}): string {
  const limit = opts.short ? OLD_RESULT_CHAR_LIMIT : RESULT_CHAR_LIMIT
  const body = result.text.length > limit ? `${result.text.slice(0, limit)}\n[truncated]` : result.text
  const pictures = result.images?.length ? `\n[${result.images.length} picture${result.images.length === 1 ? '' : 's'} attached${opts.short ? ' earlier' : ''}]` : ''
  return `<tool_result name="${name}"${result.isError ? ' error="true"' : ''}>\n${body}${pictures}\n</tool_result>`
}

/** The turns a prompt needs for the steps taken so far: recent results in full, older ones shortened. */
export function stepTurns(steps: readonly ToolStep[], keepFull = 3): { role: 'assistant' | 'user'; text: string }[] {
  return steps.flatMap((s, i) => [
    { role: 'assistant' as const, text: `<tool_call>${JSON.stringify(s.call)}</tool_call>` },
    { role: 'user' as const, text: formatToolResult(s.call.name, s.result, { short: i < steps.length - keepFull }) },
  ])
}

/** Pictures the model should see on its next reply: from the latest steps that carried any. */
export function pendingImages(steps: readonly ToolStep[], max = 2): string[] {
  return steps
    .slice(-3)
    .flatMap((s) => s.result.images ?? [])
    .slice(-max)
}

export interface ToolStep {
  call: ToolCall
  result: ToolResult
  /** The raw reply the call came from. */
  reply: string
}

export interface ToolLoopOptions {
  maxSteps?: number
  signal?: AbortSignal
  /** Asks the model for its next reply given the steps taken so far. */
  ask: (steps: ToolStep[]) => Promise<string>
  /** Runs one tool. Must not throw for ordinary failures; return an error result. */
  run: (call: ToolCall) => Promise<ToolResult>
  onStep?: (step: ToolStep) => void
}

/** Alternates model replies and tool runs until the model answers in prose or the step budget is spent. */
export async function runToolLoop(opts: ToolLoopOptions): Promise<{ final: string; steps: ToolStep[]; exhausted: boolean }> {
  const max = opts.maxSteps ?? 24
  const steps: ToolStep[] = []
  let sameCallInARow = 0
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Stopped', 'AbortError')
    const reply = await opts.ask(steps)
    const call = parseToolCall(reply)
    if (!call) return { final: reply.trim(), steps, exhausted: false }
    if (steps.length >= max) return { final: reply.replace(/<tool_call>[\s\S]*$/i, '').trim(), steps, exhausted: true }
    const last = steps[steps.length - 1]
    sameCallInARow = last && JSON.stringify(last.call) === JSON.stringify(call) ? sameCallInARow + 1 : 0
    const result: ToolResult =
      sameCallInARow >= 2
        ? { text: 'You already made this exact call twice. Use the earlier result, or answer the user.', isError: true }
        : await opts.run(call)
    const step = { call, result, reply }
    steps.push(step)
    opts.onStep?.(step)
  }
}
