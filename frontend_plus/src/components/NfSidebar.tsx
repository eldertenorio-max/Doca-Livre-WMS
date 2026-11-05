import type { ChangeEvent } from 'react'
import type { NfeItem, NotaFiscal } from '../types'
import { allItemsAllocated } from '../lib/repository'
import { itemEnderecamentoCompleto, paletesLimiteItem } from '../lib/paletes'
import { formatAddressLabel } from '../layout/camaras'

type Props = {
  notas: NotaFiscal[]
  activeNfId: string | null
  activeItemIndex: number | null
  pendingCount: number
  saving: boolean
  persistError: string | null
  onUpload: (file: File) => void
  onSelectNf: (id: string) => void
  onSelectItem: (index: number) => void
  onConfirmItem: () => void
  onFinishNf: () => void
  onRemoveNf: (id: string) => void
  uploadError: string | null
}

function itemStatus(item: NfeItem): 'pendente' | 'parcial' | 'ok' {
  if (itemEnderecamentoCompleto(item)) return 'ok'
  const limite = paletesLimiteItem(item)
  if (item.allocatedAddresses.length > 0 && limite > 0) return 'parcial'
  return 'pendente'
}

export function NfSidebar({
  notas,
  activeNfId,
  activeItemIndex,
  pendingCount,
  saving,
  persistError,
  onUpload,
  onSelectNf,
  onSelectItem,
  onConfirmItem,
  onFinishNf,
  onRemoveNf,
  uploadError,
}: Props) {
  const activeNf = notas.find((n) => n.id === activeNfId) ?? null

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-block">
        <h1 className="app-brand-title">
          <span className="app-brand-title__main">Stock System</span>
          <span className="app-brand-title__light">Plus</span>
        </h1>
        <p className="muted">Ultrafrio · alocação por NF-e</p>
        {saving && <p className="saving-hint">Salvando…</p>}
        {persistError && <p className="error">{persistError}</p>}
      </div>

      <div className="sidebar-block">
        <label className="upload-btn">
          <input type="file" accept=".xml,text/xml,application/xml" hidden onChange={handleFile} />
          Subir XML da NF-e
        </label>
        {uploadError && <p className="error">{uploadError}</p>}
      </div>

      {notas.length > 0 && (
        <div className="sidebar-block">
          <h3>Notas fiscais</h3>
          <ul className="nf-list">
            {notas.map((nf) => (
              <li key={nf.id}>
                <button
                  type="button"
                  className={`nf-chip ${nf.id === activeNfId ? 'nf-chip--active' : ''} nf-chip--${nf.status}`}
                  onClick={() => onSelectNf(nf.id)}
                >
                  <strong>NF {nf.numero}</strong>
                  <span>{nf.status === 'concluida' ? 'Concluída' : 'Em andamento'}</span>
                </button>
                <button
                  type="button"
                  className="nf-remove"
                  title="Remover nota"
                  onClick={() => onRemoveNf(nf.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeNf && (
        <div className="sidebar-block nf-detail">
          <h3>NF {activeNf.numero}</h3>
          <dl className="meta-list">
            <div><dt>Série</dt><dd>{activeNf.serie || '—'}</dd></div>
            <div><dt>Emitente</dt><dd>{activeNf.emitente || '—'}</dd></div>
            <div><dt>Emissão</dt><dd>{formatDate(activeNf.dataEmissao)}</dd></div>
            {activeNf.chave && (
              <div><dt>Chave</dt><dd className="chave">{activeNf.chave}</dd></div>
            )}
          </dl>

          <h4>Itens — selecione e marque endereços</h4>
          <ul className="item-list">
            {activeNf.items.map((item) => {
              const st = itemStatus(item)
              const isActive = activeItemIndex === item.index
              return (
                <li key={item.index}>
                  <button
                    type="button"
                    className={`item-row ${isActive ? 'item-row--active' : ''} item-row--${st}`}
                    onClick={() => onSelectItem(item.index)}
                  >
                    <span className="item-check">{st === 'ok' ? '✓' : '○'}</span>
                    <span className="item-text">
                      <strong>{item.codigo}</strong>
                      <span>{item.descricao}</span>
                      <span className="muted">
                        {item.quantidade} {item.unidade} · {item.allocatedAddresses.length} endereço(s)
                      </span>
                    </span>
                  </button>
                  {item.allocatedAddresses.length > 0 && (
                    <ul className="addr-mini">
                      {item.allocatedAddresses.map((a) => (
                        <li key={a}>{formatAddressLabel(a)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          {activeItemIndex != null && activeNf.status !== 'concluida' && (
            <div className="item-actions">
              <p className="muted">
                {pendingCount} endereço(s) selecionado(s) para este item
              </p>
              <button type="button" className="btn primary" onClick={onConfirmItem} disabled={pendingCount === 0}>
                Confirmar endereços do item
              </button>
            </div>
          )}

          {activeNf.status !== 'concluida' && allItemsAllocated(activeNf) && (
            <button type="button" className="btn success full" onClick={onFinishNf}>
              Concluir NF {activeNf.numero}
            </button>
          )}

          {activeNf.status === 'concluida' && (
            <p className="badge-concluida">Nota concluída — quadrados exibem NF {activeNf.numero}</p>
          )}
        </div>
      )}
    </aside>
  )
}

function formatDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleString('pt-BR')
}
