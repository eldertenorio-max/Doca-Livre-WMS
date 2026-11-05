import { useCallback, useEffect, useState } from 'react'
import { PageInfoBlock, PagePanelHeading } from '../components/ui/PagePanelHeading'
import {
  fetchHubPrevisoesLight,
  formatHubDataHora,
  labelHubStatus,
  type HubPrevisao,
} from '../lib/hubIntegracao'

function quando(prev: HubPrevisao): string {
  const confirmada = formatHubDataHora(prev.data_confirmada, prev.hora_confirmada)
  if (confirmada !== '—') return confirmada
  return formatHubDataHora(prev.data_solicitada, prev.hora_solicitada)
}

export default function AgendamentosHub() {
  const [items, setItems] = useState<HubPrevisao[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchHubPrevisoesLight(signal))
    } catch (e: unknown) {
      if (signal?.aborted) return
      setItems([])
      setError(e instanceof Error ? e.message : 'Falha ao ler o Hub de Integração.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void carregar(ctrl.signal)
    const timer = window.setInterval(() => {
      void fetchHubPrevisoesLight().then(setItems).catch(() => undefined)
    }, 60000)
    return () => {
      ctrl.abort()
      window.clearInterval(timer)
    }
  }, [carregar])

  return (
    <div className="page-panel page-panel--wide">
      <PagePanelHeading
        title="Agendamentos"
        info={
          <>
            <PageInfoBlock>
              Lista os agendamentos do Hub de Integração destinados ao <strong>WMS Light</strong>.
            </PageInfoBlock>
            <PageInfoBlock title="Destino">
              No Hub, use a aba <strong>Integração WMS</strong> para escolher Light, Plus ou Pro. Sem destino, o
              agendamento não aparece aqui.
            </PageInfoBlock>
          </>
        }
      />
      <p className="page-panel__subtitle">
        Previsões de entrada enviadas pelo Hub de Integração para este WMS.
      </p>
      <div style={{ marginBottom: 16 }}>
        <button type="button" className="page-btn-ghost" onClick={() => void carregar()} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      {error ? <p className="page-msg--error">{error}</p> : null}
      <div className="page-table-wrap">
        <table className="page-table">
          <thead>
            <tr>
              <th>NF / Pedido</th>
              <th>Cliente</th>
              <th>Status Hub</th>
              <th>Data</th>
              <th>Placa</th>
              <th>Volumes</th>
              <th>Protocolo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((prev) => (
              <tr key={prev.id}>
                <td>
                  {prev.nota_fiscal ? `NF ${prev.nota_fiscal}` : `Pedido ${prev.numero_pedido || prev.id}`}
                </td>
                <td>
                  {prev.cliente || '—'}
                  {prev.portal ? ` · ${prev.portal}` : ''}
                </td>
                <td>{labelHubStatus(prev.status)}</td>
                <td>{quando(prev)}</td>
                <td>{prev.placa || '—'}</td>
                <td>{prev.volumes != null ? prev.volumes : '—'}</td>
                <td>{prev.protocolo || '—'}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && !error ? (
              <tr>
                <td colSpan={7}>Nenhum agendamento destinado ao Light. Defina o destino no Hub (Integração WMS).</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
