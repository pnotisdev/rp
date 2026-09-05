import type { ChatMessage } from '@/lib/prompt/builder'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { ChoiceOption } from '@/lib/types'

const GENERATE_PARAMS = {
  max_length: 250,
  temperature: 0.95,
  top_p: 0.95,
  top_k: 0,
  min_p: 0.05,
  typical: 1,
  tfs: 1,
  rep_pen: 1.1,
  rep_pen_range: 1024,
  rep_pen_slope: 0.7,
  stop_sequence: ['\n\n\n', '```'],
  trim_stop: true,
}

function renderContext(history: ChatMessage[], charName: string, userName: string, depth: number): string {
  return history
    .slice(-depth)
    .filter((m) => m.text.trim())
    .map((m) => `${m.role === 'user' ? userName : charName}: ${m.text}`)
    .join('\n')
}

/**
 * Proposes a few distinct directions the user could take next — the multiple-choice prompt shown
 * after a reply lands, so picking one nudges the scene forward instead of staring at a blank composer.
 */
export async function generateChoices(
  client: ChatBackend,
  params: {
    history: ChatMessage[]
    charName: string
    userName: string
    count?: number
    availableGifts?: { id: string; name: string; quantity: number }[]
  },
): Promise<ChoiceOption[]> {
  const count = params.count ?? 3
  const context = renderContext(params.history, params.charName, params.userName, 8)
  const prompt = [
    'You are brainstorming what a roleplay participant could say or do next, to help them pick a direction.',
    `Recent scene:\n${context}`,
    params.availableGifts?.length
      ? `Available gifts the user can actually give now: ${params.availableGifts.map((g) => `${g.id} (${g.name}) x${g.quantity}`).join(', ')}`
      : 'No gifts are currently available to give.',
    `Propose ${count} short, distinct options for what ${params.userName} could say or do next. Each should take a different tone or approach from the others.`,
    `Output ONLY a minified JSON array of ${count} objects with this exact shape: {"kind":"line|action|gift","label":"short button text","text":"the actual line or action to send as the user's turn","giftId":"required for kind=gift","giftName":"optional"}.`,
    `At most one option may have kind="gift", and only when a gift exists in the available list above. No markdown fences, no commentary.`,
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({ ...GENERATE_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt })
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) return []
  const options: ChoiceOption[] = []
  let giftCount = 0
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    const kind = obj.kind === 'action' || obj.kind === 'gift' ? obj.kind : 'line'
    if (kind === 'gift') {
      giftCount += 1
      if (giftCount > 1) continue
    }
    const label = typeof obj.label === 'string' ? obj.label.trim() : ''
    const textValue = typeof obj.text === 'string' ? obj.text.trim() : ''
    if (!label || !textValue) continue
    const giftId = typeof obj.giftId === 'string' ? obj.giftId.trim() : undefined
    if (kind === 'gift' && !giftId) continue
    options.push({
      id: `choice-${options.length}-${Date.now()}`,
      kind,
      label,
      text: textValue,
      giftId,
      giftName: kind === 'gift' && typeof obj.giftName === 'string' ? obj.giftName.trim() : undefined,
    })
    if (options.length >= count) break
  }
  return options
}
