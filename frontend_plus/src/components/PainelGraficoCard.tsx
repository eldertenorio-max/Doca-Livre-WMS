import { useId, useMemo, type CSSProperties } from 'react'
import {
  categoriaGrafico,
  dadosGrafico,
  descricaoGrafico,
  graficoEstoqueAtual,
  tituloGrafico,
  tipoVisualGrafico,
  type PainelFiltros,
  type PainelGraficoId,
  type PainelSerie,
} from '../lib/painelAnalytics'
import type { MovimentoRegistro, NotaFiscal } from '../types'

const CATEGORIA_LABEL: Record<string, string> = {
  estoque: 'Estoque',
  movimentacao: 'Movimentação',
  operacao: 'Operação',
}

type Props = {
  id: PainelGraficoId
  filtros: PainelFiltros
  movimentos: MovimentoRegistro[]
  notas: NotaFiscal[]
  featured?: boolean
  onRemover?: () => void
}

export function PainelGraficoCard({
  id,
  filtros,
  movimentos,
  notas,
  featured,
  onRemover,
}: Props) {
  const series = dadosGrafico(id, movimentos, notas, filtros)
  const tipo = tipoVisualGrafico(id)
  const estoqueAtual = graficoEstoqueAtual(id)
  const categoria = categoriaGrafico(id)
  const total = series.reduce((s, x) => s + x.value, 0)
  const vazio = !estoqueAtual && total === 0
  const barMax = id === 'estoque-ocupacao' ? 100 : undefined
  const destaque = series.find((s) => s.label === 'Total') ?? series[0]

  return (
    <article
      className={`painel-grafico-card painel-grafico-card--${tipo}${featured ? ' painel-grafico-card--featured' : ''}`}
    >
      <header className="painel-grafico-head">
        <div className="painel-grafico-head-text">
          <span className={`painel-grafico-tag painel-grafico-tag--${categoria}`}>
            {CATEGORIA_LABEL[categoria]}
          </span>
          <h3>{tituloGrafico(id)}</h3>
          <p className="muted painel-grafico-desc">{descricaoGrafico(id)}</p>
        </div>
        {!vazio && destaque && (
          <div className="painel-grafico-highlight">
            <strong>{destaque.displayValue ?? formatHighlight(destaque.value, id)}</strong>
            <span>{destaque.label === 'Total' ? 'total' : destaque.label}</span>
          </div>
        )}
        {onRemover && (
          <button type="button" className="btn btn-ghost btn-sm painel-grafico-remove" onClick={onRemover}>
            Remover
          </button>
        )}
      </header>

      <div className="painel-grafico-body">
        {estoqueAtual && (
          <p className="painel-grafico-snapshot">
            <span className="painel-grafico-snapshot-dot" aria-hidden />
            Tempo real — não depende do período
          </p>
        )}
        {vazio ? (
          <div className="painel-grafico-vazio">
            <svg className="painel-grafico-vazio-svg" viewBox="0 0 64 64" aria-hidden>
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
              <path
                d="M20 32h24M32 20v24"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.35"
              />
            </svg>
            <p className="muted">
              {estoqueAtual ? 'Sem estoque registrado.' : 'Sem dados no período selecionado.'}
            </p>
          </div>
        ) : featured && id === 'estoque-ocupacao' ? (
          <OcupacaoGauge series={series} />
        ) : tipo === 'donut' ? (
          <DonutChart series={series} />
        ) : tipo === 'line' ? (
          <LineChart series={series} />
        ) : tipo === 'grouped-bar' ? (
          <GroupedBarChart series={series} />
        ) : (
          <BarChart series={series} horizontal maxScale={barMax} />
        )}
      </div>
    </article>
  )
}

function formatHighlight(value: number, id: PainelGraficoId): string {
  if (id === 'estoque-ocupacao') return `${value.toFixed(1)}%`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value * 10) / 10)
}

function barGradient(color: string): string {
  return `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, #fff), ${color})`
}

