import type { CSSProperties, ReactNode } from 'react'

export type WmsKpiTone =
  | 'yellow'
  | 'pink'
  | 'blue'
  | 'green'
  | 'brown'
  | 'red'
  | 'navy'
  | 'orange'
  | 'teal'

const TONE_BG: Record<WmsKpiTone, string> = {
  yellow: 'linear-gradient(145deg, #f5d76e 0%, #d4a012 100%)',
  pink: 'linear-gradient(145deg, #f48fb1 0%, #c2185b 100%)',
  blue: 'linear-gradient(145deg, #64b5f6 0%, #1565c0 100%)',
  green: 'linear-gradient(145deg, #81c784 0%, #2e7d32 100%)',
  brown: 'linear-gradient(145deg, #a1887f 0%, #5d4037 100%)',
  red: 'linear-gradient(145deg, #e57373 0%, #b71c1c 100%)',
  navy: 'linear-gradient(145deg, #5c6bc0 0%, #1a237e 100%)',
  orange: 'linear-gradient(145deg, #ffb74d 0%, #e65100 100%)',
  teal: 'linear-gradient(145deg, #4db6ac 0%, #00695c 100%)',
}

type Props = {
  title: string
  value: string
  subtitle?: string
  detail?: string
  icon?: ReactNode
  tone: WmsKpiTone
  onClick?: () => void
  onDrillDown?: () => void
  drillTitle?: string
  className?: string
  style?: CSSProperties
}

export default function WmsKpiCard({
  title,
  value,
  subtitle,
  detail,
  icon,
  tone,
  onClick,
  onDrillDown,
  drillTitle,
  className = '',
  style,
}: Props) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`wms-kpi-card wms-kpi-card--${tone} ${className}`.trim()}
      style={{ background: TONE_BG[tone], ...style }}
      onClick={onClick}
    >
      <div className="wms-kpi-card__head">
        <span className="wms-kpi-card__title">{title}</span>
        {onDrillDown ? (
          <button
            type="button"
            className="wms-kpi-card__search-btn"
            title={drillTitle ?? `Ver detalhes: ${title}`}
            aria-label={drillTitle ?? `Ver detalhes: ${title}`}
            onClick={(e) => {
              e.stopPropagation()
              onDrillDown()
            }}
          >
            🔍
          </button>
        ) : null}
      </div>
      <div className="wms-kpi-card__value">{value}</div>
      {subtitle ? <div className="wms-kpi-card__sub">{subtitle}</div> : null}
      {detail ? <div className="wms-kpi-card__detail">{detail}</div> : null}
      {icon ? <div className="wms-kpi-card__icon">{icon}</div> : null}
    </Tag>
  )
}
