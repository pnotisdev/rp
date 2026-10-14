import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PANEL_CSP, buildPanelDoc, buildScriptDoc, inlineAssets, resolveBundlePath, type ThemeSnapshot } from './frameDoc'

const theme: ThemeSnapshot = { tokens: { '--c-bg': '253 245 247', '--c-accent': '219 112 147' }, dark: false }
const panel = (files: Record<string, string | { base64: string }>, entry = 'p.html', extra: object = {}) =>
  buildPanelDoc({ files, entry, theme, surface: 'chat', ...extra })

describe('resolveBundlePath', () => {
  it('resolves relative references and rejects external or escaping ones', () => {
    expect(resolveBundlePath('', 'app.js')).toBe('app.js')
    expect(resolveBundlePath('ui', './a/b.png?x=1#y')).toBe('ui/a/b.png')
    expect(resolveBundlePath('ui/deep', '../../x.css')).toBe('x.css')
    expect(resolveBundlePath('ui', '../../x.css')).toBeUndefined()
    for (const ref of ['https://x.test/a.js', '//x.test/a.js', '/abs.js', 'data:text/plain,hi', '#frag', 'blob:abc']) {
      expect(resolveBundlePath('', ref)).toBeUndefined()
    }
  })
})

describe('buildPanelDoc', () => {
  it('puts the CSP before anything else for a bare fragment', () => {
    const doc = panel({ 'p.html': '<h1>Hi</h1>' })
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'))
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<h1>Hi</h1>'))
    expect(doc).toContain(PANEL_CSP)
    expect(doc).toContain('data-rp-surface="chat"')
  })

  it('injects into an existing head and tags the html element', () => {
    const doc = panel({ 'p.html': '<!doctype html><html lang="en"><head><title>T</title></head><body>x</body></html>' })
    expect(doc.match(/<head>/g)).toHaveLength(1)
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<title>'))
    expect(doc).toContain('<html lang="en" data-rp-surface="chat">')
  })

  it('creates a head when the document has none', () => {
    const doc = panel({ 'p.html': '<html><body>x</body></html>' })
    expect(doc).toMatch(/<html data-rp-surface="chat"><head><meta charset/)
  })

  it('emits only well-formed theme tokens', () => {
    const hostile = buildPanelDoc({
      files: { 'p.html': 'x' },
      entry: 'p.html',
      surface: 'view',
      theme: { dark: true, tokens: { '--c-bg': '1 2 3', '--c-accent': 'red;} body{background:url(//evil.test)}', '--evil': '1 2 3', '--c-text': '10 20' } },
    })
    const style = /<style id="rp-theme">([^<]*)<\/style>/.exec(doc(hostile))![1]
    expect(style).toContain('--c-bg:1 2 3')
    expect(style).not.toMatch(/evil|red|--c-text/)
    expect(style).toContain('color-scheme:dark')
    expect(hostile).toContain('class="dark"')
  })

  it('marks auto-height panels', () => {
    expect(panel({ 'p.html': 'x' }, 'p.html', { autoHeight: true })).toContain('data-rp-autoheight="1"')
    expect(panel({ 'p.html': 'x' })).not.toContain('data-rp-autoheight="1"')
  })

  it('falls back to a safe message when the entry is missing', () => {
    const d = panel({}, '<img onerror=x>.html')
    expect(d).toContain('Missing panel file')
    expect(d).not.toContain('<img')
    expect(d).toContain('Content-Security-Policy')
  })

  it('embeds the SDK as valid JavaScript', () => {
    const doc = panel({ 'p.html': 'x' })
    const sdk = /<script>([\s\S]*?)<\/script>/.exec(doc)![1]
    expect(() => new vm.Script(sdk)).not.toThrow()
  })
})

describe('inlineAssets', () => {
  const files = {
    'ui/p.html': '',
    'ui/app.js': 'console.log("a </script> b $& $1")',
    'ui/style.css': 'body{background:url(bg.png)} .x{color:red}',
    'ui/bg.png': { base64: 'iVBORw0KGgo=' },
    'shared/util.js': 'var u = 1',
  }

  it('inlines scripts (escaping a closing tag and keeping $ patterns), styles and images', () => {
    const html = '<link rel="stylesheet" href="style.css"><script src="app.js"></script><script src="../shared/util.js" defer></script><img src="bg.png" alt="">'
    const out = inlineAssets(html, 'ui', files)
    expect(out).toContain('<script>console.log("a <\\/script> b $& $1")</script>')
    expect(out).toContain('<script defer>var u = 1</script>')
    expect(out).toMatch(/<style>body\{background:url\("data:image\/png;base64,iVBORw0KGgo="\)\} \.x\{color:red\}<\/style>/)
    expect(out).toMatch(/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="">/)
    expect(out).not.toContain('app.js')
  })

  it('leaves external and missing references alone', () => {
    const html = '<script src="https://cdn.test/x.js"></script><script src="nope.js"></script><img src="https://x.test/a.png">'
    expect(inlineAssets(html, 'ui', files)).toBe(html)
  })

  it('inlines url() inside inline style attributes and style blocks', () => {
    const out = inlineAssets('<div style="background:url(bg.png)"></div><style>.a{background:url(bg.png)}</style>', 'ui', files)
    expect(out.match(/data:image\/png;base64,iVBORw0KGgo=/g)).toHaveLength(2)
  })
})

describe('buildScriptDoc', () => {
  const user = 'rp.hook("output", t => t.replace(/a/g, "$&$&")); // </script> <!-- tricky'
  const d = buildScriptDoc(user)

  it('locks the document down with a no-network CSP', () => {
    expect(d).toContain("connect-src 'none'")
    expect(d.indexOf('Content-Security-Policy')).toBeLessThan(d.indexOf('<script>'))
  })

  it('embeds the worker source as valid JS that contains the user script verbatim', () => {
    const script = /<script>([\s\S]*)<\/script>$/.exec(d)![1]
    expect(() => new vm.Script(script)).not.toThrow()
    const literal = /var source = ([\s\S]*?);\n\s+var worker;/.exec(script)![1]
    const worker = JSON.parse(literal.replace(/<\\\/script/gi, '</script').replace(/<\\!--/g, '<!--')) as string
    expect(worker).toContain(user)
    expect(worker).toContain('function createRp')
    expect(() => new vm.Script(worker)).not.toThrow()
  })

  it('wraps the user script so it cannot collide with SDK globals and supports await', () => {
    const script = /<script>([\s\S]*)<\/script>$/.exec(d)![1]
    const literal = /var source = ([\s\S]*?);\n\s+var worker;/.exec(script)![1]
    const worker = JSON.parse(literal.replace(/<\\\/script/gi, '</script').replace(/<\\!--/g, '<!--')) as string
    expect(worker).toContain('(async function(){')
    expect(() => new vm.Script(worker.replace(user, 'const core = 1; await Promise.resolve();'))).not.toThrow()
  })
})

function doc(s: string): string {
  return s
}
