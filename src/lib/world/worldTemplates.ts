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
}

export const WORLD_TEMPLATES: WorldTemplateDef[] = [
  {
    id: 'freeform',
    label: 'Freeform RP',
    blurb: 'An open-ended setting for plain roleplay or lore reference. No gift economy, no world clock.',
    description: '',
    rules: '',
  },
  {
    id: 'visual_novel',
    label: 'Visual Novel',
    blurb: 'A story-driven setting with scene backgrounds and time-of-day flavor, without the dating-sim economy.',
    description: '',
    rules: 'Describe the setting cinematically — establish where a scene is and what it looks like before dialogue.',
  },
  {
    id: 'dating_sim',
    label: 'Dating Sim',
    blurb: 'The full mechanic set: gifts, items, relationship thresholds, scene flags, and the world clock.',
    description: '',
    rules: '',
  },
  {
    id: 'slice_of_life',
    label: 'Slice of Life',
    blurb: 'A living, day-to-day setting driven by the calendar and weather, without romance mechanics.',
    description: '',
    rules: 'Let the passage of time, weather, and daily routine shape the scene as much as dialogue does.',
  },
]

export function getWorldTemplate(id: WorldTemplateId): WorldTemplateDef {
  return WORLD_TEMPLATES.find((t) => t.id === id) ?? WORLD_TEMPLATES[2]
}
