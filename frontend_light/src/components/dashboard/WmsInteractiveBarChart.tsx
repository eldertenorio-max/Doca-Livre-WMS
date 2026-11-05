import { useId } from 'react'
import type { PainelChartPoint } from '../../lib/painelAnalyticsData'

type Props = {
  title: string
  points: PainelChartPoint[]
  selectedId?: string | null
  onSelect?: (point: PainelChartPoint | null) => void
  barColor?: string
  barColorSelected?: string
  valueSuffix?: string
}

export default function WmsInteractiveBarChart({
  title,
  points,
  selectedId = null,
  onSelect,
  barColor = '#0d9488',
  barColorSelected = '#f59e0b',
  valueSuffix = '',
}: Props) {
  const gradDefault = useId()
  const gradSelected = useId()
  const w = 640
  const h = 240
  const padL = 48
  const padR = 12
  const padT = 20
  const padB = 36
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const max = Math.max(1, ...points.map((p) => p.value))
  const n = Math.max(1, points.length)
  const gap = n > 14 ? 2 : 4
  const barW = Math.max(6, (innerW - gap * (n - 1)) / n)

  const yTicks = [0, 0.5, 1].map((t) => ({
    v: max * (1 - t),
    y: padT + innerH * t,
  }))

  return (
    <div className="wms-chart-card wms-chart-card--interactive">
      <div className="wms-chart-card__head">
        <h3 className="wms-chart-card__title">{title}</h3>
        {onSelect ? (
          <span className="wms-chart-card__hint">Clique para filtrar</span>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="wms-bar-chart" role="img" aria-label={title}>
        <defs>
          <linearGradient id={gradDefault} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={barColor} stopOpacity={0.95} />
            <stop offset="100%" stopColor={barColor} stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id={gradSelected} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={barColorSelected} stopOpacity={1} />
            <stop offset="100%" stopColor={barColorSelected} stopOpacity={0.65} />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={padL} y1={t.y} x2={w - padR} y2={t.y} className="wms-chart-grid-line" />
            <text x={padL - 8} y={t.y + 4} textAnchor="end" className="wms-chart-axis-label">
              {Math.round(t.v)}
              {valueSuffix}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const bh = max > 0 ? (p.value / max) * innerH : 0
          const x = padL + i * (barW + gap)
          const y = padT + innerH - bh
          const selected = selectedId === p.id
          return (
            <g key={p.id}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, p.value > 0 ? 3 : 0)}
                fill={selected ? `url(#${gradSelected})` : `url(#${gradDefault})`}
                rx={3}
                className="wms-bar-chart__bar"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect?.(selected ? null : p)}
              />
              {p.value > 0 ? (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="wms-chart-value-label">
                  {p.value}
                </text>
              ) : null}
              <text
                x={x + barW / 2}
                y={h - 10}
                textAnchor="middle"
                className={`wms-chart-x-label${selected ? ' wms-chart-x-label--active' : ''}`}
              >
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
