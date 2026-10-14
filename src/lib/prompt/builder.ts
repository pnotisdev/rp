import type { CharacterCardData, Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { activateWorldInfo, recentMessagesText, type WorldInfoRuntimeState } from '@/lib/worldinfo/activation'
import { estimateTokens } from '@/lib/tokenEstimate'
import { buildSceneInstruction } from '@/lib/vn/sceneTag'
import { applyRegexScripts } from '@/lib/text/regexScripts'
import type { RegexScript } from '@/lib/types'
import type { InstructTemplate } from './instructTemplates'
import { DEFAULT_SYSTEM_PROMPT, IMPERSONATION_SYSTEM_PROMPT } from './systemPrompts'

export { DEFAULT_SYSTEM_PROMPT }
export type { SystemPromptPreset } from './systemPrompts'
export { BUILTIN_SYSTEM_PROMPTS } from './systemPrompts'

/** Builds the final KoboldCpp prompt string from a character, history, world info */

/** One line of `styleGuidanceItems` — see that field's doc comment for what `essential` gates. */
export interface StyleGuidanceItem {
  text: string
  essential: boolean
}

/** Prompt sections a caller (Settings → Generation) can toggle on/off. Not included: world-info blocks and the Author's Note, which have their own placement controls. */
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
  /** Pre-built life-context/voice note from `Character` fields not on the portable `CharacterCardData`. Folded into the identity block. */
  characterProfile?: string
  personaName: string
  personaDescription: string
  /** Fallback system prompt used only when the character has none of its own. */
  globalSystemPrompt?: string
  /** A mode-bundled system-prompt preset (`Chat.assistOverrides.systemPromptId`, resolved by the caller) */
  chatSystemPrompt?: string
  /** Global steering line appended after any character `post_history_instructions`. */
  globalPostHistory?: string
  history: ChatMessage[]
  /** Running long-term memory log for everything older than what's in `history`. */
  chatSummary?: string
  /** The world the character lives in, if any. Always included, not keyword-triggered like a lorebook. */
  worldDescription?: string
  /** The volatile half of the world block */
  worldMoment?: string
  lorebooks: Lorebook[]
  template: InstructTemplate
  /** Tokens available for the ENTIRE prompt (max_context_length - max_length, minus caller's safety margin). */
  contextBudget: number
  scanDepth: number
  /** Per-section on/off; an unset section defaults to on (`DEFAULT_PROMPT_SECTIONS`). */
  promptSections?: Partial<Record<PromptSectionId, boolean>>
  countTokens: (text: string) => Promise<number>
  /** The last `history` entry is an in-progress char turn to keep writing, not a finished one. */
  continueLastTurn?: boolean
  /** End the prompt on the USER's turn instead of the character's, so the model suggests what {{user}} would say next. */
  impersonateAsUser?: boolean
  /** Steers the next reply toward an in-progress goal; injected late, same placement as post_history_instructions. */
  activeObjective?: { title: string; description?: string; pendingTasks: string[] }
  /** Short natural-language relationship-stage nudge, same late placement as activeObjective. */
  relationshipDescription?: string
  /** Global writing-style steering (e.g. "avoid em dashes"), same late placement. */
  styleGuidance?: string
  /** The prioritized alternative to `styleGuidance`. */
  styleGuidanceItems?: StyleGuidanceItem[]
  /** SillyTavern-style Author's Note. `at_depth` is injected into history `depth` turns up from the latest; `before_char`/`after_char` sit in the fixed identity region. */
  authorNote?: { text: string; position: 'before_char' | 'after_char' | 'at_depth'; depth: number }
  /** User-defined find/replace rules applied to each history turn's text before rendering. */
  regexScripts?: RegexScript[]
  /** Expression/background ids the model may tag this reply with (Visual Novel mode). */
  sceneOptions?: { expressionIds: string[]; backgroundIds: string[]; moodIds?: string[]; outfitIds?: string[]; currentOutfitId?: string }
  /** Current relationship score for unlock-gated lore entries. */
  affection?: number
  /** Per-entry sticky/cooldown state from the previous turn. Omit to disable sticky/cooldown. */
  worldInfoState?: WorldInfoRuntimeState
  /** Monotonic turn counter for sticky/cooldown. Defaults to `history.length`. */
  worldInfoTurn?: number
  /** Other characters present in the scene (group chats) besides `character`, rendered as a compact roster rather than a full identity block. */
  participants?: { name: string; description?: string; personality?: string }[]
  /** Whose turn is being generated — defaults to `character.name`. */
  nextSpeakerName?: string
  /** Adds `sectionBreakdown` to the result (Prompt Inspector). Opt-in — costs extra `countTokens` calls. */
  includeSectionBreakdown?: boolean
  /** Cache-friendly layout: summary last in the fixed block, keyword/fact lore after the history, so the prefix stays identical between turns. */
  cacheFriendly?: boolean
  /** Drop the oldest history this many messages at a time so the cached prefix holds still. 1/unset = slide continuously. */
  historyTrimGrid?: number
}

