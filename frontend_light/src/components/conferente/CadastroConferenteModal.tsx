import { useEffect, useState } from 'react'
import { cadastrarConferente, conferenteNomeDeUsuario, listConferentes, type Conferente } from '../../lib/conferentesStore'
import { formatUnknownError } from '../../lib/supabaseError'

type Props = {
  open: boolean
  onClose: () => void
  onSaved?: (conferente: Conferente) => void
  /** Login do usuário logado — o nome do conferente deve ser igual. */
  loginEsperado?: string
}

export default function CadastroConferenteModal({ open, onClose, onSaved, loginEsperado }: Props) {
  const [lista, setLista] = useState<Conferente[]>([])
  const [loadingLista, setLoadingLista] = useState(false)
  const [nome, setNome] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setLoadingLista(true)
    try {
      setLista(await listConferentes())
    } catch (e) {
      setLista([])
      setErro(formatUnknownError(e) || 'Erro ao carregar conferentes.')
    } finally {
      setLoadingLista(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setNome(loginEsperado ? conferenteNomeDeUsuario(loginEsperado) : '')
    setErro('')
    void carregar()
  }, [open, loginEsperado])

  async function salvar() {
    const trimmed = conferenteNomeDeUsuario(nome)
    if (!trimmed) {
      setErro('Informe o nome do conferente.')
      return
    }
    if (loginEsperado && trimmed !== conferenteNomeDeUsuario(loginEsperado)) {
      setErro(`O nome do conferente deve ser igual ao seu login (${conferenteNomeDeUsuario(loginEsperado)}).`)
      return
    }
    setSaving(true)
    setErro('')
    try {
      const criado = await cadastrarConferente(trimmed)
      setNome('')
      await carregar()
      onSaved?.(criado)
    } catch (e) {
      setErro(formatUnknownError(e) || 'Erro ao cadastrar conferente.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="page-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cadastro-conferente-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="page-modal page-modal--wide conferente-modal">
        <div className="page-modal__head">
          <h2 id="cadastro-conferente-title">Cadastro de conferente</h2>
          <button type="button" className="page-modal__close" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="page-modal__body page-form-grid">
          <p className="conferente-modal__intro page-form-grid__full">
            O nome do conferente deve ser <strong>igual ao seu login</strong>
            {loginEsperado ? ` (${conferenteNomeDeUsuario(loginEsperado)})` : ''}. Assim as contagens ficam
            vinculadas ao usuário correto.
          </p>
          <label className="page-form-grid__full">
            Nome do conferente *
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={loginEsperado ? conferenteNomeDeUsuario(loginEsperado) : 'ex.: alex'}
              readOnly={Boolean(loginEsperado)}
              autoFocus
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void salvar()
              }}
            />
          </label>
          {erro ? <p className="page-msg page-msg--error page-form-grid__full">{erro}</p> : null}
          <div className="conferente-modal__lista-wrap page-form-grid__full">
            <h3 className="conferente-modal__lista-title">Conferentes cadastrados</h3>
            {loadingLista ? (
              <p className="page-panel__meta">Carregando…</p>
            ) : lista.length === 0 ? (
              <p className="page-panel__meta">Nenhum conferente cadastrado ainda.</p>
            ) : (
              <ul className="conferente-modal__lista">
                {lista.map((c) => (
                  <li key={c.id}>{c.nome}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="page-modal__foot">
          <button type="button" className="page-btn-ghost" onClick={onClose} disabled={saving}>
            Fechar
          </button>
          <button type="button" onClick={() => void salvar()} disabled={saving}>
            {saving ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
