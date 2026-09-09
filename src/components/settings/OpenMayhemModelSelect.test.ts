import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpenMayhemModelSelect } from './OpenMayhemModelSelect'

describe('OpenMayhem model picker', () => {
  it('does not fall back to manual model entry when no providers are available', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemModelSelect, { models: [], loading: false, value: 'offline/model', onChange: () => {} }))
    expect(html).toContain('No available models')
    expect(html).toContain('disabled')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('offline/model')
  })
  it('does not reinsert a saved unavailable model into the available options', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemModelSelect, { models: ['available/model'], loading: false, value: 'offline/model', onChange: () => {} }))
    expect(html).toContain('available/model')
    expect(html).not.toContain('offline/model')
    expect(html).toContain('selected model is currently unavailable')
  })
  it('distinguishes an unsuccessful availability check from an empty live catalog', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemModelSelect, { models: null, loading: false, value: '', onChange: () => {} }))
    expect(html).toContain('Could not check model availability')
  })
})
