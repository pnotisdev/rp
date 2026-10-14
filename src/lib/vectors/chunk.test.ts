import { describe, expect, it } from 'vitest'
import { chunkText } from './chunk'

describe('chunkText', () => {
  it('keeps a short text as one chunk', () => {
    expect(chunkText('One paragraph.\n\nAnother one.')).toEqual(['One paragraph.\n\nAnother one.'])
    expect(chunkText('   \n\n  ')).toEqual([])
    expect(chunkText('')).toEqual([])
  })

  it('groups whole paragraphs up to the limit', () => {
    const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'x'.repeat(80)}`)
    const chunks = chunkText(paras.join('\n\n'), { maxChars: 200, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200)
    expect(chunks.join('\n\n')).toBe(paras.join('\n\n'))
  })

  it('repeats the end of one chunk at the start of the next', () => {
    const paras = ['alpha beta gamma delta epsilon zeta eta theta '.repeat(2).trim(), 'iota kappa lambda mu nu xi omicron pi '.repeat(2).trim()]
    const chunks = chunkText(paras.join('\n\n'), { maxChars: 120, overlap: 30 })
    expect(chunks).toHaveLength(2)
    const carried = chunks[1].split('\n\n')[0]
    expect(paras[0].endsWith(carried)).toBe(true)
    expect(carried.length).toBeLessThanOrEqual(30)
  })

  it('splits one huge paragraph on sentences', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i}.`)
    const chunks = chunkText(sentences.join(' '), { maxChars: 120, overlap: 0 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120)
      expect(c.endsWith('.')).toBe(true)
    }
  })

  it('cuts a single run of text with no breaks rather than loop or overflow', () => {
    const chunks = chunkText('x'.repeat(1000), { maxChars: 200, overlap: 0 })
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 200, 200, 200])
  })

  it('never lets the overlap eat the whole chunk', () => {
    const chunks = chunkText(['a'.repeat(90), 'b'.repeat(90), 'c'.repeat(90)].join('\n\n'), { maxChars: 100, overlap: 500 })
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
  })
})
