import type { CharacterCardData, Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import { substituteMacros } from '@/lib/characters/macros'
import { activateWorldInfo, recentMessagesText } from '@/lib/worldinfo/activation'
import { estimateTokens } from '@/lib/tokenEstimate'
import { buildSceneInstruction } from '@/lib/vn/sceneTag'
import type { InstructTemplate } from './instructTemplates'

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
  manuallyActivatedWorldInfoIds?: Set<number>
  includeExamples?: boolean
  countTokens: (text: string) => Promise<number>
  /** The last entry in `history` is an in-progress char turn to keep writing, not a finished one — no closing suffix, no fresh generation cue appended after it. */
  continueLastTurn?: boolean
  /** End the prompt on the USER's turn instead of the character's, so the model suggests what {{user}} would say next. */
  impersonateAsUser?: boolean
  /** Steers the next reply toward an in-progress goal — injected late (right before generation), same placement as post_history_instructions. */
  activeObjective?: { title: string; description?: string; pendingTasks: string[] }
  /** A short, natural-language relationship-stage nudge (never raw numbers) — same late placement as activeObjective. Pre-built by the caller since it's dating-sim-specific, not a core builder concern. */
  relationshipDescription?: string
  /** Expression/background ids the model may tag this reply with (Visual Novel mode) — omitted entirely when empty. */
  sceneOptions?: { expressionIds: string[]; backgroundIds: string[] }
  /** Current relationship score for unlock-gated lore entries. */
  affection?: number
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
    manuallyActivatedWorldInfoIds,
    includeExamples = true,
    countTokens,
  } = input

  const macroCtx = { charName: character.name || 'Character', userName: personaName || 'User' }
  const sub = (text: string | undefined) => substituteMacros(text ?? '', macroCtx)

  // A book's own `scan_depth` (from an imported SillyTavern card) can ask to look further back
  // than our default — honor the deepest request so that book's entries are actually reachable;
  // never *narrower* than the default, since there's one shared scan window across all books.
  const effectiveScanDepth = lorebooks.reduce((max, b) => Math.max(max, b.scan_depth ?? 0), scanDepth)
  const scanText = recentMessagesText(history, effectiveScanDepth)
  const { activated: activatedEntries, droppedForBudget, droppedForGroup } = activateWorldInfo(
    lorebooks,
    scanText,
    manuallyActivatedWorldInfoIds,
    input.affection ?? 0,
  )
  const before = activatedEntries.filter((e) => e.position !== 'after_char')
  const after = activatedEntries.filter((e) => e.position === 'after_char')

  const systemBlock = sub(
    character.system_prompt?.trim() ||
      `You are ${character.name}. Stay fully in character, write vivid and consistent responses, and never break the fourth wall.`,
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
    includeExamples && character.mes_example?.trim() ? sub(character.mes_example) : ''

  const worldBefore = before.map((e) => sub(e.content)).join('\n')
  const worldAfter = after.map((e) => sub(e.content)).join('\n')

  const fixedSections = [
    systemBlock,
    summaryBlock,
    worldBlock,
    worldBefore,
    descriptionBlock,
    participantsBlock,
    worldAfter,
    personaBlock,
    exampleBlock,
  ].filter(Boolean)
  const fixedText = fixedSections.join('\n\n')
  const fixedTokens = await countTokens(fixedText)

  // Injected right before generation — same "late" placement as ST's post-history-instructions,
  // which is exactly where steering toward an in-progress objective is most effective.
  const postHistoryBlock = [
    character.post_history_instructions?.trim() ? sub(character.post_history_instructions) : '',
    buildObjectiveBlock(input.activeObjective, sub),
    input.relationshipDescription?.trim() ? sub(input.relationshipDescription) : '',
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
    ? `${turnPrefix(continuedTurn!.role, continuedTurn!.name, template)}${continuedTurn!.text}`
    : input.impersonateAsUser
      ? turnPrefix('user', macroCtx.userName, template)
      : turnPrefix('char', input.nextSpeakerName?.trim() || macroCtx.charName, template)
  const genCueTokens = await countTokens(genCue)

  let remaining = contextBudget - fixedTokens - postHistoryTokens - genCueTokens
  const includedTurns: { text: string; tokens: number }[] = []
  let excludedCount = 0

  // Walk newest -> oldest, keep what fits; always keep at least the latest turn.
  for (let i = historyForTrimming.length - 1; i >= 0; i--) {
    const msg = historyForTrimming[i]
    const rendered = renderTurn(msg, template, macroCtx)
    const tokens = await countTokens(rendered)
    if (tokens <= remaining || includedTurns.length === 0) {
      includedTurns.push({ text: rendered, tokens })
      remaining -= tokens
    } else {
      excludedCount++
    }
  }
  includedTurns.reverse()

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
    "(Steer the scene toward these naturally, in character — don't mention \"objective\" or \"task\" out loud unless it fits.)",
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
): string {
  // A char turn is rendered under its own speaker's name (group chats can have several), not
  // always the scene's primary character — every message already carries its actual speaker's
  // name (`useChatSession.ts` stamps it at creation time), so this only changes behavior when
  // that name differs from the primary's.
  const name = msg.role === 'user' ? macroCtx.userName : msg.name?.trim() || macroCtx.charName
  const prefix = turnPrefix(msg.role, name, template)
  const suffix = msg.role === 'user' ? template.userSuffix : template.assistantSuffix
  return `${prefix}${msg.text}${suffix}`
}
