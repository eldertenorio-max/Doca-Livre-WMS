import { useMemo } from 'react'
import {
  PAINEL_SECOES,
  filtrarMovimentos,
  painelFiltrosPorDias,
  resumoPeriodo,
  type PainelFiltros,
} from '../lib/painelAnalytics'
import type { MovimentoRegistro, NotaFiscal } from '../types'
import { PainelGraficoCard } from './PainelGraficoCard'
import { PainelKpiCards } from './PainelKpiCards'

type Props = {
  filtros: PainelFiltros
  movimentos: MovimentoRegistro[]
  notas: NotaFiscal[]
  onFiltrosChange: (patch: Partial<PainelFiltros>) => void
}

const PERIODOS_RAPIDOS = [
  { label: 'Hoje', dias: 0 },
  { label: '7 dias', dias: 7 },
  { label: '30 dias', dias: 30 },
  { label: '90 dias', dias: 90 },
] as const

function filtrosAtivos(filtros: PainelFiltros, dias: number): boolean {
  const ref = painelFiltrosPorDias(dias)
  return (
    filtros.dataInicio === ref.dataInicio &&
    filtros.dataFim === ref.dataFim &&
    filtros.horaInicio === ref.horaInicio &&
    filtros.horaFim === ref.horaFim
  )
}

export function PainelPanel({ filtros, movimentos, notas, onFiltrosChange }: Props) {
  const filtrados = useMemo(() => filtrarMovimentos(movimentos, filtros), [movimentos, filtros])
  const resumo = resumoPeriodo(filtros, filtrados.length)

  function aplicarFiltros(form: HTMLFormElement) {
    const formData = new FormData(form)
    onFiltrosChange({
      dataInicio: String(formData.get('dataInicio') ?? ''),
      horaInicio: String(formData.get('horaInicio') ?? ''),
      dataFim: String(formData.get('dataFim') ?? ''),
      horaFim: String(formData.get('horaFim') ?? ''),
    })
  }

  function aplicarPeriodoRapido(dias: number) {
    onFiltrosChange(painelFiltrosPorDias(dias))
  }

  return (
    <div className="painel-root">
      <div className="sidebar-block painel-header-block">
        <header className="painel-hero">
          <div className="painel-hero-text">
            <span className="painel-hero-badge">Analytics</span>
            <h3 className="painel-page-title">Painel analítico</h3>
          </div>
          <div className="painel-hero-stats" aria-hidden>
            <span className="painel-hero-stat">
              <strong>{PAINEL_SECOES.length}</strong>
              <small>seções</small>
            </span>
            <span className="painel-hero-stat">
              <strong>{filtrados.length}</strong>
              <small>movimentos</small>
            </span>
          </div>
        </header>

        <fieldset className="painel-filtros">
          <legend className="painel-filtros-title">Período de análise</legend>
          <div className="painel-periodo-rapido">
            {PERIODOS_RAPIDOS.map(({ label, dias }) => (
              <button
                key={label}
                type="button"
                className={`painel-periodo-btn${filtrosAtivos(filtros, dias) ? ' painel-periodo-btn--active' : ''}`}
                onClick={() => aplicarPeriodoRapido(dias)}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            key={`${filtros.dataInicio}-${filtros.horaInicio}-${filtros.dataFim}-${filtros.horaFim}`}
            className="painel-filtros-form"
            onSubmit={(e) => {
              e.preventDefault()
              aplicarFiltros(e.currentTarget)
            }}
          >
            <div className="painel-filtros-grid">
              <label className="painel-filtro-campo">
                <span>Data início</span>
                <input
                  type="date"
                  name="dataInicio"
                  className="input-nf"
                  defaultValue={filtros.dataInicio}
                />
              </label>
              <label className="painel-filtro-campo">
                <span>Hora início</span>
                <input
                  type="time"
                  name="horaInicio"
                  className="input-nf"
                  defaultValue={filtros.horaInicio}
                />
              </label>
              <label className="painel-filtro-campo">
                <span>Data fim</span>
                <input
                  type="date"
                  name="dataFim"
                  className="input-nf"
                  defaultValue={filtros.dataFim}
                />
              </label>
              <label className="painel-filtro-campo">
                <span>Hora fim</span>
                <input
                  type="time"
                  name="horaFim"
                  className="input-nf"
                  defaultValue={filtros.horaFim}
                />
              </label>
            </div>
            <div className="painel-filtros-actions">
              <button type="submit" className="btn primary painel-filtrar-btn">
                Filtrar
              </button>
            </div>
          </form>
        </fieldset>

        <p className="painel-resumo-badge">{resumo}</p>
      </div>

      <PainelKpiCards notas={notas} />

      {PAINEL_SECOES.map((secao) => (
        <section key={secao.id} className={`sidebar-block painel-secao painel-secao--${secao.id}`}>
          <header className={`painel-secao-head painel-secao-head--${secao.id}`}>
            <span className="painel-secao-icon" aria-hidden>
              {secao.id === 'estoque' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              )}
              {secao.id === 'movimentacao' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              )}
              {secao.id === 'operacao' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                </svg>
              )}
            </span>
            <div>
              <h3 className="painel-secao-title">{secao.titulo}</h3>
              <p className="muted painel-secao-sub">{secao.subtitulo}</p>
            </div>
            <span className="painel-secao-count">{secao.graficos.length} gráficos</span>
          </header>
          <div className="painel-secao-graficos">
            {secao.graficos.map((id) => (
              <PainelGraficoCard
                key={id}
                id={id}
                filtros={filtros}
                movimentos={movimentos}
                notas={notas}
                featured={id === 'estoque-ocupacao'}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
