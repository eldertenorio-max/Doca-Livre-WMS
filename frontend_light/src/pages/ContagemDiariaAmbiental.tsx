import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type SVGProps,
} from 'react'
import { supabase } from '../lib/supabaseClient'
type TabKey = 'temperatura' | 'ocupacao'

type Conferente = { id: string; nome: string }

type TempRow = {
  id: string
  data_registro: string
  conferente_nome: string
  camara11_temp: number
  camara12_temp: number
  camara13_temp: number
  created_at: string
}

type OcupRow = {
  id: string
  data_registro: string
  conferente_nome: string
  camara11_vazias: number
  camara12_vazias: number
  camara13_vazias: number
  /** Somado ao total de ocupadas (além do cálculo pelas vazias). */
  avaria_acrescimo_ocupacao: number
  created_at: string
}

const OCUP_TOTAL = {
  camara11: 138,
  camara12: 134,
  camara13: 138,
} as const

const OCUP_TOTAL_POSICOES = 410

function ocupPercGeral(r: OcupRow): number {
  const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
  const totalOcup = OCUP_TOTAL_POSICOES - totalVaz + r.avaria_acrescimo_ocupacao
  return OCUP_TOTAL_POSICOES > 0 ? (totalOcup / OCUP_TOTAL_POSICOES) * 100 : 0
}

function ocupPercCam11(r: OcupRow): number {
  const c = OCUP_TOTAL.camara11
  return c > 0 ? ((c - r.camara11_vazias) / c) * 100 : 0
}

function ocupPercCam12(r: OcupRow): number {
  const c = OCUP_TOTAL.camara12
  return c > 0 ? ((c - r.camara12_vazias) / c) * 100 : 0
}

function ocupPercCam13(r: OcupRow): number {
  const c = OCUP_TOTAL.camara13
  return c > 0 ? ((c - r.camara13_vazias) / c) * 100 : 0
}

function ocupAvariaPercTotal(r: OcupRow): number {
  return OCUP_TOTAL_POSICOES > 0 ? (r.avaria_acrescimo_ocupacao / OCUP_TOTAL_POSICOES) * 100 : 0
}

/**
 * Série para gráficos: no máximo um ponto por dia civil (`data_registro`),
 * usando o lançamento com `created_at` mais recente naquele dia.
 * Assim todos os gráficos de ocupação refletem o mesmo valor por data.
 */
function ocupRowsForCharts(rowsNewestFirst: OcupRow[]): OcupRow[] {
  const chrono = [...rowsNewestFirst].reverse()
  const byDay = new Map<string, OcupRow>()
  for (const r of chrono) {
    const day = String(r.data_registro ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const prev = byDay.get(day)
    if (!prev) {
      byDay.set(day, r)
    } else {
      const tNew = new Date(r.created_at).getTime()
      const tOld = new Date(prev.created_at).getTime()
      if (tNew >= tOld) byDay.set(day, r)
    }
  }
  return [...byDay.keys()].sort().map((k) => byDay.get(k)!)
}

/** Linhas por página nos históricos (temperatura e ocupação). */
const HIST_PAGE_SIZE = 5

function HistoricoPaginacaoBar({
  page,
  totalItems,
  pageSize,
  onPageChange,
  accent,
}: {
  page: number
  totalItems: number
  pageSize: number
  onPageChange: (p: number) => void
  accent: string
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages
  if (totalItems === 0) return null
  const btn = (disabled: boolean): CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 6,
    border: `1px solid ${disabled ? 'var(--border, #2e303a)' : accent}`,
    background: disabled ? 'transparent' : 'rgba(255,255,255,.06)',
    color: disabled ? '#64748b' : accent,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
  })
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginTop: 12,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--chart-footer-muted)' }}>
        Página {page} de {totalPages} · {totalItems} registro(s)
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!canPrev} style={btn(!canPrev)} onClick={() => onPageChange(page - 1)}>
          Anterior
        </button>
        <button type="button" disabled={!canNext} style={btn(!canNext)} onClick={() => onPageChange(page + 1)}>
          Próxima
        </button>
      </div>
    </div>
  )
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 13,
}

const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 13,
}

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asInt(v: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

function formatDataBr(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHoraRegistro(iso: string) {
  if (!iso?.trim()) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Data do lançamento + horário real do registro no Supabase (`created_at`). */
function celulaDataComHoraRegistro(dataRegistro: string, createdAt: string) {
  const ymd = String(dataRegistro ?? '').slice(0, 10)
  const dataTxt = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? formatDataBr(ymd) : dataRegistro || '—'
  const horaTxt = formatHoraRegistro(createdAt)
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'baseline',
        gap: 8,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.35,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{dataTxt}</span>
      <span style={{ fontSize: 12, color: 'var(--chart-caption)' }}>{horaTxt}</span>
    </div>
  )
}

/** Data no eixo dos gráficos: dd/mm/aaaa (aproveita o mesmo formato do restante da tela). */
function formatAxisDateChart(ymd: string) {
  if (!ymd) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return formatDataBr(ymd)
  if (ymd.length >= 10) return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
  return ymd
}

/** Metadados opcionais para tooltip (linhas de temperatura/ocupação no Supabase). */
function rowMetaForTooltip(r: { data_registro: string }): { conferente?: string; hora?: string } {
  const o = r as Record<string, unknown>
  const nome = o.conferente_nome
  const created = o.created_at
  return {
    conferente: typeof nome === 'string' && nome.trim() ? nome : undefined,
    hora: typeof created === 'string' && created.trim() ? formatHoraRegistro(created) : undefined,
  }
}

/** Curva suave tipo Catmull-Rom → cúbicas de Bézier. */
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

/** Marcas lineares no eixo Y (mais legível que só 3 linhas). */
function linearYTicks(safeMin: number, safeMax: number, yAt: (v: number) => number, count = 5) {
  const ticks: { v: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1)
    const v = safeMax - (safeMax - safeMin) * t
    ticks.push({ v, y: yAt(v) })
  }
  return ticks
}

const chartCardStyle: CSSProperties = {
  borderRadius: 14,
  padding: 12,
  minWidth: 0,
  background: 'var(--chart-card-bg)',
  border: '1px solid var(--chart-card-border)',
  boxShadow: 'var(--chart-card-shadow)',
}

/** Keyframes injetados uma vez na página (ContagemDiariaAmbiental). */
const CHART_ANIM_CSS = `
@keyframes contagem-chart-line-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes contagem-chart-area-in {
  from { opacity: 0; }
  to { opacity: var(--chart-area-op, 1); }
}
@media (prefers-reduced-motion: reduce) {
  .contagem-chart-stroke-anim {
    stroke-dashoffset: 0 !important;
    animation: none !important;
  }
}
`

/** Cor da série geral (ocupação): visível no tema escuro e distinta da câmara 12. */
const OCUP_COLOR_GERAL = '#22d3ee'

function isOcupGeralStroke(color: string) {
  const c = color.toLowerCase()
  return c === '#22d3ee' || c === '#f0f9ff'
}

type AnimatedStrokePathProps = SVGProps<SVGPathElement> & { animKey: string; strokeDelaySec?: number }

function AnimatedStrokePath({ animKey, strokeDelaySec = 0, d, style, ...rest }: AnimatedStrokePathProps) {
  const ref = useRef<SVGPathElement>(null)
  const [dashLen, setDashLen] = useState(0)
  const [revealed, setRevealed] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !d) {
      setDashLen(0)
      setRevealed(true)
      return
    }
    setRevealed(false)
    try {
      const L = el.getTotalLength()
      setDashLen(Number.isFinite(L) && L > 0 ? L : 0)
    } catch {
      setDashLen(0)
      setRevealed(true)
    }
  }, [d, animKey])
  useEffect(() => {
    if (dashLen <= 0) {
      setRevealed(true)
      return
    }
    const ms = 1200 + strokeDelaySec * 1000
    const id = window.setTimeout(() => setRevealed(true), ms)
    return () => clearTimeout(id)
  }, [dashLen, strokeDelaySec, animKey])
  const drawStyle: CSSProperties =
    dashLen > 0 && !revealed
      ? {
          strokeDasharray: dashLen,
          strokeDashoffset: dashLen,
          animation: `contagem-chart-line-draw 1.12s cubic-bezier(0.33, 1, 0.68, 1) ${strokeDelaySec}s forwards`,
        }
      : { strokeDashoffset: 0 }
  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      className="contagem-chart-stroke-anim"
      onAnimationEnd={() => setRevealed(true)}
      {...rest}
      style={{ ...drawStyle, ...(style as CSSProperties) }}
    />
  )
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

/** Rola o painel do modal ampliado até o fim (dados mais recentes à direita). */
function useScrollChartModalToEnd(active: boolean, contentKey: string, containerRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    if (!active) return
    const el = containerRef.current
    if (!el) return
    const snap = () => {
      el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    }
    snap()
    const id = requestAnimationFrame(snap)
    return () => cancelAnimationFrame(id)
  }, [active, contentKey])
}

/** Tooltip acima do gráfico: evita corte nas bordas (pxPct = % da largura do SVG). */
function chartTooltipOuterStyle(pxPct: number): Pick<CSSProperties, 'left' | 'right' | 'transform'> {
  if (pxPct >= 74) return { left: 'auto', right: 6, transform: 'none' }
  if (pxPct <= 26) return { left: 6, transform: 'none' }
  return { left: `${pxPct}%`, transform: 'translateX(-50%)' }
}

type TinyChartLayout = {
  width: number
  height: number
  padL: number
  padR: number
  padT: number
  padB: number
}

function buildTinyLineGeom<T extends { data_registro: string }>(
  rows: T[],
  valueOf: (r: T) => number,
  layout: TinyChartLayout,
  denseTimeline: boolean,
  /** Ampliado: tenta marcar todas as datas no eixo X (até 16 pontos; acima disso, amostragem). */
  everyXLabel = false,
) {
  const { width, height, padL, padR, padT, padB } = layout
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  const values = rows.map(valueOf)
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const safeMin = min === max ? min - 1 : min
  const safeMax = min === max ? max + 1 : max
  const rng = safeMax - safeMin
  const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
  const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
  const pts = rows.map((r, i) => ({ x: xAt(i), y: yAt(valueOf(r)) }))
  const lineD = smoothLinePath(pts)
  const last = pts[pts.length - 1]
  const first = pts[0]
  const areaD = `${lineD} L ${last.x.toFixed(2)} ${bottomY.toFixed(2)} L ${first.x.toFixed(2)} ${bottomY.toFixed(2)} Z`
  const yTicks = linearYTicks(safeMin, safeMax, yAt, 5)
  const n = rows.length
  let xIdx: number[]
  if (everyXLabel) {
    if (n <= 1) xIdx = [0]
    else if (n <= 16) xIdx = Array.from({ length: n }, (_, i) => i)
    else {
      xIdx = [0]
      for (let k = 1; k <= 12; k++) xIdx.push(Math.round(((n - 1) * k) / 13))
      xIdx.push(n - 1)
      xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
    }
  } else if (denseTimeline) {
    if (n <= 1) xIdx = [0]
    else if (n <= 7) xIdx = Array.from({ length: n }, (_, i) => i)
    else {
      xIdx = [0]
      for (let k = 1; k <= 5; k++) xIdx.push(Math.round(((n - 1) * k) / 6))
      xIdx.push(n - 1)
      xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
    }
  } else {
    xIdx = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
  }
  const xLabels = [...new Set(xIdx)]
    .sort((a, b) => a - b)
    .map((i) => {
      const o = rows[i] as Record<string, unknown>
      const c = o.created_at
      return {
        x: xAt(i),
        text: formatAxisDateChart(rows[i].data_registro),
        hora: typeof c === 'string' ? formatHoraRegistro(c) : '',
      }
    })
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const firstVal = values[0]
  const lastVal = values[values.length - 1]
  const lastPt = pts[pts.length - 1]
  return {
    lineD,
    areaD,
    yTicks,
    xLabels,
    min,
    max,
    avg,
    firstVal,
    lastVal,
    lastPt,
    delta: lastVal - firstVal,
    xAt,
    yAt,
    pts,
    values,
    bottomY,
    layout,
  }
}

const TINY_LAYOUT_CARD: TinyChartLayout = { width: 520, height: 218, padL: 48, padR: 14, padT: 16, padB: 44 }
/** Card compacto (ocupação): alinhado ao comparativo acima — menor e fontes reduzidas. */
const TINY_LAYOUT_COMPACT: TinyChartLayout = { width: 520, height: 152, padL: 40, padR: 10, padT: 10, padB: 28 }
/** Gráfico geral de ocupação: ainda menor, com rótulos numéricos reduzidos. */
const TINY_LAYOUT_COMPACT_SM: TinyChartLayout = { width: 520, height: 128, padL: 34, padR: 8, padT: 8, padB: 22 }
/** Largura/pad direito maiores no modal: área útil igual ao card, sobra margem para rótulos e tooltip. */
const TINY_LAYOUT_MODAL: TinyChartLayout = { width: 1140, height: 440, padL: 64, padR: 84, padT: 26, padB: 76 }

