import { useRef, type ChangeEvent } from 'react'
import type { NotaFiscal } from '../types'
import { findNotaByNumero, normNumero } from '../lib/nfDuplicate'
import {
  formatHubDataHora,
  labelHubStatus,
  type HubPrevisao,
  useHubPrevisoes,
} from '../lib/hubIntegracao'

type WmsSituacao = 'previsto' | 'pronto' | 'em_entrada' | 'no_wms'

type Props = {
  notas: NotaFiscal[]
  onDarEntradaXml: (previsao: HubPrevisao, files: File[]) => void
  onDarEntradaManual: (previsao: HubPrevisao) => void
  onAbrirNf: (nfId: string) => void
}

function situacaoWms(prev: HubPrevisao, notas: NotaFiscal[]): WmsSituacao {
  const nf = prev.nota_fiscal ? findNotaByNumero(notas, prev.nota_fiscal) : undefined
  if (nf?.status === 'concluida') return 'no_wms'
  if (nf?.status === 'em_andamento') return 'em_entrada'
  if (prev.pronto_entrada || prev.status === 'agendado') return 'pronto'
  return 'previsto'
}

function labelSituacao(s: WmsSituacao): string {
  switch (s) {
    case 'no_wms':
      return 'Já no WMS'
    case 'em_entrada':
      return 'Entrada em andamento'
    case 'pronto':
      return 'Pronto para entrada'
    default:
      return 'Previsão'
  }
}

export function HubPrevisaoEntrada({ notas, onDarEntradaXml, onDarEntradaManual, onAbrirNf }: Props) {
  const { items, loading, error, reload } = useHubPrevisoes(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<HubPrevisao | null>(null)

  function handleXmlClick(prev: HubPrevisao) {
    pendingRef.current = prev
    fileRef.current?.click()
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    const prev = pendingRef.current
    e.target.value = ''
    pendingRef.current = null
    if (prev && files.length > 0) onDarEntradaXml(prev, files)
  }

  return (
    <div className="sidebar-block hub-prev">
      <div className="hub-prev-head">
        <h3>Agendamentos (Hub)</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <p className="muted hub-prev-hint">
        Agendamentos do Hub destinados ao <strong>WMS Plus</strong>. Quando estiver agendado, suba o XML ou
        cadastre a NF para endereçar os produtos.
      </p>
      <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={handleFileChange} />
      {error ? <p className="error">{error}</p> : null}
      {!error && !loading && items.length === 0 ? (
        <p className="muted">Nenhum agendamento destinado ao Plus. No Hub, use a aba Integração WMS.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="hub-prev-list">
          {items.map((prev) => {
            const sit = situacaoWms(prev, notas)
            const nfWms = prev.nota_fiscal ? findNotaByNumero(notas, prev.nota_fiscal) : undefined
            const quando =
              formatHubDataHora(prev.data_confirmada, prev.hora_confirmada) !== '—'
                ? formatHubDataHora(prev.data_confirmada, prev.hora_confirmada)
                : formatHubDataHora(prev.data_solicitada, prev.hora_solicitada)
            return (
              <li key={prev.id} className={`hub-prev-card hub-prev-card--${sit}`}>
                <div className="hub-prev-card-top">
                  <strong>
                    {prev.nota_fiscal ? `NF ${normNumero(prev.nota_fiscal)}` : `Pedido ${prev.numero_pedido || prev.id}`}
                  </strong>
                  <span className={`hub-prev-badge hub-prev-badge--${sit}`}>{labelSituacao(sit)}</span>
                </div>
                <p className="hub-prev-meta">
                  {prev.cliente || 'Cliente'}
                  {prev.portal ? ` · ${prev.portal}` : ''}
                  {quando !== '—' ? ` · ${quando}` : ''}
                </p>
                <p className="hub-prev-meta">
                  Hub: {labelHubStatus(prev.status)}
                  {prev.protocolo ? ` · prot. ${prev.protocolo}` : ''}
                  {prev.placa ? ` · ${prev.placa}` : ''}
                  {prev.volumes != null ? ` · ${prev.volumes} vol.` : ''}
                </p>
                {sit === 'no_wms' || sit === 'em_entrada' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => nfWms && onAbrirNf(nfWms.id)}
                    disabled={!nfWms}
                  >
                    Abrir no WMS
                  </button>
                ) : (
                  <div className="hub-prev-actions">
                    <button type="button" className="btn primary btn-sm" onClick={() => handleXmlClick(prev)}>
                      Subir XML
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDarEntradaManual(prev)}>
                      Cadastrar NF
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
