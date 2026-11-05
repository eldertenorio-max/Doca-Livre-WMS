import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import WmsDonutChart from '../components/dashboard/WmsDonutChart'
import WmsHorizontalBarChart from '../components/dashboard/WmsHorizontalBarChart'
import WmsInteractiveBarChart from '../components/dashboard/WmsInteractiveBarChart'
import WmsKpiCard from '../components/dashboard/WmsKpiCard'
import { PagePanelHeading } from '../components/ui/PagePanelHeading'
import {
  daysAgoYmdSp,
  fetchPainelLinhasContagem,
  fetchPainelLinhasInventario,
  fetchPainelSessoesInventario,
  fetchPresencaContagemDia,
  filtrarLinhasContagem,
  filtrarLinhasInventario,
  formatYmdBr,
  kpisContagem,
  kpisInventario,
  seriePorCamara,
  seriePorConferente,
  seriePorDia,
  seriePorNumeroContagem,
  seriePorProduto,
  serieQuantidadePorCamara,
  serieQuantidadePorDia,
  serieStatusSessoesInventario,
  todayYmdSp,
  type PainelChartPoint,
  type PainelFiltroAtivo,
  type PainelLinhaContagem,
  type PainelLinhaInventario,
} from '../lib/painelAnalyticsData'
import type { InventarioSessao } from '../lib/inventarioSessaoTypes'
import { formatUnknownError } from '../lib/supabaseError'
import '../components/dashboard/wmsDashboard.css'
import './PainelPage.css'

type PainelTab = 'contagem' | 'inventario'

const FILTRO_VAZIO: PainelFiltroAtivo = {
  ymd: null,
  conferenteId: null,
  camara: null,
  codigoInterno: null,
}

function periodoPadraoPainel() {
  return { de: daysAgoYmdSp(13), ate: todayYmdSp() }
}

