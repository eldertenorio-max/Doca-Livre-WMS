import { useEffect, useMemo, useState } from 'react'
import WmsBarChart from '../dashboard/WmsBarChart'
import WmsKpiCard from '../dashboard/WmsKpiCard'
import { buildPainelInventario } from '../../lib/painelInventarioData'
import { listInventarios } from '../../lib/inventarioSessaoStore'
import type { InventarioSessao } from '../../lib/inventarioSessaoTypes'
import '../dashboard/wmsDashboard.css'

type Props = {
  refreshKey?: number
}

export default function InventarioPainel({ refreshKey = 0 }: Props) {
  const [invs, setInvs] = useState<InventarioSessao[]>([])

  useEffect(() => {
    void listInventarios()
      .then(setInvs)
      .catch(() => setInvs([]))
  }, [refreshKey])

  const data = useMemo(() => buildPainelInventario(invs), [invs])

  const fechados = useMemo(() => invs.filter((i) => i.status === 'fechado').length, [invs])

  const porCamara = useMemo(() => {
    const map = new Map<string, number>()
    for (const inv of invs) {
      for (const ln of inv.linhas) {
        const cam = ln.endereco.trim().split('-')[0] || '—'
        map.set(cam, (map.get(cam) ?? 0) + 1)
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label: `C${label}`, value }))
  }, [invs])

  return (
    <section className="wms-dashboard wms-dashboard--inventario">
      <header className="wms-dashboard__header">
        <h2 className="wms-dashboard__heading">Painel — Inventário</h2>
        <p className="wms-dashboard__hint">Indicadores das sessões de inventário (Supabase)</p>
      </header>

      <div className="wms-dashboard__top">
        <WmsKpiCard
          tone="yellow"
          title="Inventários abertos"
          value={String(data.inventariosAbertos)}
          subtitle="Sessões em andamento"
          icon={<span>📦</span>}
        />
        <WmsKpiCard
          tone="pink"
          title="Linhas hoje"
          value={String(data.linhasHoje)}
          subtitle="Capturas do dia"
          icon={<span>📋</span>}
        />
        <WmsKpiCard
          tone="blue"
          title="Endereços cadastrados"
          value={String(data.enderecosCadastrados)}
          subtitle="Base de endereçamento"
          icon={<span>📍</span>}
        />
        <WmsKpiCard
          tone="green"
          title="Endereços contados hoje"
          value={String(data.enderecosContadosHoje)}
          subtitle="Distintos no dia"
          icon={<span>✔️</span>}
        />
      </div>

      <div className="wms-dashboard__body">
        <div className="wms-dashboard__side">
          <WmsKpiCard
            tone="brown"
            title="Linhas totais"
            value={String(data.linhasTotal)}
            subtitle="Todas as sessões"
            icon={<span>📊</span>}
          />
          <WmsKpiCard
            tone="red"
            title="Inventários fechados"
            value={String(fechados)}
            subtitle="Histórico"
            icon={<span>🔒</span>}
          />
          <WmsKpiCard
            tone="navy"
            title="Média diária (7d)"
            value={String(
              Math.round(
                data.serieUltimosDias.reduce((s, p) => s + p.value, 0) /
                  Math.max(1, data.serieUltimosDias.length),
              ),
            )}
            subtitle="Linhas / dia"
            icon={<span>📈</span>}
          />
          <WmsKpiCard
            tone="orange"
            title="Pico semanal"
            value={String(data.serieUltimosDias.reduce((m, p) => Math.max(m, p.value), 0))}
            subtitle="Linhas em 1 dia"
            icon={<span>🗓️</span>}
          />
        </div>

        <div className="wms-dashboard__charts-stack">
          <WmsBarChart
            title="Capturas de inventário (últimos 7 dias)"
            points={data.serieUltimosDias}
            barColor="#c62828"
          />
          {porCamara.length > 0 ? (
            <WmsBarChart title="Linhas por câmara (top)" points={porCamara} barColor="#00695c" />
          ) : null}
        </div>
      </div>
    </section>
  )
}
