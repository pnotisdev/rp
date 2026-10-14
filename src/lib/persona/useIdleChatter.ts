// Patience timer for drive personas: after her reply, a quick double text sometimes, then she speaks up when the player goes quiet.

import { useEffect, useRef } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, StoredMessage } from '@/lib/types'
import { idlePatienceMs, initialDriveState, wantsFollowUp } from '@/lib/persona/drive'

const FOLLOW_UP_DELAY_MS = [5_000, 9_000]

export function useIdleChatter(opts: {
  chat: Chat | undefined
  character: Character | undefined
  messages: StoredMessage[]
  isGenerating: boolean
  isIdleGenerating: boolean
  draft: string
  /** False while a modal/panel or the VN auto-advance owns the turn. */
  allowed: boolean
  idleTurn: (opts: { silenceMs: number; followUp?: boolean }) => Promise<void>
  interruptIdle: () => Promise<void>
}) {
  const { chat, character, messages, isGenerating, isIdleGenerating, draft, allowed, idleTurn, interruptIdle } = opts
  const config = character?.drive
  const enabled = !!config?.enabled && !!config.idle?.enabled && !!chat && allowed
  const last = messages[messages.length - 1]
  const state = character && chat ? chat.driveStates?.[character.id] : undefined
  const followUpRolledFor = useRef<string | null>(null)

  // Typing over an idle line cuts her off.
  useEffect(() => {
    if (isIdleGenerating && draft.trim()) interruptIdle()
  }, [draft, isIdleGenerating, interruptIdle])

  useEffect(() => {
    if (!enabled || !config || !character || isGenerating || draft.trim()) return
    if (!last || last.role !== 'char' || last.failed || !last.text.trim()) return
    if (document.visibilityState !== 'visible') return
    const s = state ?? initialDriveState(config)
    const maxInARow = config.idle?.maxInARow ?? 2
    if (s.idleInARow >= maxInARow) return

    let followUp = false
    if (followUpRolledFor.current !== last.id) {
      followUpRolledFor.current = last.id
      followUp = wantsFollowUp(s)
    }
    const sinceLast = Date.now() - last.createdAt
    const patience = idlePatienceMs(s, config)
    // A chat reopened long after her last line gets a full fresh wait, not an instant pounce.
    const delay = followUp
      ? FOLLOW_UP_DELAY_MS[0] + Math.random() * (FOLLOW_UP_DELAY_MS[1] - FOLLOW_UP_DELAY_MS[0])
      : sinceLast > 30 * 60_000
        ? patience
        : Math.max(1_000, patience - sinceLast)
    const quietSince = [...messages].reverse().find((m) => m.role === 'user')?.createdAt ?? last.createdAt
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      idleTurn({ silenceMs: Date.now() - quietSince, followUp })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [enabled, config, character, isGenerating, draft, last?.id, last?.text, last?.failed, state?.idleInARow, idleTurn])
}
