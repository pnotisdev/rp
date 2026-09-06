import { useState } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { CharacterPlan, Chat, WorldCard } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatFactsApi, chatsApi, relationshipEventsApi, worldsApi } from '@/lib/api/client'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import {
  RELATIONSHIP_DIMENSIONS,
  clampAffection,
  clampStat,
  combinedSceneFlags,
  computeWarmth,
  formatCommitmentStatus,
  formatRelationshipStage,
  getRelationshipStats,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import {
  PHASES,
  advancePhase,
  describeWeather,
  getCalendarInfo,
  getCurrentActivity,
  getMoodOfDay,
  getWeather,
  presenceLabel,
} from '@/lib/world/calendar'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Section } from '@/components/ui/Section'
import { NumberField, SelectField } from '@/components/ui/Field'

const DIMENSION_LABELS: Record<string, string> = {
  affection: 'Affection',
  trust: 'Trust',
  chemistry: 'Chemistry',
  comfort: 'Comfort',
  respect: 'Respect',
  curiosity: 'Curiosity',
  tension: 'Tension',
}

const PLAN_KIND_LABELS: Record<string, string> = {
  personal: 'personal',
  together: 'with the player',
  distance: 'keeping distance',
}

interface DirectorPanelProps {
  chat: Chat
  character?: Character
  world?: WorldCard
  onClose: () => void
}

/**
 * Section 12's "director/debug view" — a read-only inspector over a chat's live state plus manual
 * world-state controls, so iterating on a world doesn't mean playing through it turn by turn every
 * time. Deliberately a power-user layer *on top of* the existing mechanics rather than a new
 * system: every control here goes through the same `chatsApi`/`worldsApi` PUTs and the same
 * deterministic `calendar.ts` reads that the ordinary chat UI already uses (see
 * `RelationshipPanel`/`ChatWindow`'s presence badge) — nothing new is stored.
 */
