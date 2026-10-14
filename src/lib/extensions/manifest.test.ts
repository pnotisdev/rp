import { describe, expect, it } from 'vitest'
import {
  EXTENSION_API_VERSION,
  LIMITS,
  highestRisk,
  isSafePath,
  normalizeGrants,
  suggestId,
  ungrantedPermissions,
  validateBundle,
  validateManifest,
} from './manifest'

const minimal = {
  id: 'dice-tray',
  name: 'Dice Tray',
  version: '1.0.0',
  panels: [{ id: 'tray', title: 'Dice', entry: 'panel.html', slots: ['chat'] }],
}

function bundle(overrides: Record<string, unknown> = {}, files: Record<string, unknown> = { 'panel.html': '<p>hi</p>' }) {
  return { format: 'rp-extension', version: 1, manifest: minimal, files, ...overrides }
}

describe('validateManifest', () => {
  it('accepts a minimal panel manifest and fills defaults', () => {
    const r = validateManifest(minimal)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ id: 'dice-tray', api: EXTENSION_API_VERSION, permissions: [], hooks: [], tools: [], settings: [], glyph: '◇' })
    expect(r.value?.panels[0]).toMatchObject({ id: 'tray', slots: ['chat'], glyph: '◇' })
  })

  it('rejects bad ids, versions and a too-new api', () => {
    expect(validateManifest({ ...minimal, id: 'Bad_Id' }).errors[0]).toMatch(/^id:/)
    expect(validateManifest({ ...minimal, id: '-ab' }).ok).toBe(false)
    expect(validateManifest({ ...minimal, version: '1.0' }).errors.join()).toMatch(/version/)
    expect(validateManifest({ ...minimal, api: 99 }).errors.join()).toMatch(/API 99/)
  })

  it('rejects unknown permissions, including inherited property names', () => {
    expect(validateManifest({ ...minimal, permissions: ['teleport'] }).ok).toBe(false)
    expect(validateManifest({ ...minimal, permissions: ['constructor'] }).ok).toBe(false)
    expect(validateManifest({ ...minimal, permissions: ['chat.read', 'chat.read'] }).value?.permissions).toEqual(['chat.read'])
  })

  it('requires a script and the permission for hooks and tools', () => {
    expect(validateManifest({ ...minimal, hooks: ['output'] }).errors.join()).toMatch(/script/)
    expect(validateManifest({ ...minimal, script: 'main.js', hooks: ['output'] }).errors.join()).toMatch(/"hooks" permission/)
    expect(validateManifest({ ...minimal, script: 'main.js', hooks: ['output'], permissions: ['hooks'] }).ok).toBe(true)
    const tool = { name: 'roll_dice', description: 'Rolls dice', parameters: { type: 'object', properties: {} } }
    expect(validateManifest({ ...minimal, script: 'main.js', tools: [tool] }).errors.join()).toMatch(/tools\.provide/)
    expect(validateManifest({ ...minimal, script: 'main.js', tools: [tool], permissions: ['tools.provide'] }).ok).toBe(true)
  })

  it('validates panels: duplicate ids, empty slots, bad entry paths', () => {
    const dup = { ...minimal, panels: [minimal.panels[0], minimal.panels[0]] }
    expect(validateManifest(dup).errors.join()).toMatch(/used twice/)
    expect(validateManifest({ ...minimal, panels: [{ ...minimal.panels[0], slots: ['nope'] }] }).errors.join()).toMatch(/slots/)
    expect(validateManifest({ ...minimal, panels: [{ ...minimal.panels[0], entry: '../x.html' }] }).errors.join()).toMatch(/entry/)
  })

  it('validates settings types, defaults and select options', () => {
    const ok = { key: 'sides', type: 'number', label: 'Sides', default: 20 }
    expect(validateManifest({ ...minimal, settings: [ok] }).value?.settings).toEqual([ok])
    expect(validateManifest({ ...minimal, settings: [{ ...ok, default: 'x' }] }).errors.join()).toMatch(/does not match/)
    expect(validateManifest({ ...minimal, settings: [{ key: 'mode', type: 'select', label: 'Mode' }] }).errors.join()).toMatch(/option/)
  })

  it('requires ui.theme for a theme and sanitizes tool schemas', () => {
    expect(validateManifest({ ...minimal, theme: { css: 'theme.css' } }).errors.join()).toMatch(/ui\.theme/)
    expect(validateManifest({ ...minimal, theme: { css: 'theme.css' }, permissions: ['ui.theme'] }).value?.theme).toEqual({ css: 'theme.css' })
    const bad = { name: 'roll', description: 'x', parameters: { type: 'string' } }
    expect(validateManifest({ ...minimal, script: 'main.js', permissions: ['tools.provide'], tools: [bad] }).errors.join()).toMatch(/JSON Schema/)
  })

  it('warns about unknown fields and empty extensions', () => {
    expect(validateManifest({ ...minimal, flavor: 'x' }).warnings.join()).toMatch(/flavor/)
    expect(validateManifest({ id: 'empty-one', name: 'Empty', version: '0.1.0' }).warnings.join()).toMatch(/contributes nothing/)
  })

  it('rejects non-objects', () => {
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest([]).ok).toBe(false)
  })
})

