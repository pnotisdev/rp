import { describe, expect, it } from 'vitest'
import { lintBundle } from './lint'
import { validateBundle } from './manifest'
import { sanitizeThemeCss } from './cssSanitize'

function make(manifest: Record<string, unknown>, files: Record<string, string>) {
  const r = validateBundle({ format: 'rp-extension', version: 1, manifest: { id: 'lint-me', name: 'Lint Me', version: '1.0.0', ...manifest }, files })
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value!
}

const panel = { panels: [{ id: 'p', title: 'P', entry: 'p.html', slots: ['view'] }] }

describe('lintBundle', () => {
  it('flags sandbox-incompatible APIs', () => {
    const b = make(panel, { 'p.html': '<script>localStorage.x = 1; fetch("/a"); alert(1)</script>' })
    const msgs = lintBundle(b).map((f) => f.message).join('\n')
    expect(msgs).toMatch(/rp\.storage/)
    expect(msgs).toMatch(/Network access/)
    expect(msgs).toMatch(/alert/)
  })

  it('errors on rp methods whose permission is not declared', () => {
    const b = make(panel, { 'p.html': '<script>rp.chat.append("x"); rp.state.get(); rp.generate("hi")</script>' })
    const errors = lintBundle(b).filter((f) => f.level === 'error').map((f) => f.message).join('\n')
    expect(errors).toMatch(/chat\.write/)
    expect(errors).toMatch(/state\.read/)
    expect(errors).toMatch(/"generate"/)
  })

  it('is quiet when permissions are declared', () => {
    const b = make({ ...panel, permissions: ['chat.write'] }, { 'p.html': '<script>rp.chat.append("x")</script>' })
    expect(lintBundle(b)).toEqual([])
  })

  it('checks event subscriptions against permissions', () => {
    const b = make(panel, { 'p.html': '<script>rp.on("message", () => {})</script>' })
    expect(lintBundle(b).some((f) => f.level === 'error' && /chat\.read/.test(f.message))).toBe(true)
  })

  it('cross-checks script hooks and tools', () => {
    const b = make(
      { script: 'main.js', hooks: ['output'], permissions: ['hooks', 'tools.provide'], tools: [{ name: 'roll', description: 'Roll', parameters: { type: 'object' } }] },
      { 'main.js': 'rp.hook("input", (t) => t); rp.tool("other", () => 1)' },
    )
    const msgs = lintBundle(b).map((f) => f.message).join('\n')
    expect(msgs).toMatch(/"input" is not listed/)
    expect(msgs).toMatch(/never calls rp\.hook\("output"/)
    expect(msgs).toMatch(/"roll" is declared/)
    expect(msgs).toMatch(/"other" is not declared/)
  })

  it('warns when a worker script touches the DOM', () => {
    const b = make({ script: 'main.js' }, { 'main.js': 'document.title = "x"' })
    expect(lintBundle(b).some((f) => /no DOM/.test(f.message))).toBe(true)
  })

  it('errors on remote theme css', () => {
    const b = make({ permissions: ['ui.theme'], theme: { css: 't.css' } }, { 't.css': '@import url(https://x.test/a.css);' })
    expect(lintBundle(b).some((f) => f.level === 'error' && f.file === 't.css')).toBe(true)
  })
})

describe('sanitizeThemeCss', () => {
  it('strips imports, remote urls and legacy vectors but keeps data urls', () => {
    const { css, removed } = sanitizeThemeCss(
      '@import "a.css"; .a { background: url(https://evil.test/x.png) } .b { background: url("data:image/png;base64,AAA") } .c { width: expression(alert(1)); behavior: url(x.htc); -moz-binding: url(y); }',
    )
    expect(css).not.toMatch(/@import|evil\.test|expression|behavior|binding/)
    expect(css).toMatch(/data:image\/png/)
    expect(removed.length).toBeGreaterThanOrEqual(4)
  })

  it('removes comments that could hide payloads and caps size', () => {
    expect(sanitizeThemeCss('/* @import "x"; */ a{color:red}').css).toBe(' a{color:red}')
    expect(sanitizeThemeCss('a'.repeat(300_000)).css.length).toBe(200_000)
  })
})
