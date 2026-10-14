// MCP JSON-RPC core: version handling, discovery and tool/resource/prompt routing, independent of transport.

export const MODERN_VERSION = '2026-07-28'
export const SUPPORTED_VERSIONS = [MODERN_VERSION, '2025-11-25', '2025-06-18', '2025-03-26']
const LEGACY_LATEST = '2025-11-25'

export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  description?: string
  [key: string]: unknown
}

export interface ToolOutput {
  /** Text shown to the model. Structured data should be serialized by the tool. */
  text: string
  isError?: boolean
}

export interface ToolDef<Ctx> {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  run(args: Record<string, unknown>, ctx: Ctx): Promise<ToolOutput>
}

export interface ResourceDef {
  uri: string
  name: string
  description: string
  mimeType: string
  read(): Promise<string>
}

export interface ResourceTemplateDef<Ctx> {
  uriTemplate: string
  name: string
  description: string
  mimeType: string
  /** Returns the contents for a concrete URI that matches this template, or undefined when it does not. */
  read(uri: string, ctx: Ctx): Promise<string | undefined>
}

export interface PromptDef {
  name: string
  title: string
  description: string
  arguments: { name: string; description: string; required?: boolean }[]
  get(args: Record<string, string>): { role: 'user' | 'assistant'; text: string }[]
}

export interface McpConfig<Ctx> {
  serverInfo: { name: string; version: string }
  instructions: string
  tools: ToolDef<Ctx>[]
  resources: ResourceDef[]
  templates: ResourceTemplateDef<Ctx>[]
  prompts: PromptDef[]
}

export interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result: Record<string, unknown> } | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } }

export interface HandleOptions {
  /** True when the client speaks the stateless 2026-07-28 revision. */
  modern: boolean
}

const MAX_TEXT = 200_000

function rpcError(id: RpcRequest['id'], code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

function typeOk(value: unknown, type: string | undefined): boolean {
  if (!type) return true
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'null') return value === null
  return typeof value === type
}

