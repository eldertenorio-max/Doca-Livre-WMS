import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

type Props = {
  kind: 'sem_paletes' | 'maximo' | 'incompleto' | 'posicoes_adicionar'
  onClose: () => void
}

export function PaletesLimiteAlert({ kind, onClose }: Props) {
  useBodyScrollLock(true)

  const title =
    kind === 'sem_paletes'
      ? 'Informe os paletes'
      : kind === 'incompleto'
        ? 'Endereços incompletos'
        : kind === 'posicoes_adicionar'
          ? 'Posições completas'
          : 'Limite de endereços'
  const message =
    kind === 'sem_paletes'
      ? 'Preencha o campo Paletes deste item (não confundir com Qtd.) antes de marcar posições no mapa.'
      : kind === 'incompleto'
        ? 'Selecione todos os endereços correspondentes aos paletes do item antes de confirmar.'
        : kind === 'posicoes_adicionar'
          ? 'Você já marcou todas as posições solicitadas. Confirme na barra lateral ou clique em uma posição marcada para desmarcar.'
          : 'Você atingiu o limite máximo de endereços para este item.'

  return (
    <div className="alert-backdrop" onClick={onClose} role="presentation">
      <div
        className="alert-box"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="paletes-limite-title"
      >
        <h2 id="paletes-limite-title">{title}</h2>
        <p>{message}</p>
        <button type="button" className="btn primary full" onClick={onClose}>
          Entendi
        </button>
      </div>
    </div>
  )
}
