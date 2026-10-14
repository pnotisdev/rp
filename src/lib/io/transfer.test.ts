import { describe, expect, it } from 'vitest'
import { fromEnvelope, importEnvelopes, toEnvelope } from './transfer'

describe('envelopes', () => {
  it('round-trips without identity fields', () => {
    const env = toEnvelope('persona', { id: 'a', createdAt: 1, updatedAt: 2, name: 'Kai', description: 'x' })
    expect(env.data).toEqual({ name: 'Kai', description: 'x' })
    expect(fromEnvelope('persona', env)).toEqual({ name: 'Kai', description: 'x' })
  })

  it('rejects the wrong kind', () => {
    expect(() => fromEnvelope('world', toEnvelope('persona', { name: 'x' }))).toThrow('Not an rp world file')
  })

  it('imports good files and reports bad ones', async () => {
    const good = new File([JSON.stringify(toEnvelope('world', { name: 'W' }))], 'w.json')
    const bad = new File(['{nope'], 'bad.json')
    const seen: unknown[] = []
    const r = await importEnvelopes('world', [good, bad], async (d) => void seen.push(d))
    expect(r.created).toBe(1)
    expect(r.failed[0]).toContain('bad.json')
    expect(seen).toEqual([{ name: 'W' }])
  })
})
