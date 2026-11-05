import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { LocalizacaoEstoque } from '../types'

type Props = {
  nfNumeros: string[]
  onConfirm: (localizacao: LocalizacaoEstoque) => void
  onCancel: () => void
}

export function EntradaDestinoModal({ nfNumeros, onConfirm, onCancel }: Props) {
  const [destino, setDestino] = useState<LocalizacaoEstoque>('armazem')
  useBodyScrollLock(true)

  const resumo =
    nfNumeros.length === 1
      ? `NF ${nfNumeros[0]}`
      : `${nfNumeros.length} notas (${nfNumeros.slice(0, 3).join(', ')}${nfNumeros.length > 3 ? '…' : ''})`

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm-box confirm-box--wide" onClick={(e) => e.stopPropagation()}>
        <h4>Destino da entrada</h4>
        <p>
          Para onde deseja enviar <strong>{resumo}</strong>?
        </p>
        <fieldset className="saida-justificativa stage-destino-fieldset">
          <legend className="saida-justificativa-title">Destino padrão dos itens</legend>
          <ul className="saida-justificativa-list">
            <li>
              <label className="saida-justificativa-option">
                <input
                  type="radio"
                  name="entrada-destino"
                  checked={destino === 'armazem'}
                  onChange={() => setDestino('armazem')}
                />
                <span>Estoque normal (endereçar no armazém)</span>
              </label>
            </li>
            <li>
              <label className="saida-justificativa-option">
                <input
                  type="radio"
                  name="entrada-destino"
                  checked={destino === 'stage'}
                  onChange={() => setDestino('stage')}
                />
                <span>Stage (separação — sem endereço físico)</span>
              </label>
            </li>
          </ul>
        </fieldset>
        <p className="muted stage-destino-aviso">
          Você poderá alterar item a item na tabela abaixo.
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn primary" onClick={() => onConfirm(destino)}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}
