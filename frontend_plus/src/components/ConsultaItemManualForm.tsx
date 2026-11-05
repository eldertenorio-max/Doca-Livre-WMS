import { useState } from 'react'
import { normalizeDataFabricacao, todayDateInputMax } from '../lib/entradaCampos'
import { parsePaletesInput } from '../lib/paletes'
import type { ItemManualInput } from '../lib/adicionarItemNf'

type Props = {
  onConfirm: (input: ItemManualInput) => void
  onCancel: () => void
  erro?: string | null
}

type Draft = {
  codigo: string
  descricao: string
  quantidade: string
  unidade: string
  paletes: string
  up: string
  lote: string
  dataFabricacao: string
  dataValidade: string
}

const VAZIO: Draft = {
  codigo: '',
  descricao: '',
  quantidade: '1',
  unidade: 'UN',
  paletes: '1',
  up: '',
  lote: '',
  dataFabricacao: '',
  dataValidade: '',
}

export function ConsultaItemManualForm({ onConfirm, onCancel, erro }: Props) {
  const [draft, setDraft] = useState<Draft>(VAZIO)

  function patch(partial: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...partial }))
  }

  function handleConfirm() {
    const paletes = parsePaletesInput(draft.paletes)
    if (paletes == null || paletes <= 0) return
    onConfirm({
      codigo: draft.codigo,
      descricao: draft.descricao,
      quantidade: Number(draft.quantidade.replace(',', '.')),
      unidade: draft.unidade,
      paletes,
      up: draft.up,
      lote: draft.lote,
      dataFabricacao: draft.dataFabricacao,
      dataValidade: draft.dataValidade,
    })
  }

  return (
    <div className="consulta-item-manual">
      <h4 className="consulta-item-manual-titulo">Item manual</h4>
      <div className="manual-nf-form">
        <label className="manual-nf-field">
          <span>Código do item</span>
          <input
            type="text"
            className="input-nf"
            value={draft.codigo}
            onChange={(e) => patch({ codigo: e.target.value })}
          />
        </label>
        <label className="manual-nf-field manual-nf-field--wide">
          <span>Descrição</span>
          <input
            type="text"
            className="input-nf"
            value={draft.descricao}
            onChange={(e) => patch({ descricao: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Quantidade</span>
          <input
            type="text"
            className="input-nf"
            inputMode="decimal"
            value={draft.quantidade}
            onChange={(e) => patch({ quantidade: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Unidade</span>
          <input
            type="text"
            className="input-nf"
            value={draft.unidade}
            onChange={(e) => patch({ unidade: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Paletes</span>
          <input
            type="number"
            min={1}
            step={1}
            className="input-nf"
            value={draft.paletes}
            onChange={(e) => patch({ paletes: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>UP</span>
          <input
            type="text"
            className="input-nf"
            value={draft.up ?? ''}
            onChange={(e) => patch({ up: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Lote</span>
          <input
            type="text"
            className="input-nf"
            value={draft.lote ?? ''}
            onChange={(e) => patch({ lote: e.target.value })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Data de fabricação</span>
          <input
            type="date"
            className="input-nf"
            max={todayDateInputMax()}
            value={draft.dataFabricacao ?? ''}
            onChange={(e) => patch({ dataFabricacao: normalizeDataFabricacao(e.target.value) })}
          />
        </label>
        <label className="manual-nf-field">
          <span>Data de validade</span>
          <input
            type="date"
            className="input-nf"
            value={draft.dataValidade ?? ''}
            onChange={(e) => patch({ dataValidade: e.target.value })}
          />
        </label>
      </div>
      {erro && <p className="error">{erro}</p>}
      <p className="muted consulta-item-manual-hint">
        Após salvar, clique nas posições disponíveis no painel ao lado para indicar onde guardar
        o item.
      </p>
      <div className="consulta-item-manual-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={handleConfirm}>
          Salvar item
        </button>
      </div>
    </div>
  )
}