describe('validateBundle', () => {
  it('accepts a good bundle', () => {
    const r = validateBundle(bundle())
    expect(r.ok).toBe(true)
    expect(Object.keys(r.value!.files)).toEqual(['panel.html'])
  })

  it('requires every referenced file', () => {
    expect(validateBundle(bundle({}, {})).errors.join()).toMatch(/panel\.html/)
    const withScript = { ...minimal, script: 'main.js' }
    expect(validateBundle(bundle({ manifest: withScript })).errors.join()).toMatch(/main\.js/)
  })

  it('rejects unsafe and reserved paths', () => {
    for (const path of ['../evil.js', '/abs.js', 'a//b.js', '__proto__', 'a/constructor']) {
      expect(isSafePath(path)).toBe(false)
    }
    const r = validateBundle(bundle({}, { 'panel.html': 'x', '../evil.js': 'x' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/not a safe relative path/)
  })

  it('does not let a __proto__ file path pollute the files map', () => {
    const files = JSON.parse('{"panel.html":"x","__proto__":{"base64":"AAAA"}}')
    const r = validateBundle(bundle({}, files))
    expect(r.ok).toBe(false)
    expect(({} as Record<string, unknown>).base64).toBeUndefined()
  })

  it('requires text files to be strings and allows binary as base64', () => {
    expect(validateBundle(bundle({}, { 'panel.html': { base64: 'AAAA' } })).errors.join()).toMatch(/plain strings/)
    const r = validateBundle(bundle({}, { 'panel.html': 'x', 'logo.png': { base64: 'iVBORw0KGgo=' } }))
    expect(r.ok).toBe(true)
  })

  it('enforces the per-file size limit', () => {
    const big = 'a'.repeat(LIMITS.fileBytes + 1)
    expect(validateBundle(bundle({}, { 'panel.html': big })).errors.join()).toMatch(/over the/)
  })

  it('ignores a manifest.json inside files with a warning', () => {
    const r = validateBundle(bundle({}, { 'panel.html': 'x', 'manifest.json': '{}' }))
    expect(r.ok).toBe(true)
    expect(r.warnings.join()).toMatch(/manifest\.json/)
    expect('manifest.json' in r.value!.files).toBe(false)
  })

  it('rejects the wrong format or version', () => {
    expect(validateBundle(bundle({ format: 'other' })).ok).toBe(false)
    expect(validateBundle(bundle({ version: 2 })).ok).toBe(false)
  })
})

describe('helpers', () => {
  it('suggests ids from names', () => {
    expect(suggestId('Dice Tray!')).toBe('dice-tray')
    expect(suggestId('  ')).toMatch(/^ext-app$/)
    expect(suggestId('Ab')).toBe('ab-app')
    expect(suggestId('x'.repeat(80)).length).toBeLessThanOrEqual(40)
  })

  it('computes risk and grants', () => {
    expect(highestRisk(['chat.read'])).toBe('low')
    expect(highestRisk(['chat.read', 'generate'])).toBe('medium')
    expect(highestRisk(['chat.read', 'hooks'])).toBe('high')
    expect(normalizeGrants(['chat.read', 'generate'], ['generate', 'bogus'])).toEqual(['generate'])
    const m = validateManifest({ ...minimal, permissions: ['chat.read', 'generate'] }).value!
    expect(ungrantedPermissions(m, ['chat.read'])).toEqual(['generate'])
  })
})
