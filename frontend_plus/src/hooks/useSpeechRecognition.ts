import { useCallback, useEffect, useRef, useState } from 'react'

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

export type SpeechListenOptions = {
  /** Acumula várias frases até silêncio ou tempo máximo (melhor para endereços longos). */
  extended?: boolean
  maxDurationMs?: number
  silenceAfterSpeechMs?: number
  /** Libera o microfone global (ex.: assistente "ok estoque") antes de escutar. */
  onPrepareMic?: () => void
  /** Restaura o microfone global após a escuta local. */
  onReleaseMic?: () => void
}

const DEFAULT_EXTENDED = {
  extended: false,
  maxDurationMs: 18000,
  silenceAfterSpeechMs: 3200,
} satisfies Omit<SpeechListenOptions, 'onPrepareMic' | 'onReleaseMic'>

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition() {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const recRef = useRef<SpeechRecognitionInstance | null>(null)
  const timersRef = useRef<{ max?: ReturnType<typeof setTimeout>; silence?: ReturnType<typeof setTimeout> }>(
    {},
  )
  const sessionRef = useRef<{
    onResult: (text: string) => void
    onError?: (message: string) => void
    onReleaseMic?: () => void
    extended: boolean
    accumulated: string
    finished: boolean
    restartAttempted: boolean
  } | null>(null)

  const clearTimers = useCallback(() => {
    if (timersRef.current.max) clearTimeout(timersRef.current.max)
    if (timersRef.current.silence) clearTimeout(timersRef.current.silence)
    timersRef.current = {}
  }, [])

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() != null)
    return () => {
      clearTimers()
      const session = sessionRef.current
      if (session && !session.finished) {
        session.onReleaseMic?.()
      }
      recRef.current?.abort()
      recRef.current = null
      sessionRef.current = null
    }
  }, [clearTimers])

  const finishSession = useCallback(
    (reason: 'result' | 'timeout' | 'manual') => {
      const session = sessionRef.current
      if (!session || session.finished) return
      session.finished = true
      clearTimers()
      recRef.current?.stop()
      recRef.current = null
      setListening(false)
      setInterimTranscript('')

      const text = session.accumulated.trim()
      if (text) {
        session.onResult(text)
      } else if (reason === 'timeout') {
        session.onError?.('Tempo esgotado. Toque no microfone e fale o endereço com calma.')
      }
      session.onReleaseMic?.()
      sessionRef.current = null
    },
    [clearTimers],
  )

  const scheduleSilenceFinish = useCallback(
    (silenceMs: number) => {
      if (timersRef.current.silence) clearTimeout(timersRef.current.silence)
      timersRef.current.silence = setTimeout(() => finishSession('result'), silenceMs)
    },
    [finishSession],
  )

  const stop = useCallback(() => {
    const session = sessionRef.current
    if (session && !session.finished) {
      finishSession('manual')
      return
    }
    clearTimers()
    recRef.current?.abort()
    recRef.current = null
    setListening(false)
    setInterimTranscript('')
    sessionRef.current = null
  }, [clearTimers, finishSession])

  const start = useCallback(
    (
      onResult: (text: string) => void,
      onError?: (message: string) => void,
      options?: SpeechListenOptions,
    ) => {
      const Ctor = getSpeechRecognitionCtor()
      if (!Ctor) {
        onError?.('Reconhecimento de voz não disponível neste navegador.')
        return
      }

      const opts = { ...DEFAULT_EXTENDED, ...options }
      clearTimers()
      recRef.current?.abort()

      const session = {
        onResult,
        onError,
        onReleaseMic: options?.onReleaseMic,
        extended: opts.extended,
        accumulated: '',
        finished: false,
        restartAttempted: false,
      }
      sessionRef.current = session

      const rec = new Ctor()
      recRef.current = rec
      rec.lang = 'pt-BR'
      rec.interimResults = true
      rec.maxAlternatives = 3
      rec.continuous = opts.extended

      rec.onresult = (ev) => {
        if (session.finished) return

        let interim = ''
        let gotFinal = false

        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const result = ev.results[i]
          if (!result) continue

          if (result.isFinal) {
            gotFinal = true
            let best = result[0]?.transcript ?? ''
            for (let a = 1; a < result.length; a++) {
              const alt = result[a]?.transcript ?? ''
              if (alt.length > best.length) best = alt
            }
            if (best.trim()) {
              session.accumulated = `${session.accumulated} ${best}`.replace(/\s+/g, ' ').trim()
            }
          } else {
            interim += result[0]?.transcript ?? ''
          }
        }

        const preview = `${session.accumulated}${interim ? ` ${interim}` : ''}`.trim()
        setInterimTranscript(preview)

        if (opts.extended) {
          if (gotFinal && session.accumulated) {
            scheduleSilenceFinish(opts.silenceAfterSpeechMs)
          }
          return
        }

        if (gotFinal && session.accumulated) {
          finishSession('result')
        }
      }

      rec.onerror = (ev) => {
        if (session.finished) return
        if (ev.error === 'aborted') return
        session.finished = true
        clearTimers()
        if (ev.error === 'not-allowed') {
          onError?.('Permita o uso do microfone no navegador.')
        } else if (ev.error !== 'no-speech') {
          onError?.('Não foi possível capturar a voz. Tente novamente.')
        }
        setListening(false)
        setInterimTranscript('')
        recRef.current = null
        session.onReleaseMic?.()
        sessionRef.current = null
      }

      rec.onend = () => {
        if (session.finished) return
        if (opts.extended) {
          if (session.accumulated) {
            finishSession('result')
            return
          }
          if (!session.restartAttempted) {
            session.restartAttempted = true
            try {
              rec.start()
            } catch {
              session.onError?.(
                'Não ouvi nada. Fale o endereço mais alto ou verifique o microfone.',
              )
              finishSession('manual')
            }
            return
          }
          session.onError?.('Não ouvi nada. Fale o endereço de destino com calma.')
          finishSession('manual')
          return
        }
        setListening(false)
        setInterimTranscript('')
        recRef.current = null
        session.onReleaseMic?.()
        sessionRef.current = null
      }

      setInterimTranscript('')
      setListening(true)
      options?.onPrepareMic?.()

      const beginRec = () => {
        if (session.finished) return
        try {
          rec.start()
          if (opts.extended) {
            timersRef.current.max = setTimeout(() => finishSession('timeout'), opts.maxDurationMs)
          }
        } catch {
          session.finished = true
          clearTimers()
          onError?.('Microfone indisponível. Tente de novo em instantes.')
          setListening(false)
          setInterimTranscript('')
          recRef.current = null
          session.onReleaseMic?.()
          sessionRef.current = null
        }
      }

      window.setTimeout(beginRec, 400)
    },
    [clearTimers, finishSession, scheduleSilenceFinish],
  )

  return { listening, supported, interimTranscript, start, stop }
}
