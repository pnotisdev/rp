import { useEffect, useMemo, useRef, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi } from '@/lib/api/client'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { transcribeAudio } from '@/lib/voice/stt'
import { synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { startVadRecording, type VadRecording } from '@/lib/voice/vad'
import { extractCompleteSentences } from '@/lib/voice/sentenceChunker'
import { toSpeakableText } from '@/lib/voice/speakableText'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { BgmPlayer } from '@/components/chat/BgmPlayer'
import { useAudioDuckStore } from '@/lib/store/useAudioDuckStore'

type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening…',
  transcribing: 'Making out what you said…',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap to interrupt',
  error: 'Something went wrong',
}

export function CompanionView() {
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const [chatId, setChatId] = useState<string | null>(null)

  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const ttsApiKey = useSettingsStore((s) => s.ttsApiKey)
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)

  const { character, persona, world, messages, isGenerating, streamingText, sendUserMessage, abortGeneration } =
    useChatSession(chatId)

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  // Duck the background music (if any) while a spoken line is playing.
  const setAudioDucked = useAudioDuckStore((s) => s.setDucked)
  useEffect(() => {
    setAudioDucked(phase === 'speaking')
    return () => setAudioDucked(false)
  }, [phase, setAudioDucked])

  const vadRef = useRef<VadRecording | null>(null)
  const wasGeneratingRef = useRef(false)
  const consumedLengthRef = useRef(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speechQueueRef = useRef<string[]>([])
  const isPumpingRef = useRef(false)
  const speechEpochRef = useRef(0)
  const pendingResolveRef = useRef<(() => void) | null>(null)

  const charFor = (id: string) => characters.find((c) => c.id === id)

  // Cuts off whatever is currently playing/queued — used for barge-in and for switching chats.
  const stopSpeaking = () => {
    speechEpochRef.current += 1
    speechQueueRef.current = []
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    pendingResolveRef.current?.()
    pendingResolveRef.current = null
  }

  // Speaks the queue one chunk at a time. Safe to call repeatedly — it's a no-op while already running.
  const pumpSpeechQueue = async () => {
    if (isPumpingRef.current) return
    isPumpingRef.current = true
    const epoch = speechEpochRef.current
    try {
      while (speechQueueRef.current.length > 0) {
        const text = speechQueueRef.current.shift()!
        setPhase('speaking')
        setError(null)
        let blob: Blob
        try {
          blob = await synthesizeSpeech(
            {
              provider: character?.voice?.provider ?? ttsProvider,
              apiKey: ttsApiKey,
              baseUrl: ttsBaseUrl,
              region: ttsRegion,
              voice: character?.voice?.voiceId || ttsVoice,
            },
            text,
            baseUrl,
          )
        } catch (e) {
          if (epoch !== speechEpochRef.current) break
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
          speechQueueRef.current = []
          break
        }
        if (epoch !== speechEpochRef.current) break

        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        await new Promise<void>((resolve) => {
          pendingResolveRef.current = resolve
          audio.onended = () => resolve()
          audio.onerror = () => resolve()
          audio.play().catch(() => resolve())
        })
        pendingResolveRef.current = null
        URL.revokeObjectURL(url)
        if (audioRef.current === audio) audioRef.current = null
      }
    } finally {
      isPumpingRef.current = false
    }
    if (epoch === speechEpochRef.current) {
      setPhase((p) => (p === 'speaking' ? 'idle' : p))
    }
  }

  const enqueueSpeech = (text: string) => {
    const speakable = toSpeakableText(text)
    if (!speakable) return
    speechQueueRef.current.push(speakable)
    pumpSpeechQueue()
  }

  // While the reply is still streaming in, speak each finished sentence as soon as it lands
  // instead of waiting for the whole thing — this is what makes it feel like it's talking as it thinks.
  useEffect(() => {
    if (!isGenerating) return
    const { chunks, consumedLength } = extractCompleteSentences(streamingText, consumedLengthRef.current)
    consumedLengthRef.current = consumedLength
    chunks.forEach(enqueueSpeech)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingText, isGenerating])

  // Generation just finished — speak whatever tail text hasn't been chunked out yet, then reset for next turn.
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      const last = messages[messages.length - 1]
      if (last && last.role === 'char') {
        const tail = last.text.slice(consumedLengthRef.current)
        if (tail.trim()) enqueueSpeech(tail)
      }
      consumedLengthRef.current = 0
    }
    wasGeneratingRef.current = isGenerating
    if (isGenerating) setPhase('thinking')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, messages])

  const startListening = async () => {
    setError(null)
    let rec: VadRecording
    try {
      rec = await startVadRecording()
    } catch {
      setError('Could not access the microphone — check your browser permissions.')
      setPhase('error')
      return
    }
    vadRef.current = rec
    setPhase('listening')
    try {
      const blob = await rec.result
      vadRef.current = null
      if (blob.size < 500) {
        setPhase('idle')
        return
      }
      setPhase('transcribing')
      const text = await transcribeAudio(baseUrl, blob)
      if (!text) {
        setPhase('idle')
        return
      }
      setPhase('thinking')
      await sendUserMessage(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  // One button, every phase: tap to start listening, tap again to stop early, or tap to
  // barge in — cutting off whatever it's saying/thinking and handing the turn back to you.
  const handleMicTap = async () => {
    if (phase === 'transcribing') return
    if (phase === 'listening') {
      vadRef.current?.stop()
      return
    }
    stopSpeaking()
    if (isGenerating) abortGeneration()
    await startListening()
  }

  // Leaving the chat mid-turn shouldn't leave audio playing or a recording dangling.
  const switchChat = () => {
    vadRef.current?.stop()
    stopSpeaking()
    setPhase('idle')
    setError(null)
    setChatId(null)
  }

  useEffect(() => {
    return () => {
      vadRef.current?.stop()
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recentTurns = useMemo(() => messages.slice(-6), [messages])

  if (!chatId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="font-mono text-3xl text-text-muted">))</span>
        <p className="text-xl font-medium text-text">Pick who to talk to</p>
        <p className="max-w-sm text-sm text-text-muted">
          The Companion talks out loud instead of typing — it uses an existing chat, so memory and
          personality carry over exactly like text mode.
        </p>
        <select
          onChange={(e) => setChatId(e.target.value || null)}
          defaultValue=""
          className="w-full max-w-xs rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
        >
          <option value="">Select a chat…</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {charFor(c.characterId)?.card.name ?? c.title} — {c.title}
            </option>
          ))}
        </select>
        {chats.length === 0 && (
          <p className="text-xs text-text-muted">No chats yet — start one in Chat mode first.</p>
        )}
      </div>
    )
  }

  const busy = phase !== 'idle' && phase !== 'error'
  const micDisabled = phase === 'transcribing'

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <BgmPlayer world={world} />
      <button
        onClick={switchChat}
        className="absolute left-8 top-8 font-mono text-xs text-text-muted hover:text-text"
      >
        ← switch
      </button>

      {character?.avatarDataUrl ? (
        <img src={character.avatarDataUrl} className="h-40 w-40 rounded-3xl object-cover themed-shadow" />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded-3xl bg-bg-elevated text-4xl text-text-muted themed-shadow">
          {(character?.card.name ?? '?').slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="text-center">
        <div className="text-lg font-semibold text-text">{character?.card.name}</div>
        <div className="text-xs text-text-muted">as {persona?.name ?? 'You'}</div>
      </div>

      <div className="flex items-center gap-2 text-sm text-text-muted">
        {busy && <Spinner className="text-accent" />}
        <span>{error ?? PHASE_LABEL[phase]}</span>
      </div>

      <button
        onClick={handleMicTap}
        disabled={micDisabled}
        aria-label={PHASE_LABEL[phase]}
        className={`flex h-24 w-24 items-center justify-center rounded-full font-mono text-2xl transition-transform active:scale-95 ${
          phase === 'listening'
            ? 'bg-danger text-white animate-pulse'
            : 'bg-gradient-to-b from-accent to-accent/85 text-accent-text'
        } disabled:opacity-50`}
      >
        {phase === 'listening' ? '■' : '((•))'}
      </button>

      {recentTurns.length > 0 && (
        <div className="mt-4 w-full max-w-md space-y-1.5 text-center">
          {recentTurns.map((m) => (
            <p key={m.id} className="text-xs text-text-muted">
              <span className="text-text">{m.name}:</span> {m.text.slice(0, 140)}
            </p>
          ))}
        </div>
      )}

      {phase === 'error' && (
        <Button
          variant="ghost"
          onClick={() => {
            setPhase('idle')
            setError(null)
          }}
        >
          Dismiss
        </Button>
      )}
    </div>
  )
}
