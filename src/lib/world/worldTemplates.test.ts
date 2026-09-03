import { describe, expect, it } from 'vitest'
import { WORLD_TEMPLATES, assistOverridesForTemplate, getWorldTemplate, hiddenWorldTabs } from './worldTemplates'

describe('hiddenWorldTabs', () => {
  it('hides nothing for the dating_sim template — the full feature set', () => {
    expect(hiddenWorldTabs('dating_sim')).toEqual([])
  })

  it('treats an unset template exactly like dating_sim, so every pre-existing world is unaffected', () => {
    expect(hiddenWorldTabs(undefined)).toEqual(hiddenWorldTabs('dating_sim'))
  })

  it('hides both dating and clock tabs for freeform', () => {
    const hidden = hiddenWorldTabs('freeform')
    expect(hidden).toContain('dating')
    expect(hidden).toContain('clock')
  })

  it('hides only the dating tab for visual_novel and slice_of_life', () => {
    expect(hiddenWorldTabs('visual_novel')).toEqual(['dating'])
    expect(hiddenWorldTabs('slice_of_life')).toEqual(['dating'])
  })

  it('never hides overview, lore, or scenes for any template', () => {
    for (const t of WORLD_TEMPLATES) {
      const hidden = hiddenWorldTabs(t.id)
      expect(hidden).not.toContain('overview')
      expect(hidden).not.toContain('lore')
      expect(hidden).not.toContain('scenes')
    }
  })
})

describe('getWorldTemplate', () => {
  it('returns the matching definition for every listed template id', () => {
    for (const t of WORLD_TEMPLATES) {
      expect(getWorldTemplate(t.id).id).toBe(t.id)
    }
  })
})

describe('assistOverridesForTemplate', () => {
  it('turns relationship tracking and choices off for freeform and slice_of_life', () => {
    expect(assistOverridesForTemplate('freeform')).toEqual({ autoTrackRelationship: false, autoSuggestChoices: false })
    expect(assistOverridesForTemplate('slice_of_life')).toEqual({ autoTrackRelationship: false, autoSuggestChoices: false })
  })

  it('leaves no relationship override for dating_sim, visual_novel, or an unset template', () => {
    expect(assistOverridesForTemplate('dating_sim')).toEqual({})
    expect(assistOverridesForTemplate(undefined)).toEqual({})
  })

  it('forces visualNovelMode on for visual_novel only, since it is the one template whose whole premise is VN presentation', () => {
    expect(assistOverridesForTemplate('visual_novel')).toEqual({ visualNovelMode: true })
    expect(assistOverridesForTemplate('dating_sim')).toEqual({})
    expect(assistOverridesForTemplate('freeform')).toEqual({ autoTrackRelationship: false, autoSuggestChoices: false })
    expect(assistOverridesForTemplate('slice_of_life')).toEqual({ autoTrackRelationship: false, autoSuggestChoices: false })
    expect(assistOverridesForTemplate(undefined)).toEqual({})
  })
})
