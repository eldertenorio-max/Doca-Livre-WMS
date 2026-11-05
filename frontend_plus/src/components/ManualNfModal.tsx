import { useId, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { normalizeDataFabricacao, pickItemCampos, todayDateInputMax } from '../lib/entradaCampos'
import type { NotaFiscal } from '../types'
import { findNotaByNumero } from '../lib/nfDuplicate'
import type { ManualNfInput } from '../lib/manualNf'
import { validarManualNfInput } from '../lib/manualNf'

export type ManualNfModalResult =
  | { kind: 'existing'; nfId: string; itemIndex: number }
  | { kind: 'new'; input: ManualNfInput }

type ManualItemDraft = {
  id: string
  codigo: string
  descricao: string
  quantidade: string
  unidade: string
  up: string
  lote: string
  dataFabricacao: string
  dataValidade: string
}

type Props = {
  notas: NotaFiscal[]
  emitentesSugeridos: string[]
  serverError?: string | null
  /** Abre direto no formulário de nova NF (botão da aba Entrada). */
  startInCreateMode?: boolean
  initialNumero?: string
  onConfirm: (result: ManualNfModalResult) => void
  onClose: () => void
}

function createItemDraft(): ManualItemDraft {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    codigo: '',
    descricao: '',
    quantidade: '1',
    unidade: 'UN',
    up: '',
    lote: '',
    dataFabricacao: '',
    dataValidade: '',
  }
}

function parseItemsDraft(items: ManualItemDraft[]): ManualNfInput['items'] {
  return items.map((item) => ({
    codigo: item.codigo,
    descricao: item.descricao,
    quantidade: Number(item.quantidade.replace(',', '.')),
    unidade: item.unidade,
    ...pickItemCampos(item),
  }))
}

