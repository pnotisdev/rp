import { describe, expect, it } from 'vitest'
import { extractCompleteSentences } from './sentenceChunker'

describe('extractCompleteSentences', () => {
  it('extracts nothing while the text has no sentence boundary yet', () => {
    const { chunks, consumedLength } = extractCompleteSentences('Hello there, how are', 0)
    expect(chunks).toEqual([])
    expect(consumedLength).toBe(0)
  })

  it('extracts one complete sentence terminated by punctuation plus whitespace', () => {
    const { chunks, consumedLength } = extractCompleteSentences('Hello there. ', 0)
    expect(chunks).toEqual(['Hello there.'])
    expect(consumedLength).toBe('Hello there. '.length)
  })

  it('extracts multiple sentences from one call', () => {
    const { chunks, consumedLength } = extractCompleteSentences('Hi! How are you? Fine, thanks. ', 0)
    expect(chunks).toEqual(['Hi!', 'How are you?', 'Fine, thanks.'])
    expect(consumedLength).toBe('Hi! How are you? Fine, thanks. '.length)
  })

  it('leaves a trailing sentence with no terminator unconsumed', () => {
    const { chunks, consumedLength } = extractCompleteSentences('Done already. And then', 0)
    expect(chunks).toEqual(['Done already.'])
    expect(consumedLength).toBe('Done already. '.length)
  })

  it('treats a run of newlines as a boundary even with no punctuation', () => {
    const { chunks, consumedLength } = extractCompleteSentences('First line\n\nSecond line', 0)
    expect(chunks).toEqual(['First line'])
    expect(consumedLength).toBe('First line\n\n'.length)
  })

  it('does not re-extract text already marked consumed', () => {
    const first = extractCompleteSentences('One. Two.', 0)
    expect(first.chunks).toEqual(['One.'])
    const second = extractCompleteSentences('One. Two. Three.', first.consumedLength)
    expect(second.chunks).toEqual(['Two.'])
    expect(second.consumedLength).toBe('One. Two. '.length)
  })

  it('handles an ellipsis and a quote/paren before the trailing space as one boundary', () => {
    const { chunks } = extractCompleteSentences('Wait... "Are you sure?" Yes. ', 0)
    expect(chunks).toEqual(['Wait...', '"Are you sure?"', 'Yes.'])
  })

  it('returns no chunks for empty or whitespace-only unconsumed text', () => {
    expect(extractCompleteSentences('', 0)).toEqual({ chunks: [], consumedLength: 0 })
    expect(extractCompleteSentences('   ', 0)).toEqual({ chunks: [], consumedLength: 0 })
  })

  it('skips a blank sentence produced by leading newlines with nothing before them', () => {
    const { chunks, consumedLength } = extractCompleteSentences('\n\nHello.', 0)
    expect(chunks).toEqual([])
    expect(consumedLength).toBe(2)
  })
})
