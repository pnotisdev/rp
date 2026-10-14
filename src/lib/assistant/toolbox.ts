// Everything the Assistant can call in one place: server tools, extension tools and picture-making, with the user's approval asked where it matters.

import { agentApi } from '@/lib/api/client'
import type { ImageBackendSettings } from '@/lib/api/createImageBackend'
import { errorMessage } from '@/lib/store/useToastStore'
import { extensionAgentTools, runExtensionTool } from '@/lib/extensions/assistantTools'
import { alwaysAsk, describeToolCall, type ApprovalPrompt } from './approval'
import { GENERATE_IMAGE, generateImageTool, runGenerateImage } from './imageTool'
import { toolList, type AgentTool, type ToolCall, type ToolResult } from './tools'

export interface ToolboxOptions {
  mode: 'off' | 'read' | 'write'
  /** Apply file edits without asking (commands and billed pictures still ask). */
  autoApprove: boolean
  imageSettings: ImageBackendSettings
  /** Shows the question and resolves with the user's answer. */
  ask: (prompt: ApprovalPrompt) => Promise<boolean>
  signal?: AbortSignal
}

export interface Toolbox {
  tools: AgentTool[]
  run(call: ToolCall): Promise<ToolResult>
}

const DECLINED: ToolResult = { text: 'The user declined this. Do not retry it; ask what they would prefer instead.', isError: true }

export async function buildToolbox(opts: ToolboxOptions): Promise<Toolbox> {
  if (opts.mode === 'off') return { tools: [], run: async () => ({ text: 'Tools are turned off.', isError: true }) }
  const allowWrites = opts.mode === 'write'
  const image = generateImageTool(opts.imageSettings)
  const known = [...(await agentApi.tools().catch(() => [])), ...extensionAgentTools(), ...(image ? [image] : [])]
  const tools = toolList(known, allowWrites)
  const byName = new Map(tools.map((t) => [t.name, t]))

  /** True when this call may proceed: no approval needed, auto-approved, or the user said yes. */
  const approved = async (tool: AgentTool, call: ToolCall): Promise<boolean> => {
    if (!tool.confirm) return true
    if (opts.autoApprove && !alwaysAsk(tool.name) && tool.name !== GENERATE_IMAGE) return true
    return opts.ask(describeToolCall(call))
  }

  return {
    tools,
    async run(call) {
      const tool = byName.get(call.name)
      if (!tool) return { text: `There is no tool called "${call.name}" right now.`, isError: true }
      try {
        const extension = await runExtensionTool(call)
        if (extension) return extension
        if (!(await approved(tool, call))) return DECLINED

        if (call.name === GENERATE_IMAGE) {
          const saveAs = typeof call.arguments.save_as === 'string' ? call.arguments.save_as.trim() : ''
          if (saveAs && !allowWrites) return { text: 'Saving needs the Assistant set to "Look and change".', isError: true }
          const made = await runGenerateImage(call, opts.imageSettings, opts.signal)
          if (made.isError || !saveAs || !made.images?.length) return made
          const save = { name: 'save_image', arguments: { path: saveAs } }
          const ok = opts.autoApprove || (await opts.ask(describeToolCall(save)))
          if (!ok) return { ...made, text: `${made.text} The user chose not to keep it in the workspace.` }
          const saved = await agentApi.saveImage(saveAs, made.images[0], true)
          return { ...made, text: `${made.text} ${saved.text}`, isError: false }
        }

        const out = await agentApi.call(call.name, call.arguments, allowWrites, tool.confirm === true)
        return { text: out.text, isError: out.isError, ...(out.images?.length ? { images: out.images } : {}) }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        return { text: errorMessage(e), isError: true }
      }
    },
  }
}
