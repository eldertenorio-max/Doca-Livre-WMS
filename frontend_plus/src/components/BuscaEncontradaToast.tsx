import type { BuscaEncontradaAviso } from '../lib/focarMapaBusca'

type Props = {
  aviso: BuscaEncontradaAviso
  onClose: () => void
}

export function BuscaEncontradaToast({ aviso, onClose }: Props) {
  return (
    <div className="busca-encontrada-toast" role="status" aria-live="polite">
      <span className="busca-encontrada-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </span>
      <div className="busca-encontrada-text">
        <strong>{aviso.titulo}</strong>
        <p>{aviso.detalhe}</p>
      </div>
      <button type="button" className="busca-encontrada-close" onClick={onClose} aria-label="Fechar aviso">
        ×
      </button>
    </div>
  )
}
