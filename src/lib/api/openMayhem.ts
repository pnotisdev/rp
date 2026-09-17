import { KoboldApiError } from './types'
import { isKreaImageModel, type KreaPolicy, type KreaPresentation } from './openMayhemKrea'

export const OPENMAYHEM_BASE_URL = 'https://api.openmayhem.ai/v1'
export const OPENMAYHEM_PROXY = '/api/openmayhem'

export function isOpenMayhem(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/, '') === OPENMAYHEM_BASE_URL
}

export type Attribute = { enumValues?: unknown[]; minimum?: number; maximum?: number; default?: unknown; multipleOf?: number; maxLength?: number; minLength?: number }
export type OpenMayhemEndpoint = 'CHAT' | 'IMAGES' | 'AUDIO_SPEECH' | 'WORKFLOWS'
type Contract = { endpoint: string; required?: string[]; attributes: Record<string, Attribute> }
export interface OpenMayhemModel {
  id: string
  name?: string
  workflow_media?: KreaPresentation
  workflow?: KreaPolicy
  live_capacity_profiles?: { modalities: { image?: { unit: string; maxItemUnits: number; maxItemsPerRequest: number } } }[]
  endpoints: string[]
  context_length?: number
  availability?: string
  providers_available?: number
  availability_stale?: boolean
  request_contracts?: Contract[]
}

/** Some CHAT models require tools and cannot handle a normal roleplay conversation. */
export function isOpenMayhemChatModel(model: OpenMayhemModel): boolean {
  const contracts = model.request_contracts?.filter((c) => c.endpoint === 'CHAT')
  return !!model.endpoints?.includes('CHAT') && !!contracts?.length && contracts.every(
    (c) => !!c.attributes?.max_tokens && c.required?.every((key) => key === 'model' || key === 'messages'),
  )
}

/** Match the catalog's live filter: online-but-busy providers cannot accept a new request. */
export function hasAvailableOpenMayhemProvider(model: OpenMayhemModel): boolean {
  return model.availability_stale !== true
    && typeof model.providers_available === 'number'
    && Number.isFinite(model.providers_available)
    && model.providers_available > 0
}

