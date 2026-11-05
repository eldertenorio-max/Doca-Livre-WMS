import { useId } from 'react'
import type { PainelChartPoint } from '../../lib/painelAnalyticsData'

type Props = {
  title: string
  points: PainelChartPoint[]
  selectedId?: string | null
  onSelect?: (point: PainelChartPoint | null) => void
  barColor?: string
  barColorSelected?: string
}

export default function WmsHorizontalBarChart({
  title,
  points,
  selectedId = null,
  onSelect,
  barColor = '#7c3aed',
  barColorSelected = '#f59e0b',
}: Props) {
  const gradDefault = useId()
  const gradSelected = useId()
  const w = 640
  const rowH = 28
  const padL = 108
  const padR = 44
  const padT = 8
  const h = padT + Math.max(1, points.length) * rowH + 8
  const innerW = w - padL - padR
  const max = Math.max(1, ...points.map((p) => p.value))

  return (
    <div className="wms-chart-card wms-chart-card--interactive">
      <div className="wms-chart-card__head">
        <h3 className="wms-chart-card__title">{title}</h3>
        {onSelect ? <span className="wms-chart-card__hint">Clique para filtrar</span> : null}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="wms-bar-chart" role="img" aria-label={title}>
        <defs>
          <linearGradient id={gradDefault} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={barColor} stopOpacity={0.55} />
            <stop offset="100%" stopColor={barColor} stopOpacity={0.95} />
          </linearGradient>
          <linearGradient id={gradSelected} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={barColorSelected} stopOpacity={0.65} />
            <stop offset="100%" stopColor={barColorSelected} stopOpacity={1} />
          </linearGradient>
        </defs>
        {points.map((p, i) => {
          const y = padT + i * rowH + 4
          const bw = max > 0 ? (p.value / max) * innerW : 0
          const selected = selectedId === p.id
          return (
            <g key={p.id}>
              <text x={padL - 6} y={y + 14} textAnchor="end" className="wms-chart-hbar-label">
                {p.label}
              </text>
              <rect
                x={padL}
                y={y}
                width={Math.max(bw, p.value > 0 ? 4 : 0)}
                height={18}
                rx={3}
                fill={selected ? `url(#${gradSelected})` : `url(#${gradDefault})`}
                className="wms-bar-chart__bar"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect?.(selected ? null : p)}
              />
              <text x={padL + bw + 6} y={y + 13} className="wms-chart-value-label">
                {p.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