export interface PromptSectionBreakdownItem {
  id: string
  label: string
  tokens: number
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
  /** How many `styleGuidanceItems` (non-essential ones only) were dropped to keep the history window from collapsing. 0 whenever the plain-string `styleGuidance` field was used instead, or nothing needed dropping. */
  styleGuidanceDroppedCount: number
  /** Present only when `includeSectionBreakdown` was requested — per-section token counts (approximate, won't sum exactly to `tokensUsed`). */
  sectionBreakdown?: PromptSectionBreakdownItem[]
  /** Sticky/cooldown state to persist for the next turn — undefined when `worldInfoState` wasn't passed in. */
  worldInfoState?: WorldInfoRuntimeState
  /** Tokens history was allowed before trimming; compaction measures the verbatim window against this. */
  historyCapacity: number
  /** Tokens the included history turns actually used. */
  historyTokens: number
  /** `systemText` and `conversationText` are the same two pieces joined into `prompt`, exposed separately for a hosted chat-completion backend that wants a proper system/user pair instead of one flat string. */
  systemText: string
  conversationText: string
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

  // Honor the deepest scan_depth requested by any book; never narrower than the default.
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
  const cacheFriendly = !!input.cacheFriendly
  // Keyword-fired and fact entries change per turn, so cache-friendly mode puts them after the history.
  const isLate = (e: LorebookEntry) =>
    cacheFriendly &&
    e.position !== 'at_depth' &&
    (e.volatile || (e.activationMode ?? (e.constant ? 'always' : 'keyword')) === 'keyword')
  const lateEntries = activatedEntries.filter(isLate)
  const before = activatedEntries.filter((e) => e.position !== 'after_char' && e.position !== 'at_depth' && !isLate(e))
  const after = activatedEntries.filter((e) => e.position === 'after_char' && !isLate(e))
  const worldAtDepth = activatedEntries.filter((e) => e.position === 'at_depth')

  // Impersonation needs its own system block; the normal one tells the model to never write {{user}}.
  const systemBlock = input.impersonateAsUser
    ? sub(IMPERSONATION_SYSTEM_PROMPT)
    : sub(character.system_prompt?.trim() || input.chatSystemPrompt?.trim() || input.globalSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT)

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
  const worldMomentBlock = sections.world && input.worldMoment?.trim() ? sub(input.worldMoment) : ''

  const personaBlock = input.personaDescription?.trim()
    ? `About ${macroCtx.userName}: ${sub(input.personaDescription)}`
    : ''

  // Frame example dialogue explicitly, so a weak model doesn't read it as something already said and echo it back.
  const exampleBlock =
    sections.examples && character.mes_example?.trim()
      ? `Example lines showing ${macroCtx.charName}'s voice, style, and typical phrasing. A reference only, not something that already happened in this scene. Do not repeat or continue these lines; write a new reply instead.\n${sub(character.mes_example)}`
      : ''

