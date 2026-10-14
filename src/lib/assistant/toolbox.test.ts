import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTool } from './tools'

const serverTools: AgentTool[] = [
  { name: 'read_file', title: 'Read', description: 'Reads.', inputSchema: { properties: {} }, write: false },
  { name: 'edit_file', title: 'Edit', description: 'Edits.', inputSchema: { properties: {} }, write: true, confirm: true },
  { name: 'run_command', title: 'Run', description: 'Runs.', inputSchema: { properties: {} }, write: true, confirm: true },
  { name: 'create_world', title: 'Create', description: 'Creates.', inputSchema: { properties: {} }, write: true },
]

const call = vi.fn()
const saveImage = vi.fn()
vi.mock('@/lib/api/client', () => ({
  agentApi: {
    tools: async () => serverTools,
    call: (...args: unknown[]) => call(...args),
    saveImage: (...args: unknown[]) => saveImage(...args),
  },
}))
vi.mock('@/lib/extensions/assistantTools', () => ({ extensionAgentTools: () => [], runExtensionTool: async () => null }))
const generate = vi.fn()
vi.mock('./imageTool', async (orig) => ({ ...(await orig<typeof import('./imageTool')>()), runGenerateImage: (...args: unknown[]) => generate(...args) }))

import { buildToolbox, type ToolboxOptions } from './toolbox'

const image = { imageBackend: 'comfyui' as const, imageBackendBaseUrl: 'http://127.0.0.1:8188', imageBackendUsername: '', imageBackendPassword: '', imageBackendModel: '' }
const opts = (over: Partial<ToolboxOptions> = {}): ToolboxOptions => ({ mode: 'write', autoApprove: false, imageSettings: image, ask: async () => true, ...over })

beforeEach(() => {
  call.mockReset().mockResolvedValue({ text: 'done', isError: false })
  saveImage.mockReset().mockResolvedValue({ text: 'Saved a.png.', isError: false })
  generate.mockReset().mockResolvedValue({ text: 'Made it.', isError: false, images: ['data:image/png;base64,AA'] })
})

describe('what is offered', () => {
  it('offers nothing when tools are off, and only read tools in read mode', async () => {
    expect((await buildToolbox(opts({ mode: 'off' }))).tools).toEqual([])
    expect((await buildToolbox(opts({ mode: 'read' }))).tools.map((t) => t.name)).toEqual(['read_file', 'generate_image'])
    expect((await buildToolbox(opts())).tools.map((t) => t.name)).toEqual(['read_file', 'edit_file', 'run_command', 'create_world', 'generate_image'])
  })

  it('leaves out picture making when no image backend is set up', async () => {
    const names = (await buildToolbox(opts({ imageSettings: { ...image, imageBackendBaseUrl: '' } }))).tools.map((t) => t.name)
    expect(names).not.toContain('generate_image')
  })
})

describe('approval', () => {
  it('asks before an edit, with the exact change, and sends it confirmed', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    const box = await buildToolbox(opts({ ask }))
    await box.run({ name: 'edit_file', arguments: { path: 'a.ts', old_text: 'x', new_text: 'y' } })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Edit a.ts?', detail: '- x\n+ y' }))
    expect(call).toHaveBeenCalledWith('edit_file', { path: 'a.ts', old_text: 'x', new_text: 'y' }, true, true)
  })

  it('does nothing when the user declines, and tells the model not to retry', async () => {
    const box = await buildToolbox(opts({ ask: async () => false }))
    const out = await box.run({ name: 'edit_file', arguments: {} })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('declined')
    expect(call).not.toHaveBeenCalled()
  })

  it('skips the question for edits when auto-approve is on, but never for commands', async () => {
    const ask = vi.fn().mockResolvedValue(false)
    const box = await buildToolbox(opts({ ask, autoApprove: true }))
    await box.run({ name: 'edit_file', arguments: {} })
    expect(ask).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledTimes(1)
    expect((await box.run({ name: 'run_command', arguments: { command: 'ls' } })).isError).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not ask for reads, and passes pictures through', async () => {
    call.mockResolvedValue({ text: 'Loaded.', isError: false, images: ['data:image/png;base64,BB'] })
    const ask = vi.fn()
    const out = await (await buildToolbox(opts({ ask }))).run({ name: 'read_file', arguments: { path: 'a' } })
    expect(ask).not.toHaveBeenCalled()
    expect(out.images).toEqual(['data:image/png;base64,BB'])
    expect(call).toHaveBeenCalledWith('read_file', { path: 'a' }, true, false)
  })

  it('rejects tools that are not available', async () => {
    const out = await (await buildToolbox(opts({ mode: 'read' }))).run({ name: 'edit_file', arguments: {} })
    expect(out.text).toContain('no tool called')
  })
})

describe('generate_image', () => {
  it('makes the picture without asking on a local backend', async () => {
    const ask = vi.fn()
    const out = await (await buildToolbox(opts({ ask }))).run({ name: 'generate_image', arguments: { prompt: 'a cat' } })
    expect(out.images).toHaveLength(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks first on a billed backend', async () => {
    const ask = vi.fn().mockResolvedValue(false)
    const billed = { ...image, imageBackend: 'novelai-image' as const, imageBackendUsername: 'key' }
    const out = await (await buildToolbox(opts({ ask, imageSettings: billed }))).run({ name: 'generate_image', arguments: { prompt: 'a cat' } })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(out.isError).toBe(true)
    expect(generate).not.toHaveBeenCalled()
  })

  it('keeps the picture in the workspace only when approved and permitted', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    const box = await buildToolbox(opts({ ask }))
    const kept = await box.run({ name: 'generate_image', arguments: { prompt: 'a cat', save_as: 'art/a.png' } })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save the picture to art/a.png?' }))
    expect(saveImage).toHaveBeenCalledWith('art/a.png', 'data:image/png;base64,AA', true)
    expect(kept.text).toContain('Saved a.png.')

    const readOnly = await (await buildToolbox(opts({ mode: 'read' }))).run({ name: 'generate_image', arguments: { prompt: 'a cat', save_as: 'a.png' } })
    expect(readOnly.isError).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('still returns the picture when the user will not keep it', async () => {
    const box = await buildToolbox(opts({ ask: async () => false }))
    const out = await box.run({ name: 'generate_image', arguments: { prompt: 'a cat', save_as: 'a.png' } })
    expect(out.images).toHaveLength(1)
    expect(out.text).toContain('chose not to keep')
    expect(saveImage).not.toHaveBeenCalled()
  })
})
