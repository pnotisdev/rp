import type { Character } from '@/lib/characters/cardSpec'
import type { StoredMessage } from '@/lib/types'
import type { SfxConfig } from '@/lib/text/messageSegments'

/**
 * Resolves the SFX-burst policy for one message: off entirely when the global toggle is off,
 * otherwise the built-in onomatopoeia plus the global custom list plus — for a character message —
 * whoever actually spoke it (`speakerId` in a group chat, else the primary character). User
 * messages get the global list only; a persona has no sound-effect vocabulary of its own.
 */
export function sfxConfigFor(
  m: Pick<StoredMessage, 'role' | 'speakerId'>,
  opts: {
    enabled: boolean
    globalWords: readonly string[]
    primary?: Character
    participants?: readonly Character[]
  },
): SfxConfig | undefined {
  if (!opts.enabled) return { disabled: true }
  const speaker =
    m.role !== 'char'
      ? undefined
      : m.speakerId
        ? opts.participants?.find((c) => c.id === m.speakerId) ?? opts.primary
        : opts.primary
  const words = speaker?.sfxWords?.length ? [...opts.globalWords, ...speaker.sfxWords] : opts.globalWords
  return words.length ? { extraWords: words } : undefined
}
