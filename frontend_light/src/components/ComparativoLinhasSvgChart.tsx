import type { CSSProperties, ReactNode, SVGProps } from 'react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ChartInfoTooltip from './ChartInfoTooltip'

/** Mesmas animações / keyframes usados em ContagemDiariaAmbiental (temperatura). */
const CHART_ANIM_CSS = `
@keyframes contagem-chart-line-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes contagem-chart-area-in {
  from { opacity: 0; }
  to { opacity: var(--chart-area-op, 1); }
}
`

const chartCardStyle: CSSProperties = {
  borderRadius: 14,
  padding: 12,
  minWidth: 0,
  background: 'var(--chart-card-bg)',
  border: '1px solid var(--chart-card-border)',
  boxShadow: 'var(--chart-card-shadow)',
}

function chartTooltipOuterStyle(pxPct: number): Pick<CSSProperties, 'left' | 'right' | 'transform'> {
  if (pxPct >= 74) return { left: 'auto', right: 6, transform: 'none' }
  if (pxPct <= 26) return { left: 6, transform: 'none' }
  return { left: `${pxPct}%`, transform: 'translateX(-50%)' }
}

function smoothLinePath(points: { x: number; y: number }[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M ${points[0].x} ${points[0].y}`
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(n - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/** Segmentos retos — evita splines que “mergulham” abaixo de zero em contagens categóricas. */
function straightLinePath(points: { x: number; y: number }[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < n; i++) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`
  }
  return d
}

function linearYTicks(safeMin: number, safeMax: number, yAt: (v: number) => number, count = 5) {
  const ticks: { v: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const v = safeMax - (safeMax - safeMin) * t
    ticks.push({ v, y: yAt(v) })
  }
  return ticks
}

type AnimatedStrokePathProps = SVGProps<SVGPathElement> & { animKey: string; strokeDelaySec?: number }

function AnimatedStrokePath({ animKey, strokeDelaySec = 0, d, style, ...rest }: AnimatedStrokePathProps) {
  const ref = useRef<SVGPathElement>(null)
  const [dashLen, setDashLen] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !d) {
      setDashLen(0)
      return
    }
    try {
      const L = el.getTotalLength()
      setDashLen(Number.isFinite(L) && L > 0 ? L : 0)
    } catch {
      setDashLen(0)
    }
  }, [d, animKey])
  const drawStyle: CSSProperties =
    dashLen > 0
      ? {
          strokeDasharray: dashLen,
          strokeDashoffset: dashLen,
          animation: `contagem-chart-line-draw 1.12s cubic-bezier(0.33, 1, 0.68, 1) ${strokeDelaySec}s forwards`,
        }
      : {}
  return <path ref={ref} d={d} fill="none" {...rest} style={{ ...drawStyle, ...(style as CSSProperties) }} />
}

function AnimatedAreaPath({
  d,
  fill,
  targetOpacity = 1,
  delaySec = 0.1,
}: {
  d: string
  fill: string
  targetOpacity?: number
  delaySec?: number
}) {
  return (
    <path
      d={d}
      fill={fill}
      style={{
        opacity: 0,
        ['--chart-area-op' as string]: String(targetOpacity),
        animation: `contagem-chart-area-in 0.9s ease ${delaySec}s forwards`,
      }}
    />
  )
}

export type SvgChartSeries = { label: string; color: string; values: number[] }

type Layout = {
  width: number
  height: number
  padL: number
  padR: number
  padT: number
  padB: number
}

const LAYOUT_CARD: Layout = { width: 1100, height: 278, padL: 54, padR: 18, padT: 20, padB: 48 }