export function DirectorPanel({ chat, character, world, onClose }: DirectorPanelProps) {
  const affection = clampAffection(chat.affection ?? 0)
  const stats = getRelationshipStats(chat)
  const warmth = computeWarmth(affection, stats)
  const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
  const stage = relationshipStageForWarmth(warmth, milestones)
  const flags = new Set(chat.sceneFlags ?? [])
  const knownFlags = combinedSceneFlags(world?.customSceneFlags)

  const day = world?.currentDay ?? 0
  const phaseIndex = world?.currentPhaseIndex ?? 0
  const calendar = getCalendarInfo(day)
  const weather = world ? getWeather(world.id, day) : undefined
  const mood = character ? getMoodOfDay(character.id, day) : undefined
  const presence = character?.schedule?.length ? getCurrentActivity(character.schedule, day, phaseIndex) : undefined

  const facts = useApiQuery('chat-facts', () => chatFactsApi.listByChat(chat.id), [chat.id]) ?? []
  const recentFacts = facts
    // `typeof f.text === 'string'` guards a malformed row from rendering an object as a React child.
    .filter((f) => f.active && typeof f.text === 'string')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)

  // The primary's persistent agency layer (`dating/plans.ts`). Every field is type-guarded before
  // it reaches JSX — a half-written plan object must never render as a React child (that crash has
  // happened before, with facts).
  const activePlans = (chat.plans ?? []).filter(
    (p): p is CharacterPlan => !!p && typeof p.goal === 'string' && typeof p.kind === 'string',
  )

  const giftCatalog = getGiftCatalog(world)
  const itemCatalog = getItemCatalog(world)

  const [statDraft, setStatDraft] = useState<Record<string, number>>({ affection, ...stats })
  const [advancing, setAdvancing] = useState(false)
  const [applyingStats, setApplyingStats] = useState(false)
  const [grantKind, setGrantKind] = useState<'gift' | 'item'>('gift')
  const [grantId, setGrantId] = useState('')
  const [grantQty, setGrantQty] = useState(1)
  const [granting, setGranting] = useState(false)

  const advanceTime = async () => {
    if (!world) return
    setAdvancing(true)
    try {
      const next = advancePhase(day, phaseIndex)
      await worldsApi.update(world.id, { currentDay: next.day, currentPhaseIndex: next.phaseIndex })
      toastSuccess(`Advanced to ${PHASES[next.phaseIndex]}${next.day !== day ? ', next day' : ''}`)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setAdvancing(false)
    }
  }

  const applyStats = async () => {
    setApplyingStats(true)
    try {
      const nextAffection = clampAffection(statDraft.affection ?? affection)
      const nextStats: Record<string, number> = {}
      const deltas: Partial<Record<string, number>> = {}
      if (nextAffection !== affection) deltas.affection = nextAffection - affection
      for (const dim of RELATIONSHIP_DIMENSIONS) {
        nextStats[dim] = clampStat(statDraft[dim] ?? stats[dim])
        if (nextStats[dim] !== stats[dim]) deltas[dim] = nextStats[dim] - stats[dim]
      }
      await chatsApi.update(chat.id, { affection: nextAffection, relationshipStats: nextStats })
      if (Object.keys(deltas).length > 0) {
        await relationshipEventsApi.create({ chatId: chat.id, reason: 'Director: manual adjustment', deltas })
      }
      toastSuccess('Relationship values updated')
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setApplyingStats(false)
    }
  }

  const toggleFlag = async (id: string) => {
    const next = flags.has(id) ? [...flags].filter((f) => f !== id) : [...flags, id]
    try {
      await chatsApi.update(chat.id, { sceneFlags: next })
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  const grantOptions = grantKind === 'gift' ? giftCatalog : itemCatalog
  const giveItem = async () => {
    if (!grantId || grantQty < 1) return
    setGranting(true)
    try {
      // Reads a fresh copy first, same as `buyGift`/`buyItem`/`useItem` in `useChatSession.ts` —
      // the local `chat` prop can lag behind a mutation made elsewhere while this panel is open.
      const fresh = await chatsApi.get(chat.id)
      if (!fresh) return
      const key = grantKind === 'gift' ? 'giftInventory' : 'itemInventory'
      const inv = { ...(fresh[key] ?? {}) }
      inv[grantId] = (inv[grantId] ?? 0) + grantQty
      await chatsApi.update(chat.id, { [key]: inv })
      toastSuccess(`Granted ${grantQty}× ${grantOptions.find((g) => g.id === grantId)?.name ?? grantId}`)
      setGrantId('')
      setGrantQty(1)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setGranting(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Director view"
      description="A read-only inspector plus manual world-state controls, for testing without playing through it turn by turn."
      size="2xl"
      scrollable
    >
      <div className="grid grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
        <Section title="World & time" surface="sunken" className="md:col-span-2">
          {world ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-text-muted sm:grid-cols-4">
                <div>
                  <span className="text-text capitalize">{calendar.season}</span> day {calendar.dayOfSeason}
                </div>
                <div className="capitalize text-text">{calendar.weekday}</div>
                <div className="capitalize text-text">
                  {PHASES[phaseIndex]}
                  {calendar.holiday ? ` · ${calendar.holiday}` : ''}
                </div>
                <div className="capitalize text-text">{weather ? describeWeather(weather) : '—'}</div>
              </div>
              {character && (
                <p className="mb-3 text-xs text-text-muted">
                  {character.card.name} is feeling <span className="text-text">{mood}</span> today
                  {presence && (
                    <>
                      , currently <span className="text-text">{presenceLabel(presence.status)}</span>
                      {presence.activity && ` — ${presence.activity}`}
                      {presence.location && ` @ ${presence.location}`}
                    </>
                  )}
                  .
                </p>
              )}
              <Button onClick={advanceTime} disabled={advancing}>
                {advancing ? 'Advancing…' : 'Advance to next phase'}
              </Button>
            </>
          ) : (
            <p className="text-xs text-text-muted">
              {character?.card.name ?? 'This character'} isn't bound to a world, so time/weather/mood aren't tracked.
            </p>
          )}
        </Section>

        <Section title="Relationship" surface="sunken" className="md:col-span-2">
          <div className="mb-3 text-xs capitalize text-text-muted">
            {formatRelationshipStage(stage)} · {warmth} warmth · {formatCommitmentStatus(chat.commitmentStatus ?? 'none')}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField
              label="Affection"
              min={0}
              max={100}
              value={statDraft.affection}
              onChange={(e) => setStatDraft((s) => ({ ...s, affection: Number(e.target.value) }))}
            />
            {RELATIONSHIP_DIMENSIONS.map((dim) => (
              <NumberField
                key={dim}
                label={DIMENSION_LABELS[dim]}
                min={0}
                max={100}
                value={statDraft[dim]}
                onChange={(e) => setStatDraft((s) => ({ ...s, [dim]: Number(e.target.value) }))}
              />
            ))}
          </div>
          <Button variant="primary" onClick={applyStats} disabled={applyingStats}>
            {applyingStats ? 'Applying…' : 'Apply values'}
          </Button>
        </Section>

        <Section
          title="Scene flags"
          description="Toggling one is the lightweight stand-in for “trigger an event” — for a full date/event card, use the Event panel instead."
          surface="sunken"
        >
          <div className="flex flex-wrap gap-2">
            {knownFlags.map((f) => (
              <button
                key={f.id}
                onClick={() => toggleFlag(f.id)}
                className={`rounded-lg px-2 py-1 text-xs capitalize transition-colors ${
                  flags.has(f.id) ? 'bg-romance/15 text-romance' : 'bg-bg-elevated text-text-muted hover:text-text'
                }`}
              >
                {f.label}
              </button>
            ))}
            {knownFlags.length === 0 && <span className="text-xs text-text-muted">No flags defined.</span>}
          </div>
        </Section>

        <Section title="Recent memories" surface="sunken">
          <div className="space-y-1.5">
            {recentFacts.map((f) => (
              <div key={f.id} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                <span className="text-text">{f.text}</span>
                <div className="mt-0.5 text-[10px]">
                  {new Date(f.createdAt).toLocaleString()}
                  {f.unresolved
                    ? (f.valence ?? 0) <= -0.15
                      ? ' · unresolved, sits badly'
                      : ' · unresolved, still open'
                    : ''}
                </div>
              </div>
            ))}
            {recentFacts.length === 0 && <span className="text-xs text-text-muted">Nothing remembered yet.</span>}
          </div>
        </Section>

        <Section
          title="Plans"
          description="What the character is quietly working toward on their own, formed and retired by the per-turn judge — read-only."
          surface="sunken"
        >
          <div className="space-y-1.5">
            {activePlans.map((p) => (
              <div key={p.id} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                <span className="text-text">{p.goal}</span>
                <div className="mt-0.5 text-[10px]">
                  {PLAN_KIND_LABELS[p.kind] ?? p.kind}
                  {typeof p.note === 'string' && p.note ? ` · ${p.note}` : ''}
                </div>
              </div>
            ))}
            {activePlans.length === 0 && <span className="text-xs text-text-muted">No active plans.</span>}
          </div>
        </Section>

        <Section
          title="Intimacy scene, pacing & rebuff"
          description="Read-only state from this session's newer relationship-depth systems."
          surface="sunken"
        >
          <div className="space-y-1.5 text-xs text-text-muted">
            <div>
              Intimacy scene:{' '}
              {chat.intimacyScene ? (
                <span className="text-text">
                  {chat.intimacyScene.phase} — {chat.intimacyScene.activityLabel}
                </span>
              ) : (
                'none active'
              )}
            </div>
            <div>
              Initiative balance: <span className="text-text">{(chat.initiativeBalance ?? 0).toFixed(2)}</span>
              {' '}(positive = you've been carrying it, negative = they have)
            </div>
            <div>
              Recent rebuff:{' '}
              {chat.recentRebuff ? (
                <span className="text-text">
                  {chat.recentRebuff.kind} · {chat.recentRebuff.severity} (turn {chat.recentRebuff.startedAtTurn})
                </span>
              ) : (
                'none on record'
              )}
            </div>
          </div>
        </Section>

        <Section
          title="Beliefs, expectations, fear & desire"
          description="What the character has come to think of you, what they've quietly started counting on, what they're privately afraid of, and what deeper drive underlies it all — formed and retired by the per-turn judge, read-only."
          surface="sunken"
        >
          <div className="space-y-1.5">
            <div className="text-xs text-text-muted">
              Fear right now: {chat.currentFear ? <span className="text-text">{chat.currentFear}</span> : 'none on record'}
            </div>
            <div className="text-xs text-text-muted">
              Desire underneath it all: {chat.currentDesire ? <span className="text-text">{chat.currentDesire}</span> : 'none on record'}
            </div>
            <div className="text-xs text-text-muted">
              Reciprocity cue:{' '}
              {chat.reciprocityCue ? (
                <span className="text-text">
                  {chat.reciprocityCue.reason} (turn {chat.reciprocityCue.startedAtTurn})
                </span>
              ) : (
                'none on record'
              )}
            </div>
            {(chat.beliefsAboutUser ?? []).map((b) => (
              <div key={b.id} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                <span className="text-text">{b.text}</span>
                <div className="mt-0.5 text-[10px]">belief · formed turn {b.formedTurn}</div>
              </div>
            ))}
            {(chat.expectationsOfUser ?? []).map((e) => (
              <div key={e.id} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                <span className="text-text">{e.text}</span>
                <div className="mt-0.5 text-[10px]">
                  expectation{typeof e.note === 'string' && e.note ? ` · ${e.note}` : ''}
                </div>
              </div>
            ))}
            {(chat.beliefsAboutUser ?? []).length === 0 && (chat.expectationsOfUser ?? []).length === 0 && (
              <span className="text-xs text-text-muted">Nothing formed yet.</span>
            )}
          </div>
        </Section>

        <Section
          title="Hand over an item"
          description="A direct inventory grant for testing — doesn't send a chat message the way giving a gift in-scene does."
          surface="sunken"
          className="md:col-span-2"
        >
          {giftCatalog.length === 0 && itemCatalog.length === 0 ? (
            <p className="text-xs text-text-muted">This world has no gift or item catalog.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <SelectField
                label="Kind"
                value={grantKind}
                onChange={(e) => {
                  setGrantKind(e.target.value as 'gift' | 'item')
                  setGrantId('')
                }}
                className="mb-0 w-28"
              >
                <option value="gift">Gift</option>
                <option value="item">Item</option>
              </SelectField>
              <SelectField
                label={grantKind === 'gift' ? 'Gift' : 'Item'}
                value={grantId}
                onChange={(e) => setGrantId(e.target.value)}
                className="mb-0 min-w-[10rem] flex-1"
              >
                <option value="">Choose one…</option>
                {grantOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
              <NumberField
                label="Qty"
                min={1}
                value={grantQty}
                onChange={(e) => setGrantQty(Math.max(1, Number(e.target.value)))}
                className="mb-0 w-20"
              />
              <Button onClick={giveItem} disabled={!grantId || granting}>
                {granting ? 'Giving…' : 'Give'}
              </Button>
            </div>
          )}
        </Section>
      </div>
    </Modal>
  )
}
