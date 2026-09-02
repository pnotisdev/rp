import type { StoredMessage } from '@/lib/types'
import type { Character } from '@/lib/characters/cardSpec'
import type { Persona } from '@/lib/types'
import { MessageBubble } from './MessageBubble'

interface MessageLogProps {
  messages: StoredMessage[]
  character?: Character
  persona?: Persona
  /** Other characters able to speak in this chat (group scenes) — [] for an ordinary single-character chat. */
  participantCharacters?: Character[]
  generatingMessageId: string | null
  streamingText: string
  /** Message id to briefly flash, set when the user jumps here from search or the pinned panel. */
  highlightedMessageId?: string | null
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onRegenerate: (id: string) => void
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
}

/** The classic scrolling transcript — shared by the default chat view and the VN mode backlog drawer. */
export function MessageLog({
  messages,
  character,
  persona,
  participantCharacters = [],
  generatingMessageId,
  streamingText,
  highlightedMessageId,
  onEdit,
  onDelete,
  onRegenerate,
  onSwipe,
  onFork,
  onTogglePin,
}: MessageLogProps) {
  const avatarFor = (m: StoredMessage): string | undefined => {
    if (m.role !== 'char') return persona?.avatarDataUrl
    if (!m.speakerId) return character?.avatarDataUrl
    return participantCharacters.find((c) => c.id === m.speakerId)?.avatarDataUrl ?? character?.avatarDataUrl
  }

  return (
    <div className="mx-auto max-w-chat backdrop-blur-chat">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          avatarDataUrl={avatarFor(m)}
          isStreaming={generatingMessageId === m.id}
          streamingText={streamingText}
          isHighlighted={highlightedMessageId === m.id}
          onEdit={(text) => onEdit(m.id, text)}
          onDelete={() => onDelete(m.id)}
          onRegenerate={() => onRegenerate(m.id)}
          onSwipe={(dir) => onSwipe(m.id, dir)}
          onFork={() => onFork(m.id)}
          onTogglePin={() => onTogglePin(m.id)}
        />
      ))}
      {messages.length === 0 && (
        <p className="text-center text-sm text-text-muted py-8">
          No messages yet — say hello, or the character's first message will appear once you send one.
        </p>
      )}
    </div>
  )
}
