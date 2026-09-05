import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { detectCompletedTasks, generateTasks, suggestObjective } from './objectiveAssist'

function stubClient(reply: string, spy?: (p: Record<string, unknown>) => void): ChatBackend {
  return {
    generate: async (p) => {
      spy?.(p as unknown as Record<string, unknown>)
      return reply
    },
    generateStream: async () => '',
    getEffectiveMaxContext: async () => 4096,
    tokenCount: async () => ({ count: 0 }),
    abort: async () => {},
    getChatTemplate: async () => null,
  }
}

const CHARACTER = { name: 'Mira', description: 'A quiet librarian.' }
const PERSONA = { name: 'You', description: 'A regular at the library.' }

describe('generateTasks', () => {
  it('parses a JSON array of steps into a task list', async () => {
    const tasks = await generateTasks(stubClient('["Find the key", "Open the door", "Enter the room"]'), 'Get inside', '', CHARACTER, 3)
    expect(tasks).toEqual(['Find the key', 'Open the door', 'Enter the room'])
  })

  it('drops non-string and blank entries', async () => {
    const tasks = await generateTasks(stubClient('["Real step", "", "  ", 42, null]'), 'Objective', '', CHARACTER)
    expect(tasks).toEqual(['Real step'])
  })

  it('throws when the model does not return a JSON array', async () => {
    await expect(generateTasks(stubClient('{"not": "an array"}'), 'Objective', '', CHARACTER)).rejects.toThrow(
      'Model did not return a JSON array of tasks',
    )
  })

  it('includes the objective title, description, and character in the prompt', async () => {
    let sent: Record<string, unknown> = {}
    await generateTasks(stubClient('[]', (p) => (sent = p)), 'Find the cat', 'It ran off yesterday', CHARACTER, 5)
    expect(sent.prompt).toContain('Find the cat')
    expect(sent.prompt).toContain('It ran off yesterday')
    expect(sent.prompt).toContain('Mira')
    expect(sent.prompt).toContain('A quiet librarian.')
    expect(sent.prompt).toContain('5 concrete')
  })
})

describe('suggestObjective', () => {
  it('returns the proposed title and description', async () => {
    const idea = await suggestObjective(stubClient('{"title":"Find the missing satchel","description":"Mira lost it at the fair."}'), CHARACTER, PERSONA)
    expect(idea).toEqual({ title: 'Find the missing satchel', description: 'Mira lost it at the fair.' })
  })

  it('defaults description to an empty string when absent', async () => {
    const idea = await suggestObjective(stubClient('{"title":"A goal"}'), CHARACTER, PERSONA)
    expect(idea).toEqual({ title: 'A goal', description: '' })
  })

  it('throws when the model returns no usable title', async () => {
    await expect(suggestObjective(stubClient('{"title":"   "}'), CHARACTER, PERSONA)).rejects.toThrow(
      'Model did not propose a usable objective',
    )
    // A bare JSON number is valid JSON (so parseLenientJson returns it rather than throwing) but
    // isn't the object shape this function needs — exercises its own guard, not jsonRepair's.
    await expect(suggestObjective(stubClient('42'), CHARACTER, PERSONA)).rejects.toThrow('Model did not return a JSON object')
  })

  it('throws jsonRepair\'s own error when the reply has no JSON in it at all', async () => {
    await expect(suggestObjective(stubClient('not json'), CHARACTER, PERSONA)).rejects.toThrow(
      'No JSON object found in model output',
    )
  })
})

describe('detectCompletedTasks', () => {
  const pending = ['Find the key', 'Open the door', 'Enter the room']

  it('returns no request at all when there are no pending tasks', async () => {
    const spy = vi.fn()
    expect(await detectCompletedTasks(stubClient('[0]', spy), 'Anything happens', [])).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns the completed task indices the model names', async () => {
    expect(await detectCompletedTasks(stubClient('[0,2]'), 'He grabs the key and enters the room', pending)).toEqual([0, 2])
  })

  it('filters out indices that are out of range, non-integer, or the wrong type', async () => {
    expect(await detectCompletedTasks(stubClient('[0, 99, 1.5, "2", -1, 2]'), 'text', pending)).toEqual([0, 2])
  })

  it('degrades to [] when the model reply parses but is not a JSON array', async () => {
    expect(await detectCompletedTasks(stubClient('{"none": true}'), 'text', pending)).toEqual([])
  })

  it('lists the pending tasks by index in the prompt', async () => {
    let sent: Record<string, unknown> = {}
    await detectCompletedTasks(stubClient('[]', (p) => (sent = p)), 'A reply', pending)
    expect(sent.prompt).toContain('0: Find the key')
    expect(sent.prompt).toContain('2: Enter the room')
  })
})

describe('timeout handling', () => {
  // Same live-confirmed failure mode `relationshipAssist.ts`'s `generateWithTimeout` exists for:
  // a provider response that simply never resolves used to leave the awaiting caller — here,
  // `ObjectivePanel`'s "Suggest one for me" / "Generate tasks with AI" buttons — stuck forever
  // with no error and no way to retry.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function hangingClient(onAbort: () => void): ChatBackend {
    return {
      generate: (_p, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            onAbort()
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
      generateStream: async () => '',
      getEffectiveMaxContext: async () => 4096,
      tokenCount: async () => ({ count: 0 }),
      abort: async () => {},
      getChatTemplate: async () => null,
    }
  }

  it('generateTasks aborts and rejects with a clear message once the backend never responds', async () => {
    let aborted = false
    const pending = generateTasks(hangingClient(() => (aborted = true)), 'Objective', '', CHARACTER)
    const assertion = expect(pending).rejects.toThrow(/Generate tasks timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
    expect(aborted).toBe(true)
  })

  it('suggestObjective aborts and rejects with a clear message once the backend never responds', async () => {
    const pending = suggestObjective(hangingClient(() => {}), CHARACTER, PERSONA)
    const assertion = expect(pending).rejects.toThrow(/Suggest objective timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('detectCompletedTasks aborts and rejects with a clear message once the backend never responds', async () => {
    const pending = detectCompletedTasks(hangingClient(() => {}), 'text', ['a task'])
    const assertion = expect(pending).rejects.toThrow(/Detect completed tasks timed out after 45s/)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('does not time out when the backend answers well within the window', async () => {
    await expect(generateTasks(stubClient('["ok"]'), 'Objective', '', CHARACTER)).resolves.toEqual(['ok'])
  })

  it('surfaces a real, non-timeout error as itself', async () => {
    const client: ChatBackend = {
      generate: async () => {
        throw new Error('Chat completion failed (429): Provider returned error')
      },
      generateStream: async () => '',
      getEffectiveMaxContext: async () => 4096,
      tokenCount: async () => ({ count: 0 }),
      abort: async () => {},
      getChatTemplate: async () => null,
    }
    await expect(generateTasks(client, 'Objective', '', CHARACTER)).rejects.toThrow(/429/)
  })
})
