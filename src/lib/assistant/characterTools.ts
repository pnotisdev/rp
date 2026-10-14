// The Assistant's character tools: draft a whole character, or rewrite one section of a saved one. They run in the browser because the model client lives here.

import type { ChatBackend } from '@/lib/api/chatBackend'
import { resolveAssistShaping } from '@/lib/api/assistShaping'
import { charactersApi, isConflict, worldsApi } from '@/lib/api/client'
import {
  OPTIONAL_STAGES,
  STAGE_LABELS,
  StageSkipped,
  draftFullCharacter,
  isAbortError,
  runDraftStage,
  type FullCharacterDraft,
  type OptionalStage,
} from '@/lib/characters/generateFullCharacter'
import { getGiftCatalog } from '@/lib/dating/gifts'
import type { WorldCard } from '@/lib/types'
import type { ApprovalPrompt } from './approval'
import { characterToDraft, describeValues, patchBody, sectionValues } from './characterSections'
import { generatedToCharacterInput } from './saveCharacter'
import type { GeneratedCharacter } from './thread'
import type { AgentTool, ToolCall, ToolResult } from './tools'

export const BUILD_CHARACTER = 'build_character'
export const EDIT_CHARACTER_SECTION = 'edit_character_section'

export interface CharacterToolContext {
  client: ChatBackend
  styleGuidance: string
  signal?: AbortSignal
  /** Shows what the tool is working on. */
  onProgress?: (label: string) => void
  /** Resolves true when the change may go ahead: the user said yes, or approvals are waived. */
  approve: (prompt: ApprovalPrompt) => Promise<boolean>
}

const STAGE_NAMES = OPTIONAL_STAGES.join(', ')

export function characterTools(): AgentTool[] {
  return [
    {
      name: BUILD_CHARACTER,
      title: 'Draft a character',
      // Only the first sentence reaches the model, so the section names live in it.
      description: `Draft a whole character from a short brief and show the user a card to review and save, with sections an optional comma-separated list limiting it to some of ${STAGE_NAMES}. Nothing is saved until the user clicks Save.`,
      inputSchema: {
        properties: {
          brief: { type: 'string', description: 'What the user asked for, in their words' },
          world_id: { type: 'string', description: 'A world the character lives in (optional)' },
          sections: { type: 'string', description: 'Comma-separated sections to draft (optional, default all)' },
        },
        required: ['brief'],
      },
      write: false,
    },
    {
      name: EDIT_CHARACTER_SECTION,
      title: 'Rewrite a section of a character',
      description: `Rewrite one section of a saved character from an instruction and show the user the before and after, with section one of ${STAGE_NAMES}. The user can revert it afterwards.`,
      inputSchema: {
        properties: {
          id: { type: 'string', description: 'Character id' },
          section: { type: 'string', description: 'Which section to rewrite' },
          instruction: { type: 'string', description: 'What to change' },
        },
        required: ['id', 'section', 'instruction'],
      },
      write: true,
    },
  ]
}

const fail = (text: string): ToolResult => ({ text, isError: true })
const arg = (call: ToolCall, key: string) => (typeof call.arguments[key] === 'string' ? (call.arguments[key] as string).trim() : '')
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

function stageFrom(name: string): OptionalStage | null {
  const found = OPTIONAL_STAGES.find((s) => s === name.toLowerCase())
  return found ?? null
}

async function worldContext(id: string | undefined): Promise<{ world?: WorldCard; error?: string }> {
  if (!id) return {}
  const world = await worldsApi.get(id)
  return world ? { world } : { error: `There is no world with id "${id}". Use list_worlds to find one.` }
}

/** The draft as it is stored on the thread and shown on the card. */
export function generatedFromDraft(draft: FullCharacterDraft): GeneratedCharacter {
  const { cardRawOutput: _raw, completed: _done, failed, skipped, ...sections } = draft
  return {
    ...sections,
    ...(failed.length ? { failedStages: failed.map((f) => f.stage) } : {}),
    ...(skipped.length ? { skippedStages: skipped } : {}),
  }
}

