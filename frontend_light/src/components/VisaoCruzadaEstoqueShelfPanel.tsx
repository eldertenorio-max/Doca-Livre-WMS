import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import * as XLSX from 'xlsx'
import {
  parseControleShelfLifeCsv,
  type ShelfLifeRow,
  type ShelfLifeStatus,
} from './ControleShelfLifePanel'
import ShelfLifeRegrasLegenda from './ShelfLifeRegrasLegenda'
import {
  PRIORIDADE_LABEL,
  contagemMatrizCruzada,
  isUrgenteCruzada,
  mergeEstoqueShelfCruzada,
  type LinhaCruzada,
  type MatrizCruzadaKey,
  type NivelEstoque,
  type NivelShelf,
  type PrioridadeCruzada,
  type RowEstoqueCruzada,
} from '../lib/estoqueShelfCruzada'
import { fetchGoogleSheetCsv } from '../lib/googleSheetsCsv'

const SHELF_SHEET_ID = '1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk'
const SHELF_SHEET_NAME = 'CONTROLE SHELF LIFE'
const PAGE_SIZE = 15

type FiltroPrioridade = 'todos' | 'urgentes' | PrioridadeCruzada
type FiltroMatriz = { estoque: NivelEstoque; shelf: Exclude<NivelShelf, 'sem'> } | null

const PRIORIDADE_CARDS: PrioridadeCruzada[] = [
  'critico',
  'desperdicio',
  'produzir',
  'validade',
  'avaliar',
  'excedente_ok',
]

const PRIORIDADE_CORES: Record<PrioridadeCruzada, { bg: string; fg: string; border: string }> = {
  critico: { bg: 'rgba(127,29,29,.45)', fg: '#fecaca', border: '#dc2626' },
  desperdicio: { bg: 'rgba(88,28,135,.35)', fg: '#e9d5ff', border: '#a855f7' },
  produzir: { bg: 'rgba(127,29,29,.25)', fg: '#fca5a5', border: '#b91c1c' },
  validade: { bg: 'rgba(124,45,18,.35)', fg: '#fdba74', border: '#f97316' },
  excedente_ok: { bg: 'rgba(76,29,149,.25)', fg: '#ddd6fe', border: '#7c3aed' },
  avaliar: { bg: 'rgba(113,63,18,.35)', fg: '#fde047', border: '#ca8a04' },
  ok: { bg: 'rgba(20,83,45,.25)', fg: '#bbf7d0', border: '#16a34a' },
  sem_shelf: { bg: 'rgba(51,65,85,.4)', fg: '#cbd5e1', border: '#64748b' },
  sem_estoque: { bg: 'rgba(30,58,138,.3)', fg: '#bfdbfe', border: '#3b82f6' },
}

const MATRIZ_ESTOQUE: { key: NivelEstoque; label: string }[] = [
  { key: 'pouco', label: 'Estoque baixo' },
  { key: 'ok', label: 'Estoque bom' },
  { key: 'muito', label: 'Estoque alto' },
]

const MATRIZ_ESTOQUE_CORES: Record<NivelEstoque, { fg: string; border: string }> = {
  pouco: { fg: '#fca5a5', border: '#dc2626' },
  ok: { fg: '#86efac', border: '#16a34a' },
  muito: { fg: '#fde047', border: '#ca8a04' },
}

const MATRIZ_SHELF: { key: Exclude<NivelShelf, 'sem'>; label: string }[] = [
  { key: 'boa', label: 'Longe do vencimento' },
  { key: 'atencao', label: 'Vencendo em breve' },
  { key: 'ruim', label: 'Vencimento crítico' },
]

const MATRIZ_SHELF_CORES: Record<
  Exclude<NivelShelf, 'sem'>,
  { bg: string; bgEmpty: string; border: string; borderActive: string; fg: string; fgEmpty: string; headerFg: string }
> = {
  boa: {
    bg: 'rgba(34, 197, 94, 0.28)',
    bgEmpty: 'rgba(34, 197, 94, 0.08)',
    border: '#16a34a',
    borderActive: '#4ade80',
    fg: '#dcfce7',
    fgEmpty: '#4ade80',
    headerFg: '#86efac',
  },
  atencao: {
    bg: 'rgba(234, 179, 8, 0.28)',
    bgEmpty: 'rgba(234, 179, 8, 0.08)',
    border: '#ca8a04',
    borderActive: '#facc15',
    fg: '#fef9c3',
    fgEmpty: '#eab308',
    headerFg: '#fde047',
  },
  ruim: {
    bg: 'rgba(239, 68, 68, 0.28)',
    bgEmpty: 'rgba(239, 68, 68, 0.08)',
    border: '#dc2626',
    borderActive: '#f87171',
    fg: '#fee2e2',
    fgEmpty: '#f87171',
    headerFg: '#fca5a5',
  },
}

function todayYmdLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function condColors(c: string): { bg: string; fg: string } {
  const n = normalize(c)
  if (n.includes('exced')) return { bg: '#4c1d95', fg: '#ddd6fe' }
  if (n.includes('vermelh')) return { bg: '#7f1d1d', fg: '#fecaca' }
  if (n.includes('amarel')) return { bg: '#713f12', fg: '#fde047' }
  if (n.includes('verde')) return { bg: '#14532d', fg: '#bbf7d0' }
  return { bg: '#334155', fg: '#e2e8f0' }
}

function shelfColors(st: ShelfLifeStatus | null): { bg: string; fg: string } {
  switch (st) {
    case 'Verde':
      return { bg: '#14532d', fg: '#bbf7d0' }
    case 'Amarelo':
      return { bg: '#713f12', fg: '#fde047' }
    case 'Laranja':
      return { bg: '#7c2d12', fg: '#fdba74' }
    case 'Vermelho':
      return { bg: '#7f1d1d', fg: '#fecaca' }
    default:
      return { bg: '#334155', fg: '#94a3b8' }
  }
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

const td: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border, #2e303a)',
  fontSize: 13,
  verticalAlign: 'top',
}

type Props = {
  rowsEstoque: RowEstoqueCruzada[]
  estoqueCarregando?: boolean
  estoqueErro?: string | null
}