function TinyLineChart<T extends { data_registro: string }>({
  title,
  color,
  rows,
  valueOf,
  valueSuffix = '°C',
  decimals = 1,
  axisCaption,
  denseTimeline,
  showSeriesInsight,
  showPointValues,
  compact,
  compactSm,
}: {
  title: string
  color: string
  rows: T[]
  valueOf: (r: T) => number
  /** Sufixo nos eixos e no rodapé (ex.: °C, %, pos.). */
  valueSuffix?: string
  decimals?: number
  /** Texto curto no canto do gráfico; default = valueSuffix. */
  axisCaption?: string
  /** Mais marcas no eixo X (do primeiro ao último lançamento). */
  denseTimeline?: boolean
  /** Último ponto destacado + bloco início / fim / variação. */
  showSeriesInsight?: boolean
  /** Exibe valores acima dos pontos da série. */
  showPointValues?: boolean
  /** Card menor, fontes reduzidas e rodapé simples (como o comparativo). */
  compact?: boolean
  /** Variante extra-pequena (ex.: ocupação geral). */
  compactSm?: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const gradId = `tgrad-${uid}`
  const gradIdModal = `tgrad-m-${uid}`
  const [expanded, setExpanded] = useState(false)
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)
  const [hoverReplayCard, setHoverReplayCard] = useState(0)
  const [hoverReplayModal, setHoverReplayModal] = useState(0)
  const onChartHoverCard = useCallback(() => setHoverReplayCard((n) => n + 1), [])
  const onChartHoverModal = useCallback(() => setHoverReplayModal((n) => n + 1), [])

  const capAxis = axisCaption ?? valueSuffix
  const isTempChart = valueSuffix === '°C'
  const gradTop = isTempChart ? 0.42 : 0.28
  const gradMid = isTempChart ? 0.14 : 0.06
  const lineShadowStyle: CSSProperties = isTempChart
    ? { filter: `drop-shadow(0 0 16px ${color}bb) drop-shadow(0 6px 22px ${color}55)` }
    : isOcupGeralStroke(color)
      ? { filter: 'drop-shadow(0 0 8px rgba(34,211,238,.55))' }
      : { filter: `drop-shadow(0 0 8px ${color}66)` }
  const fmt = (v: number) => v.toFixed(decimals)
  const lineAnimKey = useMemo(
    () => rows.map((r) => `${r.data_registro}-${String((r as { id?: string }).id ?? '')}`).join('|'),
    [rows],
  )

  const modalScrollRef = useRef<HTMLDivElement>(null)
  useScrollChartModalToEnd(expanded, lineAnimKey, modalScrollRef)

  const isCompact = compact || compactSm
  const layoutCard = compactSm ? TINY_LAYOUT_COMPACT_SM : isCompact ? TINY_LAYOUT_COMPACT : TINY_LAYOUT_CARD
  const fsY = compactSm ? 8 : isCompact ? 9 : 11
  const fsX = compactSm ? 7 : isCompact ? 8 : 10
  const fsCap = compactSm ? 7 : isCompact ? 8 : 10
  const fsPt = compactSm ? 7 : isCompact ? 8 : 10
  const fsTitle = compactSm ? 11 : isCompact ? 12 : 15
  const chartMinH = compactSm ? 124 : isCompact ? 148 : 200
  const strokeW = isCompact ? (isTempChart ? 2.5 : 2.25) : isTempChart ? 3.25 : 3
  const tipR = compactSm ? 4 : isCompact ? 4.5 : 6

  const geomCard = useMemo(
    () => buildTinyLineGeom(rows, valueOf, layoutCard, !!denseTimeline, false),
    [rows, valueOf, denseTimeline, layoutCard],
  )
  const geomModal = useMemo(
    () => buildTinyLineGeom(rows, valueOf, TINY_LAYOUT_MODAL, true, true),
    [rows, valueOf],
  )

  const makeSvgMove = useCallback(
    (L: TinyChartLayout) => (e: React.MouseEvent<SVGSVGElement>) => {
      if (!rows.length) return
      const innerW = L.width - L.padL - L.padR
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * L.width
      const n = rows.length
      if (vx < L.padL || vx > L.width - L.padR) {
        setTip(null)
        return
      }
      const step = n > 1 ? innerW / (n - 1) : 0
      let idx = n <= 1 ? 0 : Math.round((vx - L.padL) / step)
      idx = Math.max(0, Math.min(n - 1, idx))
      const xCenter = L.padL + step * idx
      setTip({ idx, pxPct: (xCenter / L.width) * 100 })
    },
    [rows.length],
  )

  const onSvgMoveCard = useMemo(() => makeSvgMove(layoutCard), [makeSvgMove, layoutCard])
  const onSvgMoveModal = useMemo(() => makeSvgMove(TINY_LAYOUT_MODAL), [makeSvgMove])
  const onSvgLeave = useCallback(() => setTip(null), [])

  const { width: wC, height: hC, padL: pLC, padR: pRC, padT: pTC, padB: pBC } = layoutCard
  const { width: wM, height: hM, padL: pLM, padR: pRM, padT: pTM, padB: pBM } = TINY_LAYOUT_MODAL

  return (
    <>
      {expanded ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--chart-modal-overlay)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setExpanded(false)}
        >
          <div
            ref={modalScrollRef}
            style={{
              ...chartCardStyle,
              padding: '12px 28px 22px 12px',
              width: 'min(1180px, 96vw)',
              maxHeight: '92vh',
              overflow: 'auto',
              border: '1px solid rgba(148,163,184,.35)',
              boxShadow: 'var(--chart-modal-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color, fontSize: 17, letterSpacing: '0.02em' }}>{title}</div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  border: '1px solid var(--chart-btn-fechar-border)',
                  background: 'var(--chart-btn-fechar-bg)',
                  color: 'var(--chart-btn-fechar-color)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 8, lineHeight: 1.45 }}>
              Eixo X: data e horário do registro · Eixo Y: {capAxis}. Passe o mouse para ver conferente e valor exato.
            </div>
            {!rows.length || !geomModal ? (
              <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  {tip != null && rows[tip.idx] ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        ...chartTooltipOuterStyle(tip.pxPct),
                        zIndex: 2,
                        pointerEvents: 'none',
                        minWidth: 200,
                        maxWidth: 320,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'var(--chart-tooltip-bg)',
                        border: `1px solid ${color}55`,
                        boxShadow: 'var(--chart-tooltip-shadow)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 6 }}>
                        {formatAxisDateChart(rows[tip.idx].data_registro)}
                      </div>
                      {(() => {
                        const m = rowMetaForTooltip(rows[tip.idx])
                        return m.conferente || m.hora ? (
                          <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 8, lineHeight: 1.4 }}>
                            {m.conferente ? <span style={{ color: 'var(--chart-footer-muted)' }}>{m.conferente}</span> : null}
                            {m.conferente && m.hora ? <span style={{ color: 'var(--chart-caption)' }}> · </span> : null}
                            {m.hora ? <span>{m.hora}</span> : null}
                          </div>
                        ) : null
                      })()}
                      <div style={{ color }}>
                        Valor:{' '}
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(valueOf(rows[tip.idx]))}
                          {valueSuffix}
                        </strong>
                      </div>
                    </div>
                  ) : null}
                  <svg
                    width="100%"
                    viewBox={`0 0 ${wM} ${hM}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ display: 'block', cursor: 'crosshair' }}
                    onMouseEnter={onChartHoverModal}
                    onMouseMove={onSvgMoveModal}
                    onMouseLeave={onSvgLeave}
                  >
                    <defs>
                      <linearGradient id={gradIdModal} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={gradTop} />
                        <stop offset="55%" stopColor={color} stopOpacity={gradMid} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <rect x={0} y={0} width={wM} height={hM} rx={8} fill="var(--chart-plot-area)" />
                    {geomModal.xLabels.map((xl, i) => (
                      <line
                        key={`xg-exp-${i}`}
                        x1={xl.x}
                        y1={pTM}
                        x2={xl.x}
                        y2={geomModal.bottomY}
                        stroke="var(--chart-grid-vertical-dense)"
                        strokeWidth={1}
                      />
                    ))}
                    {geomModal.yTicks.map((t, i) => (
                      <line
                        key={`y-exp-${i}`}
                        x1={pLM}
                        y1={t.y}
                        x2={wM - pRM}
                        y2={t.y}
                        stroke="var(--chart-modal-grid-faint)"
                        strokeDasharray="4 8"
                        strokeWidth={1}
                      />
                    ))}
                    <AnimatedAreaPath
                      key={`tl-am-${lineAnimKey}-${hoverReplayModal}`}
                      d={geomModal.areaD}
                      fill={`url(#${gradIdModal})`}
                      delaySec={0.06}
                    />
                    {tip != null ? (
                      <line
                        x1={geomModal.xAt(tip.idx)}
                        y1={pTM}
                        x2={geomModal.xAt(tip.idx)}
                        y2={geomModal.bottomY}
                        stroke="var(--chart-modal-grid-medium)"
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                      />
                    ) : null}
                    <AnimatedStrokePath
                      key={`tl-stroke-m-${lineAnimKey}-${hoverReplayModal}`}
                      animKey={`${lineAnimKey}-m-${hoverReplayModal}`}
                      d={geomModal.lineD}
                      stroke={color}
                      strokeWidth={isTempChart ? 3.45 : 3.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={lineShadowStyle}
                    />
                    {tip != null ? (
                      <circle
                        cx={geomModal.xAt(tip.idx)}
                        cy={geomModal.yAt(valueOf(rows[tip.idx]))}
                        r={7}
                        fill={color}
                        stroke="var(--chart-point-ring)"
                        strokeWidth={2}
                      />
                    ) : showSeriesInsight && geomModal.lastPt ? (
                      <circle
                        cx={geomModal.lastPt.x}
                        cy={geomModal.lastPt.y}
                        r={5.5}
                        fill={color}
                        stroke="var(--chart-point-ring)"
                        strokeWidth={2}
                      />
                    ) : null}
                    {(() => {
                      const n = geomModal.pts.length
                      const step = n <= 20 ? 1 : Math.ceil(n / 18)
                      return geomModal.pts
                        .map((pt, i) => ({ pt, i }))
                        .filter(({ i }) => i % step === 0 || i === n - 1)
                        .map(({ pt, i }) => (
                          <text
                            key={`pv-m-${i}`}
                            x={pt.x}
                            y={Math.max(pTM + 12, pt.y - 9)}
                            textAnchor="middle"
                            fill={color}
                            fontSize={11}
                            fontWeight={700}
                            fontFamily="system-ui, sans-serif"
                            style={{ filter: 'var(--chart-value-dropshadow)' }}
                          >
                            {fmt(geomModal.values[i])}
                            {valueSuffix.trim()}
                          </text>
                        ))
                    })()}
                    {geomModal.yTicks.map((t, i) => (
                      <text
                        key={`yl-m-${i}`}
                        x={pLM - 10}
                        y={t.y + 4}
                        textAnchor="end"
                        fill="var(--chart-svg-y-tick)"
                        fontSize={12}
                        fontFamily="system-ui, sans-serif"
                      >
                        {fmt(t.v)}
                        {valueSuffix}
                      </text>
                    ))}
                    <line
                      x1={pLM}
                      y1={geomModal.bottomY}
                      x2={wM - pRM}
                      y2={geomModal.bottomY}
                      stroke="var(--chart-axis-line)"
                      strokeWidth={1.5}
                    />
                    <line
                      x1={pLM}
                      y1={pTM}
                      x2={pLM}
                      y2={geomModal.bottomY}
                      stroke="var(--chart-axis-line)"
                      strokeWidth={1.5}
                    />
                    <text x={pLM} y={pTM - 4} fill="var(--chart-caption)" fontSize={11} fontFamily="system-ui, sans-serif">
                      {capAxis}
                    </text>
                    {geomModal.xLabels.map((xl, i) => (
                      <g key={`xl-m-${i}`}>
                        <text
                          x={xl.x}
                          y={hM - (xl.hora ? 22 : 12)}
                          textAnchor="middle"
                          fill="var(--chart-svg-x-label)"
                          fontSize={11}
                          fontFamily="system-ui, sans-serif"
                        >
                          {xl.text}
                        </text>
                        {xl.hora ? (
                          <text
                            x={xl.x}
                            y={hM - 8}
                            textAnchor="middle"
                            fill="var(--chart-caption)"
                            fontSize={9}
                            fontFamily="system-ui, sans-serif"
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {xl.hora}
                          </text>
                        ) : null}
                      </g>
                    ))}
                  </svg>
                </div>
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid var(--chart-divider)',
                    fontSize: 12,
                    color: 'var(--chart-footer-muted)',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 10,
                      width: '100%',
                    }}
                  >
                    <div style={{ textAlign: 'center', minWidth: 0 }}>
                      <div style={{ color: 'var(--chart-caption)', fontSize: 11, marginBottom: 4 }}>Mín.</div>
                      <strong style={{ color: 'var(--chart-legend-pill-text)', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
                        {fmt(geomModal.min)}
                        {valueSuffix}
                      </strong>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 0 }}>
                      <div style={{ color: 'var(--chart-caption)', fontSize: 11, marginBottom: 4 }}>Máx.</div>
                      <strong style={{ color: 'var(--chart-legend-pill-text)', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
                        {fmt(geomModal.max)}
                        {valueSuffix}
                      </strong>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 0 }}>
                      <div style={{ color: 'var(--chart-caption)', fontSize: 11, marginBottom: 4 }}>Média</div>
                      <strong style={{ color: 'var(--chart-legend-pill-text)', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>
                        {fmt(geomModal.avg)}
                        {valueSuffix}
                      </strong>
                    </div>
                  </div>
                  <div style={{ color: 'var(--chart-caption)', marginTop: 12, textAlign: 'center' }}>
                    {rows.length} ponto(s) no período
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      <div style={{ ...chartCardStyle, padding: compactSm ? 8 : isCompact ? 10 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: isCompact ? 6 : 10 }}>
        <div style={{ fontWeight: 700, color, fontSize: fsTitle, letterSpacing: '0.02em', lineHeight: 1.25 }}>{title}</div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            border: `1px solid ${color}55`,
            background: 'var(--chart-expand-bg)',
            color,
            borderRadius: isCompact ? 6 : 8,
            padding: compactSm ? '2px 6px' : isCompact ? '3px 7px' : '4px 9px',
            fontSize: compactSm ? 9 : isCompact ? 10 : 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Ampliar
        </button>
      </div>
      {!rows.length || !geomCard ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
          <div style={{ position: 'relative' }}>
            {tip != null && rows[tip.idx] ? (
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  ...chartTooltipOuterStyle(tip.pxPct),
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 200,
                  maxWidth: 300,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'var(--chart-tooltip-bg)',
                  border: `1px solid ${color}55`,
                  boxShadow: 'var(--chart-tooltip-shadow)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 6 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                {(() => {
                  const m = rowMetaForTooltip(rows[tip.idx])
                  return m.conferente || m.hora ? (
                    <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 8, lineHeight: 1.4 }}>
                      {m.conferente ? <span style={{ color: 'var(--chart-footer-muted)' }}>{m.conferente}</span> : null}
                      {m.conferente && m.hora ? <span style={{ color: 'var(--chart-caption)' }}> · </span> : null}
                      {m.hora ? <span>{m.hora}</span> : null}
                    </div>
                  ) : null
                })()}
                <div style={{ color }}>
                  Valor:{' '}
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(valueOf(rows[tip.idx]))}
                    {valueSuffix}
                  </strong>
                </div>
              </div>
            ) : null}
            <div
              style={{
                width: '100%',
                minHeight: chartMinH,
                aspectRatio: `${wC} / ${hC}`,
              }}
            >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${wC} ${hC}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', cursor: 'crosshair', minHeight: chartMinH }}
              onMouseEnter={onChartHoverCard}
              onMouseMove={onSvgMoveCard}
              onMouseLeave={onSvgLeave}
            >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={gradTop} />
                <stop offset="55%" stopColor={color} stopOpacity={gradMid} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={wC} height={hC} rx={8} fill="var(--chart-plot-area)" />
            {geomCard.xLabels.map((xl, i) => (
              <line
                key={`xg-${i}`}
                x1={xl.x}
                y1={pTC}
                x2={xl.x}
                y2={geomCard.bottomY}
                stroke="var(--chart-grid-vertical)"
                strokeWidth={1}
              />
            ))}
            {geomCard.yTicks.map((t, i) => (
              <line
                key={i}
                x1={pLC}
                y1={t.y}
                x2={wC - pRC}
                y2={t.y}
                stroke="var(--chart-grid-horizontal)"
                strokeDasharray="4 8"
                strokeWidth={1}
              />
            ))}
            <AnimatedAreaPath
              key={`tl-ac-${lineAnimKey}-${hoverReplayCard}`}
              d={geomCard.areaD}
              fill={`url(#${gradId})`}
              delaySec={0.06}
            />
            {tip != null ? (
              <line
                x1={geomCard.xAt(tip.idx)}
                y1={pTC}
                x2={geomCard.xAt(tip.idx)}
                y2={geomCard.bottomY}
                stroke="var(--chart-crosshair-muted)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ) : null}
            <AnimatedStrokePath
              key={`tl-stroke-c-${lineAnimKey}-${hoverReplayCard}`}
              animKey={`${lineAnimKey}-c-${hoverReplayCard}`}
              d={geomCard.lineD}
              stroke={color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={lineShadowStyle}
            />
            {tip != null ? (
              <circle
                cx={geomCard.xAt(tip.idx)}
                cy={geomCard.yAt(valueOf(rows[tip.idx]))}
                r={tipR}
                fill={color}
                stroke="var(--chart-point-ring)"
                strokeWidth={isCompact ? 1.5 : 2}
              />
            ) : (showSeriesInsight || isCompact) && geomCard.lastPt ? (
              <circle
                cx={geomCard.lastPt.x}
                cy={geomCard.lastPt.y}
                r={compactSm ? 3.5 : isCompact ? 4 : 5}
                fill={color}
                stroke="var(--chart-point-ring)"
                strokeWidth={isCompact ? 1.5 : 2}
              />
            ) : null}
            {showPointValues
              ? (() => {
                  const n = geomCard.pts.length
                  const step = n <= 16 ? 1 : Math.ceil(n / 12)
                  return geomCard.pts
                    .map((pt, i) => ({ pt, i }))
                    .filter(({ i }) => i % step === 0 || i === n - 1)
                    .map(({ pt, i }) => (
                      <text
                        key={`pv-${i}`}
                        x={pt.x}
                        y={Math.max(pTC + 8, pt.y - (compactSm ? 5 : isCompact ? 6 : 8))}
                        textAnchor="middle"
                        fill={color}
                        fontSize={fsPt}
                        fontWeight={700}
                        fontFamily="system-ui, sans-serif"
                        style={{ filter: 'var(--chart-value-dropshadow)' }}
                      >
                        {fmt(geomCard.values[i])}
                        {valueSuffix.trim()}
                      </text>
                    ))
                })()
              : null}
            {geomCard.yTicks.map((t, i) => (
              <text
                key={`yl-${i}`}
                x={pLC - 10}
                y={t.y + 3}
                textAnchor="end"
                fill="var(--chart-svg-y-tick)"
                fontSize={fsY}
                fontFamily="system-ui, sans-serif"
              >
                {fmt(t.v)}
                {valueSuffix}
              </text>
            ))}
            <line
              x1={pLC}
              y1={geomCard.bottomY}
              x2={wC - pRC}
              y2={geomCard.bottomY}
              stroke="var(--chart-axis-line)"
              strokeWidth={isCompact ? 1 : 1.5}
            />
            <line
              x1={pLC}
              y1={pTC}
              x2={pLC}
              y2={geomCard.bottomY}
              stroke="var(--chart-axis-line)"
              strokeWidth={isCompact ? 1 : 1.5}
            />
            <text
              x={pLC}
              y={pTC - (isCompact ? 2 : 4)}
              fill="var(--chart-caption)"
              fontSize={fsCap}
              fontFamily="system-ui, sans-serif"
            >
              {capAxis}
            </text>
            {geomCard.xLabels.map((xl, i) => (
              <text
                key={`xl-${i}`}
                x={xl.x}
                y={hC - (compactSm ? 5 : isCompact ? 6 : 10)}
                textAnchor="middle"
                fill="var(--chart-svg-x-label)"
                fontSize={fsX}
                fontFamily="system-ui, sans-serif"
              >
                {xl.text}
              </text>
            ))}
            </svg>
            </div>
          </div>
          {isCompact ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 8,
                fontSize: compactSm ? 10 : 11,
                paddingTop: 8,
                borderTop: '1px solid var(--chart-divider)',
                color: 'var(--chart-footer-muted)',
              }}
            >
              <span>
                Faixa no gráfico:{' '}
                <strong style={{ color: 'var(--chart-legend-pill-text)' }}>
                  {fmt(geomCard.min)}
                  {valueSuffix}
                </strong>{' '}
                a{' '}
                <strong style={{ color: 'var(--chart-legend-pill-text)' }}>
                  {fmt(geomCard.max)}
                  {valueSuffix}
                </strong>
              </span>
              <span style={{ color: 'var(--chart-caption)' }}>{rows.length} lançamento(s) no histórico carregado</span>
            </div>
          ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              alignItems: 'stretch',
              width: '100%',
              marginTop: 12,
              fontSize: 12,
              color: 'var(--text, #9ca3af)',
              paddingTop: 10,
              borderTop: '1px solid var(--chart-divider)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 10,
                width: '100%',
              }}
            >
              {(
                [
                  { k: 'Mín.', v: geomCard.min },
                  { k: 'Máx.', v: geomCard.max },
                  { k: 'Média', v: geomCard.avg },
                ] as const
              ).map((row) => (
                <div
                  key={row.k}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--chart-stat-box-bg)',
                    border: '1px solid var(--chart-stat-box-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    textAlign: 'center',
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--chart-stat-label)', fontWeight: 600, letterSpacing: '0.04em' }}>{row.k}</span>
                  <strong style={{ color: 'var(--chart-stat-value)', fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>
                    {fmt(row.v)}
                    {valueSuffix}
                  </strong>
                </div>
              ))}
            </div>
            {showSeriesInsight && rows.length >= 2 ? (
              <div
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--chart-insight-bg)',
                  border: '1px solid var(--chart-insight-border)',
                  display: 'grid',
                  gap: 10,
                  fontSize: 12,
                  color: 'var(--chart-insight-text)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--chart-insight-title)', fontSize: 12, letterSpacing: '0.02em' }}>
                  Tendência no período exibido
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: '8px 20px',
                    alignItems: 'center',
                    rowGap: 10,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    Início ({formatAxisDateChart(rows[0].data_registro)})
                  </span>
                  <strong style={{ color: 'var(--chart-insight-strong)', fontVariantNumeric: 'tabular-nums', justifySelf: 'end' }}>
                    {fmt(geomCard.firstVal)}
                    {valueSuffix}
                  </strong>
                  <span style={{ minWidth: 0 }}>Fim ({formatAxisDateChart(rows[rows.length - 1].data_registro)})</span>
                  <strong style={{ color: 'var(--chart-insight-strong)', fontVariantNumeric: 'tabular-nums', justifySelf: 'end' }}>
                    {fmt(geomCard.lastVal)}
                    {valueSuffix}
                  </strong>
                  <span style={{ minWidth: 0 }}>Variação (fim − início)</span>
                  <strong
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      justifySelf: 'end',
                      color: geomCard.delta > 0.0001 ? '#6ee7b7' : geomCard.delta < -0.0001 ? '#fca5a5' : 'var(--chart-stat-value)',
                    }}
                  >
                    {geomCard.delta > 0 ? '+' : ''}
                    {fmt(geomCard.delta)}
                    {valueSuffix}
                  </strong>
                </div>
              </div>
            ) : null}
          </div>
          )}
        </>
      )}
      </div>
    </>
  )
}

