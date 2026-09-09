import { KoboldApiError } from './types'

export const OPENMAYHEM_BASE_URL = 'https://api.openmayhem.ai/v1'
export const OPENMAYHEM_PROXY = '/api/openmayhem'

export function isOpenMayhem(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/, '') === OPENMAYHEM_BASE_URL
}

type Attribute = { enumValues?: unknown[]; minimum?: number; maximum?: number }
type Contract = { endpoint: string; required?: string[]; attributes: Record<string, Attribute> }
export interface OpenMayhemModel {
  id: string
  endpoints: string[]
  context_length?: number
  availability?: string
  request_contracts?: Contract[]
}

/** Some CHAT models require tools and cannot handle a normal roleplay conversation. */
export function isOpenMayhemChatModel(model: OpenMayhemModel): boolean {
  const contracts = model.request_contracts?.filter((c) => c.endpoint === 'CHAT')
  return !!model.endpoints?.includes('CHAT') && !!contracts?.length && contracts.every(
    (c) => !!c.attributes?.max_tokens && c.required?.every((key) => key === 'model' || key === 'messages'),
  )
}

let catalog: { until: number; promise: Promise<OpenMayhemModel[]> } | undefined
export function loadOpenMayhemModels(refresh = false): Promise<OpenMayhemModel[]> {
  if (!refresh && catalog && catalog.until > Date.now()) return catalog.promise
  const promise = fetch(`${OPENMAYHEM_PROXY}/models`, { signal: AbortSignal.timeout(10000) })
    .then(async (res) => {
      if (!res.ok) throw new Error('OpenMayhem model catalog is unavailable. Try again shortly.')
      const body = await res.json() as { data?: OpenMayhemModel[] }
      if (!Array.isArray(body.data)) throw new Error('OpenMayhem returned an invalid model catalog.')
      return body.data.filter(isOpenMayhemChatModel)
    })
  catalog = { until: Date.now() + 60000, promise }
  void promise.catch(() => { if (catalog?.promise === promise) catalog = undefined })
  return promise
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
