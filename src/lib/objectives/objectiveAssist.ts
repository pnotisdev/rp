import { KoboldClient } from '@/lib/api/kobold'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { AiLoreSubject } from '@/lib/characters/aiAssist'

const GENERATE_PARAMS = {
  max_length: 400,
  temperature: 0.7,
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

/** Breaks a user-entered objective into a concrete task list. */
export async function generateTasks(
  client: KoboldClient,
  objectiveTitle: string,
  objectiveDescription: string,
  character: AiLoreSubject,
  count = 4,
): Promise<string[]> {
  const prompt = [
    'You are helping plan a roleplay chat.',
    `Character: ${character.name}${character.description ? ` — ${character.description}` : ''}`,
    `Objective: ${objectiveTitle}${objectiveDescription ? `\n${objectiveDescription}` : ''}`,
    `Break this into ${count} concrete, sequential steps that would plausibly happen in the roleplay on the way to achieving it. Each step should be something that could visibly occur in a scene, not an abstract sub-goal.`,
    `Output ONLY a minified JSON array of ${count} short strings, one per step. No markdown fences, no commentary.`,
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({ ...GENERATE_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt })
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array of tasks')
  return parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
}

/** Proposes a plausible objective for this roleplay, grounded in the character and persona. */
export async function suggestObjective(
  client: KoboldClient,
  character: AiLoreSubject,
  persona: AiLoreSubject,
): Promise<{ title: string; description: string }> {
  const prompt = [
    'You are helping plan a roleplay chat between two participants.',
    `Character: ${character.name}${character.description ? ` — ${character.description}` : ''}${character.personality ? `. Personality: ${character.personality}` : ''}`,
    `User's persona: ${persona.name}${persona.description ? ` — ${persona.description}` : ''}`,
    'Propose one plausible, interesting objective for this roleplay to work toward — something that fits both characters and could develop naturally over several exchanges.',
    'Output ONLY a minified JSON object shaped exactly {"title": "short objective name", "description": "1-2 sentences of context"}. No markdown fences, no commentary.',
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({ ...GENERATE_PARAMS, max_context_length: await client.getEffectiveMaxContext(), prompt })
  const parsed = parseLenientJson(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('Model did not return a JSON object')
  const obj = parsed as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!title) throw new Error('Model did not propose a usable objective')
  return { title, description: typeof obj.description === 'string' ? obj.description.trim() : '' }
}

/**
 * Cheap classifier pass: given the reply that just landed, which pending tasks (by index)
 * does it look like this moment accomplished? Conservative by design — only ever used to
 * check things off automatically, never to invent progress, so a false negative just means
 * the user checks it off by hand later.
 */
export async function detectCompletedTasks(
  client: KoboldClient,
  replyText: string,
  pendingTasks: string[],
): Promise<number[]> {
  if (pendingTasks.length === 0) return []
  const taskList = pendingTasks.map((t, i) => `${i}: ${t}`).join('\n')
  const prompt = [
    'You are tracking task completion in an ongoing roleplay.',
    `The following just happened in the scene:\n${replyText}`,
    `Pending tasks:\n${taskList}`,
    'Which of these tasks, if any, does this moment clearly and unambiguously accomplish? Be conservative — only include a task if it plainly happened, not if it merely became more likely.',
    'Output ONLY a minified JSON array of the completed tasks\' index numbers, e.g. [0,2]. Use [] if none. No commentary.',
    'JSON:',
  ].join('\n\n')

  const text = await client.generate({
    ...GENERATE_PARAMS,
    max_length: 60,
    temperature: 0.2,
    max_context_length: await client.getEffectiveMaxContext(),
    prompt,
  })
  const parsed = parseLenientJson(text)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < pendingTasks.length)
}