export default function VisaoCruzadaEstoqueShelfPanel({ rowsEstoque, estoqueCarregando, estoqueErro }: Props) {
  const [loadingShelf, setLoadingShelf] = useState(true)
  const [errorShelf, setErrorShelf] = useState<string | null>(null)
  const [shelfRows, setShelfRows] = useState<ShelfLifeRow[]>([])
  const [filtroPrioridade, setFiltroPrioridade] = useState<FiltroPrioridade>('todos')
  const [filtroMatriz, setFiltroMatriz] = useState<FiltroMatriz>(null)
  const [filtroTexto, setFiltroTexto] = useState('')
  const [page, setPage] = useState(1)

  const loadShelf = useCallback(async () => {
    setLoadingShelf(true)
    setErrorShelf(null)
    try {
      const { text } = await fetchGoogleSheetCsv(SHELF_SHEET_ID, { sheetName: SHELF_SHEET_NAME })
      const parsed = parseControleShelfLifeCsv(text)
      if (!parsed.rows.length) throw new Error('Nenhum produto na aba CONTROLE SHELF LIFE.')
      setShelfRows(parsed.rows)
      setPage(1)
    } catch (e) {
      setErrorShelf(e instanceof Error ? e.message : 'Erro ao carregar shelf life.')
      setShelfRows([])
    } finally {
      setLoadingShelf(false)
    }
  }, [])

  useEffect(() => {
    void loadShelf()
  }, [loadShelf])

  const linhas = useMemo(() => mergeEstoqueShelfCruzada(rowsEstoque, shelfRows), [rowsEstoque, shelfRows])

  const contagemPrioridade = useMemo(() => {
    const out = Object.fromEntries(
      (['critico', 'desperdicio', 'produzir', 'validade', 'avaliar', 'excedente_ok', 'ok', 'sem_shelf', 'sem_estoque'] as PrioridadeCruzada[]).map(
        (p) => [p, 0],
      ),
    ) as Record<PrioridadeCruzada, number>
    linhas.forEach((l) => {
      out[l.prioridade] += 1
    })
    return out
  }, [linhas])

  const matriz = useMemo(() => contagemMatrizCruzada(linhas), [linhas])
  const qtdUrgentes = useMemo(() => linhas.filter(isUrgenteCruzada).length, [linhas])

  const linhasFiltradas = useMemo(() => {
    const txt = normalize(filtroTexto)
    return linhas.filter((l) => {
      if (filtroPrioridade === 'urgentes' && !isUrgenteCruzada(l)) return false
      if (filtroPrioridade !== 'todos' && filtroPrioridade !== 'urgentes' && l.prioridade !== filtroPrioridade) return false
      if (filtroMatriz) {
        if (l.nivelEstoque !== filtroMatriz.estoque || l.nivelShelf !== filtroMatriz.shelf) return false
      }
      if (!txt) return true
      return normalize(l.codigo).includes(txt) || normalize(l.descricao).includes(txt)
    })
  }, [linhas, filtroPrioridade, filtroMatriz, filtroTexto])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(linhasFiltradas.length / PAGE_SIZE)), [linhasFiltradas.length])
  const linhasPagina = useMemo(() => {
    const p = Math.min(page, totalPages)
    const start = (p - 1) * PAGE_SIZE
    return linhasFiltradas.slice(start, start + PAGE_SIZE)
  }, [linhasFiltradas, page, totalPages])

  useEffect(() => {
    setPage(1)
  }, [filtroPrioridade, filtroMatriz, filtroTexto, linhas.length])

  const loading = Boolean(estoqueCarregando) || loadingShelf
  const error = estoqueErro || errorShelf
  const temFiltro = filtroPrioridade !== 'todos' || filtroMatriz !== null || filtroTexto.trim() !== ''

  function toggleMatriz(estoque: NivelEstoque, shelf: Exclude<NivelShelf, 'sem'>) {
    setFiltroMatriz((prev) => {
      if (prev?.estoque === estoque && prev.shelf === shelf) return null
      return { estoque, shelf }
    })
    setFiltroPrioridade('todos')
    setPage(1)
  }

  function exportarExcel() {
    const data = linhasFiltradas.map((l) => ({
      Código: l.codigo,
      Descrição: l.descricao,
      Prioridade: PRIORIDADE_LABEL[l.prioridade],
      'Estoque (condicional)': l.condicional ?? '',
      'Shelf status': l.shelfStatus ?? '',
      'Shelf %': l.shelfPct,
      'Dias p/ vencer': l.diasParaVencer,
      'Estoque atual': l.estoqueAtual,
      'Nível estoque': l.nivelEstoque,
      'Nível shelf': l.nivelShelf,
      'Ação sugerida': l.acao,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Visão cruzada')
    XLSX.writeFile(wb, `visao-cruzada-estoque-shelf_${todayYmdLocal()}.xlsx`)
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid rgba(167, 139, 250, .4)',
          background: 'linear-gradient(135deg, rgba(139,92,246,.16), rgba(15,23,42,.2))',
        }}
      >
        <div>
          <div style={{ fontWeight: 900, color: '#f8fafc', fontSize: 19 }}>Visão cruzada — Estoque × Shelf</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4, maxWidth: 560, lineHeight: 1.45 }}>
            Cruza o semáforo de estoque de segurança com o shelf life pelo código do produto. Use os cards e a matriz para
            priorizar produção, giro ou consumo do que vence.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {qtdUrgentes > 0 ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#fca5a5',
                border: '1px solid rgba(239,68,68,.4)',
              }}
            >
              {qtdUrgentes} urgente{qtdUrgentes !== 1 ? 's' : ''}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadShelf()}
            disabled={loading}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #a78bfa',
              background: 'transparent',
              color: '#c4b5fd',
              fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Atualizando…' : 'Atualizar shelf'}
          </button>
          <button
            type="button"
            disabled={linhasFiltradas.length === 0}
            onClick={exportarExcel}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #555)',
              background: 'transparent',
              color: '#e2e8f0',
              fontWeight: 600,
              cursor: linhasFiltradas.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Exportar Excel
          </button>
        </div>
      </div>

      {loading ? <p style={{ color: '#94a3b8', margin: 0 }}>Carregando dados…</p> : null}
      {error ? (
        <div
          style={{
            border: '1px solid #b91c1c',
            background: 'rgba(127,29,29,.35)',
            color: '#fecaca',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <ShelfLifeRegrasLegenda sincronizadoPlanilha />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setFiltroPrioridade((p) => (p === 'urgentes' ? 'todos' : 'urgentes'))
                setFiltroMatriz(null)
              }}
              style={btnCard(filtroPrioridade === 'urgentes', '#dc2626', '#fecaca')}
            >
              Urgentes ({qtdUrgentes})
            </button>
            {PRIORIDADE_CARDS.map((p) => {
              const c = PRIORIDADE_CORES[p]
              const n = contagemPrioridade[p]
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setFiltroPrioridade((prev) => (prev === p ? 'todos' : p))
                    setFiltroMatriz(null)
                  }}
                  style={btnCard(filtroPrioridade === p, c.border, c.fg, c.bg)}
                >
                  {PRIORIDADE_LABEL[p]} ({n})
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => {
                setFiltroPrioridade('todos')
                setFiltroMatriz(null)
                setFiltroTexto('')
              }}
              disabled={!temFiltro}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #555)',
                background: 'transparent',
                color: temFiltro ? '#e2e8f0' : '#64748b',
                fontWeight: 600,
                cursor: temFiltro ? 'pointer' : 'default',
              }}
            >
              Limpar filtros
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 120, background: 'transparent' }} />
                  {MATRIZ_SHELF.map((col) => {
                    const cores = MATRIZ_SHELF_CORES[col.key]
                    return (
                      <th
                        key={col.key}
                        style={{
                          ...th,
                          textAlign: 'center',
                          color: cores.headerFg,
                          fontWeight: 700,
                          borderBottom: `2px solid ${cores.border}`,
                        }}
                      >
                        {col.label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {MATRIZ_ESTOQUE.map((row) => {
                  const rowCores = MATRIZ_ESTOQUE_CORES[row.key]
                  return (
                    <tr key={row.key}>
                      <th
                        style={{
                          ...th,
                          color: rowCores.fg,
                          fontWeight: 700,
                          borderLeft: `3px solid ${rowCores.border}`,
                        }}
                      >
                        {row.label}
                      </th>
                      {MATRIZ_SHELF.map((col) => {
                        const key = `${row.key}-${col.key}` as MatrizCruzadaKey
                        const n = matriz[key]
                        const cores = MATRIZ_SHELF_CORES[col.key]
                        const active = filtroMatriz?.estoque === row.key && filtroMatriz?.shelf === col.key
                        return (
                          <td key={col.key} style={{ padding: 4, textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => toggleMatriz(row.key, col.key)}
                              style={{
                                width: '100%',
                                minWidth: 72,
                                padding: '12px 8px',
                                borderRadius: 8,
                                border: `2px solid ${active ? cores.borderActive : cores.border}`,
                                background: active ? cores.bg : n > 0 ? cores.bg : cores.bgEmpty,
                                color: n > 0 ? cores.fg : cores.fgEmpty,
                                fontWeight: 800,
                                fontSize: 18,
                                cursor: 'pointer',
                                boxShadow: active ? `0 0 0 1px ${cores.borderActive}` : undefined,
                              }}
                            >
                              {n}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748b' }}>
              Matriz: quantidade de itens com SKU/código em ambas as planilhas. Clique numa célula para filtrar. Itens sem shelf
              ou só no shelf não entram na matriz ({contagemPrioridade.sem_shelf + contagemPrioridade.sem_estoque} fora da grade).
            </p>
          </div>

          <label style={{ display: 'grid', gap: 6, fontSize: 13, maxWidth: 360 }}>
            Filtrar código ou descrição
            <input
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              placeholder="código ou texto"
              style={{
                padding: '10px 10px',
                borderRadius: 8,
                border: '1px solid var(--border, #555)',
                background: 'var(--input-bg, #1a1a1a)',
                color: 'var(--text, #eee)',
              }}
            />
          </label>

          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
            {linhasFiltradas.length} item(ns) · {linhas.length} no cruzamento total
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={th}>Código</th>
                  <th style={th}>Descrição</th>
                  <th style={th}>Prioridade</th>
                  <th style={th}>Estoque</th>
                  <th style={th}>Shelf</th>
                  <th style={th}>Shelf %</th>
                  <th style={th}>Dias p/ vencer</th>
                  <th style={th}>Estoque atual</th>
                  <th style={{ ...th, minWidth: 220 }}>Ação sugerida</th>
                </tr>
              </thead>
              <tbody>
                {linhasPagina.map((l) => {
                  const pc = PRIORIDADE_CORES[l.prioridade]
                  const cc = l.condicional ? condColors(l.condicional) : { bg: '#1e293b', fg: '#64748b' }
                  const sc = shelfColors(l.shelfStatus)
                  return (
                    <tr key={l.codigo}>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{l.codigo}</td>
                      <td style={td}>{l.descricao}</td>
                      <td style={td}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: pc.bg,
                            color: pc.fg,
                            border: `1px solid ${pc.border}`,
                          }}
                        >
                          {PRIORIDADE_LABEL[l.prioridade]}
                        </span>
                      </td>
                      <td style={td}>
                        {l.condicional ? (
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              background: cc.bg,
                              color: cc.fg,
                            }}
                          >
                            {l.condicional}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={td}>
                        {l.shelfStatus ? (
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              background: sc.bg,
                              color: sc.fg,
                            }}
                          >
                            {l.shelfStatus}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={td}>{l.shelfPct || '—'}</td>
                      <td style={td}>{l.diasParaVencer || '—'}</td>
                      <td style={td}>{l.estoqueAtual || '—'}</td>
                      <td style={{ ...td, fontSize: 12, color: '#cbd5e1', lineHeight: 1.4 }}>{l.acao}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={btnPag}
              >
                Anterior
              </button>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>
                Página {Math.min(page, totalPages)} de {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={btnPag}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function btnCard(active: boolean, border: string, color: string, bg?: string): CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? border : 'var(--border, #2e303a)'}`,
    background: active ? bg ?? 'rgba(139,92,246,.2)' : 'transparent',
    color,
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 12,
  }
}

const btnPag: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border, #555)',
  background: 'transparent',
  color: '#e2e8f0',
  cursor: 'pointer',
}
