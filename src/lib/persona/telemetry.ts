// Real app facts a self-aware character may cite: time away, context fill, rerolls, speed. Only notable ones, to keep the tail short.

import { formatSilence } from '@/lib/persona/drive'

export interface TelemetryInput {
  userName: string
  now: number
  /** Gap before the player's latest message, ms. */
  userGapMs?: number
  /** Context fill 0..1 of the last prompt. */
  fill?: number
  /** Old messages were just folded into the summary. */
  justFolded?: boolean
  /** 0-based swipe index of the reply being written. */
  swipeIndex?: number
  tokensPerSec?: number
  messageCount: number
  /** Player's local time. */
  date: Date
  /** Mention the clock this turn (night, a return, a fresh session). */
  clock?: boolean
  modelName?: string
  /** A human character: only the clock, time away and message milestones. */
  human?: boolean
}

const MILESTONES = [50, 100, 200, 250, 300, 400, 500, 750, 1000]

function clockLabel(d: Date, userName: string): string {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const part = h < 5 ? 'middle of the night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'
  return `it's ${h}:${m} (${part}) for ${userName}`
}

export function describeTelemetry(t: TelemetryInput): string[] {
  const out: string[] = t.clock ? [clockLabel(t.date, t.userName)] : []
  if (t.userGapMs !== undefined && t.userGapMs > 10 * 60_000) out.push(`${t.userName} was away ${formatSilence(t.userGapMs)} before this message`)
  if (t.human) {
    const m = MILESTONES.find((n) => t.messageCount >= n && t.messageCount < n + 2)
    if (m) out.push(`this chat just passed ${m} messages`)
    return out
  }
  if (t.justFolded) out.push('older messages were just folded into her summary notes, so details from before are fuzzy now')
  else if (t.fill !== undefined && t.fill >= 0.8) out.push(`her context window is ${Math.round(t.fill * 100)}% full, a fold is coming`)
  if (t.swipeIndex !== undefined && t.swipeIndex >= 1) out.push(`${t.userName} rerolled her reply, this is draft ${t.swipeIndex + 1}`)
  if (t.tokensPerSec !== undefined && t.tokensPerSec > 0 && t.tokensPerSec < 12) out.push(`the GPU is slow today (${t.tokensPerSec} tokens/s)`)
  const milestone = MILESTONES.find((m) => t.messageCount >= m && t.messageCount < m + 2)
  if (milestone) out.push(`this chat just passed ${milestone} messages`)
  if (t.modelName) out.push(`she is running on ${t.modelName}`)
  return out
}
