import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { coletarInventarioCamara } from '../lib/camaraInventario'
import { formatValorNfe, formatQuantidadeNfe } from '../lib/formatNfeItem'
import { formatPesoKg } from '../lib/nfResumo'
import type { MovimentoRegistro, NotaFiscal } from '../types'
import { CamaraStatsCards } from './CamaraStatsCards'

type Props = {
  camaraId: number
  tipo: string
  notas: NotaFiscal[]
  movimentos: MovimentoRegistro[]
  onClose: () => void
}

function formatData(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    const [y, m, day] = iso.split('-')
    if (y && m && day) return `${day}/${m}/${y}`
    return iso
  }
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDataCurta(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    const [y, m, day] = iso.split('-')
    if (y && m && day) return `${day}/${m}/${y}`
    return iso
  }
  return d.toLocaleDateString('pt-BR')
}

export function CamaraInfoModal({ camaraId, tipo, notas, movimentos, onClose }: Props) {
  useBodyScrollLock(true)

  const inventario = useMemo(
    () => coletarInventarioCamara(camaraId, tipo, notas, movimentos),
    [camaraId, tipo, notas, movimentos],
  )

  return createPortal(
    <div className="modal-backdrop modal-backdrop--fullscreen" onClick={onClose} role="presentation">
      <div
        className="modal camara-info-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="camara-info-title"
      >
        <header className="camara-info-modal-header">
          <div>
            <h2 id="camara-info-title">
              Câmara {camaraId}
              <span className="camara-info-modal-tipo">{tipo}</span>
            </h2>
            <p className="camara-info-modal-sub muted">
              {inventario.linhas.length} posição(ões) · {inventario.notas.length} nota(s) fiscal(is)
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="camara-info-modal-body">
          <CamaraStatsCards resumo={inventario.resumo} />

          {inventario.notas.length === 0 ? (
            <p className="camara-info-empty muted">Nenhum produto armazenado nesta câmara.</p>
          ) : (
            inventario.notas.map((nf) => (
              <section key={nf.nfId} className="camara-info-nf-block">
                <header className="camara-info-nf-head">
                  <h3>NF {nf.numero}</h3>
                  <dl className="camara-info-nf-meta">
                    <div>
                      <dt>Série</dt>
                      <dd>{nf.serie || '—'}</dd>
                    </div>
                    <div>
                      <dt>Emitente</dt>
                      <dd>{nf.emitente || '—'}</dd>
                    </div>
                    <div>
                      <dt>Emissão</dt>
                      <dd>{formatDataCurta(nf.dataEmissao)}</dd>
                    </div>
                    <div>
                      <dt>Valor total</dt>
                      <dd>{nf.valorTotal != null ? formatValorNfe(nf.valorTotal) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Peso bruto</dt>
                      <dd>{formatPesoKg(nf.pesoBruto)}</dd>
                    </div>
                    <div>
                      <dt>Posições nesta câmara</dt>
                      <dd>{nf.linhas.length}</dd>
                    </div>
                  </dl>
                </header>

                <div className="camara-info-table-wrap">
                  <table className="camara-info-table">
                    <thead>
                      <tr>
                        <th>Posição</th>
                        <th>Código</th>
                        <th>Produto</th>
                        <th>Qtd item</th>
                        <th>Qtd posição</th>
                        <th>Un</th>
                        <th>Lote</th>
                        <th>UP</th>
                        <th>Fabricação</th>
                        <th>Validade</th>
                        <th>Armazenado em</th>
                        <th>Valor pos.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nf.linhas.map((linha) => (
                        <tr key={`${linha.addressId}-${linha.itemIndex}`}>
                          <td>{linha.endereco}</td>
                          <td>{linha.codigo}</td>
                          <td>{linha.descricao}</td>
                          <td>{formatQuantidadeNfe(linha.quantidade)}</td>
                          <td>{formatQuantidadeNfe(linha.quantidadeNaPosicao)}</td>
                          <td>{linha.unidade}</td>
                          <td>{linha.lote?.trim() || '—'}</td>
                          <td>{linha.up?.trim() || '—'}</td>
                          <td>{formatDataCurta(linha.dataFabricacao)}</td>
                          <td>{formatDataCurta(linha.dataValidade)}</td>
                          <td>{formatData(linha.dataArmazenagem)}</td>
                          <td>
                            {linha.valorNaPosicao != null
                              ? formatValorNfe(linha.valorNaPosicao)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
