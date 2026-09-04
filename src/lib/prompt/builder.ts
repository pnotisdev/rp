import type { CharacterCardData, Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { activateWorldInfo, recentMessagesText, type WorldInfoRuntimeState } from '@/lib/worldinfo/activation'
import { estimateTokens } from '@/lib/tokenEstimate'
import { buildSceneInstruction } from '@/lib/vn/sceneTag'
import { applyRegexScripts } from '@/lib/text/regexScripts'
import type { RegexScript } from '@/lib/types'
import type { InstructTemplate } from './instructTemplates'
import { DEFAULT_SYSTEM_PROMPT } from './systemPrompts'

export { DEFAULT_SYSTEM_PROMPT }
export type { SystemPromptPreset } from './systemPrompts'
export { BUILTIN_SYSTEM_PROMPTS } from './systemPrompts'

/**
 * Section 13's instruct-template-manager part (c): `fixedSections` below used to be a hardcoded,
 * always-on list — the only exception was `includeExamples`, wired to nothing, dead since it was
 * added. Naming each independently-computed block here lets a caller (Settings → Generation) turn
 * any of them off entirely, e.g. to drop the persona blurb for a token-tight model, without
 * touching content. Deliberately NOT included: `worldBefore`/`worldAfter` (governed by lorebook
 * activation/budget, not an on/off concept) and the Author's Note (already has its own presence +
 * position control). Reordering these relative to each other isn't exposed either — several are
 * order-coupled to world-info/author-note placement in ways a flat drag-and-drop would silently
 * break; only enable/disable is safe to expose without touching that structure.
 */
export type PromptSectionId = 'system' | 'summary' | 'world' | 'description' | 'participants' | 'persona' | 'examples'

export const PROMPT_SECTION_LABELS: Record<PromptSectionId, string> = {
  system: 'System prompt',
  summary: 'Long-term memory summary',
  world: 'World / setting description',
  description: 'Character description',
  participants: 'Other participants roster (group chats)',
  persona: 'Persona description',
  examples: 'Example messages',
}

export const DEFAULT_PROMPT_SECTIONS: Record<PromptSectionId, boolean> = {
  system: true,
  summary: true,
  world: true,
  description: true,
  participants: true,
  persona: true,
  examples: true,
}


export interface ChatMessage {
  id: string
  role: 'user' | 'char'
  name: string
  text: string
  /** Base64-encoded images (no data: prefix) attached to this turn, for vision-capable models. */
  images?: string[]
}

export interface PromptBuildInput {
  character: CharacterCardData
  /** 10e's life-context fields (occupation, home/frequented locations, likes/goals/boundaries, social connections) — a pre-built, plain-text note, since those fields live on `Character`, not the portable `CharacterCardData` this builder otherwise works from. Folded into the identity block alongside description/personality/scenario. */
  characterProfile?: string
  personaName: string
  personaDescription: string
  /** Global fallback system prompt (Settings → Generation) — used only when the character has no `system_prompt` of their own. Empty/undefined falls through to `DEFAULT_SYSTEM_PROMPT`. */
  globalSystemPrompt?: string
  /** Global steering line appended after any character `post_history_instructions`, in the same late "right before generation" slot. Applies to every chat. */
  globalPostHistory?: string
  history: ChatMessage[]
  /** Running long-term memory log for everything older than what's in `history`. */
  chatSummary?: string
  /** The world the character lives in, if any — name/description/rules, always included (not keyword-triggered like a lorebook). */
  worldDescription?: string
  lorebooks: Lorebook[]
  template: InstructTemplate
  /** Tokens available for the ENTIRE prompt (max_context_length - max_length, minus caller's safety margin). */
  contextBudget: number
  scanDepth: number
  /** Per-section on/off, e.g. from Settings → Generation — an unset section defaults to on (`DEFAULT_PROMPT_SECTIONS`), so an old caller that never passes this gets today's always-on behavior unchanged. */
  promptSections?: Partial<Record<PromptSectionId, boolean>>
  countTokens: (text: string) => Promise<number>
  /** The last entry in `history` is an in-progress char turn to keep writing, not a finished one — no closing suffix, no fresh generation cue appended after it. */
  continueLastTurn?: boolean
  /** End the prompt on the USER's turn instead of the character's, so the model suggests what {{user}} would say next. */
  impersonateAsUser?: boolean
  /** Steers the next reply toward an in-progress goal — injected late (right before generation), same placement as post_history_instructions. */
  activeObjective?: { title: string; description?: string; pendingTasks: string[] }
  /** A short, natural-language relationship-stage nudge (never raw numbers) — same late placement as activeObjective. Pre-built by the caller since it's dating-sim-specific, not a core builder concern. */
  relationshipDescription?: string
  /** Global writing-style steering (e.g. "avoid em dashes") — same late "right before generation" placement as everything else here, since style instructions are most reliably followed close to the generation point. Pre-composed by the caller from settings, not a core builder concern. */
  styleGuidance?: string
  /**
   * SillyTavern-style Author's Note — a per-chat steering line placed at a chosen point in the
   * prompt (see `AuthorNote` in `types.ts`). Macro-substituted here like any other text field;
   * a blank/whitespace `text` is ignored entirely. `at_depth` is injected into the chat history
   * `depth` turns up from the latest; `before_char`/`after_char` sit in the fixed identity region.
   */
  authorNote?: { text: string; position: 'before_char' | 'after_char' | 'at_depth'; depth: number }
  /** User-defined find/replace rules applied (prompt target) to each history turn's text before it's rendered into the prompt. */
  regexScripts?: RegexScript[]
  /** Expression/background ids the model may tag this reply with (Visual Novel mode) — omitted entirely when empty. */
  sceneOptions?: { expressionIds: string[]; backgroundIds: string[]; moodIds?: string[] }
  /** Current relationship score for unlock-gated lore entries. */
  affection?: number
  /** Per-entry sticky/cooldown state from the previous turn (`Chat.worldInfoState`). Omit to disable sticky/cooldown entirely (old callers). */
  worldInfoState?: WorldInfoRuntimeState
  /** Monotonic turn counter for sticky/cooldown (the chat's message count). Defaults to `history.length`. */
  worldInfoTurn?: number
  /**
   * Other characters present in the scene (group chats) besides `character` — the one actually
   * generating this turn. Rendered as a compact roster, not a full identity block each; only
   * `character` gets the full system_prompt/description/personality/scenario treatment.
   */
  participants?: { name: string; description?: string; personality?: string }[]
  /** Whose turn is being generated — defaults to `character.name`. Only differs in a group chat where a non-primary participant is replying. */
  nextSpeakerName?: string
}

export interface PromptBuildResult {
  prompt: string
  tokensUsed: number
  contextBudget: number
  includedMessageCount: number
  excludedMessageCount: number
  activatedEntries: LorebookEntry[]
  droppedForBudget: LorebookEntry[]
  droppedForGroup: LorebookEntry[]
  /** Sticky/cooldown state to persist for the next turn — undefined when `worldInfoState` wasn't passed in. */
  worldInfoState?: WorldInfoRuntimeState
}

export { estimateTokens }

export async function buildPrompt(input: PromptBuildInput): Promise<PromptBuildResult> {
  const {
    character,
    personaName,
    history,
    lorebooks,
    template,
    contextBudget,
    scanDepth,
    countTokens,
  } = input
  const sections = { ...DEFAULT_PROMPT_SECTIONS, ...input.promptSections }

  const macroCtx = { charName: character.name || 'Character', userName: personaName || 'User' }
  const sub = (text: string | undefined) => substituteMacros(text ?? '', macroCtx)

  // A book's own `scan_depth` (from an imported SillyTavern card) can ask to look further back
  // than our default — honor the deepest request so that book's entries are actually reachable;
  // never *narrower* than the default, since there's one shared scan window across all books.
  const effectiveScanDepth = lorebooks.reduce((max, b) => Math.max(max, b.scan_depth ?? 0), scanDepth)
  const scanText = recentMessagesText(history, effectiveScanDepth)
  const { activated: activatedEntries, droppedForBudget, droppedForGroup, nextState: worldInfoState } = activateWorldInfo(
    lorebooks,
    scanText,
    input.affection ?? 0,
    input.worldInfoState
      ? { turn: input.worldInfoTurn ?? history.length, prevState: input.worldInfoState }
      : undefined,
  )
  const before = activatedEntries.filter((e) => e.position !== 'after_char' && e.position !== 'at_depth')
  const after = activatedEntries.filter((e) => e.position === 'after_char')
  const worldAtDepth = activatedEntries.filter((e) => e.position === 'at_depth')

  const systemBlock = sub(
    character.system_prompt?.trim() || input.globalSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
  )

  const descriptionParts = [
    character.description?.trim() ? sub(character.description) : '',
    character.personality?.trim() ? `Personality: ${sub(character.personality)}` : '',
    character.scenario?.trim() ? `Scenario: ${sub(character.scenario)}` : '',
    input.characterProfile?.trim() ? sub(input.characterProfile) : '',
  ].filter(Boolean)
  const descriptionBlock = descriptionParts.join('\n')

  const participantsBlock =
    input.participants && input.participants.length > 0
      ? [
          'Also present in this scene:',
          ...input.participants.map((p) => {
            const bits = [p.description?.trim(), p.personality?.trim() ? `Personality: ${p.personality.trim()}` : '']
              .filter(Boolean)
              .join(' ')
            return `- ${sub(p.name)}${bits ? `: ${sub(bits)}` : ''}`
          }),
        ].join('\n')
      : ''

  const summaryBlock = input.chatSummary?.trim() ? `Story so far: ${sub(input.chatSummary)}` : ''
  const worldBlock = input.worldDescription?.trim() ? sub(input.worldDescription) : ''

  const personaBlock = input.personaDescription?.trim()
    ? `About ${macroCtx.userName}: ${sub(input.personaDescription)}`
    : ''

  const exampleBlock =
    sections.examples && character.mes_example?.trim() ? sub(character.mes_example) : ''

  const worldBefore = before.map((e) => sub(e.content)).join('\n')
  const worldAfter = after.map((e) => sub(e.content)).join('\n')

  // SillyTavern's Author's Note. `before_char`/`after_char` sit in the fixed region below;
  // `at_depth` is spliced into the trimmed history further down. A blank note is a no-op.
  const authorNoteText = input.authorNote?.text?.trim() ? sub(input.authorNote.text) : ''
  const authorNotePosition = input.authorNote?.position ?? 'at_depth'
  const authorNoteDepth = Math.max(0, Math.floor(Number(input.authorNote?.depth) || 0))

  const fixedSections = [
    sections.system ? systemBlock : '',
    sections.summary ? summaryBlock : '',
    sections.world ? worldBlock : '',
    worldBefore,
    authorNoteText && authorNotePosition === 'before_char' ? authorNoteText : '',
    sections.description ? descriptionBlock : '',
    sections.participants ? participantsBlock : '',
    worldAfter,
    sections.persona ? personaBlock : '',
    exampleBlock,
    authorNoteText && authorNotePosition === 'after_char' ? authorNoteText : '',
  ].filter(Boolean)
  // Everything above the chat history — system prompt, character description, persona, examples,
  // world info — is one block, and for a structured format (ChatML, Gemma, Llama 3, Mistral) it
  // has to be wrapped in that format's system/opening turn markers or the model reads it as loose
  // text outside any turn and drops out of its trained chat behaviour. `plain-chat` leaves the
  // affixes empty, so this is a no-op there.
  const fixedInner = fixedSections.join('\n\n')
  const fixedText = fixedInner ? `${template.systemPrefix}${fixedInner}${template.systemSuffix}` : ''
  const fixedTokens = await countTokens(fixedText)
  const authorNoteAtDepthTokens =
    authorNoteText && authorNotePosition === 'at_depth' ? await countTokens(authorNoteText) : 0

  // ST's World Info "@ Depth" position — same injection mechanism as the Author's Note's own
  // `at_depth` above, generalized to (potentially several) lorebook entries each with their own
  // depth, rather than the one fixed note.
  const worldAtDepthItems = await Promise.all(
    worldAtDepth.map(async (e) => {
      const text = sub(e.content)
      return { text, tokens: await countTokens(text), depth: Math.max(0, Math.floor(Number(e.depth) || 0)) }
    }),
  )
  const worldAtDepthTokens = worldAtDepthItems.reduce((sum, i) => sum + i.tokens, 0)

  // Injected right before generation — same "late" placement as ST's post-history-instructions,
  // which is exactly where steering toward an in-progress objective is most effective.
  const postHistoryBlock = [
    character.post_history_instructions?.trim() ? sub(character.post_history_instructions) : '',
    input.globalPostHistory?.trim() ? sub(input.globalPostHistory) : '',
    buildObjectiveBlock(input.activeObjective, sub),
    input.relationshipDescription?.trim() ? sub(input.relationshipDescription) : '',
    input.styleGuidance?.trim() ? input.styleGuidance.trim() : '',
    // The scene tag describes the character's own turn, so it makes no sense when generating the user's line instead.
    input.impersonateAsUser ? '' : buildSceneInstruction(input.sceneOptions),
  ]
    .filter(Boolean)
    .join('\n\n')
  const postHistoryTokens = postHistoryBlock ? await countTokens(postHistoryBlock) : 0

  const continuing = !!input.continueLastTurn && history.length > 0
  const continuedTurn = continuing ? history[history.length - 1] : null
  const historyForTrimming = continuing ? history.slice(0, -1) : history

  const genCue = continuing
    ? `${turnPrefix(continuedTurn!.role, continuedTurn!.name, template)}${applyRegexScripts(continuedTurn!.text, input.regexScripts, 'prompt')}`
    : input.impersonateAsUser
      ? turnPrefix('user', macroCtx.userName, template)
      : turnPrefix('char', input.nextSpeakerName?.trim() || macroCtx.charName, template)
  const genCueTokens = await countTokens(genCue)

  let remaining =
    contextBudget - fixedTokens - postHistoryTokens - genCueTokens - authorNoteAtDepthTokens - worldAtDepthTokens
  const includedTurns: { text: string; tokens: number }[] = []
  let excludedCount = 0

  // Walk newest -> oldest, keep what fits; always keep at least the latest turn.
  for (let i = historyForTrimming.length - 1; i >= 0; i--) {
    const msg = historyForTrimming[i]
    const rendered = renderTurn(msg, template, macroCtx, input.regexScripts)
    const tokens = await countTokens(rendered)
    if (tokens <= remaining || includedTurns.length === 0) {
      includedTurns.push({ text: rendered, tokens })
      remaining -= tokens
    } else {
      excludedCount++
    }
  }
  includedTurns.reverse()

  // "At depth" injection: each item (the Author's Note, plus any lorebook entries positioned
  // this way) drops in as its own line `depth` turns up from the latest — depth 0 is right before
  // the generation cue, higher values blend it further back into the transcript. Sorted
  // farthest-back first so each shallower item's "distance from the end" is computed against the
  // array as it's grown by the deeper insertions already spliced in, the same way a person
  // layering several depth-anchored notes by hand would reason about their relative positions.
  const depthInjections = worldAtDepthItems.map((i) => ({ text: `${i.text}\n\n`, tokens: i.tokens, depth: i.depth }))
  if (authorNoteAtDepthTokens > 0) {
    depthInjections.push({ text: `${authorNoteText}\n\n`, tokens: authorNoteAtDepthTokens, depth: authorNoteDepth })
  }
  for (const item of depthInjections.sort((a, b) => b.depth - a.depth)) {
    const insertAt = Math.max(0, includedTurns.length - item.depth)
    includedTurns.splice(insertAt, 0, { text: item.text, tokens: item.tokens })
  }

  const historyText = includedTurns.map((t) => t.text).join('')
  const tailParts = [historyText, postHistoryBlock].filter(Boolean)
  const tail = tailParts.length ? `${tailParts.join('\n\n')}\n\n${genCue}` : genCue
  const prompt = [fixedText, tail].filter(Boolean).join('\n\n')
  const tokensUsed =
    fixedTokens + postHistoryTokens + genCueTokens + includedTurns.reduce((sum, t) => sum + t.tokens, 0)

  return {
    prompt,
    tokensUsed,
    contextBudget,
    includedMessageCount: includedTurns.length,
    excludedMessageCount: excludedCount,
    activatedEntries,
    droppedForBudget,
    droppedForGroup,
    worldInfoState,
  }
}

function fillTemplate(part: string, name: string): string {
  return part.replace('{name}', name)
}

function buildObjectiveBlock(
  objective: PromptBuildInput['activeObjective'],
  sub: (text: string | undefined) => string,
): string {
  if (!objective || objective.pendingTasks.length === 0) return ''
  const lines = [
    `Current objective: ${sub(objective.title)}`,
    objective.description?.trim() ? sub(objective.description) : '',
    'Remaining steps:',
    ...objective.pendingTasks.map((t) => `- ${sub(t)}`),
    '(Steer the scene toward these in character. Do not say "objective" or "task" out loud unless it fits.)',
  ]
  return lines.filter(Boolean).join('\n')
}

function turnPrefix(role: 'user' | 'char', name: string, template: InstructTemplate): string {
  const raw = role === 'user' ? template.userPrefix : template.assistantPrefix
  return template.namesInPrompt ? fillTemplate(raw, name) : raw
}

function renderTurn(
  msg: ChatMessage,
  template: InstructTemplate,
  macroCtx: { charName: string; userName: string },
  regexScripts?: RegexScript[],
): string {
  // A char turn is rendered under its own speaker's name (group chats can have several), not
  // always the scene's primary character — every message already carries its actual speaker's
  // name (`useChatSession.ts` stamps it at creation time), so this only changes behavior when
  // that name differs from the primary's.
  const name = msg.role === 'user' ? macroCtx.userName : msg.name?.trim() || macroCtx.charName
  const prefix = turnPrefix(msg.role, name, template)
  const suffix = msg.role === 'user' ? template.userSuffix : template.assistantSuffix
  return `${prefix}${applyRegexScripts(msg.text, regexScripts, 'prompt')}${suffix}`
}
