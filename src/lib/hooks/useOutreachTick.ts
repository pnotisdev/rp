import { useEffect, useRef } from 'react'
import { charactersApi, chatsApi, instructTemplatesApi, messagesApi, personasApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import { KoboldClient } from '@/lib/api/kobold'
import { evaluateOutreach, generateOutreachMessage } from '@/lib/dating/outreach'
import { resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'

/**
 * ROADMAP.md 10f's "world tick" — the once-per-session check for whether any character should
 * text the player first, unprompted. There's no polling/cron infrastructure anywhere in this
 * codebase (by design, nothing here adds one): a character won't text while the app is closed,
 * only once enough real time has passed AND the app is reopened, so this runs exactly once per
 * mount from `App.tsx`, the one component guaranteed to mount once per session regardless of
 * which view opens first.
 */
export function useOutreachTick() {
  const hasRunRef = useRef(false)
  const baseUrl = useSettingsStore((s) => s.baseUrl)

  useEffect(() => {
    // React StrictMode double-invokes effects in dev; the ref (not a `[]`-dep effect alone)
    // survives that double-invoke on the same mounted instance, so the tick body only ever
    // actually runs once per real session.
    if (hasRunRef.current) return
    hasRunRef.current = true
    void runTick(baseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

async function runTick(baseUrl: string) {
  const now = Date.now()
  let chats: Chat[]
  let characters: Character[]
  try {
    ;[chats, characters] = await Promise.all([chatsApi.list(), charactersApi.list()])
  } catch {
    return // e.g. server unreachable this session — nothing to do, no retry needed until next mount
  }
  const charactersById = new Map(characters.map((c) => [c.id, c]))

  // Cheap in-memory pre-filter — the same conditions `evaluateOutreach` itself gates on, checked
  // here first purely to skip a per-chat network round trip (fetching last message/world/persona)
  // for a chat that's already fully determined to be ineligible from data already in hand.
  const candidates = chats
    .map((chat) => ({ chat, character: charactersById.get(chat.characterId) }))
    .filter(
      (c): c is { chat: Chat; character: Character } =>
        !!c.character && !!c.character.outreach && c.character.outreach.frequency !== 'never' && !c.chat.participants?.length && !c.chat.activeEvent,
    )
  if (candidates.length === 0) return

  const client = new KoboldClient(baseUrl)
  const worldsById = new Map<string, WorldCard | undefined>()
  const customTemplates = await instructTemplatesApi.list().catch(() => [])

  // Sequential, not parallel — this codebase already avoids concurrent generation calls against a
  // local single-GPU KoboldCpp server (see relationshipAssist.ts / useChatSession.ts's runAssist).
  for (const { chat, character } of candidates) {
    let world: WorldCard | undefined
    if (character.worldId) {
      if (!worldsById.has(character.worldId)) {
        worldsById.set(character.worldId, await worldsApi.get(character.worldId).catch(() => undefined))
      }
      world = worldsById.get(character.worldId)
    }

    const messages = await messagesApi.listByChat(chat.id).catch(() => undefined)
    if (!messages) continue
    const lastMessage = messages[messages.length - 1]

    const check = evaluateOutreach({ character, chat, lastMessage, world, now })
    if (check.status === 'skip') continue
    // A roll was attempted either way — persist the bookkeeping so a "no" doesn't get re-rolled
    // again inside the cooldown floor. skipTouch avoids bumping `updatedAt`/reordering ChatsPanel
    // for a chat nothing actually happened in.
    await chatsApi.update(chat.id, { lastOutreachCheckedAt: now, skipTouch: true }).catch(() => {})
    if (!check.eligible || !check.reason) continue

    try {
      const persona = await personasApi.get(chat.personaId).catch(() => undefined)
      const template = resolveInstructTemplate(character.instructTemplateId || useSettingsStore.getState().instructTemplateId, customTemplates)
      const recentHistory = messages.slice(-10).map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      const text = await generateOutreachMessage(client, {
        character,
        chat,
        world,
        personaName: persona?.name || 'You',
        personaDescription: persona?.description || '',
        recentHistory,
        reason: check.reason,
        template,
        sampler: useSettingsStore.getState().sampler,
      })
      if (!text.trim()) continue

      await messagesApi.create({
        id: newId(),
        chatId: chat.id,
        role: 'char',
        name: character.card.name,
        text: text.trim(),
        createdAt: Date.now(),
        initiatedBy: 'character',
      })
      // Read fresh at insert time, not captured at tick-start — the tick is long-running and
      // async across many chats, so the player could open exactly this chat mid-tick.
      const isOpen = useSettingsStore.getState().activeChatId === chat.id
      await chatsApi.update(chat.id, { hasUnreadOutreach: !isOpen })
    } catch {
      // Best-effort background feature (e.g. koboldcpp happened to be off) — fail silently per
      // chat, no toast spam. lastOutreachCheckedAt is already written above, so this won't retry
      // instantly next mount.
    }
  }
}
