import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpenMayhemVoiceField } from './OpenMayhemVoiceField'
import type { OpenMayhemModel } from '@/lib/api/openMayhem'

const model: OpenMayhemModel = { id: 'speech/model', endpoints: ['AUDIO_SPEECH'], request_contracts: [
  { endpoint: 'AUDIO_SPEECH', attributes: { voice: { enumValues: ['default', 'new-voice'] } } },
] }
describe('OpenMayhem voice choices', () => {
  it('shows newly advertised voices and never inserts a stale saved override as a choice', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemVoiceField, { model, value: 'old-voice', onChange: () => {} }))
    expect(html).toContain('new-voice')
    expect(html).not.toContain('value="old-voice"')
    expect(html).toContain('saved voice is unavailable')
    expect(html).not.toContain('<input')
  })
  it('disables the voice field until an available model is known', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemVoiceField, { value: '', onChange: () => {} }))
    expect(html).toContain('disabled')
    expect(html).not.toContain('<input')
  })
  it('allows free voice IDs only when the model does not publish an enum', () => {
    const html = renderToStaticMarkup(createElement(OpenMayhemVoiceField, { model: { ...model, request_contracts: [{ endpoint: 'AUDIO_SPEECH', attributes: { voice: {} } }] }, value: '', onChange: () => {} }))
    expect(html).toContain('<input')
  })
})
