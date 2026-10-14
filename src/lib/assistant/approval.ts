// The question put to the user before the Assistant changes a file or runs a command.

import type { ToolCall } from './tools'

export interface ApprovalPrompt {
  title: string
  detail: string
  confirmLabel: string
}

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const clip = (s: string, n = 1200) => (s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s)

/** A plain-language title plus the exact text or command, so the user approves what will really happen. */
export function describeToolCall(call: ToolCall): ApprovalPrompt {
  const a = call.arguments
  switch (call.name) {
    case 'edit_file':
      return { title: `Edit ${text(a.path) || 'a file'}?`, detail: `- ${clip(text(a.old_text), 600).split('\n').join('\n- ')}\n+ ${clip(text(a.new_text), 600).split('\n').join('\n+ ')}${a.replace_all === true ? '\n(every occurrence)' : ''}`, confirmLabel: 'Apply edit' }
    case 'write_file':
      return { title: `${a.overwrite === true ? 'Replace' : 'Create'} ${text(a.path) || 'a file'}?`, detail: clip(text(a.content)), confirmLabel: a.overwrite === true ? 'Replace file' : 'Create file' }
    case 'make_folder':
      return { title: 'Create a folder?', detail: text(a.path), confirmLabel: 'Create folder' }
    case 'move_file':
      return { title: 'Move or rename?', detail: `${text(a.from)}\n-> ${text(a.to)}`, confirmLabel: 'Move' }
    case 'run_command':
      return { title: 'Run this command?', detail: text(a.command), confirmLabel: 'Run command' }
    case 'save_image':
      return { title: `Save the picture to ${text(a.path) || 'a file'}?`, detail: text(a.path), confirmLabel: 'Save picture' }
    default:
      return { title: `Allow ${call.name}?`, detail: clip(JSON.stringify(a, null, 2)), confirmLabel: 'Allow' }
  }
}

/** Commands are never auto-approved, whatever the setting says. */
export function alwaysAsk(toolName: string): boolean {
  return toolName === 'run_command'
}
