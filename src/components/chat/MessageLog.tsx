import type { StoredMessage } from '@/lib/types'
import type { Character } from '@/lib/characters/cardSpec'
import type { Persona } from '@/lib/types'
import { MessageBubble } from './MessageBubble'

interface MessageLogProps {
  messages: StoredMessage[]
  character?: Character
  persona?: Persona
  generatingMessageId: string | null
  streamingText: string
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
  onRegenerate: (id: string) => void
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onFork: (id: string) => void
}

/** The classic scrolling transcript — shared by the default chat view and the VN mode backlog drawer. */
export function MessageLog({
  messages,
  character,
  persona,
  generatingMessageId,
  streamingText,
  onEdit,
  onDelete,
  onRegenerate,
  onSwipe,
  onFork,
}: MessageLogProps) {
  return (
    <div className="mx-auto max-w-chat backdrop-blur-chat">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          avatarDataUrl={m.role === 'char' ? character?.avatarDataUrl : persona?.avatarDataUrl}
          isStreaming={generatingMessageId === m.id}
          streamingText={streamingText}
          onEdit={(text) => onEdit(m.id, text)}
          onDelete={() => onDelete(m.id)}
          onRegenerate={() => onRegenerate(m.id)}
          onSwipe={(dir) => onSwipe(m.id, dir)}
          onFork={() => onFork(m.id)}
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
