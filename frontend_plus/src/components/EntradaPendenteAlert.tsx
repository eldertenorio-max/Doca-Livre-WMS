import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

type Props = {
  nfNumero: string
  itensPendentes: number
  onClose: () => void
  onConfirmLeave?: () => void
}

export function EntradaPendenteAlert({
  nfNumero,
  itensPendentes,
  onClose,
  onConfirmLeave,
}: Props) {
  useBodyScrollLock(true)

  const itensLabel =
    itensPendentes === 1
      ? '1 item com endereçamento incompleto'
      : `${itensPendentes} itens com endereçamento incompleto`
  const podeSair = !!onConfirmLeave

  return (
    <div className="alert-backdrop" onClick={onClose} role="presentation">
      <div
        className="alert-box alert-box--entrada-pendente"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="entrada-pendente-title"
      >
        <h2 id="entrada-pendente-title">Endereçamento incompleto</h2>
        <p>
          A <strong>NF {nfNumero}</strong> ainda tem <strong>{itensLabel}</strong>.
        </p>
        <p className="muted">
          {podeSair ? (
            <>
              A nota permanecerá em <strong>Entradas em andamento</strong> até você finalizar o
              endereçamento de todos os itens.
            </>
          ) : (
            <>
              Enderece todos os itens antes de finalizar a entrada. A nota permanecerá em{' '}
              <strong>Entradas em andamento</strong> até lá.
            </>
          )}
        </p>
        {podeSair ? (
          <div className="confirm-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Continuar endereçando
            </button>
            <button type="button" className="btn btn-ghost" onClick={onConfirmLeave}>
              Deixar pendente
            </button>
          </div>
        ) : (
          <button type="button" className="btn primary full" onClick={onClose}>
            Entendi
          </button>
        )}
      </div>
    </div>
  )
}
