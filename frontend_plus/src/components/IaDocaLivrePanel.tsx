import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

export type IaChatLine = {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

type Props = {
  messages: IaChatLine[]
  sending: boolean
  onSend: (text: string) => void | Promise<void>
}

const SUGGESTIONS = [
  'Abre o painel',
  'Tem leite no estoque?',
  'Pesquise a NF 20835',
  'Mostra o financeiro',
]

export function IaDocaLivrePanel({ messages, sending, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [micErro, setMicErro] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { listening, supported, start, stop, interimTranscript } = useSpeechRecognition()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending, listening, interimTranscript])

  function resizeDraft() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function submitText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setDraft('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    await onSend(trimmed)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void submitText(draft)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submitText(draft)
    }
  }

  function toggleMic() {
    if (!supported || sending) return
    if (listening) {
      stop()
      return
    }
    start(
      (spoken) => {
        setMicErro(null)
        void submitText(spoken)
      },
      (err) => {
        setMicErro(err)
      },
      { extended: true, maxDurationMs: 20000 },
    )
  }

  const empty = messages.length === 0 && !listening

  return (
    <div className="ia-doca">
      <div className="ia-doca-thread" role="log" aria-live="polite">
        {empty ? (
          <div className="ia-doca-empty">
            <div className="ia-doca-mark" aria-hidden>
              ✦
            </div>
            <h3 className="ia-doca-empty-title">IA DOCA LIVRE</h3>
            <p className="ia-doca-empty-sub">Como posso ajudar no WMS hoje?</p>
            <div className="ia-doca-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="ia-doca-chip" onClick={() => void submitText(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`ia-doca-row ia-doca-row--${m.role}`}>
              {m.role === 'assistant' ? (
                <span className="ia-doca-avatar" aria-hidden>
                  ✦
                </span>
              ) : null}
              <div
                className={`ia-doca-msg ia-doca-msg--${m.role}${m.pending ? ' ia-doca-msg--pending' : ''}`}
              >
                {m.pending ? (
                  <span className="ia-doca-dots" aria-label="Pensando">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))
        )}
        {listening && interimTranscript ? (
          <div className="ia-doca-row ia-doca-row--user">
            <div className="ia-doca-msg ia-doca-msg--user ia-doca-msg--interim">{interimTranscript}</div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {micErro ? <p className="ia-doca-warn">{micErro}</p> : null}

      <form className="ia-doca-composer" onSubmit={handleSubmit}>
        <div className="ia-doca-bar">
          <textarea
            ref={inputRef}
            className="ia-doca-input"
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              resizeDraft()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte qualquer coisa sobre o WMS…"
            disabled={sending}
          />
          <button
            type="button"
            className={`ia-doca-icon-btn${listening ? ' ia-doca-icon-btn--on' : ''}`}
            onClick={toggleMic}
            disabled={!supported || sending}
            title={supported ? (listening ? 'Parar de ouvir' : 'Falar') : 'Áudio não suportado neste navegador'}
            aria-label={listening ? 'Parar de ouvir' : 'Falar'}
          >
            <MicIcon />
          </button>
          <button
            type="submit"
            className="ia-doca-send-btn"
            disabled={sending || !draft.trim()}
            aria-label="Enviar"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </div>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <rect x="9" y="3.5" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M12 19V6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.5 11.5 12 6l5.5 5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