export default function PainelPage() {
  const [tab, setTab] = useState<PainelTab>('contagem')
  const [dataDe, setDataDe] = useState(() => periodoPadraoPainel().de)
  const [dataAte, setDataAte] = useState(() => periodoPadraoPainel().ate)
  const [draftDe, setDraftDe] = useState(dataDe)
  const [draftAte, setDraftAte] = useState(dataAte)
  const [filtro, setFiltro] = useState<PainelFiltroAtivo>(FILTRO_VAZIO)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [highlightChart, setHighlightChart] = useState<string | null>(null)
  const [linhasContagem, setLinhasContagem] = useState<PainelLinhaContagem[]>([])
  const [linhasInventario, setLinhasInventario] = useState<PainelLinhaInventario[]>([])
  const [sessoesInv, setSessoesInv] = useState<InventarioSessao[]>([])
  const [presencaHoje, setPresencaHoje] = useState(0)

  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const focarGrafico = useCallback((id: string) => {
    chartRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightChart(id)
    window.setTimeout(() => setHighlightChart(null), 1800)
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const [cont, inv, sessoes, presenca] = await Promise.all([
        fetchPainelLinhasContagem(dataDe, dataAte),
        fetchPainelLinhasInventario(dataDe, dataAte),
        fetchPainelSessoesInventario(),
        fetchPresencaContagemDia(todayYmdSp()),
      ])
      setLinhasContagem(cont)
      setLinhasInventario(inv)
      setSessoesInv(sessoes)
      setPresencaHoje(presenca)
    } catch (e: unknown) {
      setErro(formatUnknownError(e) || 'Erro ao carregar painel.')
    } finally {
      setLoading(false)
    }
  }, [dataDe, dataAte])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    setFiltro(FILTRO_VAZIO)
  }, [tab, dataDe, dataAte])

  function aplicarPeriodo() {
    if (draftDe && draftAte && draftDe > draftAte) {
      setErro('Data inicial não pode ser maior que a final.')
      return
    }
    setDataDe(draftDe)
    setDataAte(draftAte)
    setErro('')
  }

  function limparFiltros() {
    const { de, ate } = periodoPadraoPainel()
    setDraftDe(de)
    setDraftAte(ate)
    setDataDe(de)
    setDataAte(ate)
    setFiltro(FILTRO_VAZIO)
    setErro('')
  }

  const periodoAlterado =
    draftDe !== periodoPadraoPainel().de ||
    draftAte !== periodoPadraoPainel().ate ||
    dataDe !== periodoPadraoPainel().de ||
    dataAte !== periodoPadraoPainel().ate
  const filtrosGraficoAtivos =
    filtro.ymd != null ||
    filtro.conferenteId != null ||
    filtro.camara != null ||
    filtro.codigoInterno != null
  const podeLimparFiltros = periodoAlterado || filtrosGraficoAtivos || draftDe !== dataDe || draftAte !== dataAte

  const linhasContagemFiltradas = useMemo(
    () => filtrarLinhasContagem(linhasContagem, filtro),
    [linhasContagem, filtro],
  )
  const linhasInventarioFiltradas = useMemo(
    () => filtrarLinhasInventario(linhasInventario, filtro),
    [linhasInventario, filtro],
  )

  const kpiCont = useMemo(() => kpisContagem(linhasContagemFiltradas), [linhasContagemFiltradas])
  const kpiInv = useMemo(() => kpisInventario(linhasInventarioFiltradas, sessoesInv), [linhasInventarioFiltradas, sessoesInv])

  const baseCont = useMemo(() => filtrarLinhasContagem(linhasContagem, filtro), [linhasContagem, filtro])
  const baseInv = useMemo(() => filtrarLinhasInventario(linhasInventario, filtro), [linhasInventario, filtro])

  const serieDiaCont = useMemo(
    () => seriePorDia(filtrarLinhasContagem(linhasContagem, filtro, 'ymd'), dataDe, dataAte),
    [linhasContagem, filtro, dataDe, dataAte],
  )
  const serieQtdDiaCont = useMemo(
    () => serieQuantidadePorDia(filtrarLinhasContagem(linhasContagem, filtro, 'ymd'), dataDe, dataAte),
    [linhasContagem, filtro, dataDe, dataAte],
  )
  const serieDiaInv = useMemo(
    () => seriePorDia(filtrarLinhasInventario(linhasInventario, filtro, 'ymd'), dataDe, dataAte),
    [linhasInventario, filtro, dataDe, dataAte],
  )
  const serieQtdDiaInv = useMemo(
    () => serieQuantidadePorDia(filtrarLinhasInventario(linhasInventario, filtro, 'ymd'), dataDe, dataAte),
    [linhasInventario, filtro, dataDe, dataAte],
  )
  const serieConfCont = useMemo(
    () => seriePorConferente(filtrarLinhasContagem(linhasContagem, filtro, 'conferenteId')),
    [linhasContagem, filtro],
  )
  const serieConfInv = useMemo(
    () => seriePorConferente(filtrarLinhasInventario(linhasInventario, filtro, 'conferenteId')),
    [linhasInventario, filtro],
  )
  const serieProdCont = useMemo(
    () => seriePorProduto(filtrarLinhasContagem(linhasContagem, filtro, 'codigoInterno')),
    [linhasContagem, filtro],
  )
  const serieProdInv = useMemo(
    () => seriePorProduto(filtrarLinhasInventario(linhasInventario, filtro, 'codigoInterno')),
    [linhasInventario, filtro],
  )
  const serieCamaraInv = useMemo(
    () => seriePorCamara(filtrarLinhasInventario(linhasInventario, filtro, 'camara')),
    [linhasInventario, filtro],
  )
  const serieQtdCamaraInv = useMemo(
    () => serieQuantidadePorCamara(filtrarLinhasInventario(linhasInventario, filtro, 'camara')),
    [linhasInventario, filtro],
  )
  const serieNumContagemInv = useMemo(
    () => seriePorNumeroContagem(linhasInventarioFiltradas),
    [linhasInventarioFiltradas],
  )
  const serieStatusInv = useMemo(() => serieStatusSessoesInventario(sessoesInv), [sessoesInv])

  const filtrosAtivos = [
    filtro.ymd ? `Dia ${formatYmdBr(filtro.ymd)}` : null,
    filtro.conferenteId
      ? `Conferente ${(tab === 'contagem' ? linhasContagem : linhasInventario).find((l) => l.conferente_id === filtro.conferenteId)?.conferente_nome ?? ''}`
      : null,
    filtro.camara ? `Câmara ${filtro.camara}` : null,
    filtro.codigoInterno ? `Produto ${filtro.codigoInterno}` : null,
  ].filter(Boolean) as string[]

  function toggleDia(p: PainelChartPoint | null) {
    setFiltro((f) => ({ ...f, ymd: p ? p.id : null }))
  }

  function toggleConferente(p: PainelChartPoint | null) {
    setFiltro((f) => ({ ...f, conferenteId: p ? p.id : null }))
  }

  function toggleCamara(p: PainelChartPoint | null) {
    setFiltro((f) => ({ ...f, camara: p ? p.id : null }))
  }

  function toggleProduto(p: PainelChartPoint | null) {
    setFiltro((f) => ({ ...f, codigoInterno: p ? p.id : null }))
  }

  function chartWrap(id: string, children: ReactNode) {
    return (
      <div
        ref={(el) => {
          chartRefs.current[id] = el
        }}
        className={`painel-page__chart-slot${highlightChart === id ? ' painel-page__chart-slot--highlight' : ''}`}
      >
        {children}
      </div>
    )
  }

  return (
    <div className="page-panel page-panel--wide painel-page">
      <div className="painel-page__header-bar">
        <div className="painel-page__header-main">
          <PagePanelHeading
            className="painel-page__heading"
            title="Painel"
            info={
              <>
                Visão consolidada de <strong>contagem diária</strong> e <strong>inventário</strong>. Use o período
                acima e clique nos gráficos para filtrar — todos os indicadores acompanham a seleção. A lupa nos
                cards leva ao gráfico relacionado.
              </>
            }
          />

          <div className="page-tabs painel-page__tabs" role="tablist" aria-label="Módulo do painel">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'contagem'}
              className={`page-tabs__btn${tab === 'contagem' ? ' page-tabs__btn--active' : ''}`}
              onClick={() => setTab('contagem')}
            >
              Contagem diária
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'inventario'}
              className={`page-tabs__btn${tab === 'inventario' ? ' page-tabs__btn--active' : ''}`}
              onClick={() => setTab('inventario')}
            >
              Inventário
            </button>
          </div>
        </div>

        <form
          className="painel-page__periodo"
          onSubmit={(e) => {
            e.preventDefault()
            aplicarPeriodo()
          }}
        >
          <label>
            De
            <input type="date" value={draftDe} onChange={(e) => setDraftDe(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={draftAte} onChange={(e) => setDraftAte(e.target.value)} />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Carregando…' : 'Aplicar'}
          </button>
          <button type="button" className="page-btn-ghost" disabled={loading} onClick={() => void carregar()}>
            Atualizar
          </button>
          <button
            type="button"
            className="page-btn-ghost painel-page__limpar-periodo"
            disabled={loading || !podeLimparFiltros}
            onClick={limparFiltros}
          >
            Limpar filtro
          </button>
        </form>
      </div>

      {filtrosAtivos.length > 0 ? (
        <div className="painel-page__filtros-ativos">
          <span className="painel-page__filtros-label">Filtro ativo:</span>
          {filtrosAtivos.map((f) => (
            <span key={f} className="painel-page__filtro-chip">
              {f}
            </span>
          ))}
          <button type="button" className="painel-page__limpar-filtro" onClick={() => setFiltro(FILTRO_VAZIO)}>
            Limpar filtros
          </button>
        </div>
      ) : null}

      {erro ? <p className="page-msg page-msg--error">{erro}</p> : null}

      {tab === 'contagem' ? (
        <section className="wms-dashboard" aria-busy={loading}>
          <div className="wms-dashboard__top">
            <WmsKpiCard
              tone="teal"
              title="Itens contados"
              value={String(kpiCont.itens)}
              subtitle={`Qtd total ${kpiCont.quantidadeTotal}`}
              icon={<span>📦</span>}
              onDrillDown={() => focarGrafico('cont-volume-dia')}
              drillTitle="Ver gráfico de volume por dia"
            />
            <WmsKpiCard
              tone="blue"
              title="Conferentes"
              value={String(kpiCont.conferentes)}
              subtitle="Com registro"
              icon={<span>👤</span>}
              onDrillDown={() => focarGrafico('cont-conferente')}
              drillTitle="Ver gráfico por conferente"
            />
            <WmsKpiCard
              tone="pink"
              title="SKUs distintos"
              value={String(kpiCont.skus)}
              subtitle="Produtos únicos"
              icon={<span>🏷️</span>}
              onDrillDown={() => focarGrafico('cont-top-produtos')}
              drillTitle="Ver top produtos"
            />
            <WmsKpiCard
              tone="green"
              title="Presença hoje"
              value={String(presencaHoje)}
              subtitle="Check-in do dia"
              icon={<span>✅</span>}
              onDrillDown={() => setFiltro((f) => ({ ...f, ymd: todayYmdSp() }))}
              drillTitle="Filtrar pelo dia de hoje"
            />
          </div>

          <div className="painel-page__charts-grid">
            {chartWrap(
              'cont-volume-dia',
              <WmsInteractiveBarChart
                title="Volume por dia (linhas)"
                points={serieDiaCont}
                selectedId={filtro.ymd}
                onSelect={toggleDia}
                barColor="#0d9488"
              />,
            )}
            {chartWrap(
              'cont-conferente',
              <WmsDonutChart
                title="Por conferente"
                points={serieConfCont}
                selectedId={filtro.conferenteId}
                onSelect={toggleConferente}
              />,
            )}
          </div>

          <div className="painel-page__charts-grid painel-page__charts-grid--half">
            {chartWrap(
              'cont-qtd-dia',
              <WmsInteractiveBarChart
                title="Quantidade contada por dia"
                points={serieQtdDiaCont}
                selectedId={filtro.ymd}
                onSelect={toggleDia}
                barColor="#0891b2"
              />,
            )}
            {chartWrap(
              'cont-top-produtos',
              <WmsHorizontalBarChart
                title="Top produtos (ocorrências)"
                points={serieProdCont}
                selectedId={filtro.codigoInterno}
                onSelect={toggleProduto}
                barColor="#7c3aed"
              />,
            )}
          </div>

          <div className="wms-dashboard__top painel-page__mini-kpis">
            <WmsKpiCard
              tone="navy"
              title="Média / conferente"
              value={String(kpiCont.mediaPorConferente)}
              subtitle="Itens por pessoa"
              onDrillDown={() => focarGrafico('cont-conferente')}
            />
            <WmsKpiCard
              tone="orange"
              title="Pico no período"
              value={String(serieDiaCont.reduce((m, p) => Math.max(m, p.value), 0))}
              subtitle="Máx. linhas em 1 dia"
              onDrillDown={() => {
                const pico = [...serieDiaCont].sort((a, b) => b.value - a.value)[0]
                if (pico?.value) setFiltro((f) => ({ ...f, ymd: pico.id }))
              }}
            />
          </div>
        </section>
      ) : (
        <section className="wms-dashboard wms-dashboard--inventario" aria-busy={loading}>
          <div className="wms-dashboard__top">
            <WmsKpiCard
              tone="yellow"
              title="Linhas"
              value={String(kpiInv.linhas)}
              subtitle={`Qtd ${kpiInv.quantidadeTotal}`}
              icon={<span>📋</span>}
              onDrillDown={() => focarGrafico('inv-volume-dia')}
            />
            <WmsKpiCard
              tone="teal"
              title="Inventários abertos"
              value={String(kpiInv.abertos)}
              subtitle="Sessões ativas"
              icon={<span>📦</span>}
              onDrillDown={() => focarGrafico('inv-status')}
            />
            <WmsKpiCard
              tone="brown"
              title="Fechados"
              value={String(kpiInv.fechados)}
              subtitle="Histórico total"
              icon={<span>🔒</span>}
              onDrillDown={() => focarGrafico('inv-status')}
            />
            <WmsKpiCard
              tone="blue"
              title="Conferentes"
              value={String(kpiInv.conferentes)}
              subtitle="No período"
              icon={<span>👤</span>}
              onDrillDown={() => focarGrafico('inv-conferente')}
            />
          </div>

          <div className="painel-page__charts-grid">
            {chartWrap(
              'inv-volume-dia',
              <WmsInteractiveBarChart
                title="Capturas por dia"
                points={serieDiaInv}
                selectedId={filtro.ymd}
                onSelect={toggleDia}
                barColor="#c026d3"
              />,
            )}
            {chartWrap(
              'inv-conferente',
              <WmsDonutChart
                title="Por conferente"
                points={serieConfInv}
                selectedId={filtro.conferenteId}
                onSelect={toggleConferente}
              />,
            )}
          </div>

          <div className="painel-page__charts-grid painel-page__charts-grid--half">
            {chartWrap(
              'inv-qtd-dia',
              <WmsInteractiveBarChart
                title="Quantidade por dia"
                points={serieQtdDiaInv}
                selectedId={filtro.ymd}
                onSelect={toggleDia}
                barColor="#db2777"
              />,
            )}
            {serieStatusInv.length > 0
              ? chartWrap(
                  'inv-status',
                  <WmsDonutChart title="Status das sessões" points={serieStatusInv} />,
                )
              : null}
          </div>

          <div className="painel-page__charts-grid painel-page__charts-grid--half">
            {serieCamaraInv.length > 0
              ? chartWrap(
                  'inv-camara',
                  <WmsInteractiveBarChart
                    title="Linhas por câmara"
                    points={serieCamaraInv}
                    selectedId={filtro.camara}
                    onSelect={toggleCamara}
                    barColor="#2563eb"
                  />,
                )
              : null}
            {serieQtdCamaraInv.length > 0
              ? chartWrap(
                  'inv-qtd-camara',
                  <WmsInteractiveBarChart
                    title="Quantidade por câmara"
                    points={serieQtdCamaraInv}
                    selectedId={filtro.camara}
                    onSelect={toggleCamara}
                    barColor="#1d4ed8"
                  />,
                )
              : null}
          </div>

          <div className="painel-page__charts-grid painel-page__charts-grid--half">
            {serieNumContagemInv.length > 0
              ? chartWrap(
                  'inv-num-contagem',
                  <WmsInteractiveBarChart
                    title="Por número de contagem"
                    points={serieNumContagemInv}
                    barColor="#ea580c"
                  />,
                )
              : null}
            {chartWrap(
              'inv-top-produtos',
              <WmsHorizontalBarChart
                title="Top produtos"
                points={serieProdInv}
                selectedId={filtro.codigoInterno}
                onSelect={toggleProduto}
                barColor="#9333ea"
              />,
            )}
          </div>
        </section>
      )}
    </div>
  )
}
