import { useCallback, useEffect, useRef, useState } from 'react'
import { extractVoiceFeatures } from '../lib/voiceFeatures'
import {
  stripWakePhrase,
  wakePhraseMatches,
} from '../lib/voiceNormalize'
import {
  findBestVoiceMatch,
  VOICE_LIVE_MATCH_THRESHOLD,
  type NamedVoiceProfile,
} from '../lib/voiceProfile'

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

type SpeechRecognitionInstance = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionResultEvent = {
  resultIndex: number
  results: {
    [index: number]: {
      [index: number]: { transcript: string }
      isFinal?: boolean
      length: number
    }
    length: number
  }
}

type SpeechRecognitionErrorEvent = {
  error: string
}

export type VoiceAssistantPhase = 'off' | 'ouvindo' | 'armado' | 'conversando' | 'executando'

const ARMED_TIMEOUT_MS = 12000
const CONVERSATION_TIMEOUT_MS = 120000
const AUDIO_BUFFER_MS = 9000
const SILENCE_AFTER_SPEECH_MS = 2800
const POST_TTS_DELAY_MS = 1100
const TTS_ECHO_GUARD_MS = 1400
const CONVERSATION_WATCHDOG_MS = 5000
const REC_START_RETRY_DELAYS_MS = [0, 280, 650, 1200] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readIncrementalTranscript(ev: SpeechRecognitionResultEvent): {
  interim: string
  final: string
  combined: string
} {
  const interimParts: string[] = []
  const finalParts: string[] = []

  for (let i = 0; i < ev.results.length; i++) {
    const result = ev.results[i]
    if (!result?.length) continue

    let best = result[0]?.transcript ?? ''
    for (let a = 1; a < result.length; a++) {
      const alt = result[a]?.transcript ?? ''
      if (alt.length > best.length) best = alt
    }
    const text = best.trim()
    if (!text) continue

    if (result.isFinal) finalParts.push(text)
    else interimParts.push(text)
  }

  const final = finalParts.join(' ').trim()
  const interim = interimParts.join(' ').trim()
  const combined = [final, interim].filter(Boolean).join(' ').trim()
  return { interim, final, combined }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function createRecognitionInstance(continuous = false): SpeechRecognitionInstance | null {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'pt-BR'
  rec.interimResults = true
  rec.maxAlternatives = 5
  rec.continuous = continuous
  return rec
}

type Options = {
  enabled: boolean
  wakePhrase: string
  voiceProfiles: NamedVoiceProfile[]
  requireVoiceMatch: boolean
  interactive?: boolean
  onCommandText: (text: string) => void
  onConversationStart?: () => Promise<void>
  onConversationUtterance?: (text: string) => Promise<boolean>
  onError?: (message: string) => void
  onVoiceRecognized?: (profile: { id: string; name: string }) => void
}

export function useVoiceAssistant({
  enabled,
  wakePhrase,
  voiceProfiles,
  requireVoiceMatch,
  interactive = true,
  onCommandText,
  onConversationStart,
  onConversationUtterance,
  onError,
  onVoiceRecognized,
}: Options) {
  const [supported, setSupported] = useState(false)
  const [phase, setPhase] = useState<VoiceAssistantPhase>('off')
  const [liveText, setLiveText] = useState('')
  const [lastHint, setLastHint] = useState<string | null>(null)

  const recRef = useRef<SpeechRecognitionInstance | null>(null)
  const runningRef = useRef(false)
  const armedRef = useRef(false)
  const conversingRef = useRef(false)
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedBufferRef = useRef('')
  const armedInterimRef = useRef('')
  const listeningBufferRef = useRef('')
  const sessionAccumRef = useRef('')
  const onCommandTextRef = useRef(onCommandText)
  const onConversationStartRef = useRef(onConversationStart)
  const onConversationUtteranceRef = useRef(onConversationUtterance)
  const onErrorRef = useRef(onError)
  const onVoiceRecognizedRef = useRef(onVoiceRecognized)
  const interactiveRef = useRef(interactive)
  const wakePhraseRef = useRef(wakePhrase)
  const voiceProfilesRef = useRef(voiceProfiles)
  const requireVoiceMatchRef = useRef(requireVoiceMatch)
  const stopRecognitionRef = useRef<() => void>(() => {})
  const scheduleRecognitionRestartRef = useRef<(mode?: 'soft' | 'hard') => void>(() => {})
  const restartingRef = useRef(false)
  const processingUtteranceRef = useRef(false)
  const ttsHoldRef = useRef(false)
  const ttsEchoGuardUntilRef = useRef(0)
  const localSpeechHoldRef = useRef(0)
  const pausedForLocalSpeechRef = useRef(false)
  const enabledRef = useRef(enabled)

  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<{ data: Blob; ts: number }[]>([])
  const audioHeaderChunkRef = useRef<Blob | null>(null)

  useEffect(() => {
    onCommandTextRef.current = onCommandText
  }, [onCommandText])

  useEffect(() => {
    onConversationStartRef.current = onConversationStart
  }, [onConversationStart])

  useEffect(() => {
    onConversationUtteranceRef.current = onConversationUtterance
  }, [onConversationUtterance])

  useEffect(() => {
    interactiveRef.current = interactive
  }, [interactive])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onVoiceRecognizedRef.current = onVoiceRecognized
  }, [onVoiceRecognized])

  useEffect(() => {
    wakePhraseRef.current = wakePhrase
  }, [wakePhrase])

  useEffect(() => {
    voiceProfilesRef.current = voiceProfiles
  }, [voiceProfiles])

  useEffect(() => {
    requireVoiceMatchRef.current = requireVoiceMatch
  }, [requireVoiceMatch])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const clearArmedTimer = useCallback(() => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current)
      armedTimerRef.current = null
    }
  }, [])

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const clearListeningBuffers = useCallback(() => {
    armedBufferRef.current = ''
    armedInterimRef.current = ''
    listeningBufferRef.current = ''
    sessionAccumRef.current = ''
    setLiveText('')
  }, [])

  const stopAudioCapture = useCallback(() => {
    audioRecorderRef.current?.stop()
    audioRecorderRef.current = null
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current = null
    audioChunksRef.current = []
    audioHeaderChunkRef.current = null
  }, [])

  const startAudioCapture = useCallback(async () => {
    stopAudioCapture()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      audioStreamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return
        const ts = Date.now()
        if (audioChunksRef.current.length === 0) {
          audioHeaderChunkRef.current = e.data
        }
        audioChunksRef.current.push({ data: e.data, ts })
        if (audioChunksRef.current.length === 1) return

        const cutoff = ts - AUDIO_BUFFER_MS
        const first = audioChunksRef.current[0]
        const rest = audioChunksRef.current.slice(1).filter((c) => c.ts >= cutoff)
        audioChunksRef.current = [first, ...rest]
      }
      recorder.start(400)
      audioRecorderRef.current = recorder
    } catch {
      onErrorRef.current?.('Não foi possível acessar o microfone para verificação de voz.')
    }
  }, [stopAudioCapture])

  const scheduleVoiceCaptureIfNeeded = useCallback(() => {
    // MediaRecorder + SpeechRecognition no mesmo microfone quebra a escuta no Windows.
    // Só grava áudio no modo passivo (antes da frase de ativação).
    if (armedRef.current || conversingRef.current) {
      stopAudioCapture()
      return
    }
    if (!requireVoiceMatchRef.current || voiceProfilesRef.current.length === 0) {
      stopAudioCapture()
      return
    }
    void startAudioCapture()
  }, [startAudioCapture, stopAudioCapture])

  const tryStartRecognition = useCallback(async (rec: SpeechRecognitionInstance): Promise<boolean> => {
    for (const delayMs of REC_START_RETRY_DELAYS_MS) {
      if (delayMs > 0) await sleep(delayMs)
      try {
        rec.start()
        return true
      } catch {
        /* Chrome/Edge às vezes rejeita start() logo após TTS ou abort() */
      }
    }
    return false
  }, [])

  const getRecentAudioBlob = useCallback((): Blob | null => {
    const chunks = audioChunksRef.current
    if (chunks.length === 0) return null
    const type = chunks[0]?.data.type || audioHeaderChunkRef.current?.type || 'audio/webm'
    return new Blob(
      chunks.map((c) => c.data),
      { type },
    )
  }, [])

  const flushAudioForVerification = useCallback(async (): Promise<Blob | null> => {
    const recorder = audioRecorderRef.current
    if (recorder?.state === 'recording') {
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        const onData = (e: BlobEvent) => {
          if (e.data.size === 0) return
          const ts = Date.now()
          if (audioChunksRef.current.length === 0) {
            audioHeaderChunkRef.current = e.data
          }
          audioChunksRef.current.push({ data: e.data, ts })
        }
        recorder.addEventListener('dataavailable', onData, { once: true })
        try {
          recorder.requestData()
        } catch {
          finish()
          return
        }
        setTimeout(finish, 120)
      })
    }
    return getRecentAudioBlob()
  }, [getRecentAudioBlob])

  const verifyRegisteredVoice = useCallback(async (): Promise<boolean> => {
    const profiles = voiceProfilesRef.current
    if (!requireVoiceMatchRef.current || profiles.length === 0) return true

    const blob = await flushAudioForVerification()
    if (!blob || blob.size < 200) {
      onErrorRef.current?.(
        'Áudio insuficiente para verificar a voz. Aguarde 1 segundo e fale "ok estoque" de novo.',
      )
      return false
    }

    try {
      const features = await extractVoiceFeatures(blob)
      if (features.every((v) => v === 0)) {
        onErrorRef.current?.('Não detectei voz no microfone. Fale "ok estoque" mais perto.')
        return false
      }

      const { match, score, profile } = findBestVoiceMatch(
        profiles,
        features,
        VOICE_LIVE_MATCH_THRESHOLD,
      )
      if (!match) {
        onErrorRef.current?.(
          `Voz não reconhecida (${Math.round(score * 100)}%). Desative "Exigir voz cadastrada" no menu de voz ou grave sua voz novamente.`,
        )
        return false
      }
      if (profile) {
        setLastHint(`Voz de ${profile.name} reconhecida`)
        onVoiceRecognizedRef.current?.({ id: profile.id, name: profile.name })
      }
      return true
    } catch {
      onErrorRef.current?.(
        'Não foi possível analisar o áudio. Grave sua voz de novo em Comando de voz ou desative "Exigir voz cadastrada".',
      )
      return false
    }
  }, [flushAudioForVerification])

  const dispatchCommand = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      clearSilenceTimer()
      clearListeningBuffers()
      onCommandTextRef.current(trimmed)
    },
    [clearListeningBuffers, clearSilenceTimer],
  )

  const resumeConversationListeningRef = useRef<() => void>(() => {})

  const resetConversationTimer = useCallback(() => {
    clearArmedTimer()
    armedTimerRef.current = setTimeout(() => {
      conversingRef.current = false
      armedRef.current = false
      setLastHint('Conversa encerrada por inatividade.')
      scheduleRecognitionRestartRef.current()
    }, CONVERSATION_TIMEOUT_MS)
  }, [clearArmedTimer])

  const endConversation = useCallback(() => {
    conversingRef.current = false
    armedRef.current = false
    ttsHoldRef.current = false
    clearArmedTimer()
    clearListeningBuffers()
    scheduleRecognitionRestartRef.current()
  }, [clearArmedTimer, clearListeningBuffers])

  const runConversationUtterance = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !onConversationUtteranceRef.current || processingUtteranceRef.current) return

      processingUtteranceRef.current = true
      clearSilenceTimer()
      clearRestartTimer()
      armedBufferRef.current = ''
      armedInterimRef.current = ''
      setPhase('executando')
      setLastHint('Processando…')

      ttsHoldRef.current = true
      recRef.current?.abort()

      let continueSession = false
      try {
        continueSession = await onConversationUtteranceRef.current(trimmed)
      } catch {
        onErrorRef.current?.('Erro ao processar a fala.')
      } finally {
        processingUtteranceRef.current = false
      }

      if (!runningRef.current) {
        ttsHoldRef.current = false
        return
      }

      if (!continueSession) {
        ttsHoldRef.current = false
        endConversation()
        return
      }

      conversingRef.current = true
      armedRef.current = true
      stopAudioCapture()
      setPhase('conversando')
      setLastHint('Pode falar…')
      setLiveText('')
      resetConversationTimer()
      ttsHoldRef.current = false
      await sleep(POST_TTS_DELAY_MS)
      if (!runningRef.current) {
        ttsHoldRef.current = false
        return
      }
      ttsEchoGuardUntilRef.current = Date.now() + TTS_ECHO_GUARD_MS
      resumeConversationListeningRef.current()
    },
    [clearRestartTimer, clearSilenceTimer, endConversation, resetConversationTimer, stopAudioCapture],
  )

  const startConversation = useCallback(
    async (skipGreeting = false) => {
      conversingRef.current = true
      armedRef.current = true
      armedBufferRef.current = ''
      armedInterimRef.current = ''
      sessionAccumRef.current = ''
      listeningBufferRef.current = ''
      clearSilenceTimer()
      clearRestartTimer()
      setPhase('conversando')
      setLastHint('Iniciando conversa…')
      setLiveText('')

      ttsHoldRef.current = true
      recRef.current?.abort()
      stopAudioCapture()

      if (!skipGreeting && onConversationStartRef.current) {
        try {
          await onConversationStartRef.current()
        } catch {
          onErrorRef.current?.('Erro ao iniciar conversa por voz.')
        }
      }

      if (!runningRef.current) {
        ttsHoldRef.current = false
        return
      }

      setLastHint('Pode falar…')
      resetConversationTimer()
      ttsHoldRef.current = false
      await sleep(POST_TTS_DELAY_MS)
      if (!runningRef.current) {
        ttsHoldRef.current = false
        return
      }
      ttsEchoGuardUntilRef.current = Date.now() + TTS_ECHO_GUARD_MS
      resumeConversationListeningRef.current()
    },
    [clearRestartTimer, clearSilenceTimer, resetConversationTimer, stopAudioCapture],
  )

  const arm = useCallback(() => {
    armedRef.current = true
    armedBufferRef.current = ''
    armedInterimRef.current = ''
    sessionAccumRef.current = ''
    listeningBufferRef.current = ''
    clearArmedTimer()
    setPhase('armado')
    setLastHint('Ouvindo comando…')
    armedTimerRef.current = setTimeout(() => {
      scheduleRecognitionRestartRef.current()
    }, ARMED_TIMEOUT_MS)
  }, [clearArmedTimer])

  const processWake = useCallback(
    async (raw: string) => {
      const wake = wakePhraseRef.current
      if (!wakePhraseMatches(raw, wake)) return false

      const ok = await verifyRegisteredVoice()
      if (!ok) {
        sessionAccumRef.current = ''
        listeningBufferRef.current = ''
        return true
      }

      stopAudioCapture()

      const remainder = stripWakePhrase(raw, wake)
      if (remainder) {
        if (interactiveRef.current && onConversationUtteranceRef.current) {
          conversingRef.current = true
          armedRef.current = true
          armedBufferRef.current = ''
          armedInterimRef.current = ''
          setPhase('conversando')
          resetConversationTimer()
          await runConversationUtterance(remainder)
        } else {
          dispatchCommand(remainder)
          scheduleRecognitionRestartRef.current()
        }
        sessionAccumRef.current = ''
        listeningBufferRef.current = ''
        return true
      }

      if (interactiveRef.current && onConversationUtteranceRef.current) {
        await startConversation(false)
        sessionAccumRef.current = ''
        listeningBufferRef.current = ''
        return true
      }

      arm()
      sessionAccumRef.current = ''
      listeningBufferRef.current = ''
      return true
    },
    [arm, dispatchCommand, resetConversationTimer, runConversationUtterance, startConversation, stopAudioCapture, verifyRegisteredVoice],
  )

  const flushAfterSilence = useCallback(async () => {
    silenceTimerRef.current = null

    if (armedRef.current || conversingRef.current) {
      const text = `${armedBufferRef.current} ${armedInterimRef.current}`.replace(/\s+/g, ' ').trim()
      armedBufferRef.current = ''
      armedInterimRef.current = ''
      if (text) {
        if (conversingRef.current && interactiveRef.current) {
          await runConversationUtterance(text)
        } else {
          dispatchCommand(text)
          scheduleRecognitionRestartRef.current()
        }
      } else if (conversingRef.current && !ttsHoldRef.current) {
        resumeConversationListeningRef.current()
      }
      return
    }

    const full = listeningBufferRef.current.trim()
    if (!full) return
    const handled = await processWake(full)
    if (handled) {
      sessionAccumRef.current = ''
      listeningBufferRef.current = ''
    }
  }, [dispatchCommand, processWake, runConversationUtterance])

  const scheduleSilenceFlush = useCallback(() => {
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(() => {
      void flushAfterSilence()
    }, SILENCE_AFTER_SPEECH_MS)
  }, [clearSilenceTimer, flushAfterSilence])

  const handlePassiveTranscript = useCallback(
    async (final: string, interim: string, combined: string) => {
      if (final) {
        sessionAccumRef.current = `${sessionAccumRef.current} ${final}`.replace(/\s+/g, ' ').trim()
        if (await processWake(sessionAccumRef.current)) return
      }

      const working = combined || `${sessionAccumRef.current}${interim ? ` ${interim}` : ''}`.trim()
      if (working) {
        listeningBufferRef.current = working
        setLiveText(working)
        setPhase('ouvindo')
        if (wakePhraseMatches(working, wakePhraseRef.current)) {
          if (await processWake(working)) return
        }
        scheduleSilenceFlush()
      }
    },
    [processWake, scheduleSilenceFlush],
  )

  const bindRecognitionHandlers = useCallback(
    (rec: SpeechRecognitionInstance) => {
      rec.onresult = (ev) => {
        if (Date.now() < ttsEchoGuardUntilRef.current) return

        const { interim, final, combined } = readIncrementalTranscript(ev)

        if (armedRef.current || conversingRef.current) {
          if (conversingRef.current) resetConversationTimer()
          if (final) {
            armedBufferRef.current = `${armedBufferRef.current} ${final}`.replace(/\s+/g, ' ').trim()
          }
          armedInterimRef.current = interim
          const preview = `${armedBufferRef.current}${interim ? ` ${interim}` : ''}`.trim()
          setLiveText(preview || combined)
          setPhase(conversingRef.current ? 'conversando' : 'armado')
          if (preview || combined) scheduleSilenceFlush()
          return
        }

        if (combined) {
          setLiveText(combined)
          setPhase('ouvindo')
        }

        void handlePassiveTranscript(final, interim, combined)
      }

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed') {
          onErrorRef.current?.('Permita o uso do microfone no navegador.')
          stopRecognitionRef.current()
          return
        }
        if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
          onErrorRef.current?.('Erro no microfone. Tentando reconectar…')
        }
        if (
          runningRef.current &&
          conversingRef.current &&
          !ttsHoldRef.current &&
          !processingUtteranceRef.current &&
          ev.error !== 'not-allowed' &&
          ev.error !== 'aborted'
        ) {
          scheduleRecognitionRestartRef.current('soft')
        }
      }

      rec.onend = () => {
        if (
          !runningRef.current ||
          restartingRef.current ||
          pausedForLocalSpeechRef.current ||
          ttsHoldRef.current
        ) {
          return
        }
        clearSilenceTimer()
        void flushAfterSilence().finally(() => {
          if (!runningRef.current || pausedForLocalSpeechRef.current || ttsHoldRef.current) return
          if (conversingRef.current) {
            if (!processingUtteranceRef.current && !recRef.current) {
              resumeConversationListeningRef.current()
            }
            return
          }
          scheduleRecognitionRestartRef.current('soft')
        })
      }
    },
    [flushAfterSilence, handlePassiveTranscript, resetConversationTimer, scheduleSilenceFlush],
  )

  const resumeConversationListening = useCallback(() => {
    if (!runningRef.current || pausedForLocalSpeechRef.current || processingUtteranceRef.current) return

    restartingRef.current = true
    stopAudioCapture()
    const oldRec = recRef.current
    recRef.current = null
    try {
      oldRec?.abort()
    } catch {
      /* ignore */
    }

    const rec = createRecognitionInstance(true)
    if (!rec) {
      restartingRef.current = false
      onErrorRef.current?.('Reconhecimento de voz indisponível neste navegador.')
      return
    }
    recRef.current = rec
    bindRecognitionHandlers(rec)

    void (async () => {
      const started = await tryStartRecognition(rec)
      restartingRef.current = false
      if (!started && runningRef.current && (armedRef.current || conversingRef.current)) {
        onErrorRef.current?.('Microfone ocupado. Tentando ouvir de novo…')
        scheduleRecognitionRestartRef.current('soft')
      }
    })()
  }, [bindRecognitionHandlers, stopAudioCapture, tryStartRecognition])

  useEffect(() => {
    resumeConversationListeningRef.current = resumeConversationListening
  }, [resumeConversationListening])

  const scheduleRecognitionRestart = useCallback(
    (mode: 'soft' | 'hard' = 'hard') => {
      if (!runningRef.current || pausedForLocalSpeechRef.current || ttsHoldRef.current) return
      clearRestartTimer()
      const delayMs = mode === 'soft' ? 400 : 200
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null
        if (!runningRef.current) return

        restartingRef.current = true
        const oldRec = recRef.current
        recRef.current = null
        try {
          oldRec?.abort()
        } catch {
          /* ignore */
        }

        if (!conversingRef.current) {
          armedRef.current = false
          clearArmedTimer()
          clearSilenceTimer()
          if (mode === 'hard') {
            clearListeningBuffers()
            setLastHint(null)
          }
          setPhase('ouvindo')
        } else {
          armedRef.current = true
          clearSilenceTimer()
          setPhase('conversando')
        }

        const rec = createRecognitionInstance(conversingRef.current)
        if (!rec) return
        recRef.current = rec
        bindRecognitionHandlers(rec)

        void (async () => {
          const started = await tryStartRecognition(rec)
          restartingRef.current = false
          if (!started && runningRef.current) {
            scheduleRecognitionRestartRef.current('soft')
            return
          }
          scheduleVoiceCaptureIfNeeded()
        })()
      }, delayMs)
    },
    [
      bindRecognitionHandlers,
      clearArmedTimer,
      clearListeningBuffers,
      clearRestartTimer,
      clearSilenceTimer,
      scheduleVoiceCaptureIfNeeded,
      tryStartRecognition,
    ],
  )

  useEffect(() => {
    scheduleRecognitionRestartRef.current = scheduleRecognitionRestart
  }, [scheduleRecognitionRestart])

  const cancelArmed = useCallback(() => {
    if (!armedRef.current && !conversingRef.current) return
    endConversation()
  }, [endConversation])

  const stopRecognition = useCallback(() => {
    runningRef.current = false
    ttsHoldRef.current = false
    localSpeechHoldRef.current = 0
    pausedForLocalSpeechRef.current = false
    clearRestartTimer()
    recRef.current?.abort()
    recRef.current = null
    stopAudioCapture()
    clearArmedTimer()
    clearSilenceTimer()
    armedRef.current = false
    conversingRef.current = false
    clearListeningBuffers()
    setPhase('off')
    setLastHint(null)
  }, [
    clearArmedTimer,
    clearListeningBuffers,
    clearRestartTimer,
    clearSilenceTimer,
    stopAudioCapture,
  ])

  useEffect(() => {
    stopRecognitionRef.current = stopRecognition
  }, [stopRecognition])

  const startRecognition = useCallback(async () => {
    if (pausedForLocalSpeechRef.current) return

    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      onErrorRef.current?.('Reconhecimento de voz não disponível neste navegador.')
      return
    }

    if (requireVoiceMatchRef.current && voiceProfilesRef.current.length === 0) {
      onErrorRef.current?.('Cadastre pelo menos uma voz individual antes de ativar o assistente.')
      return
    }

    stopAudioCapture()

    recRef.current?.abort()
    const rec = createRecognitionInstance()
    if (!rec) return
    recRef.current = rec
    bindRecognitionHandlers(rec)

    runningRef.current = true
    armedRef.current = false
    clearListeningBuffers()
    setPhase('ouvindo')
    setLastHint(null)

    try {
      const started = await tryStartRecognition(rec)
      if (!started) {
        onErrorRef.current?.('Não foi possível iniciar o microfone. Verifique permissões.')
        return
      }
      scheduleVoiceCaptureIfNeeded()
    } catch {
      onErrorRef.current?.('Não foi possível iniciar o microfone. Verifique permissões.')
    }
  }, [bindRecognitionHandlers, clearListeningBuffers, scheduleVoiceCaptureIfNeeded, stopAudioCapture, tryStartRecognition])

  const suspendForLocalSpeech = useCallback(() => {
    localSpeechHoldRef.current += 1
    if (localSpeechHoldRef.current > 1) return

    pausedForLocalSpeechRef.current = true
    clearRestartTimer()
    clearArmedTimer()
    clearSilenceTimer()
    armedRef.current = false
    restartingRef.current = false

    const oldRec = recRef.current
    recRef.current = null
    try {
      oldRec?.abort()
    } catch {
      /* ignore */
    }

    stopAudioCapture()
    setLiveText('')
    setLastHint('Microfone em uso na movimentação')
  }, [clearArmedTimer, clearRestartTimer, clearSilenceTimer, stopAudioCapture])

  const resumeAfterLocalSpeech = useCallback(() => {
    if (localSpeechHoldRef.current <= 0) return
    localSpeechHoldRef.current -= 1
    if (localSpeechHoldRef.current > 0) return

    pausedForLocalSpeechRef.current = false
    setLastHint(null)

    if (runningRef.current && enabledRef.current) {
      void startRecognition()
    }
  }, [startRecognition])

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() != null)
  }, [])

  useEffect(() => {
    if (!enabled) return

    const watchdog = setInterval(() => {
      if (
        !runningRef.current ||
        !conversingRef.current ||
        ttsHoldRef.current ||
        processingUtteranceRef.current ||
        restartingRef.current ||
        pausedForLocalSpeechRef.current
      ) {
        return
      }
      if (!recRef.current) {
        resumeConversationListeningRef.current()
      }
    }, CONVERSATION_WATCHDOG_MS)

    return () => clearInterval(watchdog)
  }, [enabled])

  useEffect(() => {
    if (enabled && supported) {
      void startRecognition()
    } else {
      stopRecognition()
    }
    return () => stopRecognition()
  }, [enabled, supported, startRecognition, stopRecognition])

  const testPhrase = useCallback(
    (spoken: string): boolean => wakePhraseMatches(spoken, wakePhraseRef.current),
    [],
  )

  return {
    supported,
    phase,
    liveText,
    lastHint,
    testPhrase,
    stop: stopRecognition,
    cancelArmed,
    suspendForLocalSpeech,
    resumeAfterLocalSpeech,
  }
}