export async function runBuildCharacter(call: ToolCall, ctx: CharacterToolContext): Promise<ToolResult> {
  const brief = arg(call, 'brief')
  if (!brief) return fail('Give a brief: what the user wants this character to be.')
  const names = arg(call, 'sections')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const unknown = names.filter((n) => !stageFrom(n))
  if (unknown.length) return fail(`Unknown section${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Choose from ${STAGE_NAMES}.`)
  try {
    const { world, error } = await worldContext(arg(call, 'world_id') || undefined)
    if (error) return fail(error)
    const draft = await draftFullCharacter(
      ctx.client,
      { brief, styleGuidance: ctx.styleGuidance, worldTone: world?.description, giftCatalog: world ? getGiftCatalog(world) : undefined, worldId: world?.id },
      {
        stages: names.length ? names.map((n) => stageFrom(n)!) : undefined,
        signal: ctx.signal,
        shaping: await resolveAssistShaping(120_000),
        onStage: (stage, status) => status === 'start' && ctx.onProgress?.(STAGE_LABELS[stage]),
      },
    )
    const label = (stages: string[]) => stages.map((s) => STAGE_LABELS[s as keyof typeof STAGE_LABELS]).join(', ')
    const lines = [
      `Drafted "${draft.card.name}". Sections done: ${label(draft.completed)}.`,
      draft.failed.length ? `Failed: ${label(draft.failed.map((f) => f.stage))}.` : '',
      draft.skipped.length ? `Left blank: ${draft.skipped.map((s) => `${STAGE_LABELS[s.stage]} (${s.reason})`).join('; ')}` : '',
      'The draft card is shown to the user, who reviews and saves it. Nothing is saved yet, so do not call create_character. Tell the user briefly what you made.',
    ]
    return { text: lines.filter(Boolean).join('\n'), isError: false, draft: generatedFromDraft(draft) }
  } catch (e) {
    if (isAbortError(e)) throw e
    return fail(`The character could not be drafted: ${reason(e)}`)
  }
}

/** A rewritten drive keeps the user's own switches and decks: only the dials and lists come from the model. */
function keepDriveSettings(after: Record<string, unknown>, was: GeneratedCharacter['extras'] | undefined): Record<string, unknown> {
  const old = was?.drive
  const next = after.drive as Record<string, unknown> | null
  if (!old || !next) return after
  const { chaosBase, energyBase, fixations, loves, boredBy, motifs } = next
  return { ...after, drive: { ...old, chaosBase, energyBase, fixations, loves, boredBy, motifs } }
}

export async function runEditCharacterSection(call: ToolCall, ctx: CharacterToolContext): Promise<ToolResult> {
  const id = arg(call, 'id')
  const instruction = arg(call, 'instruction')
  const section = stageFrom(arg(call, 'section'))
  if (!id || !instruction) return fail('Give the character id and an instruction.')
  if (!section) return fail(`"section" must be one of ${STAGE_NAMES}. Core card text (name, description, personality, first message) is changed with update_character.`)
  try {
    const character = await charactersApi.get(id)
    if (!character) return fail(`There is no character with id "${id}". Use list_characters to find it.`)
    const { world } = await worldContext(character.worldId)
    ctx.onProgress?.(STAGE_LABELS[section])
    const draft = characterToDraft(character, instruction)
    const before = sectionValues(section, character)
    const next = await runDraftStage(ctx.client, section, draft, {
      styleGuidance: ctx.styleGuidance,
      worldTone: world?.description,
      giftCatalog: world ? getGiftCatalog(world) : undefined,
      shaping: await resolveAssistShaping(120_000),
      signal: ctx.signal,
      current: describeValues(before, 1500),
      hint: instruction,
    })
    let after = sectionValues(section, generatedToCharacterInput(next))
    if (section === 'drive') after = keepDriveSettings(after, draft.extras)
    const shown = `Before:\n${describeValues(before)}\n\nAfter:\n${describeValues(after)}`
    const go = await ctx.approve({ title: `Change ${STAGE_LABELS[section].toLowerCase()} of ${character.card.name}?`, detail: shown, confirmLabel: 'Apply change' })
    if (!go) return fail('The user declined this change. Do not retry it; ask what they would prefer instead.')
    try {
      await charactersApi.update(id, { ...patchBody(character, after), ifUpdatedAt: character.updatedAt })
    } catch (e) {
      if (isConflict(e)) return fail(`${character.card.name} was changed while this was being written, so nothing was applied. Read the character again and retry.`)
      throw e
    }
    return {
      text: `Changed ${STAGE_LABELS[section].toLowerCase()} of "${character.card.name}".\n${shown}\nThe user can revert this from the chat.`,
      isError: false,
      undo: { characterId: id, name: character.card.name, section, before },
    }
  } catch (e) {
    if (isAbortError(e)) throw e
    if (e instanceof StageSkipped) return fail(e.message)
    return fail(`The section could not be rewritten: ${reason(e)}`)
  }
}