function abbrevX(s: string, max = 12): string {
  const t = String(s || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

function buildModel(
  xLabelsFull: string[],
  series: SvgChartSeries[],
  uid: string,
  gradPrefix: string,
  xDense: boolean,
  layout: Layout = LAYOUT_CARD,
  useStraightLine = false,
) {
  const nPts = xLabelsFull.length
  if (nPts === 0 || !series.length) return null
  const { width, height, padL, padR, padT, padB } = layout
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  const allVals = series.flatMap((s) => s.values)
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  let safeMin = min === max ? min - 1 : min
  let safeMax = min === max ? max + 1 : max
  if (useStraightLine && min >= 0 && min !== max) {
    safeMin = Math.min(safeMin, 0)
  }
  const rng = safeMax - safeMin
  const xAt = (i: number) => padL + (nPts > 1 ? (innerW * i) / (nPts - 1) : innerW / 2)
  const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
  const linePath = useStraightLine ? straightLinePath : smoothLinePath
  const seriesPaths = series.map((s, si) => {
    const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
    return {
      lineD: linePath(pts),
      color: s.color,
      label: s.label,
      gradId: `${gradPrefix}-${uid}-${si}`,
      values: s.values,
    }
  })
  const yTicks = linearYTicks(safeMin, safeMax, yAt, 5)
  let xIdx: number[]
  if (xDense) {
    if (nPts <= 1) xIdx = [0]
    else if (nPts <= 16) xIdx = Array.from({ length: nPts }, (_, i) => i)
    else {
      xIdx = [0]
      for (let k = 1; k <= 12; k++) xIdx.push(Math.round(((nPts - 1) * k) / 13))
      xIdx.push(nPts - 1)
      xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
    }
  } else if (nPts <= 8) {
    xIdx = nPts <= 1 ? [0] : Array.from({ length: nPts }, (_, i) => i)
  } else {
    xIdx = nPts <= 1 ? [0] : nPts === 2 ? [0, 1] : [0, Math.floor((nPts - 1) / 3), Math.floor((2 * (nPts - 1)) / 3), nPts - 1]
  }
  const xLabels = [...new Set(xIdx)]
    .sort((a, b) => a - b)
    .map((i) => ({
      x: xAt(i),
      text: abbrevX(xLabelsFull[i] ?? ''),
      full: xLabelsFull[i] ?? '',
    }))
  return {
    seriesPaths,
    yTicks,
    xLabels,
    min,
    max,
    xAt,
    yAt,
    bottomY,
    innerW,
    width,
    height,
    padL,
    padR,
    padT,
    padB,
  }
}

export type ComparativoLinhasSvgChartProps = {
  title: string
  subtitle?: string
  xLabels: string[]
  series: SvgChartSeries[]
  hideLegend?: boolean
  /** Uma única linha com marcadores coloridos por índice (condicional / semáforo). */
  pointFillColors?: string[]
  yFormat?: (v: number) => string
  formatTooltipValue?: (v: number, seriesLabel: string) => string
  footerHint?: ReactNode
  onXClick?: (xLabel: string, index: number) => void
  emptyMessage?: string
  /** Linhas em segmentos retos (contagens / categorias); evita curva abaixo do eixo zero. */
  straightSegments?: boolean
}

export function ComparativoLinhasSvgChart({
  title,
  subtitle,
  xLabels,
  series,
  hideLegend = false,
  pointFillColors,
  yFormat = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
  formatTooltipValue = (v, _lbl) =>
    Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
  footerHint,
  onXClick,
  emptyMessage = 'Sem dados.',
  straightSegments = false,
}: ComparativoLinhasSvgChartProps) {
  const uid = useId().replace(/:/g, '')
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)
  const [hoverReplay, setHoverReplay] = useState(0)
  const onChartHover = useCallback(() => setHoverReplay((n) => n + 1), [])

  const xDense = xLabels.length > 8
  const chart = useMemo(
    () => buildModel(xLabels, series, uid, 'esg', xDense, LAYOUT_CARD, straightSegments),
    [xLabels, series, uid, xDense, straightSegments],
  )

  const animKey = useMemo(() => `${xLabels.join('\0')}-${series.map((s) => s.values.join(',')).join('|')}`, [xLabels, series])

  const makeMove = useCallback(
    (M: NonNullable<typeof chart>) => (e: React.MouseEvent<SVGSVGElement>) => {
      if (!xLabels.length) return
      const { width: w, padL, padR, innerW } = M
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w
      const n = xLabels.length
      if (vx < padL || vx > w - padR) {
        setTip(null)
        return
      }
      const step = n > 1 ? innerW / (n - 1) : 0
      let idx = n <= 1 ? 0 : Math.round((vx - padL) / step)
      idx = Math.max(0, Math.min(n - 1, idx))
      const xCenter = padL + step * idx
      setTip({ idx, pxPct: (xCenter / w) * 100 })
    },
    [xLabels],
  )

  const onSvgMove = useMemo(() => (chart ? makeMove(chart) : undefined), [chart, makeMove])
  const onSvgLeave = useCallback(() => setTip(null), [])

  const onSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onXClick || !chart) return
      const { width: w, padL, padR, innerW } = chart
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w
      const n = xLabels.length
      if (vx < padL || vx > w - padR) return
      const step = n > 1 ? innerW / (n - 1) : 0
      let idx = n <= 1 ? 0 : Math.round((vx - padL) / step)
      idx = Math.max(0, Math.min(n - 1, idx))
      onXClick(xLabels[idx] ?? '', idx)
    },
    [onXClick, chart, xLabels],
  )

  return (
    <div style={chartCardStyle}>
      <style dangerouslySetInnerHTML={{ __html: CHART_ANIM_CSS }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: '0.02em',
            background: 'var(--chart-comparativo-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {title}
        </div>
        {subtitle ? <ChartInfoTooltip text={subtitle} /> : null}
      </div>
      {!chart || !xLabels.length ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>{emptyMessage}</div>
      ) : (
        (() => {
          const { width, height, padL, padR, padT, padB, innerW, bottomY } = chart
          return (
        <>
          {!hideLegend && series.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
                padding: '10px 12px',
                background: 'var(--chart-legend-bar-bg)',
                borderRadius: 12,
                border: '1px solid var(--chart-legend-bar-border)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--chart-caption)', fontWeight: 600, marginRight: 4 }}>Legenda</span>
              {series.map((s) => (
                <span
                  key={s.label}
                  style={{
                    color: 'var(--chart-legend-pill-text)',
                    fontWeight: 600,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: `1px solid ${s.color}55`,
                    background: `${s.color}14`,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: s.color,
                      boxShadow: `0 0 10px ${s.color}`,
                    }}
                  />
                  {s.label}
                </span>
              ))}
              <span style={{ fontSize: 12, color: 'var(--chart-caption)', marginLeft: 'auto' }}>
                Passe o mouse no gráfico para ver valores
              </span>
            </div>
          ) : null}

          <div style={{ position: 'relative' }}>
            {tip != null && xLabels[tip.idx] !== undefined ? (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  ...chartTooltipOuterStyle(tip.pxPct),
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 200,
                  maxWidth: 340,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--chart-tooltip-bg)',
                  border: '1px solid var(--chart-tooltip-border-cyan)',
                  boxShadow: 'var(--chart-tooltip-shadow)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 4 }}>
                  {xLabels[tip.idx]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 8 }}>Todas as séries neste ponto</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {series.map((s) => {
                    const v = s.values[tip.idx]
                    const raw = typeof v === 'number' ? v : Number(v)
                    const val = formatTooltipValue(Number.isFinite(raw) ? raw : 0, s.label)
                    return (
                      <div key={s.label} style={{ color: s.color }}>
                        {s.label}: <strong>{val}</strong>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', cursor: onXClick ? 'pointer' : 'crosshair' }}
              onMouseEnter={onChartHover}
              onMouseMove={onSvgMove}
              onMouseLeave={onSvgLeave}
              onClick={onSvgClick}
            >
              <defs>
                {chart.seriesPaths.map((p) => (
                  <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.14} />
                    <stop offset="55%" stopColor={p.color} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <rect x={0} y={0} width={width} height={height} rx={10} fill="var(--chart-plot-area)" />
              {chart.xLabels.map((xl, i) => (
                <line
                  key={`vx-${i}`}
                  x1={xl.x}
                  y1={padT}
                  x2={xl.x}
                  y2={bottomY}
                  stroke="var(--chart-grid-vertical-dense)"
                  strokeWidth={1}
                />
              ))}
              {chart.yTicks.map((t, i) => (
                <line
                  key={`hy-${i}`}
                  x1={padL}
                  y1={t.y}
                  x2={width - padR}
                  y2={t.y}
                  stroke="var(--chart-grid-horizontal)"
                  strokeDasharray="4 8"
                  strokeWidth={1}
                />
              ))}
              {tip != null ? (
                <line
                  x1={chart.xAt(tip.idx)}
                  y1={padT}
                  x2={chart.xAt(tip.idx)}
                  y2={bottomY}
                  stroke="var(--chart-cursor-line)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              ) : null}
              {chart.seriesPaths.map((p, si) => {
                const lineD = p.lineD
                const pts = xLabels.map((_, i) => ({
                  x: padL + (xLabels.length > 1 ? (innerW * i) / (xLabels.length - 1) : innerW / 2),
                }))
                const lastX = pts[pts.length - 1]?.x ?? padL
                const firstX = pts[0]?.x ?? padL
                const areaD = `${lineD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`
                return (
                  <AnimatedAreaPath
                    key={`area-${p.label}-${hoverReplay}`}
                    d={areaD}
                    fill={`url(#${p.gradId})`}
                    targetOpacity={0.55}
                    delaySec={0.06 + si * 0.06}
                  />
                )
              })}
              {chart.seriesPaths.map((p, si) => (
                <AnimatedStrokePath
                  key={`line-${p.label}-${hoverReplay}`}
                  animKey={`${animKey}-c-${width}-${hoverReplay}`}
                  strokeDelaySec={0.05 * si}
                  d={p.lineD}
                  stroke={p.color}
                  strokeWidth={2.85}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 6px ${p.color}55)` }}
                />
              ))}
              {tip != null
                ? series.flatMap((s, si) => {
                    const v = s.values[tip.idx]
                    const num = typeof v === 'number' ? v : Number(v)
                    const cx = chart.xAt(tip.idx)
                    const cy = chart.yAt(Number.isFinite(num) ? num : 0)
                    return (
                      <circle
                        key={`dot-${s.label}-${si}`}
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={s.color}
                        stroke="var(--chart-point-ring)"
                        strokeWidth={2}
                      />
                    )
                  })
                : null}
              {pointFillColors && series.length === 1
                ? xLabels.map((_, i) => {
                    const v = series[0].values[i]
                    const num = typeof v === 'number' ? v : Number(v)
                    const cx = chart.xAt(i)
                    const cy = chart.yAt(Number.isFinite(num) ? num : 0)
                    const fill = pointFillColors[i] ?? series[0].color
                    return (
                      <circle
                        key={`pt-${i}`}
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill={fill}
                        stroke="var(--chart-point-ring)"
                        strokeWidth={2}
                      />
                    )
                  })
                : null}
              {chart.yTicks.map((t, i) => (
                <text
                  key={`yl-${i}`}
                  x={padL - 10}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="var(--chart-svg-y-tick)"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {yFormat(t.v)}
                </text>
              ))}
              <line
                x1={padL}
                y1={bottomY}
                x2={width - padR}
                y2={bottomY}
                stroke="var(--chart-axis-line)"
                strokeWidth={1.5}
              />
              <line
                x1={padL}
                y1={padT}
                x2={padL}
                y2={bottomY}
                stroke="var(--chart-axis-line)"
                strokeWidth={1.5}
              />
              {chart.xLabels.map((xl, i) => (
                <text
                  key={`xl-${i}`}
                  x={xl.x}
                  y={height - 12}
                  textAnchor="middle"
                  fill="var(--chart-svg-x-label)"
                  fontSize={10}
                  fontFamily="system-ui, sans-serif"
                >
                  {xl.text}
                </text>
              ))}
            </svg>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 12,
              fontSize: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--chart-divider)',
              color: 'var(--chart-footer-muted)',
            }}
          >
            <span>
              Escala vertical:{' '}
              <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{yFormat(chart.min)}</strong> a{' '}
              <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{yFormat(chart.max)}</strong>
            </span>
            {footerHint}
          </div>
        </>
          )
        })()
      )}
    </div>
  )
}
