import { describe, expect, it, vi } from 'vitest'
import { formatToolResult, parseToolCall, pendingImages, stepTurns, runToolLoop, toolInstructions, toolList, type AgentTool, type ToolCall } from './tools'

const tools: AgentTool[] = [
  { name: 'list_worlds', title: 'List worlds', description: 'Lists worlds. Extra detail.', inputSchema: { properties: { query: { type: 'string' } } }, write: false },
  { name: 'create_world', title: 'Create a world', description: 'Creates a world.', inputSchema: { properties: { name: { type: 'string' }, lore: { type: 'array' } }, required: ['name'] }, write: true },
]

describe('toolList / toolInstructions', () => {
  it('hides write tools unless allowed', () => {
    expect(toolList(tools, false).map((t) => t.name)).toEqual(['list_worlds'])
    expect(toolList(tools, true)).toHaveLength(2)
  })

  it('describes each tool as a short signature and states the call format', () => {
    const text = toolInstructions(tools)
    expect(text).toContain('- list_worlds(query?: string): Lists worlds')
    expect(text).toContain('- create_world(name: string, lore?: array): Creates a world')
    expect(text).toContain('<tool_call>')
    expect(text).not.toContain('Extra detail')
  })
})

describe('parseToolCall', () => {
  it('reads a tagged call', () => {
    expect(parseToolCall('<tool_call>{"name":"list_worlds","arguments":{"query":"sea"}}</tool_call>')).toEqual({ name: 'list_worlds', arguments: { query: 'sea' } })
  })

  it('accepts a missing close tag, fences, bare JSON and alternate keys', () => {
    expect(parseToolCall('<tool_call>{"name":"a","arguments":{}}')).toEqual({ name: 'a', arguments: {} })
    expect(parseToolCall('Let me check.\n```json\n{"name":"b","arguments":{"x":1}}\n```')).toEqual({ name: 'b', arguments: { x: 1 } })
    expect(parseToolCall('{"tool":"c","args":{"y":2}}')).toEqual({ name: 'c', arguments: { y: 2 } })
  })

  it("reads Gemma's native call syntax, including its quote tokens and bare keys", () => {
    expect(parseToolCall('<|tool_call>call:list_worlds{query:<|"|>Lumen Quay<|"|>}<tool_call|>')).toEqual({ name: 'list_worlds', arguments: { query: 'Lumen Quay' } })
    expect(parseToolCall('<|tool_call>call:create_world{"name": "R", "description": "D", "lore_entries": [{"keys": ["a"], "content": "c"}]}')).toEqual({
      name: 'create_world',
      arguments: { name: 'R', description: 'D', lore_entries: [{ keys: ['a'], content: 'c' }] },
    })
  })

  it('unwraps my own format when the model nests it inside the native wrapper', () => {
    expect(parseToolCall('<|tool_call>call:tool_call{"name": "list_worlds", "arguments": {"query": "x"}}<tool_call|>')).toEqual({ name: 'list_worlds', arguments: { query: 'x' } })
  })

  it('repairs slightly broken JSON', () => {
    expect(parseToolCall('<tool_call>{"name":"d","arguments":{"text":"hi",}}</tool_call>')).toEqual({ name: 'd', arguments: { text: 'hi' } })
  })

  it('returns null for ordinary prose, including prose that mentions braces', () => {
    expect(parseToolCall('I made the world for you.')).toBeNull()
    expect(parseToolCall('Use {curly} braces like this.')).toBeNull()
    expect(parseToolCall('<tool_call>not json</tool_call>')).toBeNull()
  })
})

describe('formatToolResult', () => {
  it('wraps, flags errors and truncates', () => {
    expect(formatToolResult('x', { text: 'ok', isError: false })).toBe('<tool_result name="x">\nok\n</tool_result>')
    expect(formatToolResult('x', { text: 'bad', isError: true })).toContain('error="true"')
    expect(formatToolResult('x', { text: 'z'.repeat(7000), isError: false })).toContain('[truncated]')
  })
})

describe('runToolLoop', () => {
  const call = (name: string, args: Record<string, unknown> = {}) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`

  it('runs tools until the model answers in prose', async () => {
    const replies = [call('list_worlds'), call('create_world', { name: 'Reach' }), 'Done: created Reach.']
    const seen: number[] = []
    const run = vi.fn(async (c: ToolCall) => ({ text: `ran ${c.name}`, isError: false }))
    const out = await runToolLoop({ ask: async (steps) => (seen.push(steps.length), replies[steps.length]), run })
    expect(out.final).toBe('Done: created Reach.')
    expect(out.steps.map((s) => s.call.name)).toEqual(['list_worlds', 'create_world'])
    expect(out.exhausted).toBe(false)
    expect(seen).toEqual([0, 1, 2])
  })

  it('reports each step as it happens', async () => {
    const onStep = vi.fn()
    await runToolLoop({ ask: async (s) => (s.length ? 'ok' : call('list_worlds')), run: async () => ({ text: 'r', isError: false }), onStep })
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(onStep.mock.calls[0][0].call.name).toBe('list_worlds')
  })

  it('stops at the step budget', async () => {
    const out = await runToolLoop({ maxSteps: 2, ask: async (s) => call('list_worlds', { n: s.length }), run: async () => ({ text: 'r', isError: false }) })
    expect(out.steps).toHaveLength(2)
    expect(out.exhausted).toBe(true)
  })

  it('refuses a call repeated three times in a row', async () => {
    const run = vi.fn(async () => ({ text: 'r', isError: false }))
    const out = await runToolLoop({ maxSteps: 5, ask: async (s) => (s.length < 4 ? call('list_worlds') : 'finished'), run })
    expect(run).toHaveBeenCalledTimes(2)
    expect(out.steps[2].result.isError).toBe(true)
    expect(out.final).toBe('finished')
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runToolLoop({ signal: controller.signal, ask: async () => 'x', run: async () => ({ text: '', isError: false }) })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('steps with pictures', () => {
  const step = (name: string, text: string, images?: string[]) => ({ call: { name, arguments: {} }, result: { text, isError: false, images }, reply: '' })

  it('says when a picture is attached', () => {
    expect(formatToolResult('view_image', { text: 'Loaded.', isError: false, images: ['data:image/png;base64,AA'] })).toContain('[1 picture attached]')
  })

  it('keeps recent results whole and shortens older ones', () => {
    const long = 'x'.repeat(2000)
    const turns = stepTurns([step('a', long), step('b', long), step('c', long), step('d', long)])
    const results = turns.filter((t) => t.role === 'user').map((t) => t.text.length)
    expect(results[0]).toBeLessThan(700)
    expect(results[1]).toBeGreaterThan(2000)
    expect(results).toHaveLength(4)
  })

  it('hands the model the latest pictures only', () => {
    const steps = [step('a', 'x', ['1']), step('b', 'y', ['2', '3']), step('c', 'z')]
    expect(pendingImages(steps)).toEqual(['2', '3'])
    expect(pendingImages([step('a', 'x')])).toEqual([])
  })
})
