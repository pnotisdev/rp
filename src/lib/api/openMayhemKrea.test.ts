import { afterEach, describe, expect, it, vi } from 'vitest'
import turboJson from './fixtures/krea-turbo.json'
import qualityJson from './fixtures/krea-quality.json'
import { kreaImageBody, isKreaImageModel, openMayhemImageLabel } from './openMayhemKrea'
import { loadOpenMayhemImageModels, hasAvailableOpenMayhemProvider, type OpenMayhemModel } from './openMayhem'
import { OpenMayhemImageClient } from './openMayhemMedia'

const turbo = turboJson as unknown as OpenMayhemModel
const quality = qualityJson as unknown as OpenMayhemModel
const params = { prompt: 'A watercolor lighthouse', width: 832, height: 1216, steps: 28, cfgScale: 7, seed: 42 }
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>
const graph = (model: OpenMayhemModel, patch = {}) => kreaImageBody(model, { ...params, ...patch }).body.workflow as Graph
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Krea base images from public catalog metadata', () => {
  it.each([turbo, quality])('builds the base graph for $name without any LoRA nodes', (model) => {
    expect(isKreaImageModel(model)).toBe(true)
    const nodes = graph(model)
    expect(Object.keys(nodes)).toHaveLength(10)
    expect(Object.values(nodes).some((node) => /lora/i.test(node.class_type))).toBe(false)
    expect(nodes.sampling.inputs.model).toEqual(['denoiser', 0])
    expect(nodes.positive.inputs.text).toBe(params.prompt)
    expect(nodes.latent.inputs.batch_size).toBe(1)
    expect(nodes.sampler.inputs.seed).toBe(42)
    expect(nodes.denoiser.inputs.unet_name).toContain(model === turbo ? 'turbo' : 'raw')
    expect(nodes.sampler.inputs.steps).toBe(model === turbo ? 8 : 52)
    expect(nodes.sampler.inputs.cfg).toBe(model === turbo ? 1 : 4.5)
  })
  it('honors Turbo negative prompts through its published negative-prompt preset', () => {
    const nodes = graph(turbo, { negativePrompt: 'text, watermark' })
    expect(nodes.sampler.inputs.cfg).toBe(4)
    expect(nodes.sampler.inputs.steps).toBe(8)
    expect(nodes.negative.inputs.text).toBe('text, watermark')
  })
  it.each([[832,1216], [1920,1080], [4096,4096]])('fits %sx%s within live capacity and preserves aspect ratio', (width, height) => {
    const nodes = graph(turbo, { width, height })
    const w = Number(nodes.latent.inputs.width), h = Number(nodes.latent.inputs.height)
    expect(w * h).toBeLessThanOrEqual(1048576)
    expect(w % 64).toBe(0); expect(h % 64).toBe(0)
    expect(Math.abs(w / h - width / height)).toBeLessThan(0.1)
    expect(nodes.sampling.inputs.width).toBe(w)
    expect(nodes.sampling.inputs.height).toBe(h)
  })
  it('rejects missing metadata, unsupported families, mandatory LoRAs, invalid defaults and inputs', () => {
    for (const edit of [
      (m: OpenMayhemModel) => { m.workflow_media = undefined },
      (m: OpenMayhemModel) => { m.workflow_media!.family = 'video' },
      (m: OpenMayhemModel) => { m.workflow!.graph_constraints.roles.user_lora.min_count = 1 },
      (m: OpenMayhemModel) => { m.workflow_media!.presets[0].inputs[0].value = 900 },
      (m: OpenMayhemModel) => { m.workflow!.parts[0].sha256 = 'invalid' },
      (m: OpenMayhemModel) => { m.live_capacity_profiles![0].modalities.image!.maxItemUnits = NaN },
      (m: OpenMayhemModel) => { m.live_capacity_profiles![0].modalities.image!.maxItemsPerRequest = 0 },
      (m: OpenMayhemModel) => { m.request_contracts![0].required!.push('input_files') },
    ]) { const model = structuredClone(turbo); edit(model); expect(isKreaImageModel(model)).toBe(false) }
    expect(() => graph(turbo, { prompt: 'x'.repeat(16385) })).toThrow('16,384')
    expect(() => graph(turbo, { width: NaN })).toThrow()
    expect(() => graph(turbo, { seed: 1.5 })).toThrow()
  })
  it('uses stable IDs with friendly labels', () => {
    expect(openMayhemImageLabel(turbo)).toBe('Krea 2 Turbo')
    expect(openMayhemImageLabel(quality)).toBe('Krea 2 Quality')
  })
  it('combines paginated image/workflow catalogs and filters unavailable or unsupported workflows', async () => {
    const zimage: OpenMayhemModel = { id: 'tongyi/z-image-turbo', endpoints: ['IMAGES'], providers_available: 1, request_contracts: [{ endpoint: 'IMAGES', required: ['model', 'prompt'], attributes: {} }] }
    const fetchMock = vi.fn(async (url: string) => url.includes('IMAGES') ? json({ data: [zimage] })
      : url.includes('cursor=next') ? json({ data: [quality, { ...turbo, id: 'new/turbo' }] })
        : json({ data: [turbo, { ...turbo, id: 'busy', providers_available: 0 }, { ...turbo, id: 'stale', availability_stale: true }, { id: 'video', endpoints: ['WORKFLOWS'] }], next_cursor: 'next' }))
    vi.stubGlobal('fetch', fetchMock)
    const models = (await loadOpenMayhemImageModels(true)).filter(hasAvailableOpenMayhemProvider)
    expect(models.map((m) => m.id)).toEqual([zimage.id, turbo.id, quality.id, 'new/turbo'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it.each([turbo, quality])('executes $name through workflow jobs and returns an image and seed', async (model) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/models?')) return json({ data: url.includes('WORKFLOWS') ? [model] : [] })
      if (url.endsWith('/workflows')) {
        const body = JSON.parse(String(init?.body))
        expect(body.model).toBe(model.id)
        expect(body.workflow.sampler.inputs.seed).toBe(42)
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer example-key' })
        return json({ id: 'job', status: 'completed', artifacts: [{ id: 'image', contentType: 'image/png' }] })
      }
      return new Response('image data', { headers: { 'Content-Type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await new OpenMayhemImageClient('example-key', model.id).generateImage(params)
    expect(result).toMatchObject({ mimeType: 'image/png', seed: 42 })
    expect(atob(result.base64)).toBe('image data')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
})
