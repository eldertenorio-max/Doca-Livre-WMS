import type { VoiceAssistantPhase } from '../hooks/useVoiceAssistant'

type ConversationLine = { role: 'user' | 'assistant'; text: string }

type Props = {
  phase: VoiceAssistantPhase
  liveText: string
  lastHint: string | null
  feedback: string | null
  conversationLines: ConversationLine[]
  interactiveMode: boolean
  wakePhrase: string
  onCancel: () => void
}

export function VoiceAssistantHUD({
  phase,
  liveText,
  lastHint,
  feedback,
  conversationLines,
  interactiveMode,
  wakePhrase,
  onCancel,
}: Props) {
  if (phase === 'ouvindo') {
    return (
      <div className="voice-assistant-hud voice-assistant-hud--passive" role="status" aria-live="polite">
        <div className="voice-assistant-hud-inner">
          <span className="voice-assistant-hud-dot voice-assistant-hud-dot--ouvindo" aria-hidden />
          <div className="voice-assistant-hud-body">
            <strong className="voice-assistant-hud-title">Aguardando frase de ativação…</strong>
            {liveText ? (
              <p className="voice-assistant-hud-live">
                Ouvindo: <strong>{liveText}</strong>
              </p>
            ) : (
              <p className="voice-assistant-hud-hint muted">
                {interactiveMode
                  ? `Fale "${wakePhrase}" para conversar com o assistente do estoque.`
                  : `Fale "${wakePhrase}" + comando, ex.: "${wakePhrase} abrir consulta".`}
              </p>
            )}
            {feedback && <p className="voice-assistant-hud-feedback">{feedback}</p>}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'conversando' || phase === 'executando') {
    const recent = conversationLines.slice(-6)
    return (
      <div className="voice-assistant-hud voice-assistant-hud--conversa" role="status" aria-live="polite">
        <div className="voice-assistant-hud-inner">
          <span
            className={`voice-assistant-hud-dot ${phase === 'executando' ? 'voice-assistant-hud-dot--executando' : 'voice-assistant-hud-dot--armado'}`}
            aria-hidden
          />
          <div className="voice-assistant-hud-body">
            <strong className="voice-assistant-hud-title">
              {phase === 'executando' ? 'Processando…' : 'Conversando com o estoque'}
            </strong>
            {liveText && phase === 'conversando' && (
              <p className="voice-assistant-hud-live">
                Você: <strong>{liveText}</strong>
              </p>
            )}
            {recent.length > 0 && (
              <ul className="voice-assistant-hud-chat">
                {recent.map((line, i) => (
                  <li
                    key={`${line.role}-${i}-${line.text.slice(0, 24)}`}
                    className={`voice-assistant-hud-chat-line voice-assistant-hud-chat-line--${line.role}`}
                  >
                    {line.role === 'assistant' ? 'Assistente' : 'Você'}: {line.text}
                  </li>
                ))}
              </ul>
            )}
            {feedback && <p className="voice-assistant-hud-feedback">{feedback}</p>}
            {!liveText && !feedback && lastHint && (
              <p className="voice-assistant-hud-hint muted">
                {lastHint === 'Pode falar…' ? 'Ouvindo… diga o comando.' : lastHint}
              </p>
            )}
          </div>
          <button
            type="button"
            className="voice-assistant-hud-cancel"
            onClick={onCancel}
            aria-label="Encerrar conversa por voz"
          >
            Encerrar
          </button>
        </div>
      </div>
    )
  }

  if (phase !== 'armado') return null

  return (
    <div className="voice-assistant-hud" role="status" aria-live="polite">
      <div className="voice-assistant-hud-inner">
        <span className="voice-assistant-hud-dot voice-assistant-hud-dot--armado" aria-hidden />
        <div className="voice-assistant-hud-body">
          <strong className="voice-assistant-hud-title">Fale o comando…</strong>
          {liveText && <p className="voice-assistant-hud-live">{liveText}</p>}
          {feedback && <p className="voice-assistant-hud-feedback">{feedback}</p>}
          {!liveText && !feedback && lastHint && (
            <p className="voice-assistant-hud-hint muted">{lastHint}</p>
          )}
          {!liveText && !feedback && !lastHint && (
            <p className="voice-assistant-hud-hint muted">
              Após falar, aguarde — o comando será executado automaticamente.
            </p>
          )}
        </div>
        <span className="voice-assistant-hud-waves" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="voice-assistant-hud-wave"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </span>
        <button
          type="button"
          className="voice-assistant-hud-cancel"
          onClick={onCancel}
          aria-label="Cancelar comando de voz"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
