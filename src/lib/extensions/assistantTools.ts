// Exposes tools that enabled extensions provide to the Assistant's tool loop, namespaced as "<extension-id>.<tool>".

import type { AgentTool, ToolCall, ToolResult } from '@/lib/assistant/tools'
import { callProvidedTool, listProvidedTools } from './runtime'

export function extensionAgentTools(): AgentTool[] {
  return listProvidedTools().map(({ extId, extName, spec }) => ({
    name: `${extId}.${spec.name}`,
    title: spec.name,
    description: `${spec.description} (from ${extName})`,
    inputSchema: spec.parameters as AgentTool['inputSchema'],
    write: false,
  }))
}

/** Runs a namespaced extension tool, or returns null when `call` is not one. */
export async function runExtensionTool(call: ToolCall): Promise<ToolResult | null> {
  const dot = call.name.indexOf('.')
  if (dot < 1 || !extensionAgentTools().some((t) => t.name === call.name)) return null
  const reply = await callProvidedTool(call.name.slice(0, dot), call.name.slice(dot + 1), call.arguments)
  if ('skipped' in reply) return { text: 'The extension did not respond.', isError: true }
  if (!reply.ok) return { text: reply.error, isError: true }
  return { text: typeof reply.value === 'string' ? reply.value : JSON.stringify(reply.value ?? null), isError: false }
}
