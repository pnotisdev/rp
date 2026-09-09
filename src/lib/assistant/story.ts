import type { ChatBackend } from '@/lib/api/chatBackend'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { GeneratedStory, GeneratedStoryChapter } from '@/lib/assistant/thread'

/**
 * Long-form story writing, in two phases: plan the whole thing, then write it a chapter at a time.
 *
 * One generation cannot hold a complete multi-chapter story — it runs out of context and, well
 * before that, out of shape: a model asked for "a whole novel" writes a synopsis that accelerates
 * until it is summarising its own ending. Planning first and then writing each chapter against a
 * running account of what has already happened is what keeps chapter nine a chapter rather than a
 * recap, and it is the same "structure first, prose within it" split the scene engine uses.
 */

const OUTLINE_PARAMS = {
  max_length: 900,
  temperature: 0.9,
  top_p: 0.95,
  top_k: 0,
  min_p: 0.05,
  typical: 1,
  tfs: 1,
  rep_pen: 1.05,
  stop_sequence: ['```'],
  trim_stop: true,
}

const CHAPTER_PARAMS = {
  max_length: 1400,
  temperature: 1,
  top_p: 0.95,
  top_k: 0,
  min_p: 0.05,
  typical: 1,
  tfs: 1,
  rep_pen: 1.08,
  rep_pen_range: 2048,
  rep_pen_slope: 0.7,
  stop_sequence: [] as string[],
  trim_stop: true,
}

/** Chapters asked for when the request doesn't say. Enough to be a real story, few enough to finish. */
export const DEFAULT_CHAPTER_COUNT = 6
const MAX_CHAPTER_COUNT = 20

/** How much of the story so far is carried into the next chapter, in characters. */
const RECAP_BUDGET = 2600

/** A chapter count the request named ("in 8 chapters", "a 3 chapter story"), if any. */
export function requestedChapterCount(text: string): number | undefined {
  const match = /\b(?:in|with|about|over)?\s*(\d{1,2})\s*chapters?\b/i.exec(text) ?? /\b(\d{1,2})[- ]chapter\b/i.exec(text)
  if (!match) return undefined
  const n = Number(match[1])
  return n >= 1 && n <= MAX_CHAPTER_COUNT ? n : undefined
}

/** Validates the planning call's JSON into a story skeleton. `undefined` when nothing usable came back. */
export function parseStoryOutline(raw: unknown): Pick<GeneratedStory, 'title' | 'premise' | 'chapters'> | undefined {
  const obj = parseLenientJson(typeof raw === 'string' ? raw : JSON.stringify(raw ?? null))
  if (!obj || typeof obj !== 'object') return undefined
  const record = obj as Record<string, unknown>
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const premise = typeof record.premise === 'string' ? record.premise.trim() : ''
  const rawChapters = Array.isArray(record.chapters) ? record.chapters : []
  const chapters: GeneratedStoryChapter[] = rawChapters
    .map((entry) => {
      if (typeof entry === 'string') return { title: entry.trim() }
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        const t = typeof e.title === 'string' ? e.title.trim() : ''
        // The plan's own one-line intent for the chapter rides along in the title's own field, since
        // it is only ever read back into the chapter prompt.
        const beat = typeof e.beat === 'string' ? e.beat.trim() : typeof e.summary === 'string' ? e.summary.trim() : ''
        return { title: t || beat, beat }
      }
      return { title: '' }
    })
    .filter((c): c is GeneratedStoryChapter & { beat?: string } => !!c.title)
    .slice(0, MAX_CHAPTER_COUNT)
  // A title and at least two chapters, or it isn't a plan for a chaptered story.
  if (!title || chapters.length < 2) return undefined
  return { title, premise, chapters }
}

/** The planning call: a title, a premise, and one line per chapter. */
export async function planStory(
  client: ChatBackend,
  brief: string,
  opts: { chapterCount?: number; styleGuidance?: string; signal?: AbortSignal } = {},
): Promise<Pick<GeneratedStory, 'title' | 'premise' | 'chapters'>> {
  const count = opts.chapterCount ?? DEFAULT_CHAPTER_COUNT
  const prompt = [
    `Plan a complete ${count}-chapter story from this brief:\n${brief.trim()}`,
    opts.styleGuidance?.trim() ? `Writing style to honour throughout: ${opts.styleGuidance.trim()}` : '',
    'Plan the whole arc before writing any of it. Every chapter needs its own turn of events, and the last one has to actually end the story rather than trailing off or promising a sequel.',
    `Return ONLY a minified JSON object: {"title":"the story's title","premise":"two or three sentences on the whole arc, including how it ends","chapters":[ exactly ${count} objects {"title":"the chapter's title","beat":"one sentence on what happens in it and what changes by the end"} ]}`,
    'JSON:',
  ]
    .filter(Boolean)
    .join('\n\n')
  const raw = await generateWithTimeout(client, { prompt, ...OUTLINE_PARAMS, max_context_length: await client.getEffectiveMaxContext() }, 'story outline', opts.signal)
  const parsed = parseStoryOutline(raw)
  if (!parsed) throw new Error("The model didn't return a usable chapter plan. Try again, or rephrase the brief.")
  return parsed
}

/** Everything already written, trimmed to a budget from the most recent end. */
export function storySoFar(chapters: readonly GeneratedStoryChapter[], upToIndex: number): string {
  const written = chapters.slice(0, upToIndex).filter((c) => c.text?.trim())
  if (!written.length) return ''
  const parts: string[] = []
  let spent = 0
  // Newest first: the immediately preceding chapter matters most for continuity, so it survives the
  // trim even when the earlier ones can't.
  for (let i = written.length - 1; i >= 0; i -= 1) {
    const entry = `Chapter ${i + 1}, "${written[i].title}":\n${written[i].text!.trim()}`
    if (spent && spent + entry.length > RECAP_BUDGET) break
    parts.unshift(entry)
    spent += entry.length
  }
  return parts.join('\n\n')
}

/** Writes one chapter against the plan and everything written so far. */
export async function writeChapter(
  client: ChatBackend,
  story: Pick<GeneratedStory, 'title' | 'premise' | 'chapters'>,
  index: number,
  opts: { styleGuidance?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const chapter = story.chapters[index]
  if (!chapter) throw new Error(`There is no chapter ${index + 1} in this plan.`)
  const beat = (chapter as GeneratedStoryChapter & { beat?: string }).beat
  const isLast = index === story.chapters.length - 1
  const soFar = storySoFar(story.chapters, index)
  const prompt = [
    `You are writing "${story.title}", a ${story.chapters.length}-chapter story.`,
    `The whole arc: ${story.premise}`,
    `The full chapter plan:\n${story.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n')}`,
    soFar ? `What has already been written:\n\n${soFar}` : '',
    `Now write chapter ${index + 1}, "${chapter.title}".${beat ? ` What it covers: ${beat}` : ''}`,
    isLast
      ? 'This is the final chapter. End the story properly: resolve what the arc set up, and do not promise a sequel or trail off mid-scene.'
      : 'End the chapter somewhere that pulls the reader on, without summarising what is coming.',
    opts.styleGuidance?.trim() ? `Writing style: ${opts.styleGuidance.trim()}` : '',
    'Write the chapter as prose. Continue the established voice, tense and character names exactly. Do not recap earlier chapters, do not write a chapter heading or title line, and do not add commentary before or after. No em dashes.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const text = await generateWithTimeout(client, { prompt, ...CHAPTER_PARAMS, max_context_length: await client.getEffectiveMaxContext() }, `chapter ${index + 1}`, opts.signal)
  return text.trim()
}
