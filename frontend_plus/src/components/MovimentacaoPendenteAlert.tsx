import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

type Props = {
  nfNumero: string
  onClose: () => void
  onConfirmLeave: () => void
}

export function MovimentacaoPendenteAlert({ nfNumero, onClose, onConfirmLeave }: Props) {
  useBodyScrollLock(true)

  return (
    <div className="alert-backdrop" onClick={onClose} role="presentation">
      <div
        className="alert-box alert-box--entrada-pendente"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="movimentacao-pendente-title"
      >
        <h2 id="movimentacao-pendente-title">Movimentação não confirmada</h2>
        <p>
          A <strong>NF {nfNumero}</strong> ainda tem endereços marcados no mapa que não foram
          confirmados.
        </p>
        <p className="muted">
          Se sair agora, você perderá essa seleção. Volte à aba Movimentação para continuar ou
          confirme antes de trocar de seção.
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Continuar movimentando
          </button>
          <button type="button" className="btn btn-ghost" onClick={onConfirmLeave}>
            Sair mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}