const COMBINED_SERIES = [
  { color: '#22c55e', valueOf: (r: TempRow) => r.camara11_temp, label: 'Câmara 11' },
  { color: '#38bdf8', valueOf: (r: TempRow) => r.camara12_temp, label: 'Câmara 12' },
  { color: '#f59e0b', valueOf: (r: TempRow) => r.camara13_temp, label: 'Câmara 13' },
] as const

type CombTempLayout = {
  width: number
  height: number
  padL: number
  padR: number
  padT: number
  padB: number
}

const COMB_TEMP_LAYOUT_CARD: CombTempLayout = { width: 1100, height: 278, padL: 54, padR: 18, padT: 20, padB: 48 }
const COMB_TEMP_LAYOUT_MODAL: CombTempLayout = { width: 1300, height: 400, padL: 60, padR: 82, padT: 24, padB: 76 }

function buildCombinedTempChartModel(
  rows: TempRow[],
  uid: string,
  L: CombTempLayout,
  gradPrefix: string,
  xDense: boolean,
) {
  const { width, height, padL, padR, padT, padB } = L
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  if (!rows.length) return null
  const allVals = rows.flatMap((r) => [r.camara11_temp, r.camara12_temp, r.camara13_temp])
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const safeMin = min === max ? min - 1 : min
  const safeMax = min === max ? max + 1 : max
  const rng = safeMax - safeMin
  const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
  const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
  const seriesPaths = COMBINED_SERIES.map((s, si) => {
    const pts = rows.map((r, i) => {
      const v = s.valueOf(r)
      return { x: xAt(i), y: yAt(v) }
    })
    return {
      lineD: smoothLinePath(pts),
      color: s.color,
      label: s.label,
      gradId: `${gradPrefix}-${uid}-${si}`,
    }
  })
  const yTicks = linearYTicks(safeMin, safeMax, yAt, 5)
  const n = rows.length
  let xIdx: number[]
  if (xDense) {
    if (n <= 1) xIdx = [0]
    else if (n <= 16) xIdx = Array.from({ length: n }, (_, i) => i)
    else {
      xIdx = [0]
      for (let k = 1; k <= 12; k++) xIdx.push(Math.round(((n - 1) * k) / 13))
      xIdx.push(n - 1)
      xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
    }
  } else {
    xIdx = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1]
  }
  const xLabels = [...new Set(xIdx)]
    .sort((a, b) => a - b)
    .map((i) => ({
      x: xAt(i),
      text: formatAxisDateChart(rows[i].data_registro),
      hora: formatHoraRegistro(rows[i].created_at),
    }))
  return { seriesPaths, yTicks, xLabels, min, max, xAt, yAt, bottomY, innerW, width, height, padL, padR, padT, padB }
}