export function ManualNfModal({
  notas,
  emitentesSugeridos,
  serverError,
  startInCreateMode = false,
  initialNumero = '',
  onConfirm,
  onClose,
}: Props) {
  const [numero, setNumero] = useState(initialNumero)
  const [numeroCadastro, setNumeroCadastro] = useState(initialNumero)
  const [searched, setSearched] = useState<NotaFiscal | null | undefined>(
    startInCreateMode ? null : undefined,
  )
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(startInCreateMode)
  const [serie, setSerie] = useState('')
  const [emitente, setEmitente] = useState('')
  const [items, setItems] = useState<ManualItemDraft[]>(() => [createItemDraft()])
  const [error, setError] = useState<string | null>(null)
  const emitentesListId = useId()

  useBodyScrollLock(true)

  function resetCreateForm() {
    setSerie('')
    setEmitente('')
    setItems([createItemDraft()])
  }

  function handleBuscar() {
    setError(null)
    const trimmed = numero.trim()
    if (!trimmed) {
      setError('Informe o número da NF.')
      return
    }
    const nf = findNotaByNumero(notas, trimmed)
    setSearched(nf ?? null)
    setSelectedItemIndex(nf?.items[0]?.index ?? null)
    setShowCreate(!nf)
    if (!nf) {
      setNumeroCadastro(trimmed)
      resetCreateForm()
    } else {
      setNumeroCadastro('')
    }
    setNumero('')
  }

  function updateItem(id: string, patch: Partial<Omit<ManualItemDraft, 'id'>>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, createItemDraft()])
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== id)))
  }

  function handleConfirm() {
    setError(null)

    if (searched && !showCreate) {
      if (selectedItemIndex == null) {
        setError('Selecione o item da NF.')
        return
      }
      onConfirm({ kind: 'existing', nfId: searched.id, itemIndex: selectedItemIndex })
      return
    }

    if (!showCreate && searched === undefined) {
      setError('Busque a NF pelo número ou use o cadastro manual abaixo.')
      return
    }

    const input: ManualNfInput = {
      numero: numeroCadastro.trim(),
      serie,
      emitente,
      items: parseItemsDraft(items),
    }

    const validation = validarManualNfInput(input)
    if (validation) {
      setError(validation)
      return
    }

    onConfirm({ kind: 'new', input })
  }

  const exibirFormularioCriacao = showCreate || (searched === null && searched !== undefined)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal manual-nf-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-nf-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="manual-nf-title">Cadastrar NF manual</h2>
            <p className="muted manual-nf-sub">
              Cadastre a nota e os itens sem XML — depois aloque nos endereços no painel.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <section className="modal-section modal-section--first">
          <h3>Nota fiscal</h3>
          <div className="saida-busca">
            <input
              type="text"
              className="input-nf"
              placeholder="Número da NF"
              value={numero}
              onChange={(e) => {
                setNumero(e.target.value)
                setSearched(undefined)
                setShowCreate(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
            <button type="button" className="btn primary" onClick={handleBuscar}>
              Registrar
            </button>
          </div>
        </section>

        {searched && !showCreate && (
          <section className="modal-section">
            <h3>Item da NF</h3>
            <p className="muted">
              NF {searched.numero}
              {searched.emitente ? ` · ${searched.emitente}` : ''}
            </p>
            <ul className="item-list manual-nf-item-list">
              {searched.items.map((item) => (
                <li key={item.index}>
                  <button
                    type="button"
                    className={`item-row ${selectedItemIndex === item.index ? 'item-row--active' : ''}`}
                    onClick={() => setSelectedItemIndex(item.index)}
                  >
                    <span className="item-check">{selectedItemIndex === item.index ? '●' : '○'}</span>
                    <span className="item-text">
                      <strong>{item.codigo}</strong>
                      <span>{item.descricao}</span>
                      <span className="muted">
                        {item.quantidade} {item.unidade} · {item.allocatedAddresses.length} end.
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setNumeroCadastro(searched.numero)
                setShowCreate(true)
              }}
            >
              NF não encontrada? Cadastrar manualmente
            </button>
          </section>
        )}

        {exibirFormularioCriacao && (
          <section className="modal-section">
            <h3>{searched === null ? 'Cadastrar NF manual' : 'Nova NF manual'}</h3>
            {searched === null && numeroCadastro.trim() && (
              <p className="muted">
                NF {numeroCadastro.trim()} não está no sistema. Preencha os dados abaixo.
              </p>
            )}
            <div className="manual-nf-form manual-nf-form--nf">
              <label className="manual-nf-field">
                <span>Número da NF</span>
                <input
                  type="text"
                  className="input-nf"
                  value={numeroCadastro}
                  onChange={(e) => setNumeroCadastro(e.target.value)}
                  placeholder="Obrigatório"
                />
              </label>
              <label className="manual-nf-field">
                <span>Série</span>
                <input type="text" className="input-nf" value={serie} onChange={(e) => setSerie(e.target.value)} />
              </label>
              <label className="manual-nf-field manual-nf-field--wide">
                <span>Remetente</span>
                <input
                  type="text"
                  className="input-nf"
                  list={emitentesListId}
                  value={emitente}
                  onChange={(e) => setEmitente(e.target.value)}
                  placeholder="Opcional"
                  autoComplete="off"
                />
                {emitentesSugeridos.length > 0 && (
                  <datalist id={emitentesListId}>
                    {emitentesSugeridos.map((nome) => (
                      <option key={nome} value={nome} />
                    ))}
                  </datalist>
                )}
              </label>
            </div>

            <div className="manual-nf-items">
              {items.map((item, index) => (
                <div key={item.id} className="manual-nf-item-block">
                  <div className="manual-nf-item-head">
                    <h4>Item {index + 1}</h4>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm manual-nf-item-remove"
                        onClick={() => removeItem(item.id)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <div className="manual-nf-form">
                    <label className="manual-nf-field">
                      <span>Código do item</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={item.codigo}
                        onChange={(e) => updateItem(item.id, { codigo: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field manual-nf-field--wide">
                      <span>Descrição</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={item.descricao}
                        onChange={(e) => updateItem(item.id, { descricao: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>Quantidade</span>
                      <input
                        type="text"
                        className="input-nf"
                        inputMode="decimal"
                        value={item.quantidade}
                        onChange={(e) => updateItem(item.id, { quantidade: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>Unidade</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={item.unidade}
                        onChange={(e) => updateItem(item.id, { unidade: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>UP</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={item.up}
                        onChange={(e) => updateItem(item.id, { up: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>Lote</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={item.lote}
                        onChange={(e) => updateItem(item.id, { lote: e.target.value })}
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>Data de fabricação</span>
                      <input
                        type="date"
                        className="input-nf"
                        max={todayDateInputMax()}
                        value={item.dataFabricacao}
                        onChange={(e) =>
                          updateItem(item.id, {
                            dataFabricacao: normalizeDataFabricacao(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="manual-nf-field">
                      <span>Data de validade</span>
                      <input
                        type="date"
                        className="input-nf"
                        value={item.dataValidade}
                        onChange={(e) => updateItem(item.id, { dataValidade: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-ghost btn-sm manual-nf-add-item" onClick={addItem}>
              + Adicionar item
            </button>

            {searched && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>
                Voltar para NF existente
              </button>
            )}
          </section>
        )}

        {(error || serverError) && (
          <p className="error manual-nf-error" role="alert">
            {error ?? serverError}
          </p>
        )}

        <div className="manual-nf-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary" onClick={handleConfirm}>
            Cadastrar NF
          </button>
        </div>
      </div>
    </div>
  )
}
