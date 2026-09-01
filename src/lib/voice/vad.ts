// Push-to-talk feels like a walkie-talkie, not a friend — this records automatically,
// starting the moment you speak and stopping the moment you go quiet, no held button.

export interface VadRecording {
  /** Stop early by hand (used for barge-in, or a manual "stop listening" tap). */
  stop: () => void
  /** Resolves with the recorded audio once silence is detected (or `stop()` is called, or maxMs is hit). */
  result: Promise<Blob>
}

export interface VadOptions {
  /** How long a quiet stretch has to last after speech before we consider the turn over. */
  silenceMs?: number
  /** Hard cap so a stuck mic can't record forever. */
  maxMs?: number
  /** RMS amplitude (0-1) above which audio counts as "speech". */
  volumeThreshold?: number
}

export async function startVadRecording(opts: VadOptions = {}): Promise<VadRecording> {
  const { silenceMs = 900, maxMs = 20_000, volumeThreshold = 0.02 } = opts

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaStreamSource(stream)
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const timeDomain = new Uint8Array(analyser.fftSize)

  const recorder = new MediaRecorder(stream)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)

  let stopped = false
  let hasSpoken = false
  let silenceStartedAt: number | null = null
  let rafId = 0
  let maxTimer: ReturnType<typeof setTimeout>

  const cleanup = () => {
    cancelAnimationFrame(rafId)
    clearTimeout(maxTimer)
    stream.getTracks().forEach((t) => t.stop())
    audioCtx.close().catch(() => {})
  }

  let stop: () => void = () => {}

  const result = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      cleanup()
      resolve(new Blob(chunks, { type: 'audio/webm' }))
    }

    stop = () => {
      if (stopped) return
      stopped = true
      if (recorder.state === 'recording') recorder.stop()
      else cleanup()
    }

    const tick = () => {
      if (stopped) return
      analyser.getByteTimeDomainData(timeDomain)
      let sumSquares = 0
      for (const byte of timeDomain) {
        const v = (byte - 128) / 128
        sumSquares += v * v
      }
      const rms = Math.sqrt(sumSquares / timeDomain.length)
      const now = performance.now()

      if (rms > volumeThreshold) {
        hasSpoken = true
        silenceStartedAt = null
      } else if (hasSpoken) {
        if (silenceStartedAt === null) silenceStartedAt = now
        else if (now - silenceStartedAt > silenceMs) {
          stop()
          return
        }
      }
      rafId = requestAnimationFrame(tick)
    }

    recorder.start()
    rafId = requestAnimationFrame(tick)
    maxTimer = setTimeout(stop, maxMs)
  })

  return { stop, result }
}
