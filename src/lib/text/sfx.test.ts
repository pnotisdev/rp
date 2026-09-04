import { describe, expect, it } from 'vitest'
import { sfxConfigFor } from '@/lib/text/sfx'
import type { Character } from '@/lib/characters/cardSpec'

const char = (id: string, sfxWords?: string[]): Character =>
  ({ id, card: { name: id } as Character['card'], sfxWords, createdAt: 0, updatedAt: 0 }) as Character

describe('sfxConfigFor', () => {
  it('returns a disabled config when the global toggle is off', () => {
    expect(sfxConfigFor({ role: 'char' }, { enabled: false, globalWords: ['nya'], primary: char('a', ['nya']) })).toEqual({
      disabled: true,
    })
  })

  it('returns undefined (built-ins only) when nothing extra applies', () => {
    expect(sfxConfigFor({ role: 'char' }, { enabled: true, globalWords: [], primary: char('a') })).toBeUndefined()
  })

  it('merges the global list with the primary speaker\'s own words for a plain char message', () => {
    expect(
      sfxConfigFor({ role: 'char' }, { enabled: true, globalWords: ['glomp'], primary: char('a', ['nya', 'mrrp']) }),
    ).toEqual({ extraWords: ['glomp', 'nya', 'mrrp'] })
  })

  it('uses the speaking participant\'s words in a group chat, not the primary\'s', () => {
    const cfg = sfxConfigFor(
      { role: 'char', speakerId: 'kestrel' },
      {
        enabled: true,
        globalWords: [],
        primary: char('aria', ['nya']),
        participants: [char('kestrel', ['clang', 'shff'])],
      },
    )
    expect(cfg).toEqual({ extraWords: ['clang', 'shff'] })
  })

  it('gives a user message only the global list, never any character\'s words', () => {
    expect(
      sfxConfigFor({ role: 'user' }, { enabled: true, globalWords: ['glomp'], primary: char('a', ['nya']) }),
    ).toEqual({ extraWords: ['glomp'] })
    expect(
      sfxConfigFor({ role: 'user' }, { enabled: true, globalWords: [], primary: char('a', ['nya']) }),
    ).toBeUndefined()
  })

  it('falls back to the primary when a group-chat speakerId no longer matches anyone', () => {
    expect(
      sfxConfigFor(
        { role: 'char', speakerId: 'deleted' },
        { enabled: true, globalWords: [], primary: char('aria', ['nya']), participants: [char('kestrel', ['clang'])] },
      ),
    ).toEqual({ extraWords: ['nya'] })
  })
})
