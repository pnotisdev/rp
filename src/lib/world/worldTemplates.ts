export type WorldTemplateId = 'freeform' | 'visual_novel' | 'dating_sim'

/** Template ids retired from the picker but that may still be sitting on a world/chat created
 *  before the retirement — mapped to whichever still-offered template it now behaves as, so old
 *  data keeps working with no migration step. Slice of Life merged into Freeform (Tier 3a): it kept
 *  the world clock but never grew a distinct loop of its own, and Freeform's "no romance mechanics"
 *  plain-roleplay framing already covers what it was for. */
const RETIRED_TEMPLATE_ALIASES: Record<string, WorldTemplateId> = {
  slice_of_life: 'freeform',
}

/** Turns any stored `WorldCard.template`/`Chat.mode` value — including a retired id from before a
 *  template was merged away, or unset — into a live `WorldTemplateId`. The one place that decides
 *  what old data means now; anything reading a stored value for display or logic (not just this
 *  module's own functions) should go through this rather than re-deriving the fallback by hand. */
export function normalizeWorldTemplateId(id: string | undefined): WorldTemplateId {
  if (!id) return 'dating_sim'
  return RETIRED_TEMPLATE_ALIASES[id] ?? (id as WorldTemplateId)
}

/** World-editor tab ids (WorldsView.tsx's WORLD_TABS) hidden for a given template. Never hides
 *  'overview'/'lore'/'scenes' — every template still wants a setting, lore, and backgrounds. */
const HIDDEN_TABS: Record<WorldTemplateId, string[]> = {
  freeform: ['dating', 'clock'],
  visual_novel: ['dating'],
  dating_sim: [],
}

export function hiddenWorldTabs(template: WorldTemplateId | undefined): string[] {
  return HIDDEN_TABS[normalizeWorldTemplateId(template)]
}

export interface WorldTemplateDef {
  id: WorldTemplateId
  label: string
  blurb: string
  /** Pre-filled into the new world's description field — a starting point, not locked in. */
  description: string
  rules: string
  /** Whether a new chat for a character bound to this world should default `Chat.assistOverrides`
   *  to turn off relationship tracking/choice suggestions — the templates whose own blurb says
   *  "no romance mechanics," not merely "no gift economy" (Visual Novel keeps relationship
   *  tracking on by default; plenty of VN stories are romance-driven even without a gift shop). */
  disablesRelationshipAssists: boolean
  /** A `SystemPromptPreset.id` (`src/lib/prompt/systemPrompts.ts`) this template seeds new chats
   *  with — unset for a template with no particular opinion on prose style (Visual Novel, Dating
   *  Sim: still just whatever the global Settings default already says). */
  systemPromptId?: string
}

export const WORLD_TEMPLATES: WorldTemplateDef[] = [
  {
    id: 'freeform',
    label: 'Freeform RP',
    blurb: 'An open-ended setting for plain roleplay or lore reference. No gift economy, no world clock. New chats here start with relationship-tracking and choice-suggestions off by default (change anytime in Settings or per-chat).',
    description: '',
    rules: '',
    disablesRelationshipAssists: true,
    systemPromptId: 'balanced',
  },
  {
    id: 'visual_novel',
    label: 'Visual Novel',
    blurb: 'A story-driven setting with scene backgrounds and time-of-day flavor, without the dating-sim economy. New chats here start with Visual Novel mode on by default; relationship tracking stays on too, since plenty of VN stories are romance-driven.',
    description: '',
    rules: 'Describe the setting cinematically. Establish where a scene is and what it looks like before dialogue.',
    disablesRelationshipAssists: false,
  },
  {
    id: 'dating_sim',
    label: 'Dating Sim',
    blurb: 'The full mechanic set: gifts, items, relationship thresholds, scene flags, and the world clock. No default overrides. New chats here just use whatever your global Settings already say.',
    description: '',
    rules: '',
    disablesRelationshipAssists: false,
  },
]

export function getWorldTemplate(id: WorldTemplateId | undefined): WorldTemplateDef {
  const normalized = normalizeWorldTemplateId(id)
  return WORLD_TEMPLATES.find((t) => t.id === normalized) ?? WORLD_TEMPLATES.find((t) => t.id === 'dating_sim')!
}

/** `Chat.assistOverrides` to seed a brand-new chat with, derived from the bound world's template —
 *  `{}` (no override, inherit the global default) for a template that doesn't disable them. */
export function assistOverridesForTemplate(template: WorldTemplateId | undefined): {
  autoTrackRelationship?: boolean
  autoSuggestChoices?: boolean
  visualNovelMode?: boolean | 'auto'
  slowBurnPacing?: boolean
  systemPromptId?: string
  showIntentChips?: boolean
  showDateEventButton?: boolean
} {
  const def = getWorldTemplate(template)
  // Every one of these four rides on the same "no romance mechanics" opinion the template's own
  // blurb already states — slow-burn pacing, intent chips (Flirt/Tease/…), and the date/event
  // button are all romance-flavored surface, same reasoning as the relationship-assist pair.
  const relationshipOverride = def.disablesRelationshipAssists
    ? { autoTrackRelationship: false, autoSuggestChoices: false, slowBurnPacing: false, showIntentChips: false, showDateEventButton: false }
    : {}
  // Only Visual Novel forces a *display mode* opinion — its whole premise is scene-background
  // presentation, unlike the other templates, where VN mode is a legitimate but unrelated choice
  // the user's own global default should keep deciding. `'auto'` rather than a hard `true`: it
  // still shouldn't force a blank void on a character/world with no art yet (`isVnReady`).
  const vnOverride = normalizeWorldTemplateId(template) === 'visual_novel' ? { visualNovelMode: 'auto' as const } : {}
  const systemPromptOverride = def.systemPromptId ? { systemPromptId: def.systemPromptId } : {}
  return { ...relationshipOverride, ...vnOverride, ...systemPromptOverride }
}
