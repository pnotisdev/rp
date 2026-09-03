import { describe, expect, it } from 'vitest'
import { WORLD_TEMPLATES, getWorldTemplate, hiddenWorldTabs } from './worldTemplates'

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
