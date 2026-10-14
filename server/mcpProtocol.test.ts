import { describe, expect, it } from 'vitest'
import { ERR, createMcpHandler, validateArgs, type McpConfig } from './mcpProtocol.ts'

interface Ctx {
  user: string
}

const config: McpConfig<Ctx> = {
  serverInfo: { name: 'test', version: '1.2.3' },
  instructions: 'Be kind.',
  tools: [
    {
      name: 'zeta',
      title: 'Zeta',
      description: 'last alphabetically',
      inputSchema: { type: 'object', properties: {}, required: [] },
      run: async () => ({ text: 'z' }),
    },
    {
      name: 'greet',
      title: 'Greet',
      description: 'says hello',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, times: { type: 'integer' }, mood: { type: 'string', enum: ['happy', 'sad'] }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['name'],
      },
      run: async (args, ctx) => ({ text: `hello ${String(args.name)} from ${ctx.user}` }),
    },
    {
      name: 'boom',
      title: 'Boom',
      description: 'always fails',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        throw Object.assign(new Error('nope'), { details: ['first problem', 'second problem'] })
      },
    },
    {
      name: 'big',
      title: 'Big',
      description: 'huge output',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ text: 'x'.repeat(250_000) }),
    },
  ],
  resources: [{ uri: 'rp://docs/a', name: 'A', description: 'doc a', mimeType: 'text/markdown', read: async () => '# A' }],
  templates: [
    {
      uriTemplate: 'rp://thing/{id}',
      name: 'Thing',
      description: 'a thing',
      mimeType: 'application/json',
      read: async (uri) => (uri === 'rp://thing/1' ? '{"id":1}' : undefined),
    },
  ],
  prompts: [
    {
      name: 'plan',
      title: 'Plan',
      description: 'plans things',
      arguments: [{ name: 'goal', description: 'what for', required: true }, { name: 'extra', description: 'more' }],
      get: (a) => [{ role: 'user', text: `Plan for ${a.goal}${a.extra ? ` (${a.extra})` : ''}` }],
    },
  ],
}

const h = createMcpHandler(config)
const ctx: Ctx = { user: 'tester' }
const legacy = { modern: false }
const modern = { modern: true }

let nextId = 1
const call = (method: string, params?: Record<string, unknown>, opts = legacy) => h.handle({ jsonrpc: '2.0', id: nextId++, method, params }, opts, ctx)
const result = async (method: string, params?: Record<string, unknown>, opts = legacy) => {
  const r = await call(method, params, opts)
  if (!r || 'error' in r) throw new Error(`expected a result for ${method}, got ${JSON.stringify(r)}`)
  return r.result
}

describe('validateArgs', () => {
  const schema = config.tools[1].inputSchema

  it('accepts valid input', () => {
    expect(validateArgs(schema, { name: 'a', times: 2, mood: 'sad', tags: ['x'] })).toEqual([])
  })

  it('reports missing, mistyped, non-integer and enum problems', () => {
    expect(validateArgs(schema, {})).toEqual(['arguments.name is required'])
    expect(validateArgs(schema, { name: 3 })).toEqual(['arguments.name must be a string'])
    expect(validateArgs(schema, { name: 'a', times: 1.5 })).toEqual(['arguments.times must be an integer'])
    expect(validateArgs(schema, { name: 'a', mood: 'angry' })[0]).toMatch(/must be one of "happy", "sad"/)
    expect(validateArgs(schema, { name: 'a', tags: ['x', 5] })).toEqual(['arguments.tags[1] must be a string'])
  })

  it('rejects arrays and non-objects where an object is expected', () => {
    expect(validateArgs(schema, [])).toEqual(['arguments must be an object'])
    expect(validateArgs(schema, 'text')).toEqual(['arguments must be an object'])
  })
})

