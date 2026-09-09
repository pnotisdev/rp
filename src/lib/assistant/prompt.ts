import { estimateTokens } from '@/lib/tokenEstimate'
import type { InstructTemplate } from '@/lib/prompt/instructTemplates'

/**
 * The plain-assistant prompt: a normal model chat, deliberately with none of the roleplay stack.
 *
 * `prompt/builder.ts` assembles a character's turn — card, persona, world, lorebooks, relationship
 * state, scene state, a dozen `styleGuidance` channels. None of that belongs here. This is the
 * "talking to the model" surface: a system instruction, the turns so far, and nothing else. Kept in
 * its own module rather than as a mode of the big builder precisely so it can't accrete any of it.
 *
 * The instruct template is still honoured, because a local GGUF fed the wrong turn markers rambles
 * or never stops regardless of what it's being asked to do.
 */

/** One turn of an assistant thread. `role` only ever has two values — there is no character here. */
export interface AssistantTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * The default instruction. Says what the assistant *is* (a capable general assistant) and, just as
 * importantly, what it is not: it should never adopt a persona or answer in character, because this
 * app is full of characters and a model primed by the rest of the product will drift into one.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  'You are a knowledgeable, direct assistant. Answer the question that was asked, at the length it actually warrants: a sentence when a sentence will do, and a thorough walkthrough when the question needs one.',
  'You are not a character and this is not a roleplay. Do not adopt a persona, narrate actions, use asterisks for stage directions, or write in anyone\'s voice but your own. Do not open with pleasantries or close by asking whether there is anything else.',
  'Say plainly when you are unsure or when something cannot be known, rather than guessing in a confident register. If a request is ambiguous in a way that changes the answer, ask the one question that resolves it instead of answering both readings at length.',
  'Write in plain, specific prose. Use markdown structure (headings, lists, code fences) when the content is genuinely structured, and ordinary paragraphs when it is not. No em dashes.',
].join('\n\n')

export interface AssistantPromptInput {
  turns: readonly AssistantTurn[]
  template: InstructTemplate
  /** Overrides `ASSISTANT_SYSTEM_PROMPT` when the user has set their own. */
  systemPrompt?: string
  /** The user's global writing-style setting, appended to the system block when set. */
  styleGuidance?: string
  /** Total tokens the prompt may occupy. Oldest turns are dropped to fit. */
  contextBudget: number
  /** Injectable for tests; defaults to the shared cheap estimator. */
  estimate?: (text: string) => number
}

/** One turn rendered in the template's own turn format. */
function renderTurn(turn: AssistantTurn, template: InstructTemplate): string {
  const [prefix, suffix] =
    turn.role === 'user'
      ? [template.userPrefix, template.userSuffix]
      : [template.assistantPrefix, template.assistantSuffix]
  // `namesInPrompt` exists for roleplay, where a model tracks speakers better with names in the
  // turn. An assistant thread has exactly two speakers and no names, so the macro is resolved to
  // the generic role rather than left in the prompt as a literal "{name}".
  const named = (text: string) => text.replace(/\{name\}/g, turn.role === 'user' ? 'User' : 'Assistant')
  return `${named(prefix)}${turn.text.trim()}${named(suffix)}`
}

/**
 * The assembled prompt, plus which turns actually survived the budget.
 *
 * Trimming drops from the *oldest* end and always in whole turns: half a turn teaches the model a
 * malformed turn format, which is worse than the lost context. The most recent turn is always kept
 * even if it alone exceeds the budget, since a prompt without the actual question is useless.
 */
export function buildAssistantPrompt(input: AssistantPromptInput): { prompt: string; usedTurns: number } {
  const { turns, template, contextBudget } = input
  const estimate = input.estimate ?? estimateTokens
  const system = [input.systemPrompt?.trim() || ASSISTANT_SYSTEM_PROMPT, input.styleGuidance?.trim()]
    .filter(Boolean)
    .join('\n\n')
  const systemBlock = `${template.systemPrefix}${system}${template.systemSuffix}`
  // The reply has to be written somewhere, so the open assistant prefix is part of the cost.
  const openReply = template.assistantPrefix.replace(/\{name\}/g, 'Assistant')
  const fixedCost = estimate(systemBlock) + estimate(openReply)

  const kept: string[] = []
  let used = 0
  let spent = fixedCost
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const rendered = renderTurn(turns[i], template)
    const cost = estimate(rendered)
    // `used === 0` is the always-keep case: the newest turn goes in whatever it costs.
    if (used > 0 && spent + cost > contextBudget) break
    kept.unshift(rendered)
    spent += cost
    used += 1
  }
  return { prompt: `${systemBlock}${kept.join('')}${openReply}`, usedTurns: used }
}

/** Stop sequences for an assistant turn: the template's own, plus its user prefix so a reply can't roleplay the next question. */
export function assistantStopSequences(template: InstructTemplate): string[] {
  const userPrefix = template.userPrefix.replace(/\{name\}/g, 'User').trim()
  return [...new Set([...template.stopSequences, userPrefix].filter(Boolean))]
}
