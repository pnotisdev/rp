import { describe, expect, it } from 'vitest'
import type { KoboldClient } from '@/lib/api/kobold'
import type { ChatMessage } from '@/lib/prompt/builder'
import { RAPPORT_READS, RAPPORT_TRAJECTORIES, assessRapport, isRapportTrajectory } from './rapport'

function stubClient(reply: string, spy?: (p: Record<string, unknown>) => void): KoboldClient {
  return {
    generate: async (p: Record<string, unknown>) => {
      spy?.(p)
      return reply
    },
    getEffectiveMaxContext: async () => 4096,
  } as unknown as KoboldClient
}

const TRANSCRIPT: ChatMessage[] = [
  { id: '1', role: 'user', name: 'Kai', text: 'This place is nicer than I expected.' },
  { id: '2', role: 'char', name: 'Sumire', text: '"I did some research. Obviously."' },
  { id: '3', role: 'user', name: 'Kai', text: 'You keep smiling when you think I am not looking.' },
]

describe('rapport specs', () => {
  it('every trajectory has a label, a tone, and a judge hint', () => {
    for (const id of RAPPORT_TRAJECTORIES) {
      const spec = RAPPORT_READS[id]
      expect(spec.label.length).toBeGreaterThan(0)
      expect(['up', 'up-strong', 'flat', 'down', 'down-strong']).toContain(spec.tone)
      expect(spec.judgeHint.length).toBeGreaterThan(0)
    }
  })

  it('isRapportTrajectory guards the union', () => {
    expect(isRapportTrajectory('warming')).toBe(true)
    expect(isRapportTrajectory('ecstatic')).toBe(false)
    expect(isRapportTrajectory(3)).toBe(false)
  })
})

describe('assessRapport', () => {
  it('returns a validated trajectory and trimmed note', async () => {
    const r = await assessRapport(stubClient('{"trajectory":"warming","note":"keeps stealing glances at you"}'), {
      transcript: TRANSCRIPT,
      charName: 'Sumire',
      userName: 'Kai',
    })
    expect(r).toEqual({ trajectory: 'warming', note: 'keeps stealing glances at you', walkOut: false })
  })

  it('drops an unknown trajectory entirely (null, not a guess)', async () => {
    const r = await assessRapport(stubClient('{"trajectory":"smitten","note":"x"}'), {
      transcript: TRANSCRIPT,
      charName: 'Sumire',
      userName: 'Kai',
    })
    expect(r).toBeNull()
  })

  it('tolerates a missing note', async () => {
    const r = await assessRapport(stubClient('{"trajectory":"on_edge"}'), {
      transcript: TRANSCRIPT,
      charName: 'Sumire',
      userName: 'Kai',
    })
    expect(r).toEqual({ trajectory: 'on_edge', note: undefined, walkOut: false })
  })

  it('reads a genuine walkOut flag', async () => {
    const r = await assessRapport(stubClient('{"trajectory":"on_edge","note":"grabs her coat","walkOut":true}'), {
      transcript: TRANSCRIPT,
      charName: 'Sumire',
      userName: 'Kai',
    })
    expect(r).toEqual({ trajectory: 'on_edge', note: 'grabs her coat', walkOut: true })
  })

  it('treats anything other than a literal true as no walkout', async () => {
    const r = await assessRapport(stubClient('{"trajectory":"on_edge","walkOut":"true"}'), {
      transcript: TRANSCRIPT,
      charName: 'Sumire',
      userName: 'Kai',
    })
    expect(r?.walkOut).toBe(false)
  })

  it('returns null for an empty transcript without calling the model', async () => {
    let called = false
    const r = await assessRapport(
      stubClient('{"trajectory":"warming"}', () => {
        called = true
      }),
      { transcript: [], charName: 'Sumire', userName: 'Kai' },
    )
    expect(r).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null on unparseable output and on a thrown client error', async () => {
    expect(
      await assessRapport(stubClient('the vibes are immaculate honestly'), {
        transcript: TRANSCRIPT,
        charName: 'S',
        userName: 'K',
      }),
    ).toBeNull()
    const throwing = {
      generate: async () => {
        throw new Error('offline')
      },
      getEffectiveMaxContext: async () => 4096,
    } as unknown as KoboldClient
    expect(await assessRapport(throwing, { transcript: TRANSCRIPT, charName: 'S', userName: 'K' })).toBeNull()
  })

  it('sends only the last 8 turns', async () => {
    let sentPrompt = ''
    const long: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? 'char' : 'user',
      name: i % 2 ? 'Sumire' : 'Kai',
      text: `line ${i}`,
    }))
    await assessRapport(
      stubClient('{"trajectory":"at_ease"}', (p) => {
        sentPrompt = p.prompt as string
      }),
      { transcript: long, charName: 'Sumire', userName: 'Kai' },
    )
    expect(sentPrompt).toContain('line 19')
    expect(sentPrompt).toContain('line 12')
    expect(sentPrompt).not.toContain('line 11')
  })
})