  const worldBefore = before.map((e) => sub(e.content)).join('\n')
  const worldAfter = after.map((e) => sub(e.content)).join('\n')

  // `before_char`/`after_char` sit in the fixed region below; `at_depth` is spliced into history further down.
  const authorNoteText = input.authorNote?.text?.trim() ? sub(input.authorNote.text) : ''
  const authorNotePosition = input.authorNote?.position ?? 'at_depth'
  const authorNoteDepth = Math.max(0, Math.floor(Number(input.authorNote?.depth) || 0))

  const lateLoreBlock = lateEntries.length
    ? `Relevant background to keep in mind:\n${lateEntries.map((e) => sub(e.content)).join('\n')}`
    : ''
  const summarySection = sections.summary ? summaryBlock : ''

  const fixedSections = [
    sections.system ? systemBlock : '',
    cacheFriendly ? '' : summarySection,
    sections.world ? worldBlock : '',
    worldBefore,
    authorNoteText && authorNotePosition === 'before_char' ? authorNoteText : '',
    sections.description ? descriptionBlock : '',
    sections.participants ? participantsBlock : '',
    worldAfter,
    sections.persona ? personaBlock : '',
    exampleBlock,
    authorNoteText && authorNotePosition === 'after_char' ? authorNoteText : '',
    // Changes only on compaction, so it goes last.
    cacheFriendly ? summarySection : '',
  ].filter(Boolean)
  // Wrap everything above the chat history in the template's system/opening turn markers (a no-op for `plain-chat`).
  const fixedInner = fixedSections.join('\n\n')
  const fixedText = fixedInner ? `${template.systemPrefix}${fixedInner}${template.systemSuffix}` : ''
  const fixedTokens = await countTokens(fixedText)
  const authorNoteAtDepthTokens =
    authorNoteText && authorNotePosition === 'at_depth' ? await countTokens(authorNoteText) : 0
  const lateLoreTokens = lateLoreBlock ? await countTokens(lateLoreBlock) : 0

  // World Info "@ Depth" entries — same at_depth injection mechanism as the Author's Note, but per-entry.
  const worldAtDepthItems = await Promise.all(
    worldAtDepth.map(async (e) => {
      const text = sub(e.content)
      return { text, tokens: await countTokens(text), depth: Math.max(0, Math.floor(Number(e.depth) || 0)) }
    }),
  )
  const worldAtDepthTokens = worldAtDepthItems.reduce((sum, i) => sum + i.tokens, 0)

  // Computed ahead of postHistoryBlock below
  const continuing = !!input.continueLastTurn && history.length > 0
  const continuedTurn = continuing ? history[history.length - 1] : null
  const historyForTrimming = continuing ? history.slice(0, -1) : history

  // A trailing space on the cue makes the first token awkward (stray newlines/digits); end on the colon.
  const genCueRaw = continuing
    ? `${turnPrefix(continuedTurn!.role, continuedTurn!.name, template, true)}${applyRegexScripts(continuedTurn!.text, input.regexScripts, 'prompt')}`
    : input.impersonateAsUser
      ? turnPrefix('user', macroCtx.userName, template)
      : turnPrefix('char', input.nextSpeakerName?.trim() || macroCtx.charName, template, true)
  const genCue = continuing ? genCueRaw : genCueRaw.replace(/[ 	]+$/, '')
  const genCueTokens = await countTokens(genCue)

  // Injected right before generation, same late placement as post-history-instructions.
  const imp = !!input.impersonateAsUser

  // `styleGuidanceItems` wins when given
  let styleItems: StyleGuidanceItem[] = input.styleGuidanceItems
    ? input.styleGuidanceItems.filter((i) => i.text.trim())
    : input.styleGuidance?.trim()
      ? [{ text: input.styleGuidance.trim(), essential: true }]
      : []

