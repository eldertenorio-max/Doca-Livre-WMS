import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { LocalizacaoEstoque } from '../types'

export type EscolhaEstoqueOpcao = LocalizacaoEstoque | 'armazem_apenas'

type OpcaoConfig = {
  id: EscolhaEstoqueOpcao
  label: string
  descricao?: string
}

type Props = {
  title: string
  pergunta: string
  opcoes: OpcaoConfig[]
  onConfirm: (opcao: EscolhaEstoqueOpcao) => void
  onCancel: () => void
}

export function EscolhaEstoqueModal({ title, pergunta, opcoes, onConfirm, onCancel }: Props) {
  const [opcao, setOpcao] = useState<EscolhaEstoqueOpcao>(opcoes[0]?.id ?? 'armazem')
  useBodyScrollLock(true)

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm-box confirm-box--wide" onClick={(e) => e.stopPropagation()}>
        <h4>{title}</h4>
        <p>{pergunta}</p>
        <fieldset className="saida-justificativa stage-destino-fieldset">
          <legend className="saida-justificativa-title">Escolha</legend>
          <ul className="saida-justificativa-list">
            {opcoes.map((opt) => (
              <li key={opt.id}>
                <label className="saida-justificativa-option">
                  <input
                    type="radio"
                    name="escolha-estoque"
                    checked={opcao === opt.id}
                    onChange={() => setOpcao(opt.id)}
                  />
                  <span>
                    {opt.label}
                    {opt.descricao && <span className="muted"> — {opt.descricao}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn primary" onClick={() => onConfirm(opcao)}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}