/** A small JSON Schema subset (type, required, properties, items, enum): enough to give agents precise, fixable errors. */
export function validateArgs(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = []
  if (!typeOk(value, schema.type)) {
    errors.push(`${path} must be ${/^[aeiou]/.test(schema.type ?? '') ? 'an' : 'a'} ${schema.type}`)
    return errors
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`)
  if (schema.type === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (obj[key] === undefined || obj[key] === null) errors.push(`${path}.${key} is required`)
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (obj[key] !== undefined && obj[key] !== null) errors.push(...validateArgs(sub, obj[key], `${path}.${key}`))
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.slice(0, 200).forEach((v, i) => errors.push(...validateArgs(schema.items!, v, `${path}[${i}]`)))
  }
  return errors
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[output truncated at ${MAX_TEXT} characters]` : text
}

export function createMcpHandler<Ctx>(config: McpConfig<Ctx>) {
  const capabilities = {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
  }
  const toolList = [...config.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }))

  /** Adds the fields modern clients require on every result. */
  function finish(result: Record<string, unknown>, opts: HandleOptions, cache?: boolean): Record<string, unknown> {
    if (!opts.modern) return result
    return { resultType: 'complete', ...result, ...(cache ? { ttlMs: 60_000, cacheScope: 'private' } : {}) }
  }

  async function handle(message: unknown, opts: HandleOptions, ctx: Ctx): Promise<RpcResponse | null> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return rpcError(null, ERR.invalidRequest, 'Request must be a JSON-RPC object')
    const req = message as RpcRequest
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return rpcError(req.id, ERR.invalidRequest, 'Not a JSON-RPC 2.0 request')
    const isNotification = req.id === undefined
    if (isNotification) return null
    const id = req.id ?? null
    const params = (req.params && typeof req.params === 'object' ? req.params : {}) as Record<string, unknown>

    switch (req.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : LEGACY_LATEST
        return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities, serverInfo: config.serverInfo, instructions: config.instructions } }
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'server/discover':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resultType: 'complete',
            supportedVersions: SUPPORTED_VERSIONS,
            capabilities,
            _meta: { 'io.modelcontextprotocol/serverInfo': config.serverInfo },
            instructions: config.instructions,
            ttlMs: 3_600_000,
            cacheScope: 'public',
          },
        }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: finish({ tools: toolList }, opts, true) }
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        const tool = config.tools.find((t) => t.name === name)
        if (!tool) return rpcError(id, ERR.invalidParams, `Unknown tool: ${name || '(none)'}`)
        const args = params.arguments === undefined ? {} : params.arguments
        const problems = validateArgs(tool.inputSchema, args)
        if (problems.length) return { jsonrpc: '2.0', id, result: finish({ content: [{ type: 'text', text: `Invalid arguments for ${name}:\n- ${problems.join('\n- ')}` }], isError: true }, opts) }
        try {
          const out = await tool.run(args as Record<string, unknown>, ctx)
          return { jsonrpc: '2.0', id, result: finish({ content: [{ type: 'text', text: clip(out.text) }], isError: out.isError === true }, opts) }
        } catch (e) {
          const text = e instanceof Error ? e.message : String(e)
          const details = e && typeof e === 'object' && Array.isArray((e as { details?: unknown }).details) ? ((e as { details: unknown[] }).details.filter((d) => typeof d === 'string') as string[]) : []
          const body = details.length ? `${text}\n- ${details.slice(0, 30).join('\n- ')}` : text
          return { jsonrpc: '2.0', id, result: finish({ content: [{ type: 'text', text: clip(`${name} failed: ${body}`) }], isError: true }, opts) }
        }
      }
      case 'resources/list':
        return {
          jsonrpc: '2.0',
          id,
          result: finish({ resources: config.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) }, opts, true),
        }
      case 'resources/templates/list':
        return {
          jsonrpc: '2.0',
          id,
          result: finish({ resourceTemplates: config.templates.map(({ uriTemplate, name, description, mimeType }) => ({ uriTemplate, name, description, mimeType })) }, opts, true),
        }
      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : ''
        const fixed = config.resources.find((r) => r.uri === uri)
        if (fixed) return { jsonrpc: '2.0', id, result: finish({ contents: [{ uri, mimeType: fixed.mimeType, text: clip(await fixed.read()) }] }, opts, true) }
        for (const t of config.templates) {
          const text = await t.read(uri, ctx).catch(() => undefined)
          if (text !== undefined) return { jsonrpc: '2.0', id, result: finish({ contents: [{ uri, mimeType: t.mimeType, text: clip(text) }] }, opts, true) }
        }
        return rpcError(id, ERR.invalidParams, `Resource not found: ${uri}`)
      }
      case 'prompts/list':
        return {
          jsonrpc: '2.0',
          id,
          result: finish({ prompts: config.prompts.map(({ name, title, description, arguments: a }) => ({ name, title, description, arguments: a })) }, opts, true),
        }
      case 'prompts/get': {
        const name = typeof params.name === 'string' ? params.name : ''
        const prompt = config.prompts.find((p) => p.name === name)
        if (!prompt) return rpcError(id, ERR.invalidParams, `Unknown prompt: ${name || '(none)'}`)
        const raw = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
        const args: Record<string, string> = {}
        for (const a of prompt.arguments) {
          const v = raw[a.name]
          if (typeof v === 'string' && v.trim()) args[a.name] = v
          else if (a.required) return rpcError(id, ERR.invalidParams, `Missing required argument: ${a.name}`)
        }
        const messages = prompt.get(args).map((m) => ({ role: m.role, content: { type: 'text', text: m.text } }))
        return { jsonrpc: '2.0', id, result: finish({ description: prompt.description, messages }, opts) }
      }
      default:
        return rpcError(id, ERR.methodNotFound, `Method not found: ${req.method}`)
    }
  }

  return { handle }
}
