export type WorldTemplateId = 'freeform' | 'visual_novel' | 'dating_sim' | 'slice_of_life'

/** World-editor tab ids (WorldsView.tsx's WORLD_TABS) hidden for a given template. Never hides
 *  'overview'/'lore'/'scenes' — every template still wants a setting, lore, and backgrounds. */
const HIDDEN_TABS: Record<WorldTemplateId, string[]> = {
  freeform: ['dating', 'clock'],
  visual_novel: ['dating'],
  dating_sim: [],
  slice_of_life: ['dating'],
}

export function hiddenWorldTabs(template: WorldTemplateId | undefined): string[] {
  return HIDDEN_TABS[template ?? 'dating_sim']
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
}

export const WORLD_TEMPLATES: WorldTemplateDef[] = [
  {
    id: 'freeform',
    label: 'Freeform RP',
    blurb: 'An open-ended setting for plain roleplay or lore reference. No gift economy, no world clock.',
    description: '',
    rules: '',
    disablesRelationshipAssists: true,
  },
  {
    id: 'visual_novel',
    label: 'Visual Novel',
    blurb: 'A story-driven setting with scene backgrounds and time-of-day flavor, without the dating-sim economy.',
    description: '',
    rules: 'Describe the setting cinematically — establish where a scene is and what it looks like before dialogue.',
    disablesRelationshipAssists: false,
  },
  {
    id: 'dating_sim',
    label: 'Dating Sim',
    blurb: 'The full mechanic set: gifts, items, relationship thresholds, scene flags, and the world clock.',
    description: '',
    rules: '',
    disablesRelationshipAssists: false,
  },
  {
    id: 'slice_of_life',
    label: 'Slice of Life',
    blurb: 'A living, day-to-day setting driven by the calendar and weather, without romance mechanics.',
    description: '',
    rules: 'Let the passage of time, weather, and daily routine shape the scene as much as dialogue does.',
    disablesRelationshipAssists: true,
  },
]

export function getWorldTemplate(id: WorldTemplateId): WorldTemplateDef {
  return WORLD_TEMPLATES.find((t) => t.id === id) ?? WORLD_TEMPLATES[2]
}

/** `Chat.assistOverrides` to seed a brand-new chat with, derived from the bound world's template —
 *  `{}` (no override, inherit the global default) for a template that doesn't disable them. */
export function assistOverridesForTemplate(
  template: WorldTemplateId | undefined,
): { autoTrackRelationship?: boolean; autoSuggestChoices?: boolean; visualNovelMode?: boolean } {
  const relationshipOverride = getWorldTemplate(template ?? 'dating_sim').disablesRelationshipAssists
    ? { autoTrackRelationship: false, autoSuggestChoices: false }
    : {}
  // Only Visual Novel forces a *display mode* opinion — its whole premise is scene-background
  // presentation, unlike the other three templates, where VN mode is a legitimate but unrelated
  // choice the user's own global default should keep deciding.
  const vnOverride = (template ?? 'dating_sim') === 'visual_novel' ? { visualNovelMode: true } : {}
  return { ...relationshipOverride, ...vnOverride }
}