function CombinedTempChart({ rows }: { rows: TempRow[] }) {
  const uid = useId().replace(/:/g, '')
  const [expanded, setExpanded] = useState(false)
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)
  const [hoverReplayCard, setHoverReplayCard] = useState(0)
  const [hoverReplayModal, setHoverReplayModal] = useState(0)
  const onChartHoverCard = useCallback(() => setHoverReplayCard((n) => n + 1), [])
  const onChartHoverModal = useCallback(() => setHoverReplayModal((n) => n + 1), [])

  const chart = useMemo(
    () => buildCombinedTempChartModel(rows, uid, COMB_TEMP_LAYOUT_CARD, 'cgrad', false),
    [rows, uid],
  )
  const chartModal = useMemo(
    () => buildCombinedTempChartModel(rows, uid, COMB_TEMP_LAYOUT_MODAL, 'cgrad-m', true),
    [rows, uid],
  )

  const makeCombTempMove = useCallback(
    (M: NonNullable<typeof chart>) =>
      (e: React.MouseEvent<SVGSVGElement>) => {
        if (!rows.length) return
        const { width, padL, padR, innerW } = M
        const svg = e.currentTarget
        const rect = svg.getBoundingClientRect()
        const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width
        const n = rows.length
        if (vx < padL || vx > width - padR) {
          setTip(null)
          return
        }
        const step = n > 1 ? innerW / (n - 1) : 0
        let idx = n <= 1 ? 0 : Math.round((vx - padL) / step)
        idx = Math.max(0, Math.min(n - 1, idx))
        const xCenter = padL + step * idx
        setTip({ idx, pxPct: (xCenter / width) * 100 })
      },
    [rows.length],
  )

  const onSvgMoveCard = useMemo(() => (chart ? makeCombTempMove(chart) : undefined), [chart, makeCombTempMove])
  const onSvgMoveModal = useMemo(
    () => (chartModal ? makeCombTempMove(chartModal) : undefined),
    [chartModal, makeCombTempMove],
  )

  const onSvgLeave = useCallback(() => setTip(null), [])

  const combTempLineAnimKey = useMemo(() => rows.map((r) => r.id).join(','), [rows])

  const combTempModalScrollRef = useRef<HTMLDivElement>(null)
  useScrollChartModalToEnd(expanded && !!chartModal, combTempLineAnimKey, combTempModalScrollRef)

  const width = COMB_TEMP_LAYOUT_CARD.width
  const height = COMB_TEMP_LAYOUT_CARD.height
  const padL = COMB_TEMP_LAYOUT_CARD.padL
  const padR = COMB_TEMP_LAYOUT_CARD.padR
  const padT = COMB_TEMP_LAYOUT_CARD.padT
  const padB = COMB_TEMP_LAYOUT_CARD.padB
  const innerW = COMB_TEMP_LAYOUT_CARD.width - COMB_TEMP_LAYOUT_CARD.padL - COMB_TEMP_LAYOUT_CARD.padR
  const bottomY = chart?.bottomY ?? COMB_TEMP_LAYOUT_CARD.padT + (COMB_TEMP_LAYOUT_CARD.height - COMB_TEMP_LAYOUT_CARD.padT - COMB_TEMP_LAYOUT_CARD.padB)

  return (
    <div style={chartCardStyle}>
      {expanded && chartModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--chart-modal-overlay)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setExpanded(false)}
        >
          <div
            ref={combTempModalScrollRef}
            style={{
              ...chartCardStyle,
              padding: '12px 28px 22px 12px',
              width: 'min(1320px, 98vw)',
              maxHeight: '94vh',
              overflow: 'auto',
              border: '1px solid var(--chart-modal-border-accent-green)',
              boxShadow: 'var(--chart-modal-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                  letterSpacing: '0.02em',
                  background: 'var(--chart-comparativo-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Comparativo — Câmaras 11, 12 e 13
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  border: '1px solid var(--chart-btn-fechar-border)',
                  background: 'var(--chart-btn-fechar-bg)',
                  color: 'var(--chart-btn-fechar-color)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 10, lineHeight: 1.45 }}>
              Eixo X: data e horário do registro · Eixo Y: °C. Passe o mouse para ver as três câmaras no ponto.
            </div>
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
              {chartModal.seriesPaths.map((p) => (
                <span
                  key={p.label}
                  style={{
                    color: 'var(--chart-legend-pill-text)',
                    fontWeight: 600,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: `1px solid ${p.color}55`,
                    background: `${p.color}14`,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                  {p.label}
                </span>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              {tip != null && rows[tip.idx] ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    ...chartTooltipOuterStyle(tip.pxPct),
                    zIndex: 2,
                    pointerEvents: 'none',
                    minWidth: 220,
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
                    {formatAxisDateChart(rows[tip.idx].data_registro)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 8 }}>
                    {formatHoraRegistro(rows[tip.idx].created_at)}
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#22c55e' }}>
                      Câm. 11: <strong>{rows[tip.idx].camara11_temp.toFixed(1)} °C</strong>
                    </div>
                    <div style={{ color: '#38bdf8' }}>
                      Câm. 12: <strong>{rows[tip.idx].camara12_temp.toFixed(1)} °C</strong>
                    </div>
                    <div style={{ color: '#f59e0b' }}>
                      Câm. 13: <strong>{rows[tip.idx].camara13_temp.toFixed(1)} °C</strong>
                    </div>
                  </div>
                </div>
              ) : null}
              <svg
                width="100%"
                viewBox={`0 0 ${chartModal.width} ${chartModal.height}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ display: 'block', cursor: 'crosshair' }}
                onMouseEnter={onChartHoverModal}
                onMouseMove={onSvgMoveModal}
                onMouseLeave={onSvgLeave}
              >
                <defs>
                  {chartModal.seriesPaths.map((p) => (
                    <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={p.color} stopOpacity={0.26} />
                      <stop offset="55%" stopColor={p.color} stopOpacity={0.11} />
                      <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <rect x={0} y={0} width={chartModal.width} height={chartModal.height} rx={10} fill="var(--chart-plot-area)" />
                {chartModal.xLabels.map((xl, i) => (
                  <line
                    key={`cxgm-${i}`}
                    x1={xl.x}
                    y1={chartModal.padT}
                    x2={xl.x}
                    y2={chartModal.bottomY}
                    stroke="var(--chart-grid-vertical-dense)"
                    strokeWidth={1}
                  />
                ))}
                {chartModal.yTicks.map((t, i) => (
                  <line
                    key={`cym-${i}`}
                    x1={chartModal.padL}
                    y1={t.y}
                    x2={chartModal.width - chartModal.padR}
                    y2={t.y}
                    stroke="var(--chart-grid-horizontal)"
                    strokeDasharray="4 8"
                    strokeWidth={1}
                  />
                ))}
                {tip != null ? (
                  <line
                    x1={chartModal.xAt(tip.idx)}
                    y1={chartModal.padT}
                    x2={chartModal.xAt(tip.idx)}
                    y2={chartModal.bottomY}
                    stroke="var(--chart-cursor-line)"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                  />
                ) : null}
                {chartModal.seriesPaths.map((p, si) => {
                  const lineD = p.lineD
                  const pts = rows.map((_, i) => ({
                    x: chartModal.padL + (rows.length > 1 ? (chartModal.innerW * i) / (rows.length - 1) : chartModal.innerW / 2),
                  }))
                  const lastX = pts[pts.length - 1]?.x ?? chartModal.padL
                  const firstX = pts[0]?.x ?? chartModal.padL
                  const areaD = `${lineD} L ${lastX.toFixed(2)} ${chartModal.bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${chartModal.bottomY.toFixed(2)} Z`
                  return (
                    <AnimatedAreaPath
                      key={`${p.label}-m-${hoverReplayModal}`}
                      d={areaD}
                      fill={`url(#${p.gradId})`}
                      targetOpacity={0.72}
                      delaySec={0.06 + si * 0.06}
                    />
                  )
                })}
                {chartModal.seriesPaths.map((p, si) => (
                  <AnimatedStrokePath
                    key={`line-m-${p.label}-${hoverReplayModal}`}
                    animKey={`${combTempLineAnimKey}-m-${chartModal.width}-${hoverReplayModal}`}
                    strokeDelaySec={0.05 * si}
                    d={p.lineD}
                    stroke={p.color}
                    strokeWidth={3.05}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: `drop-shadow(0 0 14px ${p.color}99) drop-shadow(0 6px 20px ${p.color}50)` }}
                  />
                ))}
                {(() => {
                  const n = rows.length
                  const idxs =
                    n <= 18 ? Array.from({ length: n }, (_, i) => i) : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
                  const uniqIdxs = [...new Set(idxs)].sort((a, b) => a - b)
                  return COMBINED_SERIES.flatMap((s, si) =>
                    uniqIdxs.map((i) => {
                      const v = s.valueOf(rows[i])
                      const x = chartModal.xAt(i)
                      const y = chartModal.yAt(v)
                      const yShift = si === 0 ? -10 : si === 1 ? -18 : -6
                      return (
                        <text
                          key={`tmp-valm-${si}-${i}`}
                          x={x}
                          y={Math.max(chartModal.padT + 11, y + yShift)}
                          textAnchor="middle"
                          fill={s.color}
                          fontSize={11}
                          fontWeight={700}
                          fontFamily="system-ui, sans-serif"
                          style={{ filter: 'var(--chart-value-dropshadow)' }}
                        >
                          {v.toFixed(1)}°C
                        </text>
                      )
                    }),
                  )
                })()}
                {tip != null
                  ? COMBINED_SERIES.map((s) => {
                      const v = s.valueOf(rows[tip.idx])
                      const cx = chartModal.xAt(tip.idx)
                      const cy = chartModal.yAt(v)
                      return (
                        <circle
                          key={`dotm-${s.label}`}
                          cx={cx}
                          cy={cy}
                          r={5.5}
                          fill={s.color}
                          stroke="var(--chart-point-ring)"
                          strokeWidth={2}
                        />
                      )
                    })
                  : null}
                {chartModal.yTicks.map((t, i) => (
                  <text
                    key={`cylm-${i}`}
                    x={chartModal.padL - 10}
                    y={t.y + 4}
                    textAnchor="end"
                    fill="var(--chart-svg-y-tick)"
                    fontSize={12}
                    fontFamily="system-ui, sans-serif"
                  >
                    {t.v.toFixed(1)}°C
                  </text>
                ))}
                <text x={chartModal.padL} y={chartModal.padT - 2} fill="var(--chart-caption)" fontSize={11} fontFamily="system-ui, sans-serif">
                  °C
                </text>
                <line
                  x1={chartModal.padL}
                  y1={chartModal.bottomY}
                  x2={chartModal.width - chartModal.padR}
                  y2={chartModal.bottomY}
                  stroke="var(--chart-axis-line)"
                  strokeWidth={1.5}
                />
                <line
                  x1={chartModal.padL}
                  y1={chartModal.padT}
                  x2={chartModal.padL}
                  y2={chartModal.bottomY}
                  stroke="var(--chart-axis-line)"
                  strokeWidth={1.5}
                />
                {chartModal.xLabels.map((xl, i) => (
                  <g key={`cxlm-${i}`}>
                    <text
                      x={xl.x}
                      y={chartModal.height - (xl.hora ? 22 : 12)}
                      textAnchor="middle"
                      fill="var(--chart-svg-x-label)"
                      fontSize={11}
                      fontFamily="system-ui, sans-serif"
                    >
                      {xl.text}
                    </text>
                    {xl.hora ? (
                      <text
                        x={xl.x}
                        y={chartModal.height - 8}
                        textAnchor="middle"
                        fill="var(--chart-caption)"
                        fontSize={9}
                        fontFamily="system-ui, sans-serif"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {xl.hora}
                      </text>
                    ) : null}
                  </g>
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
                Escala: <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chartModal.min.toFixed(1)} °C</strong> a{' '}
                <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chartModal.max.toFixed(1)} °C</strong>
              </span>
              <span style={{ color: 'var(--chart-caption)' }}>{rows.length} lançamento(s)</span>
            </div>
          </div>
        </div>
      ) : null}
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
          Comparativo — Câmaras 11, 12 e 13
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={!rows.length}
          style={{
            border: '1px solid rgba(34,197,94,.45)',
            background: rows.length ? 'var(--chart-expand-bg)' : 'var(--chart-expand-disabled-bg)',
            color: '#22c55e',
            borderRadius: 8,
            padding: '5px 11px',
            fontSize: 11,
            fontWeight: 700,
            cursor: rows.length ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}
        >
          Ampliar
        </button>
      </div>
      {!rows.length || !chart ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
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
            {chart.seriesPaths.map((p) => (
              <span
                key={p.label}
                style={{
                  color: 'var(--chart-legend-pill-text)',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${p.color}55`,
                  background: `${p.color}14`,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                {p.label}
              </span>
            ))}
            <span style={{ fontSize: 12, color: 'var(--chart-caption)', marginLeft: 'auto' }}>
              Passe o mouse no gráfico para ver valores por data
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            {tip != null && rows[tip.idx] ? (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  ...chartTooltipOuterStyle(tip.pxPct),
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 200,
                  maxWidth: 320,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--chart-tooltip-bg)',
                  border: '1px solid var(--chart-tooltip-border-cyan)',
                  boxShadow: 'var(--chart-tooltip-shadow)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 8 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#22c55e' }}>
                    Câm. 11: <strong>{rows[tip.idx].camara11_temp.toFixed(1)} °C</strong>
                  </div>
                  <div style={{ color: '#38bdf8' }}>
                    Câm. 12: <strong>{rows[tip.idx].camara12_temp.toFixed(1)} °C</strong>
                  </div>
                  <div style={{ color: '#f59e0b' }}>
                    Câm. 13: <strong>{rows[tip.idx].camara13_temp.toFixed(1)} °C</strong>
                  </div>
                </div>
              </div>
            ) : null}
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', cursor: 'crosshair' }}
              onMouseEnter={onChartHoverCard}
              onMouseMove={onSvgMoveCard}
              onMouseLeave={onSvgLeave}
            >
              <defs>
                {chart.seriesPaths.map((p) => (
                  <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.26} />
                    <stop offset="55%" stopColor={p.color} stopOpacity={0.11} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <rect x={0} y={0} width={width} height={height} rx={10} fill="var(--chart-plot-area)" />
              {chart.xLabels.map((xl, i) => (
                <line
                  key={`cxg-${i}`}
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
                  key={i}
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
                const pts = rows.map((_, i) => ({
                  x: padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2),
                }))
                const lastX = pts[pts.length - 1]?.x ?? padL
                const firstX = pts[0]?.x ?? padL
                const areaD = `${lineD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`
                return (
                  <AnimatedAreaPath
                    key={`${p.label}-c-${hoverReplayCard}`}
                    d={areaD}
                    fill={`url(#${p.gradId})`}
                    targetOpacity={0.72}
                    delaySec={0.06 + si * 0.06}
                  />
                )
              })}
              {chart.seriesPaths.map((p, si) => (
                <AnimatedStrokePath
                  key={`line-${p.label}-${hoverReplayCard}`}
                  animKey={`${combTempLineAnimKey}-c-${width}-${hoverReplayCard}`}
                  strokeDelaySec={0.05 * si}
                  d={p.lineD}
                  stroke={p.color}
                  strokeWidth={3.05}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 14px ${p.color}99) drop-shadow(0 6px 20px ${p.color}50)` }}
                />
              ))}
              {(() => {
                const n = rows.length
                const idxs =
                  n <= 10
                    ? Array.from({ length: n }, (_, i) => i)
                    : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
                const uniqIdxs = [...new Set(idxs)].sort((a, b) => a - b)
                return COMBINED_SERIES.flatMap((s, si) =>
                  uniqIdxs.map((i) => {
                    const v = s.valueOf(rows[i])
                    const x = chart.xAt(i)
                    const y = chart.yAt(v)
                    const yShift = si === 0 ? -10 : si === 1 ? -18 : -6
                    return (
                      <text
                        key={`tmp-val-${si}-${i}`}
                        x={x}
                        y={Math.max(padT + 11, y + yShift)}
                        textAnchor="middle"
                        fill={s.color}
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="system-ui, sans-serif"
                        style={{ filter: 'var(--chart-value-dropshadow)' }}
                      >
                        {v.toFixed(1)}°C
                      </text>
                    )
                  }),
                )
              })()}
              {tip != null
                ? COMBINED_SERIES.map((s) => {
                    const v = s.valueOf(rows[tip.idx])
                    const cx = chart.xAt(tip.idx)
                    const cy = chart.yAt(v)
                    return (
                      <circle
                        key={`dot-${s.label}`}
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
              {chart.yTicks.map((t, i) => (
                <text
                  key={`cyl-${i}`}
                  x={padL - 10}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="var(--chart-svg-y-tick)"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {t.v.toFixed(1)}°C
                </text>
              ))}
              <text x={padL} y={padT - 2} fill="var(--chart-caption)" fontSize={10} fontFamily="system-ui, sans-serif">
                °C
              </text>
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
                  key={`cxl-${i}`}
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
              Escala vertical: <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chart.min.toFixed(1)} °C</strong> a{' '}
              <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chart.max.toFixed(1)} °C</strong>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const COMBINED_OCP_SERIES = [
  { color: OCUP_COLOR_GERAL, valueOf: ocupPercGeral, label: 'Geral (11+12+13 + avaria)', strokeWidth: 3.35 },
  { color: '#22c55e', valueOf: ocupPercCam11, label: 'Câmara 11', strokeWidth: 2.7 },
  { color: '#38bdf8', valueOf: ocupPercCam12, label: 'Câmara 12', strokeWidth: 2.7 },
  { color: '#f59e0b', valueOf: ocupPercCam13, label: 'Câmara 13', strokeWidth: 2.7 },
] as const

const COMB_OCP_LAYOUT_CARD: CombTempLayout = { width: 1100, height: 292, padL: 54, padR: 18, padT: 20, padB: 50 }
const COMB_OCP_LAYOUT_MODAL: CombTempLayout = { width: 1300, height: 410, padL: 60, padR: 82, padT: 24, padB: 80 }

function buildCombinedOcupChartModel(
  rows: OcupRow[],
  uid: string,
  L: CombTempLayout,
  gradPrefix: string,
  xDense: boolean,
) {
  const { width, height, padL, padR, padT, padB } = L
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const bottomY = padT + innerH
  if (!rows.length) return null
  const allVals = rows.flatMap((r) => COMBINED_OCP_SERIES.map((s) => s.valueOf(r)))
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const pad = (max - min) * 0.06 || 1
  const safeMin = min === max ? min - pad : min - pad * 0.35
  const safeMax = min === max ? max + pad : max + pad * 0.35
  const rng = safeMax - safeMin
  const xAt = (i: number) => padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2)
  const yAt = (v: number) => padT + innerH - ((v - safeMin) / rng) * innerH
  const seriesPaths = COMBINED_OCP_SERIES.map((s, si) => {
    const pts = rows.map((r, i) => {
      const v = s.valueOf(r)
      return { x: xAt(i), y: yAt(v) }
    })
    return {
      lineD: smoothLinePath(pts),
      color: s.color,
      label: s.label,
      strokeWidth: s.strokeWidth,
      gradId: `${gradPrefix}-${uid}-${si}`,
    }
  })
  const yTicks = linearYTicks(safeMin, safeMax, yAt, 6)
  const n = rows.length
  let xIdx: number[]
  if (xDense) {
    if (n <= 1) xIdx = [0]
    else if (n <= 16) xIdx = Array.from({ length: n }, (_, i) => i)
    else {
      xIdx = [0]
      for (let k = 1; k <= 12; k++) xIdx.push(Math.round(((n - 1) * k) / 13))
      xIdx.push(n - 1)
      xIdx = [...new Set(xIdx)].sort((a, b) => a - b)
    }
  } else {
    xIdx =
      n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
  }
  const xLabels = [...new Set(xIdx)]
    .sort((a, b) => a - b)
    .map((i) => ({
      x: xAt(i),
      text: formatAxisDateChart(rows[i].data_registro),
      hora: formatHoraRegistro(rows[i].created_at),
    }))
  return { seriesPaths, yTicks, xLabels, min, max, xAt, yAt, bottomY, innerW, width, height, padL, padR, padT, padB }
}

function CombinedOcupacaoChart({ rows }: { rows: OcupRow[] }) {
  const uid = useId().replace(/:/g, '')
  const [expanded, setExpanded] = useState(false)
  const [tip, setTip] = useState<{ idx: number; pxPct: number } | null>(null)
  const [hoverReplayCard, setHoverReplayCard] = useState(0)
  const [hoverReplayModal, setHoverReplayModal] = useState(0)
  const onChartHoverCard = useCallback(() => setHoverReplayCard((n) => n + 1), [])
  const onChartHoverModal = useCallback(() => setHoverReplayModal((n) => n + 1), [])

  const chart = useMemo(
    () => buildCombinedOcupChartModel(rows, uid, COMB_OCP_LAYOUT_CARD, 'ocp-grad', false),
    [rows, uid],
  )
  const chartModal = useMemo(
    () => buildCombinedOcupChartModel(rows, uid, COMB_OCP_LAYOUT_MODAL, 'ocp-grad-m', true),
    [rows, uid],
  )

  const makeCombOcpMove = useCallback(
    (M: NonNullable<typeof chart>) =>
      (e: React.MouseEvent<SVGSVGElement>) => {
        if (!rows.length) return
        const { width, padL, padR, innerW } = M
        const svg = e.currentTarget
        const rect = svg.getBoundingClientRect()
        const vx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width
        const n = rows.length
        if (vx < padL || vx > width - padR) {
          setTip(null)
          return
        }
        const step = n > 1 ? innerW / (n - 1) : 0
        let idx = n <= 1 ? 0 : Math.round((vx - padL) / step)
        idx = Math.max(0, Math.min(n - 1, idx))
        const xCenter = padL + step * idx
        setTip({ idx, pxPct: (xCenter / width) * 100 })
      },
    [rows.length],
  )

  const onSvgMoveCard = useMemo(() => (chart ? makeCombOcpMove(chart) : undefined), [chart, makeCombOcpMove])
  const onSvgMoveModal = useMemo(
    () => (chartModal ? makeCombOcpMove(chartModal) : undefined),
    [chartModal, makeCombOcpMove],
  )

  const onSvgLeave = useCallback(() => setTip(null), [])

  const combOcpLineAnimKey = useMemo(() => rows.map((r) => r.id).join(','), [rows])

  const combOcpModalScrollRef = useRef<HTMLDivElement>(null)
  useScrollChartModalToEnd(expanded && !!chartModal, combOcpLineAnimKey, combOcpModalScrollRef)

  const width = COMB_OCP_LAYOUT_CARD.width
  const height = COMB_OCP_LAYOUT_CARD.height
  const padL = COMB_OCP_LAYOUT_CARD.padL
  const padR = COMB_OCP_LAYOUT_CARD.padR
  const padT = COMB_OCP_LAYOUT_CARD.padT
  const innerW = COMB_OCP_LAYOUT_CARD.width - COMB_OCP_LAYOUT_CARD.padL - COMB_OCP_LAYOUT_CARD.padR
  const bottomY = chart?.bottomY ?? COMB_OCP_LAYOUT_CARD.padT + (COMB_OCP_LAYOUT_CARD.height - COMB_OCP_LAYOUT_CARD.padT - COMB_OCP_LAYOUT_CARD.padB)

  return (
    <div style={{ ...chartCardStyle, padding: 16 }}>
      {expanded && chartModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--chart-modal-overlay)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setExpanded(false)}
        >
          <div
            ref={combOcpModalScrollRef}
            style={{
              ...chartCardStyle,
              width: 'min(1320px, 98vw)',
              maxHeight: '94vh',
              overflow: 'auto',
              padding: '16px 28px 24px 16px',
              border: '1px solid var(--chart-modal-border-accent-cyan)',
              boxShadow: 'var(--chart-modal-shadow)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 18,
                    letterSpacing: '0.02em',
                    background: 'var(--chart-comparativo-ocup-gradient)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Comparativo — ocupação %
                </div>
                <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginTop: 6, lineHeight: 1.45, maxWidth: 720 }}>
                  Linha <strong style={{ color: 'var(--chart-legend-pill-text)' }}>geral</strong> inclui avaria. Eixo X: data e horário do registro.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  border: '1px solid var(--chart-btn-fechar-border)',
                  background: 'var(--chart-btn-fechar-bg)',
                  color: 'var(--chart-btn-fechar-color)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Fechar
              </button>
            </div>
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
                border: '1px solid var(--chart-tooltip-border-cyan)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--chart-caption)', fontWeight: 600, marginRight: 4 }}>Legenda</span>
              {chartModal.seriesPaths.map((p) => (
                <span
                  key={p.label}
                  style={{
                    color: 'var(--chart-legend-pill-text)',
                    fontWeight: 600,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: `1px solid ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.45)' : `${p.color}55`}`,
                    background: `${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.12)' : `${p.color}14`}`,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: p.color,
                      boxShadow: `0 0 10px ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.5)' : p.color}`,
                    }}
                  />
                  {p.label}
                </span>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              {tip != null && rows[tip.idx] ? (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    ...chartTooltipOuterStyle(tip.pxPct),
                    zIndex: 2,
                    pointerEvents: 'none',
                    minWidth: 240,
                    maxWidth: 360,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--chart-tooltip-bg)',
                    border: '1px solid var(--chart-modal-border-accent-cyan)',
                    boxShadow: 'var(--chart-tooltip-shadow)',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 4 }}>
                    {formatAxisDateChart(rows[tip.idx].data_registro)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 10 }}>
                    {rows[tip.idx].conferente_nome}
                    <span style={{ color: 'var(--chart-caption)' }}> · </span>
                    {formatHoraRegistro(rows[tip.idx].created_at)}
                  </div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    <div style={{ color: OCUP_COLOR_GERAL }}>
                    Geral: <strong>{ocupPercGeral(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                    <div style={{ color: '#22c55e' }}>
                      Câm. 11: <strong>{ocupPercCam11(rows[tip.idx]).toFixed(1)} %</strong>
                    </div>
                    <div style={{ color: '#38bdf8' }}>
                      Câm. 12: <strong>{ocupPercCam12(rows[tip.idx]).toFixed(1)} %</strong>
                    </div>
                    <div style={{ color: '#f59e0b' }}>
                      Câm. 13: <strong>{ocupPercCam13(rows[tip.idx]).toFixed(1)} %</strong>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        paddingTop: 8,
                        borderTop: '1px solid var(--chart-divider)',
                        color: '#fdba74',
                      }}
                    >
                      Avaria: <strong>{rows[tip.idx].avaria_acrescimo_ocupacao}</strong> pos. (
                      {ocupAvariaPercTotal(rows[tip.idx]).toFixed(1)}% do armazém)
                    </div>
                  </div>
                </div>
              ) : null}
              <svg
                width="100%"
                viewBox={`0 0 ${chartModal.width} ${chartModal.height}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ display: 'block', cursor: 'crosshair' }}
                onMouseEnter={onChartHoverModal}
                onMouseMove={onSvgMoveModal}
                onMouseLeave={onSvgLeave}
              >
                <defs>
                  {chartModal.seriesPaths.map((p) => (
                    <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={p.color} stopOpacity={0.16} />
                      <stop offset="55%" stopColor={p.color} stopOpacity={0.05} />
                      <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <rect x={0} y={0} width={chartModal.width} height={chartModal.height} rx={10} fill="var(--chart-plot-area)" />
                {chartModal.xLabels.map((xl, i) => (
                  <line
                    key={`oxgm-${i}`}
                    x1={xl.x}
                    y1={chartModal.padT}
                    x2={xl.x}
                    y2={chartModal.bottomY}
                    stroke="var(--chart-grid-vertical)"
                    strokeWidth={1}
                  />
                ))}
                {chartModal.yTicks.map((t, i) => (
                  <line
                    key={`oym-${i}`}
                    x1={chartModal.padL}
                    y1={t.y}
                    x2={chartModal.width - chartModal.padR}
                    y2={t.y}
                    stroke="var(--chart-grid-horizontal)"
                    strokeDasharray="4 8"
                    strokeWidth={1}
                  />
                ))}
                {tip != null ? (
                  <line
                    x1={chartModal.xAt(tip.idx)}
                    y1={chartModal.padT}
                    x2={chartModal.xAt(tip.idx)}
                    y2={chartModal.bottomY}
                    stroke="var(--chart-cursor-line-strong)"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                  />
                ) : null}
                {chartModal.seriesPaths.map((p, si) => {
                  const lineD = p.lineD
                  const pts = rows.map((_, i) => ({
                    x: chartModal.padL + (rows.length > 1 ? (chartModal.innerW * i) / (rows.length - 1) : chartModal.innerW / 2),
                  }))
                  const lastX = pts[pts.length - 1]?.x ?? chartModal.padL
                  const firstX = pts[0]?.x ?? chartModal.padL
                  const areaD = `${lineD} L ${lastX.toFixed(2)} ${chartModal.bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${chartModal.bottomY.toFixed(2)} Z`
                  return (
                    <AnimatedAreaPath
                      key={`${p.label}-m-${hoverReplayModal}`}
                      d={areaD}
                      fill={`url(#${p.gradId})`}
                      targetOpacity={0.5}
                      delaySec={0.05 + si * 0.05}
                    />
                  )
                })}
                {chartModal.seriesPaths.map((p, si) => (
                  <AnimatedStrokePath
                    key={`olinem-${p.label}-${hoverReplayModal}`}
                    animKey={`${combOcpLineAnimKey}-m-${chartModal.width}-${hoverReplayModal}`}
                    strokeDelaySec={0.04 * si}
                    d={p.lineD}
                    stroke={p.color}
                    strokeWidth={p.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: `drop-shadow(0 0 6px ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.45)' : `${p.color}55`})` }}
                  />
                ))}
                {(() => {
                  const n = rows.length
                  const idxs =
                    n <= 18
                      ? Array.from({ length: n }, (_, i) => i)
                      : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
                  const uniqIdxs = [...new Set(idxs)].sort((a, b) => a - b)
                  return COMBINED_OCP_SERIES.flatMap((s, si) =>
                    uniqIdxs.map((i) => {
                      const v = s.valueOf(rows[i])
                      const x = chartModal.xAt(i)
                      const y = chartModal.yAt(v)
                      const yShift = si === 0 ? -10 : si === 1 ? -18 : si === 2 ? -6 : -14
                      return (
                        <text
                          key={`ocp-valm-${si}-${i}`}
                          x={x}
                          y={Math.max(chartModal.padT + 11, y + yShift)}
                          textAnchor="middle"
                          fill={s.color}
                          fontSize={11}
                          fontWeight={700}
                          fontFamily="system-ui, sans-serif"
                          style={{ filter: 'var(--chart-value-dropshadow)' }}
                        >
                          {v.toFixed(1)}%
                        </text>
                      )
                    }),
                  )
                })()}
                {tip != null
                  ? COMBINED_OCP_SERIES.map((s) => {
                      const v = s.valueOf(rows[tip.idx])
                      const cx = chartModal.xAt(tip.idx)
                      const cy = chartModal.yAt(v)
                      return (
                        <circle
                          key={`odm-${s.label}`}
                          cx={cx}
                          cy={cy}
                          r={s.strokeWidth > 3 ? 5.8 : 5.2}
                          fill={s.color}
                          stroke="var(--chart-point-ring)"
                          strokeWidth={2}
                        />
                      )
                    })
                  : null}
                {chartModal.yTicks.map((t, i) => (
                  <text
                    key={`oylm-${i}`}
                    x={chartModal.padL - 10}
                    y={t.y + 4}
                    textAnchor="end"
                    fill="var(--chart-svg-y-tick)"
                    fontSize={12}
                    fontFamily="system-ui, sans-serif"
                  >
                    {t.v.toFixed(1)}%
                  </text>
                ))}
                <text x={chartModal.padL} y={chartModal.padT - 2} fill="var(--chart-caption)" fontSize={11} fontFamily="system-ui, sans-serif">
                  % ocupada
                </text>
                <line
                  x1={chartModal.padL}
                  y1={chartModal.bottomY}
                  x2={chartModal.width - chartModal.padR}
                  y2={chartModal.bottomY}
                  stroke="var(--chart-axis-line)"
                  strokeWidth={1.5}
                />
                <line
                  x1={chartModal.padL}
                  y1={chartModal.padT}
                  x2={chartModal.padL}
                  y2={chartModal.bottomY}
                  stroke="var(--chart-axis-line)"
                  strokeWidth={1.5}
                />
                {chartModal.xLabels.map((xl, i) => (
                  <g key={`oxlm-${i}`}>
                    <text
                      x={xl.x}
                      y={chartModal.height - (xl.hora ? 22 : 12)}
                      textAnchor="middle"
                      fill="var(--chart-svg-x-label)"
                      fontSize={11}
                      fontFamily="system-ui, sans-serif"
                    >
                      {xl.text}
                    </text>
                    {xl.hora ? (
                      <text
                        x={xl.x}
                        y={chartModal.height - 8}
                        textAnchor="middle"
                        fill="var(--chart-caption)"
                        fontSize={9}
                        fontFamily="system-ui, sans-serif"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {xl.hora}
                      </text>
                    ) : null}
                  </g>
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
                Faixa: <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chartModal.min.toFixed(1)} %</strong> a{' '}
                <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chartModal.max.toFixed(1)} %</strong>
              </span>
              <span style={{ color: 'var(--chart-caption)' }}>{rows.length} lançamento(s)</span>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div
          style={{
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: '0.02em',
            background: 'var(--chart-comparativo-ocup-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Comparativo — ocupação %
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={!rows.length}
          style={{
            border: '1px solid var(--chart-modal-border-accent-cyan)',
            background: rows.length ? 'var(--chart-expand-bg)' : 'var(--chart-expand-disabled-bg)',
            color: '#38bdf8',
            borderRadius: 8,
            padding: '5px 11px',
            fontSize: 11,
            fontWeight: 700,
            cursor: rows.length ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Ampliar
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--chart-caption)', marginBottom: 14, lineHeight: 1.45 }}>
        Linha <strong style={{ color: 'var(--chart-legend-pill-text)' }}>geral</strong> inclui avaria no total ocupado. As outras três curvas são só as câmaras 11, 12 e 13 (percentual sobre a capacidade de cada uma).
      </div>
      {!rows.length || !chart ? (
        <div style={{ fontSize: 13, color: 'var(--text, #9ca3af)' }}>Sem dados ainda.</div>
      ) : (
        <>
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
              border: '1px solid var(--chart-tooltip-border-cyan)',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--chart-caption)', fontWeight: 600, marginRight: 4 }}>Legenda</span>
            {chart.seriesPaths.map((p) => (
              <span
                key={p.label}
                style={{
                  color: 'var(--chart-legend-pill-text)',
                  fontWeight: 600,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.45)' : `${p.color}55`}`,
                  background: `${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.12)' : `${p.color}14`}`,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: p.color,
                    boxShadow: `0 0 10px ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.5)' : p.color}`,
                  }}
                />
                {p.label}
              </span>
            ))}
            <span style={{ fontSize: 12, color: 'var(--chart-caption)', marginLeft: 'auto' }}>
              Passe o mouse para ver valores, conferente e avaria na data
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            {tip != null && rows[tip.idx] ? (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  ...chartTooltipOuterStyle(tip.pxPct),
                  zIndex: 2,
                  pointerEvents: 'none',
                  minWidth: 240,
                  maxWidth: 360,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--chart-tooltip-bg)',
                  border: '1px solid var(--chart-modal-border-accent-cyan)',
                  boxShadow: 'var(--chart-tooltip-shadow)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--chart-tooltip-title)', marginBottom: 4 }}>
                  {formatAxisDateChart(rows[tip.idx].data_registro)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--chart-caption)', marginBottom: 10 }}>
                  {rows[tip.idx].conferente_nome}
                  <span style={{ color: 'var(--chart-caption)' }}> · </span>
                  {formatHoraRegistro(rows[tip.idx].created_at)}
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                    <div style={{ color: OCUP_COLOR_GERAL }}>
                    Geral: <strong>{ocupPercGeral(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#22c55e' }}>
                    Câm. 11: <strong>{ocupPercCam11(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#38bdf8' }}>
                    Câm. 12: <strong>{ocupPercCam12(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div style={{ color: '#f59e0b' }}>
                    Câm. 13: <strong>{ocupPercCam13(rows[tip.idx]).toFixed(1)} %</strong>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      paddingTop: 8,
                      borderTop: '1px solid var(--chart-divider)',
                      color: '#fdba74',
                    }}
                  >
                    Avaria: <strong>{rows[tip.idx].avaria_acrescimo_ocupacao}</strong> pos. (
                    {ocupAvariaPercTotal(rows[tip.idx]).toFixed(1)}% do armazém)
                  </div>
                </div>
              </div>
            ) : null}
            <div
              style={{
                width: '100%',
                minHeight: 200,
                aspectRatio: `${width} / ${height}`,
              }}
            >
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', cursor: 'crosshair', minHeight: 200 }}
              onMouseEnter={onChartHoverCard}
              onMouseMove={onSvgMoveCard}
              onMouseLeave={onSvgLeave}
            >
              <defs>
                {chart.seriesPaths.map((p) => (
                  <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.16} />
                    <stop offset="55%" stopColor={p.color} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <rect x={0} y={0} width={width} height={height} rx={10} fill="var(--chart-plot-area)" />
              {chart.xLabels.map((xl, i) => (
                <line
                  key={`oxg-${i}`}
                  x1={xl.x}
                  y1={padT}
                  x2={xl.x}
                  y2={bottomY}
                  stroke="var(--chart-grid-vertical)"
                  strokeWidth={1}
                />
              ))}
              {chart.yTicks.map((t, i) => (
                <line
                  key={`oy-${i}`}
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
                  stroke="var(--chart-cursor-line-strong)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              ) : null}
              {chart.seriesPaths.map((p, si) => {
                const lineD = p.lineD
                const pts = rows.map((_, i) => ({
                  x: padL + (rows.length > 1 ? (innerW * i) / (rows.length - 1) : innerW / 2),
                }))
                const lastX = pts[pts.length - 1]?.x ?? padL
                const firstX = pts[0]?.x ?? padL
                const areaD = `${lineD} L ${lastX.toFixed(2)} ${bottomY.toFixed(2)} L ${firstX.toFixed(2)} ${bottomY.toFixed(2)} Z`
                return (
                  <AnimatedAreaPath
                    key={`${p.label}-c-${hoverReplayCard}`}
                    d={areaD}
                    fill={`url(#${p.gradId})`}
                    targetOpacity={0.5}
                    delaySec={0.05 + si * 0.05}
                  />
                )
              })}
              {chart.seriesPaths.map((p, si) => (
                <AnimatedStrokePath
                  key={`oline-${p.label}-${hoverReplayCard}`}
                  animKey={`${combOcpLineAnimKey}-c-${width}-${hoverReplayCard}`}
                  strokeDelaySec={0.04 * si}
                  d={p.lineD}
                  stroke={p.color}
                  strokeWidth={p.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 0 6px ${isOcupGeralStroke(p.color) ? 'rgba(34,211,238,.45)' : `${p.color}55`})` }}
                />
              ))}
              {(() => {
                const n = rows.length
                const idxs =
                  n <= 10
                    ? Array.from({ length: n }, (_, i) => i)
                    : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1]
                const uniqIdxs = [...new Set(idxs)].sort((a, b) => a - b)
                return COMBINED_OCP_SERIES.flatMap((s, si) =>
                  uniqIdxs.map((i) => {
                    const v = s.valueOf(rows[i])
                    const x = chart.xAt(i)
                    const y = chart.yAt(v)
                    const yShift = si === 0 ? -10 : si === 1 ? -18 : si === 2 ? -6 : -14
                    return (
                      <text
                        key={`ocp-val-${si}-${i}`}
                        x={x}
                        y={Math.max(padT + 11, y + yShift)}
                        textAnchor="middle"
                        fill={s.color}
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="system-ui, sans-serif"
                        style={{ filter: 'var(--chart-value-dropshadow)' }}
                      >
                        {v.toFixed(1)}%
                      </text>
                    )
                  }),
                )
              })()}
              {tip != null
                ? COMBINED_OCP_SERIES.map((s) => {
                    const v = s.valueOf(rows[tip.idx])
                    const cx = chart.xAt(tip.idx)
                    const cy = chart.yAt(v)
                    return (
                      <circle
                        key={`od-${s.label}`}
                        cx={cx}
                        cy={cy}
                        r={s.strokeWidth > 3 ? 5.5 : 5}
                        fill={s.color}
                        stroke="var(--chart-point-ring)"
                        strokeWidth={2}
                      />
                    )
                  })
                : null}
              {chart.yTicks.map((t, i) => (
                <text
                  key={`oyl-${i}`}
                  x={padL - 10}
                  y={t.y + 4}
                  textAnchor="end"
                  fill="var(--chart-svg-y-tick)"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {t.v.toFixed(1)}%
                </text>
              ))}
              <text x={padL} y={padT - 2} fill="var(--chart-caption)" fontSize={10} fontFamily="system-ui, sans-serif">
                % ocupada
              </text>
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
                  key={`oxl-${i}`}
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
              Faixa no gráfico: <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chart.min.toFixed(1)} %</strong> a{' '}
              <strong style={{ color: 'var(--chart-legend-pill-text)' }}>{chart.max.toFixed(1)} %</strong>
            </span>
            <span style={{ color: 'var(--chart-caption)' }}>
              {rows.length} lançamento(s) no histórico carregado
            </span>
          </div>
        </>
      )}
    </div>
  )
}

type OcupResumoSalvo = {
  r: OcupRow
  totalPos: number
  totalVaz: number
  /** Posições ocupadas nas câmaras (total − vazias), sem somar avaria. */
  totalOcupFisico: number
  percOcupFisico: number
  /** Inclui acréscimo de avaria; usado na tabela e nos gráficos “geral”. */
  totalOcup: number
  percOcup: number
  /** % vagas físicas vazias (soma câmaras) / totalPos — fecha 100% com ocupação física. */
  percLivre: number
  /** Complemento da ocupação c/ avaria: max(0, totalPos − totalOcup); % fecha 100% com percOcup no resumo. */
  totalSaldoLivre: number
  percSaldoLivre: number
}

type OcupResumoRascunho = {
  o11: number
  o12: number
  o13: number
  totalPos: number
  totalOcupFisico: number
  totalOcup: number
  totalVaz: number
  avariaAcrescimo: number
  percOcupFisico: number
  percOcup: number
  percLivre: number
}

const TEMA_OCP = {
  resumoGradient: 'var(--ocup-resumo-gradient)',
  resumoBorder: 'var(--ocup-resumo-border)',
  resumoShadow: 'var(--ocup-resumo-shadow)',
  tituloResumo: 'var(--ocup-titulo-resumo)',
  kpiOcupBorder: 'var(--ocup-kpi-ocup-border)',
  kpiOcupTitulo: 'var(--ocup-kpi-ocup-titulo)',
  kpiOcupValor: 'var(--ocup-kpi-ocup-valor)',
  camTitulo: 'var(--ocup-cam-titulo)',
  camBorda: 'var(--ocup-cam-borda)',
  barFill: 'var(--ocup-bar-fill)',
  ocupSpan: 'var(--ocup-ocup-span)',
  emptyBorder: 'var(--ocup-empty-border)',
  emptyStrong: 'var(--ocup-empty-strong)',
  formTitulo: 'var(--ocup-form-titulo)',
  btnBorder: 'var(--ocup-btn-border)',
  btnBg: 'var(--ocup-btn-bg)',
  btnColor: 'var(--ocup-btn-color)',
  tabelaLivre: 'var(--ocup-tabela-livre)',
  avariaDestaque: 'var(--ocup-avaria-destaque)',
} as const

function OcupacaoCamaras111213Secao({
  labels,
  resumoDia,
  resumoRascunho,
  rows,
  conferenteId,
  setConferenteId,
  dataYmd,
  setDataYmd,
  v11,
  setV11,
  v12,
  setV12,
  v13,
  setV13,
  vAvaria,
  setVAvaria,
  onSalvar,
  loading,
  conferentesLoading,
  conferentes,
}: {
  labels: { resumo: string; form: string; tabela: string; emptyHint: string }
  resumoDia: OcupResumoSalvo | null
  resumoRascunho: OcupResumoRascunho
  rows: OcupRow[]
  conferenteId: string
  setConferenteId: (v: string) => void
  dataYmd: string
  setDataYmd: (v: string) => void
  v11: string
  setV11: (v: string) => void
  v12: string
  setV12: (v: string) => void
  v13: string
  setV13: (v: string) => void
  vAvaria: string
  setVAvaria: (v: string) => void
  onSalvar: () => void
  loading: boolean
  conferentesLoading: boolean
  conferentes: Conferente[]
}) {
  const t = TEMA_OCP
  const inOcupNum: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 10px',
    borderRadius: 6,
    minHeight: 30,
    fontSize: 14,
    lineHeight: 1.25,
  }
  const [histPage, setHistPage] = useState(1)
  useEffect(() => {
    setHistPage(1)
  }, [rows])
  const rowsPagina = useMemo(
    () => rows.slice((histPage - 1) * HIST_PAGE_SIZE, histPage * HIST_PAGE_SIZE),
    [rows, histPage],
  )
  const mediasMes = useMemo(() => {
    if (!rows.length) return { ocup: 0, livre: 0 }
    const totalPos = OCUP_TOTAL_POSICOES
    const acc = rows.reduce(
      (s, r) => {
        const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
        const totalOcupFisico = totalPos - totalVaz
        const percOcupFisico = totalPos > 0 ? (totalOcupFisico / totalPos) * 100 : 0
        const percLivre = totalPos > 0 ? (totalVaz / totalPos) * 100 : 0
        return { ocup: s.ocup + percOcupFisico, livre: s.livre + percLivre }
      },
      { ocup: 0, livre: 0 },
    )
    return {
      ocup: acc.ocup / rows.length,
      livre: acc.livre / rows.length,
    }
  }, [rows])
  return (
    <>
      {resumoDia ? (
        <div
          style={{
            borderRadius: 12,
            padding: '8px 12px 10px',
            background: t.resumoGradient,
            border: t.resumoBorder,
            boxShadow: t.resumoShadow,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
              alignItems: 'start',
              gap: 8,
              marginBottom: 1,
            }}
          >
            <div style={{ justifySelf: 'start' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--chart-footer-muted)',
                  marginBottom: 2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Total de posições
              </div>
              <div
                style={{
                  fontSize: 'clamp(16px, 2.8vw, 20px)',
                  fontWeight: 800,
                  color: 'var(--ocup-resumo-numero)',
                  lineHeight: 1.05,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {resumoDia.totalPos}
              </div>
            </div>
            <div
              style={{
                fontSize: 'clamp(15px, 2.6vw, 19px)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: t.tituloResumo,
                textAlign: 'center',
                paddingTop: 2,
                lineHeight: 1.2,
              }}
            >
              {labels.resumo}
            </div>
            <div />
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--chart-footer-muted)', textAlign: 'center', marginBottom: 6, lineHeight: 1.35 }}>
            Último registro salvo (data · horário · conferente)
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 8,
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div style={{ paddingRight: 2 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--chart-footer-muted)',
                  marginBottom: 2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Data do lançamento
              </div>
              <div style={{ fontSize: 'clamp(17px, 3.2vw, 22px)', fontWeight: 800, color: 'var(--ocup-resumo-numero)', lineHeight: 1.05 }}>
                {formatDataBr(resumoDia.r.data_registro)}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 6,
                padding: '6px 8px',
                background: 'var(--ocup-resumo-meta-bg)',
                borderRadius: 8,
                border: '1px solid var(--ocup-resumo-meta-border)',
              }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ocup-resumo-label)', marginBottom: 2 }}>Horário do registro</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ocup-resumo-hora)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
                  {formatHoraRegistro(resumoDia.r.created_at)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ocup-resumo-label)', marginBottom: 2 }}>Conferente</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ocup-resumo-nome)', lineHeight: 1.15 }}>{resumoDia.r.conferente_nome}</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                background: 'var(--ocup-nested-strong)',
                borderRadius: 10,
                padding: '8px 12px',
                border: t.kpiOcupBorder,
                boxShadow: 'var(--ocup-kpi-card-shadow)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 13, color: t.kpiOcupTitulo, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, textAlign: 'center' }}>
                Ocupação
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid var(--ocup-kpi-inner-border)',
                  borderBottom: '1px solid var(--ocup-kpi-inner-border)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Posições ocupadas (c/ avaria)
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ocup-resumo-numero)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalOcup}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    % Ocupada (c/ avaria)
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: t.kpiOcupValor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.percOcup.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--chart-caption)',
                  textAlign: 'center',
                  marginTop: 8,
                  lineHeight: 1.4,
                }}
              >
                Ocupação <strong style={{ color: 'var(--chart-footer-muted)' }}>física</strong> (só vagas ocupadas, sem avaria):{' '}
                <strong style={{ color: 'var(--chart-insight-strong)', fontVariantNumeric: 'tabular-nums' }}>{resumoDia.totalOcupFisico}</strong> pos. ·{' '}
                <strong style={{ color: 'var(--chart-insight-strong)', fontVariantNumeric: 'tabular-nums' }}>{resumoDia.percOcupFisico.toFixed(1)}%</strong>
                {' — '}
                <span style={{ color: 'var(--chart-caption)' }}>
                  com a física (sem avaria), <strong style={{ color: 'var(--chart-footer-muted)' }}>% ocupada + % livre = 100%</strong> sobre as{' '}
                  <strong style={{ color: 'var(--chart-footer-muted)' }}>{resumoDia.totalPos}</strong> pos. O painel <strong style={{ color: '#6ee7b7' }}>Livres</strong>{' '}
                  ao lado usa o complemento da ocupação <strong style={{ color: 'var(--chart-footer-muted)' }}>com avaria</strong>.
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--chart-caption)', lineHeight: 1.35, marginTop: 6 }}>
                Detalhe do acréscimo por avaria no painel <strong style={{ color: '#fdba74' }}>Avaria</strong> abaixo.
              </div>
            </div>

            <div
              style={{
                background: 'var(--ocup-nested-strong)',
                borderRadius: 10,
                padding: '8px 12px',
                border: '1px solid rgba(52,211,153,.4)',
                boxShadow: 'var(--ocup-kpi-card-shadow)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 13, color: '#6ee7b7', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, textAlign: 'center' }}>
                Livres
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(52,211,153,.25)',
                  borderBottom: '1px solid rgba(52,211,153,.25)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Saldo livre (capacidade)
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#ecfdf5', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalSaldoLivre}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>% Livre</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#34d399', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.percSaldoLivre.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--chart-caption)', lineHeight: 1.35, marginTop: 6 }}>
                Complemento do painel <strong style={{ color: '#7dd3fc' }}>Ocupação (c/ avaria)</strong>:{' '}
                <strong style={{ color: 'var(--chart-footer-muted)' }}>% ocupada + % livre = 100%</strong> sobre as {resumoDia.totalPos} pos.{' '}
                <strong style={{ color: '#6ee7b7' }}>Vagas físicas vazias</strong> (soma câmaras 11+12+13):{' '}
                <strong style={{ color: 'var(--chart-insight-strong)', fontVariantNumeric: 'tabular-nums' }}>{resumoDia.totalVaz}</strong> pos. (
                {resumoDia.percLivre.toFixed(1)}% do armazém — fecha com ocupação <em>física</em>).
              </div>
            </div>

            <div
              style={{
                background: 'var(--ocup-nested-strong)',
                borderRadius: 10,
                padding: '8px 12px',
                border: '1px solid rgba(249,115,22,.45)',
                boxShadow: 'var(--ocup-kpi-card-shadow)',
                display: 'grid',
                gap: 0,
              }}
            >
              <div style={{ fontSize: 13, color: t.avariaDestaque, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, textAlign: 'center' }}>
                Avaria (acréscimo na ocupação)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(249,115,22,.28)',
                  borderBottom: '1px solid rgba(249,115,22,.28)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quantidade</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.avariaDestaque, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.r.avaria_acrescimo_ocupacao}
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fdba74', marginLeft: 4 }}>pos.</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>% sobre o armazém</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fb923c', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {resumoDia.totalPos > 0
                      ? ((resumoDia.r.avaria_acrescimo_ocupacao / resumoDia.totalPos) * 100).toFixed(1)
                      : '0.0'}
                    %
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--chart-caption)', lineHeight: 1.35, marginTop: 6 }}>
                Valor somado ao total de ocupadas no mesmo lançamento. Percentual calculado sobre as {resumoDia.totalPos} posições totais.
              </div>
            </div>

            <div
              style={{
                background: 'var(--ocup-nested-weak)',
                borderRadius: 10,
                padding: '8px 12px',
                border: '1px solid rgba(250,204,21,.35)',
                boxShadow: 'var(--ocup-kpi-card-shadow-sm)',
              }}
            >
              <div style={{ fontSize: 13, color: '#fde047', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, textAlign: 'center' }}>
                Médias do mês (histórico carregado)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(250,204,21,.3)',
                  borderBottom: '1px solid rgba(250,204,21,.3)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Média Ocupação Mês</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#fde047', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {mediasMes.ocup.toFixed(0)}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Média Livre Mês</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#fef08a', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {mediasMes.livre.toFixed(0)}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--chart-caption)', lineHeight: 1.35, marginTop: 6 }}>
                Cálculo sobre os lançamentos de ocupação carregados no histórico atual.
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--chart-footer-muted)', marginBottom: 6, letterSpacing: '0.03em' }}>
            Detalhe por câmara (último registro)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {(
              [
                { id: 11, v: resumoDia.r.camara11_vazias, cap: OCUP_TOTAL.camara11 },
                { id: 12, v: resumoDia.r.camara12_vazias, cap: OCUP_TOTAL.camara12 },
                { id: 13, v: resumoDia.r.camara13_vazias, cap: OCUP_TOTAL.camara13 },
              ] as const
            ).map((c) => {
              const oc = c.cap - c.v
              const pct = c.cap > 0 ? (oc / c.cap) * 100 : 0
              return (
                <div
                  key={c.id}
                  style={{
                    background: 'var(--ocup-nested-weak)',
                    borderRadius: 10,
                    padding: '8px 10px',
                    border: t.camBorda,
                  }}
                >
                  <div style={{ fontWeight: 800, color: t.camTitulo, marginBottom: 2, fontSize: 14 }}>Câmara {c.id}</div>
                  <div
                    style={{
                      marginBottom: 6,
                      padding: '6px 9px',
                      borderRadius: 8,
                      background: 'var(--ocup-cam-cap-bg)',
                      border: '1px solid var(--ocup-cam-cap-border)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: 'var(--ocup-cam-cap-numero)',
                        fontVariantNumeric: 'tabular-nums',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {c.cap}
                    </span>
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#bae6fd',
                        letterSpacing: '0.02em',
                      }}
                    >
                      posições no total
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span>
                      <span style={{ color: '#6ee7b7', fontWeight: 700 }}>Vazias</span> <strong style={{ color: '#ecfdf5' }}>{c.v}</strong>
                    </span>
                    <span>
                      <span style={{ color: t.ocupSpan, fontWeight: 700 }}>Ocupadas</span> <strong style={{ color: '#f0f9ff' }}>{oc}</strong>
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, pct))}%`,
                        borderRadius: 999,
                        background: t.barFill,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--chart-footer-muted)', marginTop: 4, textAlign: 'right' }}>{pct.toFixed(0)}% ocupada nesta câmara</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            borderRadius: 14,
            padding: '18px 20px',
            background: 'var(--ocup-empty-panel-bg)',
            border: t.emptyBorder,
            color: 'var(--chart-footer-muted)',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          <strong style={{ color: t.emptyStrong }}>{labels.resumo}:</strong> {labels.emptyHint}
        </div>
      )}

      <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: t.formTitulo }}>{labels.form}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Conferente</span>
            <select value={conferenteId} onChange={(e) => setConferenteId(e.target.value)} disabled={conferentesLoading}>
              <option value="">{conferentesLoading ? 'Carregando...' : 'Selecione...'}</option>
              {conferentes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span>Data</span>
            <input type="date" value={dataYmd} onChange={(e) => setDataYmd(e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--chart-footer-muted)',
              marginBottom: 6,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Vagas vazias e avaria
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '8px 10px',
              width: '100%',
              alignItems: 'end',
            }}
          >
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: 'var(--chart-footer-muted)' }}>Câm. 11 — vazias</span>
              <input value={v11} onChange={(e) => setV11(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: 'var(--chart-footer-muted)' }}>Câm. 12 — vazias</span>
              <input value={v12} onChange={(e) => setV12(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: 'var(--chart-footer-muted)' }}>Câm. 13 — vazias</span>
              <input value={v13} onChange={(e) => setV13(e.target.value)} type="number" min="0" style={inOcupNum} />
            </label>
            <label style={{ display: 'grid', gap: 4, minWidth: 0, alignContent: 'start' }}>
              <span style={{ fontSize: 12, lineHeight: 1.25, color: t.avariaDestaque }}>Avaria — acréscimo</span>
              <input
                value={vAvaria}
                onChange={(e) => setVAvaria(e.target.value)}
                type="number"
                min="0"
                placeholder="0"
                style={inOcupNum}
              />
            </label>
          </div>
          <p
            style={{
              fontSize: 10,
              color: 'var(--chart-caption)',
              margin: '8px 0 0',
              lineHeight: 1.4,
            }}
          >
            O valor de <strong style={{ color: t.avariaDestaque }}>Avaria</strong> soma-se ao total de ocupadas no mesmo
            lançamento (câmaras 11, 12 e 13).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onSalvar()}
          disabled={loading}
          style={{
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 8,
            border: t.btnBorder,
            background: t.btnBg,
            color: t.btnColor,
            fontWeight: 700,
          }}
        >
          {loading ? 'Salvando...' : 'Salvar ocupação'}
        </button>

        <div style={{ marginTop: 12, border: '1px solid var(--border, #2e303a)', borderRadius: 10, padding: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumo automático (rascunho)</div>
          <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            <div>
              Câmara 11: {resumoRascunho.o11} ocupadas / {asInt(v11)} vazias (total {OCUP_TOTAL.camara11})
            </div>
            <div>
              Câmara 12: {resumoRascunho.o12} ocupadas / {asInt(v12)} vazias (total {OCUP_TOTAL.camara12})
            </div>
            <div>
              Câmara 13: {resumoRascunho.o13} ocupadas / {asInt(v13)} vazias (total {OCUP_TOTAL.camara13})
            </div>
            <div style={{ color: t.avariaDestaque }}>
              Avaria (acréscimo): {resumoRascunho.avariaAcrescimo} posição(ões)
            </div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              Ocupadas físico: {resumoRascunho.totalOcupFisico} · Com avaria: {resumoRascunho.totalOcup} · Livres:{' '}
              {resumoRascunho.totalVaz} | % Ocup. {resumoRascunho.percOcupFisico.toFixed(0)}% + % Livre{' '}
              {resumoRascunho.percLivre.toFixed(0)}% = 100% · Com avaria ({resumoRascunho.percOcup.toFixed(0)}% da base)
            </div>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{labels.tabela}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              <th style={th}>Data / horário</th>
              <th style={th}>Conferente</th>
              <th style={th}>Cam 11 (vazias)</th>
              <th style={th}>Cam 12 (vazias)</th>
              <th style={th}>Cam 13 (vazias)</th>
              <th style={{ ...th, color: t.avariaDestaque }}>Avaria (+ ocup.)</th>
              <th style={th}>Livre</th>
              <th style={th}>Total ocupadas</th>
              <th style={th}>% Ocup. (c/ avaria)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...td, color: 'var(--text, #9ca3af)' }}>
                  Nenhum lançamento ainda.
                </td>
              </tr>
            ) : (
              rowsPagina.map((r) => {
                const totalPos = OCUP_TOTAL_POSICOES
                const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
                const av = r.avaria_acrescimo_ocupacao
                const totalOcup = totalPos - totalVaz + av
                const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
                return (
                  <tr key={r.id}>
                    <td style={td}>{celulaDataComHoraRegistro(r.data_registro, r.created_at)}</td>
                    <td style={td}>{r.conferente_nome}</td>
                    <td style={td}>{r.camara11_vazias}</td>
                    <td style={td}>{r.camara12_vazias}</td>
                    <td style={td}>{r.camara13_vazias}</td>
                    <td style={{ ...td, color: t.avariaDestaque, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {av}
                    </td>
                    <td style={{ ...td, color: t.tabelaLivre, fontWeight: 600 }}>{totalVaz}</td>
                    <td style={td}>{totalOcup}</td>
                    <td style={td}>{percOcup.toFixed(0)}%</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <HistoricoPaginacaoBar
          page={histPage}
          totalItems={rows.length}
          pageSize={HIST_PAGE_SIZE}
          onPageChange={setHistPage}
          accent={t.formTitulo}
        />
      </div>
    </>
  )
}

export default function ContagemDiariaAmbiental({
  initialTab = 'temperatura',
  lockTab = false,
}: {
  /** Aba inicial (temperatura ou ocupação). */
  initialTab?: TabKey
  /** Oculta o seletor de abas — usado quando cada módulo tem item próprio no menu. */
  lockTab?: boolean
} = {}) {
  const [tempHistPage, setTempHistPage] = useState(1)
  const [tab, setTab] = useState<TabKey>(initialTab)
  useEffect(() => {
    if (lockTab) setTab(initialTab)
  }, [initialTab, lockTab])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [conferentesLoading, setConferentesLoading] = useState(true)
  const [tempConferenteId, setTempConferenteId] = useState('')
  const [tempData, setTempData] = useState(todayYmd())
  const [cam11, setCam11] = useState('')
  const [cam12, setCam12] = useState('')
  const [cam13, setCam13] = useState('')
  const [tempRows, setTempRows] = useState<TempRow[]>([])

  const [ocupConferenteId, setOcupConferenteId] = useState('')
  const [ocupData, setOcupData] = useState(todayYmd())
  const [vazias11, setVazias11] = useState('')
  const [vazias12, setVazias12] = useState('')
  const [vazias13, setVazias13] = useState('')
  const [ocupAvariaAcrescimo, setOcupAvariaAcrescimo] = useState('')
  const [ocupRows, setOcupRows] = useState<OcupRow[]>([])

  async function loadTempRows() {
    const { data, error: qErr } = await supabase
      .from('contagem_temperatura_camaras')
      .select('id,data_registro,conferente_nome,camara11_temp,camara12_temp,camara13_temp,created_at')
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
    if (qErr) throw qErr
    setTempRows((data || []).reverse().map((r) => ({ ...r, camara11_temp: asNum(r.camara11_temp), camara12_temp: asNum(r.camara12_temp), camara13_temp: asNum(r.camara13_temp) })))
  }

  async function loadConferentes() {
    const { data, error: qErr } = await supabase.from('conferentes').select('id,nome').order('nome')
    if (qErr) throw qErr
    setConferentes(data ?? [])
  }

  async function loadOcupRows() {
    const { data, error: qErr } = await supabase
      .from('contagem_ocupacao_camaras')
      .select(
        'id,data_registro,conferente_nome,camara11_vazias,camara12_vazias,camara13_vazias,avaria_acrescimo_ocupacao,created_at',
      )
      .order('data_registro', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000)
    if (qErr) throw qErr
    setOcupRows(
      (data || []).map((r) => ({
        ...r,
        camara11_vazias: asNum((r as { camara11_vazias?: unknown }).camara11_vazias),
        camara12_vazias: asNum((r as { camara12_vazias?: unknown }).camara12_vazias),
        camara13_vazias: asNum((r as { camara13_vazias?: unknown }).camara13_vazias),
        avaria_acrescimo_ocupacao: asNum(
          (r as { avaria_acrescimo_ocupacao?: unknown }).avaria_acrescimo_ocupacao,
        ),
      })),
    )
  }

  useEffect(() => {
    void (async () => {
      setError(null)
      try {
        setConferentesLoading(true)
        await Promise.all([loadTempRows(), loadOcupRows(), loadConferentes()])
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.message}. Confira: create_contagem_diaria_temperatura_ocupacao.sql, alter_contagem_ocupacao_camaras_rename_vazias_678_para_111213.sql e alter_contagem_ocupacao_camaras_add_avaria_acrescimo.sql.`
            : 'Erro ao carregar dados.',
        )
      } finally {
        setConferentesLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    setTempHistPage(1)
  }, [tempRows])

  async function salvarTemperatura() {
    setError(null)
    setOk(null)
    const nomeConf = conferentes.find((c) => c.id === tempConferenteId)?.nome?.trim() ?? ''
    if (!nomeConf) {
      setError('Selecione o conferente.')
      return
    }
    if (!tempData) {
      setError('Selecione a data.')
      return
    }
    if (cam11.trim() === '' || cam12.trim() === '' || cam13.trim() === '') {
      setError('Preencha as três temperaturas (Câmaras 11, 12 e 13).')
      return
    }
    setLoading(true)
    try {
      const payload = {
        data_registro: tempData,
        conferente_nome: nomeConf,
        camara11_temp: asNum(cam11),
        camara12_temp: asNum(cam12),
        camara13_temp: asNum(cam13),
      }
      const { error: insErr } = await supabase.from('contagem_temperatura_camaras').insert(payload)
      if (insErr) throw insErr
      setCam11('')
      setCam12('')
      setCam13('')
      await loadTempRows()
      setOk('Temperatura salva com sucesso.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar temperatura.')
    } finally {
      setLoading(false)
    }
  }

  async function salvarOcupacao() {
    setError(null)
    setOk(null)
    const nomeConfOcup = conferentes.find((c) => c.id === ocupConferenteId)?.nome?.trim() ?? ''
    if (!nomeConfOcup) {
      setError('Selecione o conferente.')
      return
    }
    if (!ocupData) {
      setError('Selecione a data.')
      return
    }
    if (vazias11.trim() === '' || vazias12.trim() === '' || vazias13.trim() === '') {
      setError('Preencha as posições vazias das câmaras 11, 12 e 13.')
      return
    }
    const n11 = asInt(vazias11)
    const n12 = asInt(vazias12)
    const n13 = asInt(vazias13)
    const avAc = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
    if (n11 > OCUP_TOTAL.camara11 || n12 > OCUP_TOTAL.camara12 || n13 > OCUP_TOTAL.camara13) {
      setError('Uma ou mais câmaras têm vagas maiores que o total de posições.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        data_registro: ocupData,
        conferente_nome: nomeConfOcup,
        camara11_vazias: n11,
        camara12_vazias: n12,
        camara13_vazias: n13,
        avaria_acrescimo_ocupacao: avAc,
      }
      const { error: insErr } = await supabase.from('contagem_ocupacao_camaras').insert(payload)
      if (insErr) throw insErr
      await loadOcupRows()
      setOk('Ocupação salva com sucesso.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar ocupação.')
    } finally {
      setLoading(false)
    }
  }

  /** Mais recentes primeiro — para histórico em tabela. */
  const tempHistoricoDesc = useMemo(() => [...tempRows].reverse(), [tempRows])
  const tempHistoricoPagina = useMemo(
    () =>
      tempHistoricoDesc.slice((tempHistPage - 1) * HIST_PAGE_SIZE, tempHistPage * HIST_PAGE_SIZE),
    [tempHistoricoDesc, tempHistPage],
  )

  /** Metadados exibidos ao lado do título dos gráficos (último registro salvo na data do formulário). */
  const tempGraficosMeta = useMemo(() => {
    const day = tempData
    const rowsDoDia = tempRows.filter((r) => String(r.data_registro).slice(0, 10) === day)
    const nomeForm = conferentes.find((c) => c.id === tempConferenteId)?.nome?.trim() ?? ''
    if (rowsDoDia.length) {
      const r = rowsDoDia.reduce((best, cur) =>
        new Date(cur.created_at).getTime() > new Date(best.created_at).getTime() ? cur : best,
      )
      return {
        data: formatDataBr(r.data_registro),
        hora: formatHoraRegistro(r.created_at),
        conferente: r.conferente_nome?.trim() || nomeForm || '—',
      }
    }
    return {
      data: day ? formatDataBr(day) : '—',
      hora: '—',
      conferente: nomeForm || '—',
    }
  }, [tempRows, tempData, tempConferenteId, conferentes])

  const ocupResumoAtual = useMemo(() => {
    const v11 = asInt(vazias11)
    const v12 = asInt(vazias12)
    const v13 = asInt(vazias13)
    const o11 = Math.max(0, OCUP_TOTAL.camara11 - v11)
    const o12 = Math.max(0, OCUP_TOTAL.camara12 - v12)
    const o13 = Math.max(0, OCUP_TOTAL.camara13 - v13)
    const totalPos = OCUP_TOTAL_POSICOES
    const avariaAcrescimo = ocupAvariaAcrescimo.trim() === '' ? 0 : asInt(ocupAvariaAcrescimo)
    const totalOcupFisico = o11 + o12 + o13
    const totalOcup = totalOcupFisico + avariaAcrescimo
    const totalVaz = v11 + v12 + v13
    return {
      o11,
      o12,
      o13,
      totalPos,
      totalOcupFisico,
      totalOcup,
      totalVaz,
      avariaAcrescimo,
      percOcupFisico: totalPos > 0 ? (totalOcupFisico / totalPos) * 100 : 0,
      percOcup: totalPos > 0 ? (totalOcup / totalPos) * 100 : 0,
      percLivre: totalPos > 0 ? (totalVaz / totalPos) * 100 : 0,
    }
  }, [vazias11, vazias12, vazias13, ocupAvariaAcrescimo])

  /** Último lançamento salvo na data selecionada no formulário (`ocupData`). */
  const ocupResumoDiaSalvo = useMemo(() => {
    const day = ocupData
    const rowsDoDia = ocupRows.filter((r) => String(r.data_registro).slice(0, 10) === day)
    if (!rowsDoDia.length) return null
    const r = rowsDoDia.reduce((best, cur) =>
      new Date(cur.created_at).getTime() > new Date(best.created_at).getTime() ? cur : best,
    )
    const totalPos = OCUP_TOTAL_POSICOES
    const totalVaz = r.camara11_vazias + r.camara12_vazias + r.camara13_vazias
    const av = r.avaria_acrescimo_ocupacao
    const totalOcupFisico = totalPos - totalVaz
    const totalOcup = totalOcupFisico + av
    const percOcupFisico = totalPos > 0 ? (totalOcupFisico / totalPos) * 100 : 0
    const percOcup = totalPos > 0 ? (totalOcup / totalPos) * 100 : 0
    const percLivre = totalPos > 0 ? (totalVaz / totalPos) * 100 : 0
    const totalSaldoLivre = Math.max(0, totalPos - totalOcup)
    const percSaldoLivre = totalPos > 0 ? (totalSaldoLivre / totalPos) * 100 : 0
    return {
      r,
      totalPos,
      totalVaz,
      totalOcupFisico,
      percOcupFisico,
      totalOcup,
      percOcup,
      percLivre,
      totalSaldoLivre,
      percSaldoLivre,
    }
  }, [ocupRows, ocupData])

  /** Um ponto por dia civil nos gráficos — último `created_at` daquele dia (todos os gráficos alinhados). */
  const ocupRowsChronoCharts = useMemo(() => ocupRowsForCharts(ocupRows), [ocupRows])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CHART_ANIM_CSS }} />
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '0 16px 22px', width: '100%', boxSizing: 'border-box' }}>
      {!lockTab ? (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setTab('temperatura')}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${tab === 'temperatura' ? '#22c55e' : 'var(--border, #2e303a)'}`,
            background: tab === 'temperatura' ? '#22c55e' : 'transparent',
            color: tab === 'temperatura' ? '#06250f' : '#22c55e',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Temperatura
        </button>
        <button
          type="button"
          onClick={() => setTab('ocupacao')}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${tab === 'ocupacao' ? '#38bdf8' : 'var(--border, #2e303a)'}`,
            background: tab === 'ocupacao' ? '#38bdf8' : 'transparent',
            color: tab === 'ocupacao' ? '#082131' : '#38bdf8',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Ocupação
        </button>
      </div>
      ) : null}

      {ok ? (
        <div style={{ marginBottom: 10, border: '1px solid #15803d', background: 'rgba(21,128,61,.2)', color: '#bbf7d0', borderRadius: 8, padding: '8px 10px' }}>
          {ok}
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 10, border: '1px solid #b91c1c', background: 'rgba(127,29,29,.35)', color: '#fecaca', borderRadius: 8, padding: '8px 10px' }}>
          {error}
        </div>
      ) : null}

      {tab === 'temperatura' ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#22c55e' }}>Lançar temperatura diária</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Conferente</span>
                <select
                  value={tempConferenteId}
                  onChange={(e) => setTempConferenteId(e.target.value)}
                  disabled={conferentesLoading}
                >
                  <option value="">{conferentesLoading ? 'Carregando...' : 'Selecione...'}</option>
                  {conferentes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Data</span>
                <input type="date" value={tempData} onChange={(e) => setTempData(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 11 (°C)</span>
                <input value={cam11} onChange={(e) => setCam11(e.target.value)} type="number" step="0.1" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 12 (°C)</span>
                <input value={cam12} onChange={(e) => setCam12(e.target.value)} type="number" step="0.1" />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                <span>Câmara 13 (°C)</span>
                <input value={cam13} onChange={(e) => setCam13(e.target.value)} type="number" step="0.1" />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void salvarTemperatura()}
              disabled={loading}
              style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: '1px solid #16a34a', background: '#22c55e', color: '#052e16', fontWeight: 700 }}
            >
              {loading ? 'Salvando...' : 'Salvar temperatura'}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 14,
              border: '1px solid rgba(34, 197, 94, .32)',
              background: 'linear-gradient(135deg, rgba(34,197,94,.16), rgba(15,23,42,.2))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 220px' }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: '#22c55e',
                  boxShadow: '0 0 18px rgba(34,197,94,.9)',
                  flex: '0 0 auto',
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, color: '#f8fafc', fontSize: 19, letterSpacing: '.01em' }}>
                  Gráficos de temperatura por câmara
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                  Acompanhe a variação diária das Câmaras 11, 12 e 13.
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'stretch',
                flex: '0 1 auto',
                padding: '6px 10px',
                borderRadius: 10,
                border: '1px solid rgba(34, 197, 94, .22)',
                background: 'rgba(15, 23, 42, .35)',
              }}
            >
              <div style={{ minWidth: 88 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#86efac',
                    marginBottom: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Data da contagem
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                  {tempGraficosMeta.data}
                </div>
              </div>
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'rgba(34, 197, 94, .25)',
                  margin: '2px 0',
                }}
                aria-hidden
              />
              <div style={{ minWidth: 100 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#86efac',
                    marginBottom: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Horário do registro
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#a5f3fc',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {tempGraficosMeta.hora}
                </div>
              </div>
              <div
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'rgba(34, 197, 94, .25)',
                  margin: '2px 0',
                }}
                aria-hidden
              />
              <div style={{ minWidth: 120, maxWidth: 220 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#86efac',
                    marginBottom: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Conferente
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: '#e2e8f0',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={tempGraficosMeta.conferente}
                >
                  {tempGraficosMeta.conferente}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <TinyLineChart title="Câmara 11" color="#22c55e" rows={tempRows} valueOf={(r) => r.camara11_temp} showPointValues />
            <TinyLineChart title="Câmara 12" color="#38bdf8" rows={tempRows} valueOf={(r) => r.camara12_temp} showPointValues />
            <TinyLineChart title="Câmara 13" color="#f59e0b" rows={tempRows} valueOf={(r) => r.camara13_temp} showPointValues />
          </div>
          <CombinedTempChart rows={tempRows} />

          <div style={{ border: '1px solid var(--border, #2e303a)', borderRadius: 12, padding: 12, overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#22c55e' }}>Histórico de registros (temperatura)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Conferente</th>
                  <th style={th}>Data / horário</th>
                  <th style={{ ...th, color: '#22c55e' }}>Câm. 11 (°C)</th>
                  <th style={{ ...th, color: '#38bdf8' }}>Câm. 12 (°C)</th>
                  <th style={{ ...th, color: '#f59e0b' }}>Câm. 13 (°C)</th>
                </tr>
              </thead>
              <tbody>
                {tempHistoricoDesc.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ ...td, color: 'var(--text, #9ca3af)' }}>
                      Nenhum registro ainda.
                    </td>
                  </tr>
                ) : (
                  tempHistoricoPagina.map((r) => (
                    <tr key={r.id}>
                      <td style={td}>{r.conferente_nome}</td>
                      <td style={td}>{celulaDataComHoraRegistro(r.data_registro, r.created_at)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara11_temp.toFixed(1)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara12_temp.toFixed(1)}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.camara13_temp.toFixed(1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <HistoricoPaginacaoBar
              page={tempHistPage}
              totalItems={tempHistoricoDesc.length}
              pageSize={HIST_PAGE_SIZE}
              onPageChange={setTempHistPage}
              accent="#22c55e"
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--chart-footer-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Ocupação (câmaras 11, 12 e 13)
          </div>

          <OcupacaoCamaras111213Secao
            labels={{
              resumo: 'Resumo do dia',
              form: 'Lançar ocupação (vagas vazias nas câmaras 11, 12 e 13 + avaria, se houver)',
              tabela: 'Últimos lançamentos de ocupação',
              emptyHint: ocupData
                ? `Ainda não há lançamento salvo para ${formatDataBr(ocupData)}. Preencha o formulário abaixo e salve.`
                : 'Ainda não há lançamentos salvos. Preencha o formulário abaixo e salve para ver o resumo aqui.',
            }}
            resumoDia={ocupResumoDiaSalvo}
            resumoRascunho={ocupResumoAtual}
            rows={ocupRows}
            conferenteId={ocupConferenteId}
            setConferenteId={setOcupConferenteId}
            dataYmd={ocupData}
            setDataYmd={setOcupData}
            v11={vazias11}
            setV11={setVazias11}
            v12={vazias12}
            setV12={setVazias12}
            v13={vazias13}
            setV13={setVazias13}
            vAvaria={ocupAvariaAcrescimo}
            setVAvaria={setOcupAvariaAcrescimo}
            onSalvar={salvarOcupacao}
            loading={loading}
            conferentesLoading={conferentesLoading}
            conferentes={conferentes}
          />

          <div
            style={{
              borderRadius: 16,
              padding: '18px 18px 22px',
              background: 'var(--ambient-ocup-historico-bg)',
              border: 'var(--ambient-ocup-historico-border)',
              boxShadow: 'var(--ambient-ocup-historico-shadow)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--ambient-ocup-historico-kicker)',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Histórico visual
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ambient-ocup-historico-title)', marginBottom: 8, letterSpacing: '-0.02em' }}>
              Evolução da ocupação nos lançamentos
            </div>
            <p style={{ fontSize: 12, color: 'var(--ambient-ocup-historico-p)', lineHeight: 1.55, margin: '0 0 18px', maxWidth: 920 }}>
              O gráfico agrupado mostra a curva <strong style={{ color: 'var(--ambient-ocup-historico-strong)' }}>geral</strong> (com avaria) e as
              três câmaras lado a lado — passe o mouse para ver conferente, horário e avaria naquele ponto. Abaixo, cada
              série em detalhe, com eixo temporal mais denso e a variação entre o primeiro e o último registro exibido.
            </p>

            <CombinedOcupacaoChart rows={ocupRowsChronoCharts} />

            <div style={{ marginTop: 18 }}>
              <TinyLineChart
                title="% Ocupada geral (11+12+13, inclui avaria)"
                color={OCUP_COLOR_GERAL}
                rows={ocupRowsChronoCharts}
                valueOf={ocupPercGeral}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showPointValues
                compactSm
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
                gap: 12,
                marginTop: 12,
              }}
            >
              <TinyLineChart
                title="% Ocupada — Câmara 11"
                color="#22c55e"
                rows={ocupRowsChronoCharts}
                valueOf={ocupPercCam11}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showPointValues
                compact
              />
              <TinyLineChart
                title="% Ocupada — Câmara 12"
                color="#38bdf8"
                rows={ocupRowsChronoCharts}
                valueOf={ocupPercCam12}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showPointValues
                compact
              />
              <TinyLineChart
                title="% Ocupada — Câmara 13"
                color="#f59e0b"
                rows={ocupRowsChronoCharts}
                valueOf={ocupPercCam13}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showPointValues
                compact
              />
              <TinyLineChart
                title="Avaria — quantidade (posições)"
                color="#fb923c"
                rows={ocupRowsChronoCharts}
                valueOf={(r) => r.avaria_acrescimo_ocupacao}
                valueSuffix=" pos."
                decimals={0}
                axisCaption="pos."
                denseTimeline
                showPointValues
                compact
              />
              <TinyLineChart
                title="Avaria — % do total de posições"
                color="#fdba74"
                rows={ocupRowsChronoCharts}
                valueOf={ocupAvariaPercTotal}
                valueSuffix="%"
                decimals={1}
                axisCaption="%"
                denseTimeline
                showPointValues
                compact
              />
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}