// Plays short lines in order, synthesizing upcoming ones while the current one plays so texts are read back to back.

export type Synthesize = (text: string, signal: AbortSignal) => Promise<Blob>

interface Item {
  blob: Promise<Blob | null>
}

let queue: Item[] = []
let epoch = 0
let running = false
let controller = new AbortController()
let current: { audio: HTMLAudioElement; done: () => void } | null = null
let onError: ((e: unknown) => void) | null = null

/** One handler for synthesis failures (bad key, no quota), so a burst doesn't toast per bubble. */
export function setSpeechErrorHandler(handler: ((e: unknown) => void) | null): void {
  onError = handler
}

export function enqueueSpeech(text: string, synthesize: Synthesize): void {
  if (!text.trim()) return
  const signal = controller.signal
  const blob = synthesize(text, signal).catch((e) => {
    if (!signal.aborted) onError?.(e)
    return null
  })
  queue.push({ blob })
  if (!running) void drain(epoch)
}

async function drain(myEpoch: number): Promise<void> {
  running = true
  while (queue.length && myEpoch === epoch) {
    const item = queue.shift()!
    const blob = await item.blob
    if (!blob || myEpoch !== epoch) continue
    const url = URL.createObjectURL(blob)
    await new Promise<void>((resolve) => {
      const audio = new Audio(url)
      const done = () => {
        if (current?.audio === audio) current = null
        resolve()
      }
      current = { audio, done }
      audio.onended = done
      audio.onerror = done
      audio.play().catch(done)
    })
    URL.revokeObjectURL(url)
  }
  if (myEpoch === epoch) running = false
}

/** Cuts off whatever is playing and drops everything queued. */
export function stopSpeech(): void {
  epoch++
  controller.abort()
  controller = new AbortController()
  queue = []
  const playing = current
  current = null
  playing?.audio.pause()
  playing?.done()
  running = false
}

export function isSpeaking(): boolean {
  return running
}
