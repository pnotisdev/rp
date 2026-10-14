// What the Assistant is told about the world around the conversation: the date, its workspace, what it remembers, and what scrolled out of view.

export interface AgentContext {
  now: Date
  /** Folder name the file tools work in, when one is set. */
  workspaceName?: string
  /** Long-term notes about the user. */
  notes: readonly string[]
  /** A summary of turns that no longer fit in the prompt. */
  summary?: string
}

const MAX_NOTES_IN_PROMPT = 25

/** A short block appended to the system prompt; empty when there is nothing to say beyond the date. */
export function agentContextBlock(ctx: AgentContext): string {
  const date = ctx.now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const lines = [`Right now it is ${date}.`]
  if (ctx.workspaceName) lines.push(`Your file tools work inside the user's workspace folder "${ctx.workspaceName}". Paths are relative to it.`)
  const notes = ctx.notes.slice(-MAX_NOTES_IN_PROMPT)
  if (notes.length) lines.push(`What you remember about the user from earlier conversations (use it quietly, do not recite it):\n${notes.map((n) => `- ${n}`).join('\n')}`)
  if (ctx.summary?.trim()) lines.push(`Earlier in this conversation, now out of view (summary):\n${ctx.summary.trim()}`)
  return lines.join('\n\n')
}

/** The base prompt, then the context block. */
export function withAgentContext(base: string, ctx: AgentContext): string {
  const block = agentContextBlock(ctx)
  return block ? `${base.trim()}\n\n${block}` : base
}
