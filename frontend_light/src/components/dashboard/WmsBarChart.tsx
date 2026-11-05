export type WmsBarChartPoint = {
  label: string
  value: number
}

type Props = {
  title: string
  points: WmsBarChartPoint[]
  valueSuffix?: string
  maxValue?: number
  barColor?: string
}

export default function WmsBarChart({
  title,
  points,
  valueSuffix = '',
  maxValue,
  barColor = '#1a5c5c',
}: Props) {
  const w = 640
  const h = 220
  const padL = 44
  const padR = 12
  const padT = 16
  const padB = 32
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const max = maxValue ?? Math.max(1, ...points.map((p) => p.value))
  const n = Math.max(1, points.length)
  const gap = 4
  const barW = Math.max(4, (innerW - gap * (n - 1)) / n)

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    v: max * (1 - t),
    y: padT + innerH * t,
  }))

  return (
    <div className="wms-chart-card">
      <div className="wms-chart-card__head">
        <h3 className="wms-chart-card__title">{title}</h3>
        <span className="wms-chart-card__search" aria-hidden>
          🔍
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="wms-bar-chart" role="img" aria-label={title}>
        {yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={padL}
              y1={t.y}
              x2={w - padR}
              y2={t.y}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#64748b">
              {Math.round(t.v)}
              {valueSuffix}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const bh = max > 0 ? (p.value / max) * innerH : 0
          const x = padL + i * (barW + gap)
          const y = padT + innerH - bh
          return (
            <g key={`${p.label}-${i}`}>
              <rect x={x} y={y} width={barW} height={bh} fill={barColor} rx={2} />
              <text
                x={x + barW / 2}
                y={h - 8}
                textAnchor="middle"
                fontSize={9}
                fill="#64748b"
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
