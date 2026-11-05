import { useEffect, useState } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useVoiceProfileEnrollment } from '../hooks/useVoiceProfileEnrollment'
import { VOICE_COMMAND_BLOCKED_NOTE, VOICE_COMMAND_EXAMPLES } from '../lib/parseVoiceCommand'
import type { VoicePrefs } from '../lib/voicePrefs'
import { DEFAULT_WAKE_PHRASE } from '../lib/voicePrefs'
import {
  MAX_VOICE_PROFILES,
  VOICE_ENROLLMENT_SAMPLES,
  getStoredVoiceRegistry,
  removeNamedVoiceProfile,
  type VoiceRegistry,
} from '../lib/voiceProfile'

type Props = {
  prefs: VoicePrefs
  voiceRegistry: VoiceRegistry
  supported: boolean
  assistantActive: boolean
  voiceFeedback: string | null
  voiceSyncError?: string | null
  onPrefsChange: (patch: Partial<VoicePrefs>) => void
  onVoiceRegistryChange: (registry: VoiceRegistry) => void
  onRefreshVoiceRegistry?: () => void | Promise<void>
  onTestWakePhrase: (spoken: string) => boolean
  sectionOpen?: boolean
}

export function CadastroVozPanel({
  prefs,
  voiceRegistry,
  supported,
  assistantActive,
  voiceFeedback,
  voiceSyncError = null,
  onPrefsChange,
  onVoiceRegistryChange,
  onRefreshVoiceRegistry,
  onTestWakePhrase,
  sectionOpen = true,
}: Props) {
  const [calibrando, setCalibrando] = useState(false)
  const [calibMsg, setCalibMsg] = useState<string | null>(null)
  const [calibErro, setCalibErro] = useState<string | null>(null)
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null)
  const [nomeVoz, setNomeVoz] = useState('')
  const { listening, start, stop } = useSpeechRecognition()

  const enrollment = useVoiceProfileEnrollment({
    registry: voiceRegistry,
    onRegistryChange: onVoiceRegistryChange,
    onProfileComplete: (profile) => {
      onVoiceRegistryChange(getStoredVoiceRegistry())
      onPrefsChange({ calibrated: true })
      setEnrollMsg(`Voz de "${profile.name}" cadastrada com sucesso (3/3).`)
      setNomeVoz('')
    },
  })

  useEffect(() => {
    if (!sectionOpen) return
    void onRefreshVoiceRegistry?.()
  }, [sectionOpen, onRefreshVoiceRegistry])

  const wake = prefs.wakePhrase || DEFAULT_WAKE_PHRASE
  const pessoasCadastradas = voiceRegistry.profiles
  const temVozCadastrada = pessoasCadastradas.length > 0
  const limitePessoas = MAX_VOICE_PROFILES
  const limiteAmostras = enrollment.requiredSamples
  const amostrasGravadas = enrollment.sampleCount
  const sessaoCompleta = amostrasGravadas >= limiteAmostras
  const podeCadastrarPessoa = enrollment.canAddPerson || amostrasGravadas > 0

  function handleAtivarVoz() {
    setCalibErro(null)
    if (prefs.voiceLocked && !temVozCadastrada) {
      setCalibErro('Cadastre pelo menos uma voz individual antes de ativar.')
      return
    }
    onPrefsChange({ enabled: true })
  }

  function handleDesativarVoz() {
    if (listening) {
      stop()
      setCalibrando(false)
    }
    setCalibMsg(null)
    onPrefsChange({ enabled: false })
  }

  async function handleGravarAmostra() {
    if (!nomeVoz.trim()) {
      setCalibErro('Informe o nome de quem está gravando.')
      return
    }
    if (!podeCadastrarPessoa && amostrasGravadas === 0) return
    if (sessaoCompleta) return

    setEnrollMsg(null)
    setCalibErro(null)
    const features = await enrollment.recordSample(nomeVoz)
    if (!features) return

    const next = amostrasGravadas + 1
    if (next < limiteAmostras) {
      setEnrollMsg(
        `Amostra ${next}/${limiteAmostras} de "${nomeVoz.trim()}" gravada. Fale "${wake}" na próxima.`,
      )
    }
  }

  function handleRemoverPessoa(id: string) {
    const next = removeNamedVoiceProfile(voiceRegistry, id)
    onVoiceRegistryChange(next)
    if (next.profiles.length === 0) {
      onPrefsChange({ enabled: false, calibrated: false })
    }
    enrollment.resetSession()
    setEnrollMsg(null)
    setCalibErro(null)
  }

  function handleReiniciarSessao() {
    enrollment.resetSession()
    setEnrollMsg(null)
    setCalibErro(null)
  }

  function handleCalibrar() {
    setCalibMsg(null)
    setCalibErro(null)
    if (listening) {
      stop()
      setCalibrando(false)
      return
    }
    setCalibrando(true)
    start(
      (text) => {
        setCalibrando(false)
        if (onTestWakePhrase(text)) {
          onPrefsChange({ calibrated: true })
          setCalibMsg(`Reconhecido: "${text.trim()}" — frase confirmada.`)
        } else {
          setCalibErro(
            `Não reconheceu "${wake}". Fale exatamente a frase de ativação e tente de novo.`,
          )
        }
      },
      (err) => {
        setCalibrando(false)
        setCalibErro(err)
      },
    )
  }

  return (
    <>
      <div className="sidebar-block">
        <h3 className="cadastro-voz-title">Assistente de voz</h3>
        <p className="muted cadastro-voz-intro">
          Fale <strong>{wake}</strong> para conversar com o assistente. Ele pergunta o que você
          precisa e responde por voz. Você também pode cadastrar vozes individuais para maior
          segurança.
        </p>

        {!supported && (
          <p className="error">
            Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.
          </p>
        )}

        <div
          className={`cadastro-voz-badge${assistantActive ? ' cadastro-voz-badge--on' : ' cadastro-voz-badge--off'}`}
          role="status"
        >
          {assistantActive ? `Aguardando "${wake}"…` : 'Voz desativada'}
        </div>

        <div className="cadastro-voz-controles">
          <button
            type="button"
            className="btn success"
            disabled={!supported || prefs.enabled || calibrando || enrollment.recording}
            onClick={handleAtivarVoz}
          >
            Ativar voz
          </button>
          <button
            type="button"
            className="btn danger-outline"
            disabled={!supported || !prefs.enabled}
            onClick={handleDesativarVoz}
          >
            Desativar voz
          </button>
        </div>

        {voiceSyncError && <p className="error">{voiceSyncError}</p>}

        {assistantActive && (
          <p className="cadastro-voz-status cadastro-voz-status--on">
            {prefs.interactiveMode
              ? `Microfone aguardando "${wake}". Fale naturalmente — ex.: "quero ver o painel", "tem leite no estoque?", "fecha essa aba". Diga "sair" para encerrar.`
              : `Microfone aguardando "${wake}" — fale o pedido em linguagem natural após a frase de ativação.`}
          </p>
        )}

        {assistantActive && voiceFeedback && (
          <p className="cadastro-voz-ok">{voiceFeedback}</p>
        )}

        {!assistantActive && supported && (
          <p className="muted cadastro-voz-status-hint">
            {prefs.voiceLocked && !temVozCadastrada
              ? 'Cadastre uma voz abaixo ou desmarque "Exigir voz cadastrada" para testar só com a frase de ativação.'
              : prefs.interactiveMode
                ? `Toque em Ativar voz e fale "${wake}" — depois diga o que precisa em linguagem natural.`
                : `Toque em Ativar voz e fale "${wake}" seguido do que deseja fazer.`}
          </p>
        )}

        {temVozCadastrada && (
          <div className="cadastro-voz-resumo" aria-label="Vozes cadastradas">
            <span className="cadastro-voz-resumo-label">Vozes cadastradas:</span>
            <ul className="cadastro-voz-resumo-lista">
              {pessoasCadastradas.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="cadastro-voz-toggle">
          <input
            type="checkbox"
            checked={prefs.interactiveMode}
            disabled={!supported || assistantActive}
            onChange={(e) => onPrefsChange({ interactiveMode: e.target.checked })}
          />
          <span>Modo conversa interativa (assistente pergunta e responde por voz)</span>
        </label>

        <label className="cadastro-voz-toggle">
          <input
            type="checkbox"
            checked={prefs.aiInterpretation}
            disabled={!supported || assistantActive}
            onChange={(e) => onPrefsChange({ aiInterpretation: e.target.checked })}
          />
          <span>Interpretação livre — entende frases naturais sem decorar comandos</span>
        </label>

        {prefs.aiInterpretation && (
          <label className="cadastro-voz-field">
            <span>Chave Gemini (obrigatória para conversar e executar tarefas)</span>
            <input
              type="password"
              className="input-nf"
              value={prefs.geminiApiKey}
              disabled={!supported || assistantActive}
              onChange={(e) => onPrefsChange({ geminiApiKey: e.target.value.trim() })}
              placeholder="Cole a chave do Google AI Studio (opcional)"
              autoComplete="off"
            />
            <span className="muted cadastro-voz-field-hint">
              Cole a chave do Google AI Studio. Com ela, a Gemini executa as funções do WMS
              (abrir telas, consultar estoque, buscar NF, saída, relatório) conversando, como no
              app financeiro. Sem chave, só frases locais.
            </span>
          </label>
        )}

        <label className="cadastro-voz-toggle">
          <input
            type="checkbox"
            checked={prefs.voiceLocked}
            disabled={!supported || assistantActive}
            onChange={(e) => onPrefsChange({ voiceLocked: e.target.checked })}
          />
          <span>Exigir voz cadastrada (só responde a quem gravou as 3 amostras)</span>
        </label>

        <label className="cadastro-voz-field">
          <span>Frase de ativação</span>
          <input
            type="text"
            className="input-nf"
            value={prefs.wakePhrase}
            disabled={!supported || assistantActive}
            onChange={(e) =>
              onPrefsChange({ wakePhrase: e.target.value, calibrated: false })
            }
            placeholder={DEFAULT_WAKE_PHRASE}
          />
        </label>
      </div>

      <div className="sidebar-block cadastro-voz-individual">
        <h4 className="cadastro-voz-subtitle">Cadastro de voz individual</h4>
        <p className="muted cadastro-voz-intro">
          Informe o <strong>nome</strong> e grave <strong>3 amostras</strong> falando &quot;{wake}&quot;
          em voz normal. Máximo de {limitePessoas} pessoas.
        </p>

        <div
          className={`cadastro-voz-badge${temVozCadastrada ? ' cadastro-voz-badge--on' : ' cadastro-voz-badge--off'}`}
        >
          {pessoasCadastradas.length}/{limitePessoas} pessoas cadastradas
        </div>

        <div className="cadastro-voz-lista-wrap">
          <h5 className="cadastro-voz-lista-title">Vozes cadastradas</h5>
          {pessoasCadastradas.length === 0 ? (
            <p className="muted cadastro-voz-lista-vazia">Nenhuma voz cadastrada ainda.</p>
          ) : (
            <ul className="cadastro-voz-pessoas">
              {pessoasCadastradas.map((p) => (
                <li key={p.id}>
                  <div className="cadastro-voz-pessoa-info">
                    <span className="cadastro-voz-pessoa-nome">{p.name}</span>
                    <span className="cadastro-voz-pessoa-meta">
                      {p.sampleCount}/{VOICE_ENROLLMENT_SAMPLES} amostras
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm danger-outline"
                    disabled={assistantActive}
                    onClick={() => handleRemoverPessoa(p.id)}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="cadastro-voz-field">
          <span>Nome de quem está gravando</span>
          <input
            type="text"
            className="input-nf"
            value={nomeVoz}
            disabled={!supported || assistantActive || (!podeCadastrarPessoa && amostrasGravadas === 0)}
            onChange={(e) => setNomeVoz(e.target.value)}
            placeholder="Ex.: Diego, Maria…"
          />
        </label>

        {amostrasGravadas > 0 && !sessaoCompleta && (
          <p className="muted cadastro-voz-enroll-progress">
            {enrollment.recording
              ? `Gravando amostra ${amostrasGravadas + 1}/${limiteAmostras}…`
              : `Progresso de "${nomeVoz.trim() || '…'}": ${amostrasGravadas}/${limiteAmostras} amostras`}
          </p>
        )}

        <button
          type="button"
          className={`btn full ${enrollment.recording ? 'danger-outline' : 'primary'}`}
          disabled={
            !supported ||
            assistantActive ||
            !nomeVoz.trim() ||
            sessaoCompleta ||
            (!podeCadastrarPessoa && amostrasGravadas === 0)
          }
          onClick={handleGravarAmostra}
        >
          {enrollment.recording
            ? 'Gravando… fale agora'
            : !podeCadastrarPessoa && amostrasGravadas === 0
              ? `Limite de ${limitePessoas} pessoas atingido`
              : sessaoCompleta
                ? 'Gravação concluída (3/3)'
                : amostrasGravadas === 0
                  ? `Gravar amostra 1/${limiteAmostras}`
                  : `Gravar amostra ${amostrasGravadas + 1}/${limiteAmostras}`}
        </button>

        {amostrasGravadas > 0 && !sessaoCompleta && (
          <button
            type="button"
            className="btn full btn-sm cadastro-voz-reiniciar"
            disabled={enrollment.recording}
            onClick={handleReiniciarSessao}
          >
            Reiniciar gravação desta pessoa
          </button>
        )}

        {assistantActive && (
          <p className="muted cadastro-voz-calib-hint">
            Desative a voz antes de cadastrar ou alterar vozes individuais.
          </p>
        )}

        {enrollMsg && <p className="cadastro-voz-ok">{enrollMsg}</p>}
        {enrollment.error && <p className="error">{enrollment.error}</p>}
        {calibErro && <p className="error">{calibErro}</p>}
      </div>

      <div className="sidebar-block">
        <button
          type="button"
          className={`btn full btn-sm ${calibrando ? 'danger-outline' : ''}`}
          disabled={!supported || !prefs.wakePhrase.trim() || assistantActive}
          onClick={handleCalibrar}
        >
          {calibrando ? 'Testando frase… toque para cancelar' : 'Testar frase de ativação (texto)'}
        </button>
        {calibMsg && <p className="cadastro-voz-ok">{calibMsg}</p>}
      </div>

      <div className="sidebar-block">
        <h4 className="cadastro-voz-subtitle">Comandos disponíveis</h4>
        <p className="muted cadastro-voz-comandos-hint">
          Fale <strong>{wake}</strong> e diga o que precisa em linguagem natural — não precisa decorar
          frases exatas. Exemplos abaixo.
        </p>
        <ul className="cadastro-voz-comandos">
          {VOICE_COMMAND_EXAMPLES.map((ex) => (
            <li key={ex.frase}>
              <strong>{ex.frase}</strong>
              <span>{ex.descricao}</span>
            </li>
          ))}
        </ul>
        <p className="muted cadastro-voz-comandos-blocked">{VOICE_COMMAND_BLOCKED_NOTE}</p>
      </div>
    </>
  )
}
