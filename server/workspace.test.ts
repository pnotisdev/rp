import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { assertPublicUrl, htmlToText, resolveInWorkspace, workspaceTools, WEB_TOOLS, type WorkspaceCtx } from './workspace.ts'

// Scratch folders live inside the project (gitignored data-sandbox), never elsewhere on the machine.
const base = path.resolve('data-sandbox', `ws-test-${process.pid}`)
const root = path.join(base, 'project')
const outside = path.join(base, 'outside')
let ctx: WorkspaceCtx

const tool = (name: string, config = ctx.config) => {
  const t = [...workspaceTools(config), ...WEB_TOOLS].find((x) => x.name === name)
  if (!t) throw new Error(`no tool ${name}`)
  return (args: Record<string, unknown>, over: Partial<WorkspaceCtx> = {}) => t.run(args, { ...ctx, ...over })
}

beforeAll(() => {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  fs.mkdirSync(path.join(root, 'secret-data'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(root, 'README.md'), '# Title\nhello world\n')
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
  fs.writeFileSync(path.join(root, 'src', 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n')
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'x.js'), 'hello')
  fs.writeFileSync(path.join(root, 'secret-data', 'db.bin'), 'x')
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
  fs.writeFileSync(path.join(root, 'pic.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  fs.writeFileSync(path.join(outside, 'stolen.txt'), 'nope')
  ctx = { config: { root, allowCommands: false }, readOnly: false, confirmed: true, protectedDirs: [path.join(root, 'secret-data')] }
})

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

describe('workspace paths', () => {
  it('stays inside the folder', () => {
    expect(() => resolveInWorkspace(ctx, '../outside/stolen.txt')).toThrow('outside the workspace')
    expect(() => resolveInWorkspace(ctx, path.join(outside, 'stolen.txt'))).toThrow('outside the workspace')
    expect(() => resolveInWorkspace(ctx, 'src/../../outside')).toThrow('outside')
    expect(resolveInWorkspace(ctx, 'src/a.ts')).toContain(path.join('project', 'src', 'a.ts'))
  })

  it('refuses symlinks that lead out', (t) => {
    const link = path.join(root, 'link')
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch {
      return t.skip()
    }
    expect(() => resolveInWorkspace(ctx, 'link/stolen.txt')).toThrow('outside')
    expect(() => resolveInWorkspace(ctx, 'link/new.txt')).toThrow('outside')
    fs.rmSync(link, { recursive: true, force: true })
  })

  it('blocks protected folders and an unset workspace', () => {
    expect(() => resolveInWorkspace(ctx, 'secret-data/db.bin')).toThrow('off limits')
    expect(() => resolveInWorkspace({ ...ctx, config: { root: '', allowCommands: false } }, 'a')).toThrow('No workspace folder')
  })
})

describe('reading', () => {
  it('lists, skipping node_modules', async () => {
    const out = (await tool('list_files')({})).text
    expect(out).toContain('src/')
    expect(out).toContain('README.md  (')
    expect(out).not.toContain('node_modules')
  })

  it('reads with line numbers and pages', async () => {
    const out = (await tool('read_file')({ path: 'src/a.ts' })).text
    expect(out).toContain('(lines 1-3 of 3)')
    expect(out).toContain('    2  export const b = 2')
    expect((await tool('read_file')({ path: 'src/crlf.txt', offset: 2, limit: 1 })).text).toContain('more: call again with offset 3')
  })

  it('refuses binary files and folders', async () => {
    await expect(tool('read_file')({ path: 'bin.dat' })).rejects.toThrow('binary')
    await expect(tool('read_file')({ path: 'src' })).rejects.toThrow('not a file')
  })

  it('searches by regex or plain text with a glob', async () => {
    expect((await tool('search_files')({ pattern: 'export const (a|b)' })).text).toContain('src/a.ts:2: export const b = 2')
    expect((await tool('search_files')({ pattern: 'hello', glob: '*.md' })).text).toBe('README.md:2: hello world')
    expect((await tool('search_files')({ pattern: 'hello' })).text).not.toContain('node_modules')
    expect((await tool('search_files')({ pattern: 'zzz(' })).text).toBe('No matches.')
  })

  it('returns pictures as data URLs for vision', async () => {
    const out = (await tool('view_image')({ path: 'pic.png' })) as { text: string; images?: string[] }
    expect(out.images?.[0]).toMatch(/^data:image\/png;base64,/)
    await expect(tool('view_image')({ path: 'README.md' })).rejects.toThrow('not a png')
  })
})

describe('writing', () => {
  it('needs permission and approval', async () => {
    await expect(tool('write_file')({ path: 'x.txt', content: 'x' }, { readOnly: true })).rejects.toThrow('read-only')
    await expect(tool('write_file')({ path: 'x.txt', content: 'x' }, { confirmed: false })).rejects.toThrow('approval')
    expect(fs.existsSync(path.join(root, 'x.txt'))).toBe(false)
  })

  it('creates files and folders, and will not overwrite by accident', async () => {
    await tool('write_file')({ path: 'out/new/file.txt', content: 'hi' })
    expect(fs.readFileSync(path.join(root, 'out', 'new', 'file.txt'), 'utf8')).toBe('hi')
    await expect(tool('write_file')({ path: 'out/new/file.txt', content: 'again' })).rejects.toThrow('already exists')
    await tool('write_file')({ path: 'out/new/file.txt', content: 'again', overwrite: true })
    expect(fs.readFileSync(path.join(root, 'out', 'new', 'file.txt'), 'utf8')).toBe('again')
    await tool('make_folder')({ path: 'out/empty' })
    expect(fs.statSync(path.join(root, 'out', 'empty')).isDirectory()).toBe(true)
  })

  it('edits exact text once, and keeps CRLF files CRLF', async () => {
    await tool('edit_file')({ path: 'src/a.ts', old_text: 'a = 1', new_text: 'a = 100' })
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toContain('a = 100')
    await expect(tool('edit_file')({ path: 'src/a.ts', old_text: 'export const', new_text: 'const' })).rejects.toThrow('appears 2 times')
    await expect(tool('edit_file')({ path: 'src/a.ts', old_text: 'nothing here', new_text: 'x' })).rejects.toThrow('not found')
    await tool('edit_file')({ path: 'src/crlf.txt', old_text: 'one\ntwo', new_text: '1\n2' })
    expect(fs.readFileSync(path.join(root, 'src', 'crlf.txt'), 'utf8')).toBe('1\r\n2\r\nthree\r\n')
    await tool('edit_file')({ path: 'src/a.ts', old_text: 'export', new_text: 'pub', replace_all: true })
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('pub const a = 100\npub const b = 2\n')
  })

  it('moves without overwriting, and refuses to leave the folder', async () => {
    await tool('move_file')({ from: 'out/new/file.txt', to: 'out/moved.txt' })
    expect(fs.existsSync(path.join(root, 'out', 'moved.txt'))).toBe(true)
    await expect(tool('move_file')({ from: 'out/moved.txt', to: 'README.md' })).rejects.toThrow('already exists')
    await expect(tool('move_file')({ from: 'out/moved.txt', to: '../outside/moved.txt' })).rejects.toThrow('outside')
  })

  it('never touches .git', async () => {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    await expect(tool('write_file')({ path: '.git/config', content: 'x' })).rejects.toThrow('.git')
  })
})

describe('commands and the web', () => {
  it('only offers commands when the user allowed them', async () => {
    expect(workspaceTools({ root, allowCommands: false }).some((t) => t.name === 'run_command')).toBe(false)
    const allowed = { root, allowCommands: true }
    const run = tool('run_command', allowed)
    const out = await run({ command: 'node --version' }, { config: allowed })
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/Exit code 0\.\s+v\d+/)
    await expect(run({ command: 'node --version' }, { config: allowed, confirmed: false })).rejects.toThrow('approval')
    await expect(tool('run_command', allowed)({ command: 'x' }, { config: { root, allowCommands: false } })).rejects.toThrow('turned off')
  })

  it('stops a command that runs too long', async () => {
    const allowed = { root, allowCommands: true }
    const out = await tool('run_command', allowed)({ command: 'node -e "setTimeout(()=>{},60000)"', timeout_seconds: 1 }, { config: allowed })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('Stopped after 1s')
  }, 15_000)

  it('refuses local and private addresses', async () => {
    for (const url of ['http://localhost:3001/api/chats', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.2/x', 'http://[::1]/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'ftp://example.com']) {
      await expect(assertPublicUrl(url)).rejects.toThrow()
    }
    await expect(assertPublicUrl('http://93.184.216.34/')).resolves.toBeInstanceOf(URL)
  })

  it('turns html into readable text', () => {
    expect(htmlToText('<html><head><style>p{}</style><script>x()</script></head><body><h1>Hi &amp; bye</h1><p>One</p><p>Two</p></body></html>')).toBe('Hi & bye\n One\n Two')
  })
})
