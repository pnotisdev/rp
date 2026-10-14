import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { analyzeWorkflow, buildCheckpointWorkflow, buildDitWorkflow, buildWorkflow, ComfyWorkflowError, DEFAULT_COMFY_CONFIG, fillCustomWorkflow, parseApiWorkflow, type ComfyConfig } from './comfyWorkflow'
import type { ImageGenerateParams } from './imageBackend'

const params: ImageGenerateParams = { prompt: 'a lighthouse', negativePrompt: 'blurry', width: 640, height: 960, steps: 20, cfgScale: 6, model: 'sd15.safetensors' }
// The workflow the repo's own sprite pipeline uses (split loaders, SLOT_ placeholders).
const anima = fs.readFileSync('tools/comfy/anima-txt2img.api.json', 'utf8')
const cfg = (over: Partial<ComfyConfig>): ComfyConfig => ({ ...DEFAULT_COMFY_CONFIG, ...over })

describe('built-in workflows', () => {
  it('builds the checkpoint graph and chains LoRAs through model and text encoder', () => {
    const wf = buildCheckpointWorkflow(params, 7, cfg({ loras: [{ name: 'a.safetensors', strength: 0.8 }, { name: 'b.safetensors', strength: 0.5 }], scheduler: 'karras' }))
    expect(wf['4'].inputs.ckpt_name).toBe('sd15.safetensors')
    expect(wf['100'].inputs).toMatchObject({ model: ['4', 0], clip: ['4', 1], lora_name: 'a.safetensors', strength_model: 0.8 })
    expect(wf['101'].inputs).toMatchObject({ model: ['100', 0], clip: ['100', 1] })
    expect(wf['3'].inputs).toMatchObject({ seed: 7, steps: 20, cfg: 6, scheduler: 'karras', sampler_name: 'euler', model: ['101', 0] })
    expect(wf['6'].inputs).toMatchObject({ text: 'a lighthouse', clip: ['101', 1] })
    expect(wf['5'].inputs).toMatchObject({ width: 640, height: 960 })
  })

  it('builds the split-loader graph for diffusion transformers', () => {
    const wf = buildDitWorkflow(params, 3, cfg({ preset: 'dit', unet: 'u.safetensors', clip: 'q.safetensors', vae: 'v.safetensors', clipType: 'cosmos', loras: [{ name: 'l.safetensors', strength: 1 }] }))
    expect(wf['1'].class_type).toBe('UNETLoader')
    expect(wf['2'].inputs).toMatchObject({ clip_name: 'q.safetensors', type: 'cosmos' })
    expect(wf['100'].class_type).toBe('LoraLoaderModelOnly')
    expect(wf['4'].inputs).toMatchObject({ model: ['100', 0], sampler_name: 'dpmpp_2m', scheduler: 'simple', seed: 3 })
    expect(wf['5'].class_type).toBe('EmptySD3LatentImage')
    expect(() => buildDitWorkflow(params, 1, cfg({ preset: 'dit', unet: 'u' }))).toThrow(ComfyWorkflowError)
  })

  it('picks the graph from the preset', () => {
    expect(buildWorkflow(params, 1, cfg({ preset: 'checkpoint' }))['4'].class_type).toBe('CheckpointLoaderSimple')
    expect(buildWorkflow(params, 1, cfg({ preset: 'custom', workflow: anima }))['1'].class_type).toBe('UNETLoader')
  })
})

describe('parseApiWorkflow', () => {
  it('accepts API format, with or without a prompt wrapper', () => {
    expect(Object.keys(parseApiWorkflow(anima))).toContain('4')
    expect(Object.keys(parseApiWorkflow(JSON.stringify({ prompt: JSON.parse(anima) })))).toContain('4')
  })

  it('explains the UI format and other mistakes', () => {
    expect(() => parseApiWorkflow('{ nope')).toThrow('not valid JSON')
    expect(() => parseApiWorkflow(JSON.stringify({ nodes: [], links: [] }))).toThrow('Export (API)')
    expect(() => parseApiWorkflow(JSON.stringify({ '1': { inputs: {} } }))).toThrow('class_type')
    expect(() => parseApiWorkflow('[1]')).toThrow('JSON object')
  })
})

describe('fillCustomWorkflow', () => {
  it('fills the repo workflow: SLOT_ placeholders, seed and size; leaves steps and cfg alone', () => {
    const wf = fillCustomWorkflow(anima, params, 99)
    expect(wf['6'].inputs.text).toBe('a lighthouse')
    expect(wf['7'].inputs.text).toBe('blurry')
    expect(wf['4'].inputs).toMatchObject({ seed: 99, steps: 30, cfg: 5 })
    expect(wf['5'].inputs).toMatchObject({ width: 640, height: 960 })
  })

  it('substitutes {{tokens}} inside longer text and as numbers', () => {
    const wf = fillCustomWorkflow(
      JSON.stringify({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, {{prompt}}, detailed', clip: ['9', 0] } },
        '2': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}', sampler_name: '{{sampler}}', positive: ['1', 0], negative: ['1', 0] } },
        '3': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
        '4': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
      }),
      { ...params, sampler: 'euler' },
      5,
    )
    expect(wf['1'].inputs.text).toBe('masterpiece, a lighthouse, detailed')
    expect(wf['2'].inputs).toMatchObject({ seed: 5, steps: 20, cfg: 6, sampler_name: 'euler' })
    expect(wf['3'].inputs).toMatchObject({ width: 640, height: 960 })
  })

  it('finds the prompt nodes itself when there are no placeholders, following conditioning nodes', () => {
    const wf = fillCustomWorkflow(
      JSON.stringify({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['9', 0] } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['9', 0] } },
        '3': { class_type: 'FluxGuidance', inputs: { conditioning: ['1', 0], guidance: 3.5 } },
        '4': { class_type: 'KSampler', inputs: { seed: 1, steps: 8, cfg: 1, positive: ['3', 0], negative: ['2', 0] } },
        '5': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
      }),
      params,
      42,
    )
    expect(wf['1'].inputs.text).toBe('a lighthouse')
    expect(wf['2'].inputs.text).toBe('blurry')
    expect(wf['4'].inputs).toMatchObject({ seed: 42, steps: 8 })
  })

  it('says what is missing', () => {
    expect(() => fillCustomWorkflow(JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }), params, 1)).toThrow('Could not find where the prompt goes')
  })
})

describe('analyzeWorkflow', () => {
  it('reports what it recognised and what is wrong', () => {
    const ok = analyzeWorkflow(parseApiWorkflow(anima))
    expect(ok).toMatchObject({ samplers: ['4'], positive: '6', negative: '7', latents: ['5'], outputs: ['9'], problems: [] })
    expect(ok.tokens.sort()).toEqual(['negative', 'prompt'])
    const bad = analyzeWorkflow(parseApiWorkflow(JSON.stringify({ '1': { class_type: 'KSampler', inputs: { seed: 1 } } })))
    expect(bad.problems).toHaveLength(2)
  })
})
