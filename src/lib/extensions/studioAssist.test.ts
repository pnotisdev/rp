import { describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { askStudio, buildStudioPrompt, describeFiles, parseStudioReply, trimGuide } from './studioAssist'

const current = { manifest: '{"id":"x"}', files: { 'panel.html': '<p>hi</p>', 'big.js': 'x'.repeat(20_000) } }

function client(reply: string): ChatBackend {
  return {
    generate: vi.fn().mockResolvedValue(reply),
    generateStream: vi.fn(),
    getEffectiveMaxContext: vi.fn().mockResolvedValue(8192),
    tokenCount: vi.fn(),
    abort: vi.fn(),
    getChatTemplate: vi.fn().mockResolvedValue(null),
  }
}

describe('parseStudioReply', () => {
  it('reads several file blocks and the manifest', () => {
    const out = parseStudioReply('=== FILE: panel.html ===\n<h1>New</h1>\n=== END FILE ===\n\n=== FILE: manifest.json ===\n{"id":"x","name":"X"}\n=== END FILE ===\n=== FILE: main.js ===\nrp.log(1)\n=== END FILE ===')
    expect(out.files).toEqual({ 'panel.html': '<h1>New</h1>', 'main.js': 'rp.log(1)' })
    expect(out.manifest).toBe('{"id":"x","name":"X"}')
  })

  it('strips code fences inside a block and tolerates a missing final end marker', () => {
    const out = parseStudioReply('=== FILE: a.js ===\n```js\nlet a = 1\n```\n=== END FILE ===\n=== FILE: b.css ===\nbody{}\n')
    expect(out.files).toEqual({ 'a.js': 'let a = 1', 'b.css': 'body{}' })
  })

  it('ignores unsafe and non-text paths and prose around the blocks', () => {
    const out = parseStudioReply('Sure! Here you go.\n=== FILE: ../evil.js ===\nx\n=== END FILE ===\n=== FILE: logo.png ===\nx\n=== END FILE ===\n=== FILE: ok.js ===\ny\n=== END FILE ===')
    expect(Object.keys(out.files)).toEqual(['ok.js'])
  })

  it('returns nothing for a reply with no blocks', () => {
    expect(parseStudioReply('I would add a button.')).toEqual({ files: {} })
  })
})

describe('prompt building', () => {
  it('drops the agent section from the guide', () => {
    expect(trimGuide('# Guide\nbody\n\n## Using AI agents (MCP)\nsecret')).toBe('# Guide\nbody')
  })

  it('shows small files and names the ones over budget without their content', () => {
    const text = describeFiles(current)
    expect(text).toContain('=== FILE: panel.html ===')
    expect(text).toContain('=== FILE: manifest.json ===')
    expect(text).toContain('big.js is 20000 characters and not shown')
    expect(text).not.toContain('xxxxxxxxxx')
  })

  it('puts the request and the answer format in the prompt', () => {
    const prompt = buildStudioPrompt('add a reset button', current, '# Guide')
    expect(prompt).toContain('add a reset button')
    expect(prompt).toContain('=== END FILE ===')
    expect(prompt).toContain('# Guide')
  })
})

describe('askStudio', () => {
  it('returns the parsed changes and the raw reply', async () => {
    const out = await askStudio(client('=== FILE: panel.html ===\n<p>bye</p>\n=== END FILE ==='), 'say bye', current, { guide: '' })
    expect(out.files).toEqual({ 'panel.html': '<p>bye</p>' })
    expect(out.raw).toContain('bye')
  })

  it('fails clearly when the reply has no files or the request is empty', async () => {
    await expect(askStudio(client('no idea'), 'x', current, { guide: '' })).rejects.toThrow(/no files/)
    await expect(askStudio(client(''), '  ', current, { guide: '' })).rejects.toThrow(/Describe/)
  })
})
