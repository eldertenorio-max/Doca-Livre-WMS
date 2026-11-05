import { useEffect, useState } from 'react'
import WmsBarChart from '../dashboard/WmsBarChart'
import WmsKpiCard from '../dashboard/WmsKpiCard'
import {
  fetchPainelContagemDiaria,
  type PainelContagemDiaria,
} from '../../lib/painelContagemDiariaData'
import '../dashboard/wmsDashboard.css'

const EMPTY: PainelContagemDiaria = {
  hojeYmd: '',
  itensHoje: 0,
  conferentesHoje: 0,
  produtosDistintosHoje: 0,
  presencaHoje: 0,
  serieUltimosDias: [],
}

export default function ContagemDiariaPainel() {
  const [data, setData] = useState<PainelContagemDiaria>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void fetchPainelContagemDiaria()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (alive) setData(EMPTY)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const mediaPorConf =
    data.conferentesHoje > 0 ? Math.round(data.itensHoje / data.conferentesHoje) : 0
  const picoSemana = data.serieUltimosDias.reduce((m, p) => Math.max(m, p.value), 0)

  return (
    <section className="wms-dashboard" aria-busy={loading}>
      <header className="wms-dashboard__header">
        <h2 className="wms-dashboard__heading">Painel — Contagem diária</h2>
        <p className="wms-dashboard__hint">
          Resumo do dia {data.hojeYmd ? data.hojeYmd.split('-').reverse().join('/') : '—'} (SP)
        </p>
      </header>

      <div className="wms-dashboard__top">
        <WmsKpiCard
          tone="yellow"
          title="Itens contados hoje"
          value={String(data.itensHoje)}
          subtitle={`${data.conferentesHoje} conferente(s)`}
          icon={<span>📦</span>}
        />
        <WmsKpiCard
          tone="pink"
          title="Conferentes ativos"
          value={String(data.conferentesHoje)}
          subtitle="Com registro hoje"
          icon={<span>👤</span>}
        />
        <WmsKpiCard
          tone="blue"
          title="SKUs distintos"
          value={String(data.produtosDistintosHoje)}
          subtitle="Produtos únicos"
          icon={<span>🏷️</span>}
        />
        <WmsKpiCard
          tone="green"
          title="Presença"
          value={String(data.presencaHoje)}
          subtitle="Check-in do dia"
          icon={<span>✅</span>}
        />
      </div>

      <div className="wms-dashboard__body">
        <div className="wms-dashboard__side">
          <WmsKpiCard
            tone="brown"
            title="Média por conferente"
            value={`${mediaPorConf}`}
            subtitle="Itens / conferente"
            icon={<span>📊</span>}
          />
          <WmsKpiCard
            tone="red"
            title="Pico da semana"
            value={`${picoSemana}`}
            subtitle="Máx. itens em 1 dia"
            icon={<span>📈</span>}
          />
          <WmsKpiCard
            tone="navy"
            title="Ontem"
            value={String(data.serieUltimosDias.at(-2)?.value ?? 0)}
            subtitle="Itens contados"
            icon={<span>📅</span>}
          />
          <WmsKpiCard
            tone="orange"
            title="7 dias"
            value={String(data.serieUltimosDias.reduce((s, p) => s + p.value, 0))}
            subtitle="Total acumulado"
            icon={<span>🗓️</span>}
          />
        </div>

        <WmsBarChart
          title="Volume de contagem diária (últimos 7 dias)"
          points={data.serieUltimosDias.map((p) => ({ label: p.label, value: p.value }))}
          barColor="#1a5c5c"
        />
      </div>
    </section>
  )
}