function OcupacaoGauge({ series }: { series: PainelSerie[] }) {
  const totalItem = series.find((s) => s.label === 'Total')
  const pct = Math.min(100, Math.max(0, totalItem?.value ?? 0))
  const uid = useId()
  const cor = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#6366f1'
  const r = 54
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct / 100)

  return (
    <div className="painel-gauge-wrap">
      <svg viewBox="0 0 140 140" className="painel-gauge-svg" aria-hidden>
        <defs>
          <linearGradient id={`${uid}-gauge`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={cor} stopOpacity="1" />
            <stop offset="100%" stopColor={cor} stopOpacity="0.55" />
          </linearGradient>
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="70" cy="70" r={r} className="painel-gauge-track" />
        <circle
          cx="70"
          cy="70"
          r={r}
          className="painel-gauge-fill"
          stroke={`url(#${uid}-gauge)`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          filter={`url(#${uid}-glow)`}
        />
        <text x="70" y="64" className="painel-gauge-val" textAnchor="middle">
          {pct.toFixed(1)}%
        </text>
        <text x="70" y="82" className="painel-gauge-sub" textAnchor="middle">
          ocupação
        </text>
      </svg>
      <ul className="painel-gauge-legend">
        {series
          .filter((s) => s.label !== 'Total')
          .map((s) => (
            <li key={s.label}>
              <span className="painel-legend-swatch" style={{ background: s.cor }} />
              <span className="painel-gauge-legend-label">{s.label}</span>
              <strong>{s.displayValue ?? `${s.value.toFixed(1)}%`}</strong>
            </li>
          ))}
      </ul>
    </div>
  )
}

function BarChart({
  series,
  horizontal = false,
  maxScale,
}: {
  series: PainelSerie[]
  horizontal?: boolean
  maxScale?: number
}) {
  const max = maxScale ?? Math.max(...series.map((s) => s.value), 1)

  return (
    <ul className={`painel-bar-chart${horizontal ? ' painel-bar-chart--horizontal' : ''}`}>
      {series.map((s, i) => {
        const color = s.cor ?? '#6366f1'
        const isTotal = s.label === 'Total'
        const widthPct = Math.max(2, (s.value / max) * 100)
        return (
          <li
            key={s.label}
            className={isTotal ? 'painel-bar-row--total' : undefined}
            style={{ '--i': i } as CSSProperties}
          >
            <span className="painel-bar-label" title={s.label}>
              {s.label}
            </span>
            <div className="painel-bar-track">
              <div
                className="painel-bar-fill"
                style={{
                  width: `${widthPct}%`,
                  background: barGradient(color),
                  boxShadow: `0 0 14px color-mix(in srgb, ${color} 40%, transparent)`,
                }}
              />
            </div>
            <span className="painel-bar-val">{s.displayValue ?? s.value}</span>
          </li>
        )
      })}
    </ul>
  )
}

function GroupedBarChart({ series }: { series: PainelSerie[] }) {
  const dias = [...new Set(series.map((s) => s.label.split(' · ')[0]))]
  const max = Math.max(...series.map((s) => s.value), 1)

  return (
    <div className="painel-grouped-chart">
      <ul className="painel-grouped-legend">
        <li>
          <span className="painel-legend-swatch painel-legend-swatch--ent" /> Entrada
        </li>
        <li>
          <span className="painel-legend-swatch painel-legend-swatch--sai" /> Saída
        </li>
      </ul>
      <div className="painel-grouped-bars">
        {dias.map((dia, i) => {
          const ent = series.find((s) => s.label.startsWith(`${dia} · Ent`))?.value ?? 0
          const sai = series.find((s) => s.label.startsWith(`${dia} · Sai`))?.value ?? 0
          return (
            <div
              key={dia}
              className="painel-grouped-col"
              style={{ '--i': i } as CSSProperties}
              title={`${dia}: ${ent} entradas, ${sai} saídas`}
            >
              <div className="painel-grouped-pair">
                <div
                  className="painel-grouped-bar painel-grouped-bar--ent"
                  style={{ height: `${Math.max(3, (ent / max) * 100)}%` }}
                />
                <div
                  className="painel-grouped-bar painel-grouped-bar--sai"
                  style={{ height: `${Math.max(3, (sai / max) * 100)}%` }}
                />
              </div>
              <span className="painel-grouped-label">{dia}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

function LineChart({ series }: { series: PainelSerie[] }) {
  const uid = useId()
  if (series.length === 0) return null

  const max = Math.max(...series.map((s) => s.value), 1)
  const color = series[0]?.cor ?? '#6366f1'
  const w = 360
  const h = 120
  const padX = 12
  const padY = 16
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const step = series.length > 1 ? innerW / (series.length - 1) : 0

  const coords = series.map((s, i) => {
    const x = padX + (series.length === 1 ? innerW / 2 : i * step)
    const y = padY + innerH - (s.value / max) * innerH
    return { x, y, label: s.label, value: s.value }
  })

  const linePath = smoothPath(coords)
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${padY + innerH} L ${coords[0].x} ${padY + innerH} Z`
  const gridLines = [0.25, 0.5, 0.75, 1].map((pct) => padY + innerH * (1 - pct))
  const labelStep = Math.max(1, Math.ceil(series.length / 6))

  return (
    <div className="painel-line-chart">
      <div className="painel-line-yaxis">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="painel-line-svg" aria-hidden>
        <defs>
          <linearGradient id={`${uid}-lineFill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`${uid}-lineStroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.7" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        {gridLines.map((y, i) => (
          <line key={i} x1={padX} y1={y} x2={padX + innerW} y2={y} className="painel-line-grid" />
        ))}
        <path d={areaPath} fill={`url(#${uid}-lineFill)`} />
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${uid}-lineStroke)`}
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((c) => (
          <g key={c.label}>
            <circle
              cx={c.x}
              cy={c.y}
              r="5"
              fill="var(--bg-elevated)"
              stroke={color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={c.x} cy={c.y} r="2" fill={color} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <ul className="painel-line-labels">
        {series.filter((_, i) => i % labelStep === 0 || i === series.length - 1).map((s) => (
          <li key={s.label}>{s.label}</li>
        ))}
      </ul>
    </div>
  )
}

function DonutChart({ series }: { series: PainelSerie[] }) {
  const uid = useId()
  const total = series.reduce((s, x) => s + x.value, 0) || 1
  const segments = useMemo(() => {
    let acc = 0
    return series.map((s) => {
      const start = (acc / total) * 360
      acc += s.value
      const end = (acc / total) * 360
      return { ...s, start, end, pct: (s.value / total) * 100 }
    })
  }, [series, total])

  return (
    <div className="painel-donut-wrap">
      <svg viewBox="0 0 160 160" className="painel-donut-svg" aria-hidden>
        <defs>
          {segments.map((s, i) => (
            <linearGradient key={s.label} id={`${uid}-seg-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={s.cor ?? '#888'} />
              <stop offset="100%" stopColor={s.cor ?? '#888'} stopOpacity="0.65" />
            </linearGradient>
          ))}
        </defs>
        {segments.map((s, i) => (
          <path
            key={s.label}
            d={donutSegment(80, 80, 58, 72, s.start, s.end - 1.5)}
            fill={`url(#${uid}-seg-${i})`}
            className="painel-donut-segment"
            style={{ '--i': i } as CSSProperties}
          />
        ))}
        <circle cx="80" cy="80" r="48" className="painel-donut-hole-svg" />
        <text x="80" y="76" className="painel-donut-center-val" textAnchor="middle">
          {total}
        </text>
        <text x="80" y="92" className="painel-donut-center-sub" textAnchor="middle">
          total
        </text>
      </svg>
      <ul className="painel-donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="painel-legend-swatch" style={{ background: s.cor }} />
            <span className="painel-donut-legend-label">{s.label}</span>
            <strong className="painel-donut-legend-val">
              {s.value}
              <small>{s.pct.toFixed(0)}%</small>
            </strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

function donutSegment(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const s = toRad(startAngle - 90)
  const e = toRad(endAngle - 90)
  const x1 = cx + rOuter * Math.cos(s)
  const y1 = cy + rOuter * Math.sin(s)
  const x2 = cx + rOuter * Math.cos(e)
  const y2 = cy + rOuter * Math.sin(e)
  const x3 = cx + rInner * Math.cos(e)
  const y3 = cy + rInner * Math.sin(e)
  const x4 = cx + rInner * Math.cos(s)
  const y4 = cy + rInner * Math.sin(s)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`
}