describe('handshake and discovery', () => {
  it('negotiates a supported protocol version and falls back otherwise', async () => {
    expect(await result('initialize', { protocolVersion: '2025-06-18' })).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'test', version: '1.2.3' }, instructions: 'Be kind.' })
    expect((await result('initialize', { protocolVersion: '1999-01-01' })).protocolVersion).toBe('2025-11-25')
  })

  it('advertises tools, resources and prompts', async () => {
    const r = await result('initialize', {})
    expect(Object.keys(r.capabilities as object).sort()).toEqual(['prompts', 'resources', 'tools'])
  })

  it('answers server/discover with supported versions and caching hints', async () => {
    const r = await result('server/discover', {}, modern)
    expect(r).toMatchObject({ resultType: 'complete', cacheScope: 'public' })
    expect(r.supportedVersions).toContain('2026-07-28')
    expect(r.supportedVersions).toContain('2025-03-26')
  })

  it('answers ping and ignores notifications', async () => {
    expect(await result('ping')).toEqual({})
    expect(await h.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, legacy, ctx)).toBeNull()
  })

  it('rejects malformed envelopes and unknown methods', async () => {
    expect(await h.handle('nope', legacy, ctx)).toMatchObject({ error: { code: ERR.invalidRequest } })
    expect(await h.handle({ jsonrpc: '1.0', id: 1, method: 'ping' }, legacy, ctx)).toMatchObject({ error: { code: ERR.invalidRequest } })
    expect(await call('does/not/exist')).toMatchObject({ error: { code: ERR.methodNotFound } })
  })
})

describe('tools', () => {
  it('lists tools alphabetically with schemas; modern results add resultType and caching', async () => {
    const r = await result('tools/list')
    expect((r.tools as { name: string }[]).map((t) => t.name)).toEqual(['big', 'boom', 'greet', 'zeta'])
    expect(r.resultType).toBeUndefined()
    const m = await result('tools/list', {}, modern)
    expect(m).toMatchObject({ resultType: 'complete', cacheScope: 'private' })
  })

  it('runs a tool with the request context', async () => {
    const r = await result('tools/call', { name: 'greet', arguments: { name: 'Ada' } })
    expect(r).toEqual({ content: [{ type: 'text', text: 'hello Ada from tester' }], isError: false })
  })

  it('returns argument problems as a tool error the model can fix', async () => {
    const r = await result('tools/call', { name: 'greet', arguments: { times: 'x' } })
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.content)).toMatch(/arguments\.name is required/)
    expect(JSON.stringify(r.content)).toMatch(/arguments\.times must be an integer/)
  })

  it('treats a missing tool as a protocol error', async () => {
    expect(await call('tools/call', { name: 'ghost' })).toMatchObject({ error: { code: ERR.invalidParams } })
  })

  it('turns a thrown error into a tool error including its details', async () => {
    const r = await result('tools/call', { name: 'boom' })
    expect(r.isError).toBe(true)
    const text = (r.content as { text: string }[])[0].text
    expect(text).toContain('boom failed: nope')
    expect(text).toContain('first problem')
    expect(text).toContain('second problem')
  })

  it('truncates huge output', async () => {
    const r = await result('tools/call', { name: 'big' })
    const text = (r.content as { text: string }[])[0].text
    expect(text.length).toBeLessThan(201_000)
    expect(text).toContain('output truncated')
  })
})

describe('resources and prompts', () => {
  it('lists and reads fixed resources and templates', async () => {
    expect((await result('resources/list')).resources).toEqual([{ uri: 'rp://docs/a', name: 'A', description: 'doc a', mimeType: 'text/markdown' }])
    expect((await result('resources/templates/list')).resourceTemplates).toHaveLength(1)
    expect(await result('resources/read', { uri: 'rp://docs/a' })).toEqual({ contents: [{ uri: 'rp://docs/a', mimeType: 'text/markdown', text: '# A' }] })
    expect((await result('resources/read', { uri: 'rp://thing/1' })).contents).toEqual([{ uri: 'rp://thing/1', mimeType: 'application/json', text: '{"id":1}' }])
  })

  it('errors on an unknown resource', async () => {
    expect(await call('resources/read', { uri: 'rp://thing/2' })).toMatchObject({ error: { code: ERR.invalidParams } })
  })

  it('renders prompts and enforces required arguments', async () => {
    expect((await result('prompts/list')).prompts).toHaveLength(1)
    const r = await result('prompts/get', { name: 'plan', arguments: { goal: 'dinner', extra: 'quick' } })
    expect(r.messages).toEqual([{ role: 'user', content: { type: 'text', text: 'Plan for dinner (quick)' } }])
    expect(await call('prompts/get', { name: 'plan', arguments: {} })).toMatchObject({ error: { code: ERR.invalidParams } })
    expect(await call('prompts/get', { name: 'ghost' })).toMatchObject({ error: { code: ERR.invalidParams } })
  })
})