  const buildPostHistory = (items: StyleGuidanceItem[]) =>
    [
      // Scene framing first: where and when, before anything about how to behave.
      worldMomentBlock,
      imp || !character.post_history_instructions?.trim() ? '' : sub(character.post_history_instructions),
      imp || !input.globalPostHistory?.trim() ? '' : sub(input.globalPostHistory),
      buildObjectiveBlock(input.activeObjective, sub),
      input.relationshipDescription?.trim() ? sub(input.relationshipDescription) : '',
      items.map((i) => i.text).join('\n'),
      imp ? '' : buildSceneInstruction(input.sceneOptions),
      imp
        ? ''
        : `Conversation fidelity: keep statements with their speaker. Resolve references from the exchange; never attribute ${macroCtx.charName}'s words or beliefs to ${macroCtx.userName}. Answer ${macroCtx.userName}'s latest message directly.`,
      imp ? `[Write only ${macroCtx.userName}'s next message. Stop before ${macroCtx.charName} replies.]` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

  let postHistoryBlock = buildPostHistory(styleItems)
  let postHistoryTokens = postHistoryBlock ? await countTokens(postHistoryBlock) : 0

  // Below this many tokens, history has essentially nothing left to work with — the model would be answering off a single truncated turn or none at all.
  const HISTORY_FLOOR_TOKENS = 300
  let styleGuidanceDroppedCount = 0
  while (
    contextBudget - fixedTokens - postHistoryTokens - genCueTokens - authorNoteAtDepthTokens - worldAtDepthTokens - lateLoreTokens <
    HISTORY_FLOOR_TOKENS
  ) {
    // Drop the least-essential item still standing.
    const dropIndex = findLastIndex(styleItems, (i) => !i.essential)
    if (dropIndex === -1) break // Nothing left that's safe to drop; let history do what it can.
    styleItems = styleItems.filter((_, i) => i !== dropIndex)
    styleGuidanceDroppedCount++
    postHistoryBlock = buildPostHistory(styleItems)
    postHistoryTokens = postHistoryBlock ? await countTokens(postHistoryBlock) : 0
  }

  let remaining =
    contextBudget - fixedTokens - postHistoryTokens - genCueTokens - authorNoteAtDepthTokens - worldAtDepthTokens - lateLoreTokens
  const historyCapacity = remaining
  const includedTurns: { text: string; tokens: number }[] = []
  let excludedCount = 0

  // Walk newest -> oldest, keeping turns until one doesn't fit; always keep at least the latest.
  for (let i = historyForTrimming.length - 1; i >= 0; i--) {
    const msg = historyForTrimming[i]
    const rendered = renderHistoryTurn(msg, template, macroCtx, input.regexScripts)
    const tokens = await countTokens(rendered)
    if (tokens > remaining && includedTurns.length > 0) {
      excludedCount += i + 1
      break
    }
    includedTurns.push({ text: rendered, tokens })
    remaining -= tokens
  }
  includedTurns.reverse()

  // Advance the window start in whole grid steps; costs at most grid-1 turns of recall.
  const grid = Math.max(1, Math.floor(input.historyTrimGrid ?? 1))
  if (grid > 1 && excludedCount > 0) {
    const extra = Math.min((grid - (excludedCount % grid)) % grid, includedTurns.length - 1)
    if (extra > 0) {
      includedTurns.splice(0, extra)
      excludedCount += extra
    }
  }

  const historyTokens = includedTurns.reduce((sum, t) => sum + t.tokens, 0)

  // "At depth" injection: each item drops in `depth` turns up from the latest (0 = right before the generation cue).
  const depthInjections = worldAtDepthItems.map((i) => ({ text: `${i.text}\n\n`, tokens: i.tokens, depth: i.depth }))
  if (authorNoteAtDepthTokens > 0) {
    depthInjections.push({ text: `${authorNoteText}\n\n`, tokens: authorNoteAtDepthTokens, depth: authorNoteDepth })
  }
  for (const item of depthInjections.sort((a, b) => b.depth - a.depth)) {
    const insertAt = Math.max(0, includedTurns.length - item.depth)
    includedTurns.splice(insertAt, 0, { text: item.text, tokens: item.tokens })
  }

  const historyText = includedTurns.map((t) => t.text).join('')
  const tailParts = [historyText, lateLoreBlock, postHistoryBlock].filter(Boolean)
  const tail = tailParts.length ? `${tailParts.join('\n\n')}\n\n${genCue}` : genCue
  const prompt = [fixedText, tail].filter(Boolean).join('\n\n')
  const tokensUsed =
    fixedTokens + postHistoryTokens + genCueTokens + lateLoreTokens + includedTurns.reduce((sum, t) => sum + t.tokens, 0)

  let sectionBreakdown: PromptSectionBreakdownItem[] | undefined
  if (input.includeSectionBreakdown) {
    const worldInfoBlock = [worldBefore, worldAfter, lateLoreBlock].filter(Boolean).join('\n')
    const candidates: { id: string; label: string; text: string }[] = [
      { id: 'system', label: 'System prompt', text: sections.system ? systemBlock : '' },
      { id: 'summary', label: 'Long-term memory summary', text: sections.summary ? summaryBlock : '' },
      { id: 'world', label: 'World / setting description', text: sections.world ? worldBlock : '' },
      { id: 'worldMoment', label: 'World right now (time, weather, scene)', text: worldMomentBlock },
      { id: 'worldInfo', label: 'World info (activated lore)', text: worldInfoBlock },
      { id: 'description', label: 'Character description', text: sections.description ? descriptionBlock : '' },
      { id: 'participants', label: 'Other participants roster', text: sections.participants ? participantsBlock : '' },
      { id: 'persona', label: 'Persona description', text: sections.persona ? personaBlock : '' },
      { id: 'examples', label: 'Example messages', text: exampleBlock },
      { id: 'authorNote', label: "Author's note", text: authorNoteText },
      { id: 'postHistory', label: 'Steering (objective / relationship / style)', text: postHistoryBlock },
      { id: 'history', label: `Chat history (${includedTurns.length} turns included)`, text: historyText },
      { id: 'generationCue', label: 'Generation cue', text: genCue },
    ]
    sectionBreakdown = await Promise.all(
      candidates
        .filter((c) => c.text.trim())
        .map(async (c) => ({ id: c.id, label: c.label, tokens: await countTokens(c.text) })),
    )
  }

  return {
    prompt,
    tokensUsed,
    contextBudget,
    includedMessageCount: includedTurns.length,
    excludedMessageCount: excludedCount,
    activatedEntries,
    droppedForBudget,
    droppedForGroup,
    styleGuidanceDroppedCount,
    sectionBreakdown,
    worldInfoState,
    historyCapacity,
    historyTokens,
    systemText: fixedText,
    conversationText: tail,
  }
}

function fillTemplate(part: string, name: string): string {
  return part.replace('{name}', name)
}

/** `Array.prototype.findLastIndex` — not available at this project's ES2020 target. */
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i
  }
  return -1
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

function turnPrefix(role: 'user' | 'char', name: string, template: InstructTemplate, cue = false): string {
  const raw = role === 'user' ? template.userPrefix : cue ? (template.assistantCuePrefix ?? template.assistantPrefix) : template.assistantPrefix
  return template.namesInPrompt ? fillTemplate(raw, name) : raw
}

/** One history message exactly as it appears in the prompt — what compaction counts tokens against. */
export function renderHistoryTurn(
  msg: ChatMessage,
  template: InstructTemplate,
  macroCtx: { charName: string; userName: string },
  regexScripts?: RegexScript[],
): string {
  // A char turn is rendered under its own speaker's name (group chats can have several), not always the primary character.
  const name = msg.role === 'user' ? macroCtx.userName : msg.name?.trim() || macroCtx.charName
  const prefix = turnPrefix(msg.role, name, template)
  const suffix = msg.role === 'user' ? template.userSuffix : template.assistantSuffix
  return `${prefix}${applyRegexScripts(msg.text, regexScripts, 'prompt')}${suffix}`
}
