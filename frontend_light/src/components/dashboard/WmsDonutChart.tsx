import type { PainelChartPoint } from '../../lib/painelAnalyticsData'

const PALETTE = ['#0d9488', '#2563eb', '#c026d3', '#ea580c', '#ca8a04', '#dc2626', '#4f46e5', '#0891b2']

type Props = {
  title: string
  points: PainelChartPoint[]
  selectedId?: string | null
  onSelect?: (point: PainelChartPoint | null) => void
}

export default function WmsDonutChart({ title, points, selectedId = null, onSelect }: Props) {
  const total = points.reduce((s, p) => s + p.value, 0)
  const cx = 120
  const cy = 120
  const r = 78
  const stroke = 28

  let angle = -Math.PI / 2
  const slices = points.map((p, i) => {
    const frac = total > 0 ? p.value / total : 0
    const sweep = frac * Math.PI * 2
    const start = angle
    angle += sweep
    const end = angle
    const large = sweep > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const color = PALETTE[i % PALETTE.length]
    const selected = selectedId === p.id
    const path =
      frac <= 0
        ? ''
        : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
    return { p, path, color, selected, frac }
  })

  return (
    <div className="wms-chart-card wms-chart-card--interactive wms-chart-card--donut">
      <div className="wms-chart-card__head">
        <h3 className="wms-chart-card__title">{title}</h3>
        {onSelect ? <span className="wms-chart-card__hint">Clique para filtrar</span> : null}
      </div>
      <div className="wms-donut">
        <svg viewBox="0 0 240 240" className="wms-donut__svg" role="img" aria-label={title}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
          {slices.map(({ p, path, color, selected }) =>
            path ? (
              <path
                key={p.id}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={selected ? stroke + 6 : stroke}
                strokeLinecap="butt"
                opacity={selectedId && !selected ? 0.35 : 1}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect?.(selected ? null : p)}
              />
            ) : null,
          )}
          <text x={cx} y={cy - 4} textAnchor="middle" className="wms-donut__total">
            {total}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="wms-donut__total-label">
            itens
          </text>
        </svg>
        <ul className="wms-donut__legend">
          {points.map((p, i) => {
            const selected = selectedId === p.id
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`wms-donut__legend-btn${selected ? ' wms-donut__legend-btn--active' : ''}`}
                  onClick={() => onSelect?.(selected ? null : p)}
                >
                  <span className="wms-donut__swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="wms-donut__legend-label">{p.label}</span>
                  <span className="wms-donut__legend-value">{p.value}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