const catalogs = new Map<OpenMayhemEndpoint, { until: number; promise: Promise<OpenMayhemModel[]> }>()
export function loadOpenMayhemModels(refresh = false, endpoint: OpenMayhemEndpoint = 'CHAT'): Promise<OpenMayhemModel[]> {
  const catalog = catalogs.get(endpoint)
  if (!refresh && catalog && catalog.until > Date.now()) return catalog.promise
  const promise = (async () => {
    const models = new Map<string, OpenMayhemModel>()
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ endpoint_family: endpoint })
      if (cursor) query.set('cursor', cursor)
      const res = await fetch(`${OPENMAYHEM_PROXY}/models?${query}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error('OpenMayhem model catalog is unavailable. Try again shortly.')
      const body = await res.json() as { data?: OpenMayhemModel[]; next_cursor?: string | null }
      if (!Array.isArray(body.data)) throw new Error('OpenMayhem returned an invalid model catalog.')
      for (const model of body.data) if (isCompatibleOpenMayhemModel(model, endpoint)) models.set(model.id, model)
      cursor = body.next_cursor || undefined
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) throw new Error('OpenMayhem returned an invalid catalog cursor.')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return [...models.values()]
  })()
  catalogs.set(endpoint, { until: Date.now() + 60000, promise })
  void promise.catch(() => { if (catalogs.get(endpoint)?.promise === promise) catalogs.delete(endpoint) })
  return promise
}

export function isCompatibleOpenMayhemModel(model: OpenMayhemModel, endpoint: OpenMayhemEndpoint): boolean {
  if (endpoint === 'WORKFLOWS') return isKreaImageModel(model)
  if (endpoint === 'CHAT') return isOpenMayhemChatModel(model)
  const supplied = endpoint === 'IMAGES'
    ? ['model', 'prompt', 'size', 'width', 'height', 'n', 'steps', 'cfg_scale', 'seed', 'negative_prompt']
    : ['model', 'input', 'voice', 'response_format']
  const contracts = model.request_contracts?.filter((c) => c.endpoint === endpoint)
  const compatible = !!model.endpoints?.includes(endpoint) && !!contracts?.length && contracts.every((c) =>
    !!c.attributes && (c.required ?? []).every((key) => supplied.includes(key)),
  )
  if (!compatible) return false
  if (endpoint === 'AUDIO_SPEECH') {
    const voices = openMayhemAttribute(model, endpoint, 'voice')?.enumValues
    const formats = openMayhemAttribute(model, endpoint, 'response_format')?.enumValues
    return (!voices || voices.length > 0) && (!formats || formats.some((f) => f === 'wav' || f === 'mp3'))
  }
  return true
}

/** One image picker, with endpoint-specific execution kept inside the image backend. */
export async function loadOpenMayhemImageModels(refresh = false): Promise<OpenMayhemModel[]> {
  const catalogs = await Promise.all([loadOpenMayhemModels(refresh, 'IMAGES'), loadOpenMayhemModels(refresh, 'WORKFLOWS')])
  return [...new Map(catalogs.flat().map((model) => [model.id, model])).values()]
}

/** Intersect runtime contracts: a request may route to any available implementation. */
export function openMayhemAttribute(model: OpenMayhemModel, endpoint: OpenMayhemEndpoint, key: string): Attribute | undefined {
  const attrs = model.request_contracts?.filter((c) => c.endpoint === endpoint).map((c) => c.attributes[key])
  if (!attrs?.length || attrs.some((a) => !a)) return undefined
  const enums = attrs.filter((a) => a.enumValues).map((a) => a.enumValues!)
  const values = enums.length ? enums[0].filter((value) => enums.every((e) => e.includes(value))) : undefined
  return {
    enumValues: values,
    default: attrs.every((a) => a.default === attrs[0].default) ? attrs[0].default : undefined,
    minimum: Math.max(...attrs.map((a) => a.minimum ?? -Infinity)),
    maximum: Math.min(...attrs.map((a) => a.maximum ?? Infinity)),
    maxLength: Math.min(...attrs.map((a) => a.maxLength ?? Infinity)),
    minLength: Math.max(...attrs.map((a) => a.minLength ?? 0)),
    multipleOf: attrs.some((a) => a.multipleOf !== undefined) ? attrs.filter((a) => a.multipleOf !== undefined).map((a) => a.multipleOf!).reduce((multiple, next) => {
      const gcd = (x: number, y: number): number => y ? gcd(y, x % y) : x
      return multiple * next / gcd(multiple, next)
    }) : undefined,
  }
}

/** Keep short judge calls useful: disable thinking when the model explicitly supports it.
 * Send only attributes shared by its CHAT contracts, so routing to another runtime is safe.
 * Preserve the caller's token budget; never silently increase billed generation limits.
 */
export async function openMayhemRequestBody(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!body.model) throw new KoboldApiError('Choose an OpenMayhem chat model first.')
  const model = (await loadOpenMayhemModels()).find((m) => m.id === body.model)
  if (!model) throw new KoboldApiError('This model is not in OpenMayhem’s chat catalog. Refresh the model list and choose another.')
  const contracts = model.request_contracts!.filter((c) => c.endpoint === 'CHAT')
  const result: Record<string, unknown> = { model: body.model, messages: body.messages, stream: body.stream }
  for (const [key, value] of Object.entries(body)) {
    if (key in result || value === undefined) continue
    const attributes = contracts.map((c) => c.attributes[key])
    if (attributes.some((a) => !a)) continue
    if (attributes.some((a) => a.enumValues && !a.enumValues.includes(value))) continue
    if (typeof value === 'number' && attributes.some((a) =>
      (a.minimum !== undefined && value < a.minimum) || (a.maximum !== undefined && value > a.maximum),
    )) throw new KoboldApiError(`The selected OpenMayhem model does not support ${key}=${value}. Adjust Settings → Generation.`)
    result[key] = value
  }
  if (!('max_tokens' in result)) throw new KoboldApiError('This OpenMayhem model does not support RP Suite’s response token limit.')
  if (contracts.every((c) => c.attributes.thinking_mode?.enumValues?.includes('disabled'))) {
    result.thinking_mode = 'disabled'
  }
  return result
}
