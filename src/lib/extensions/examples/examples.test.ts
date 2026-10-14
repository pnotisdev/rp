import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_BUNDLES } from './index'
import { lintBundle } from '../lint'
import { buildPanelDoc, buildScriptDoc } from '../frameDoc'
import { sanitizeThemeCss } from '../cssSanitize'
import { validateBundle } from '../manifest'

const theme = { tokens: { '--c-bg': '255 255 255' }, dark: false }

describe.each(EXAMPLE_BUNDLES.map((b) => [b.manifest.id, b] as const))('example %s', (_id, bundle) => {
  it('validates', () => {
    const r = validateBundle(JSON.parse(JSON.stringify(bundle)))
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('lints without errors or warnings', () => {
    expect(lintBundle(bundle)).toEqual([])
  })

  it('has panel scripts that compile (raw and as built into the frame)', () => {
    for (const panel of bundle.manifest.panels) {
      const html = bundle.files[panel.entry] as string
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
      expect(inline.length).toBeGreaterThan(0)
      for (const code of inline) expect(() => new vm.Script(code)).not.toThrow()
      const doc = buildPanelDoc({ files: bundle.files, entry: panel.entry, theme, surface: 'chat' })
      for (const m of doc.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new vm.Script(m[1])).not.toThrow()
    }
  })

  it('has a script that compiles inside the worker wrapper', () => {
    const path = bundle.manifest.script
    if (!path) return
    const code = bundle.files[path] as string
    expect(() => new vm.Script(`(async function(){\n${code}\n})()`)).not.toThrow()
    const doc = buildScriptDoc(code)
    expect(doc).toContain("connect-src 'none'")
  })

  it('has theme css that survives sanitizing untouched', () => {
    if (!bundle.manifest.theme) return
    const css = bundle.files[bundle.manifest.theme.css] as string
    const { removed } = sanitizeThemeCss(css)
    expect(removed).toEqual([])
  })
})

describe('example set', () => {
  it('has unique ids and covers every panel slot, hooks and themes', () => {
    const ids = EXAMPLE_BUNDLES.map((b) => b.manifest.id)
    expect(new Set(ids).size).toBe(ids.length)
    const slots = new Set(EXAMPLE_BUNDLES.flatMap((b) => b.manifest.panels.flatMap((p) => p.slots)))
    expect([...slots].sort()).toEqual(['chat', 'hud', 'view'])
    expect(EXAMPLE_BUNDLES.some((b) => b.manifest.hooks.length > 0)).toBe(true)
    expect(EXAMPLE_BUNDLES.some((b) => b.manifest.theme)).toBe(true)
  })
})
