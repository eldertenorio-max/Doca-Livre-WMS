import { useMemo, type CSSProperties } from 'react'
import { formatValorNfe } from '../lib/formatNfeItem'
import { calcularResumoEstoqueArmazem } from '../lib/painelEstoqueArmazem'
import type { NotaFiscal } from '../types'

type Props = {
  notas: NotaFiscal[]
}

export function PainelKpiCards({ notas }: Props) {
  const total = useMemo(() => calcularResumoEstoqueArmazem(notas).total, [notas])
  const pct = Math.min(100, Math.max(0, total.ocupacaoPct))

  return (
    <div className="sidebar-block painel-kpi-block">
      <header className="painel-kpi-head">
        <h3>Resumo rápido</h3>
        <p className="muted">Indicadores consolidados do armazém em tempo real</p>
      </header>
      <div className="painel-kpi-grid">
        <article className="painel-kpi painel-kpi--ocupacao">
          <div
            className="painel-kpi-ring"
            style={{ '--pct': `${pct}`, '--ring-color': ringColor(pct) } as CSSProperties}
            aria-hidden
          >
            <span className="painel-kpi-ring-val">{pct.toFixed(1)}%</span>
          </div>
          <div className="painel-kpi-text">
            <strong>Ocupação</strong>
            <span>
              {total.posicoesOcupadas} / {total.posicoesTotal} posições
            </span>
            <div className="painel-kpi-bar" aria-hidden>
              <div className="painel-kpi-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </article>

        <article className="painel-kpi painel-kpi--valor">
          <span className="painel-kpi-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <div className="painel-kpi-text">
            <strong>Valor armazenado</strong>
            <span className="painel-kpi-metric">{formatValorNfe(total.valorTotalArmazenado)}</span>
          </div>
        </article>

        <article className="painel-kpi painel-kpi--paletes">
          <span className="painel-kpi-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </span>
          <div className="painel-kpi-text">
            <strong>Paletes no armazém</strong>
            <span className="painel-kpi-metric">{total.paletesArmazenados}</span>
          </div>
        </article>

        <article className="painel-kpi painel-kpi--livres">
          <span className="painel-kpi-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" strokeDasharray="3 2" />
            </svg>
          </span>
          <div className="painel-kpi-text">
            <strong>Posições livres</strong>
            <span className="painel-kpi-metric">{total.posicoesLivres}</span>
          </div>
        </article>
      </div>
    </div>
  )
}

function ringColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 75) return '#f59e0b'
  return '#6366f1'
}
