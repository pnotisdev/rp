import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { STARTER_KINDS, starterBundle } from './starter'
import { lintBundle } from './lint'
import { validateBundle } from './manifest'

describe.each(STARTER_KINDS.map((k) => k.id))('starter %s', (kind) => {
  const bundle = starterBundle({ id: 'my-new-app', name: 'My <New> "App"', kind })

  it('validates and lints clean', () => {
    const r = validateBundle(JSON.parse(JSON.stringify(bundle)))
    expect(r.errors).toEqual([])
    expect(lintBundle(bundle)).toEqual([])
  })

  it('has code that compiles', () => {
    for (const [path, file] of Object.entries(bundle.files)) {
      if (typeof file !== 'string') continue
      if (path.endsWith('.js')) expect(() => new vm.Script(`(async function(){\n${file}\n})()`)).not.toThrow()
      if (path.endsWith('.html')) for (const m of file.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new vm.Script(m[1])).not.toThrow()
    }
  })
})

describe('starterBundle', () => {
  it('escapes the name into markup', () => {
    const b = starterBundle({ id: 'x-app', name: '<img src=x onerror=alert(1)>', kind: 'panel' })
    expect(b.files['panel.html']).not.toContain('<img src=x')
  })

  it('declares the permissions its code needs', () => {
    expect(starterBundle({ id: 'x-app', name: 'X', kind: 'script' }).manifest.permissions).toContain('hooks')
    expect(starterBundle({ id: 'x-app', name: 'X', kind: 'theme' }).manifest.permissions).toContain('ui.theme')
  })
})
