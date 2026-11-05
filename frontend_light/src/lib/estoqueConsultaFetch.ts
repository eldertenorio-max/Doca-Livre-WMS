import {
  fetchPlanilhaContagemIdsParaIntervalo,
  filterContagensPorModoListagem,
} from './contagemListagemCompat'
import { fetchConferentesNomesPorIds } from './conferentesNomesBatch'
import { TABLE_CONTAGEM_DIARIA, TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import { ensureContagensDiariaSessaoSincronizadas } from './contagemDiariaFinalizeSync'
import { ensureInventariosSessaoSincronizados } from './inventarioSessaoFinalizeSync'
import { supabase } from './supabaseClient'

export type EstoqueTipoFiltro = 'todos' | 'contagem_diaria' | 'inventario'

export type EstoqueLinha = {
  id: string
  fonte: 'contagem_diaria' | 'inventario'
  data_contagem: string
  data_hora_contagem: string
  codigo_interno: string
  descricao: string
  unidade_medida: string | null
  quantidade_up: number
  lote: string | null
  data_validade: string | null
  conferente_id: string
  conferente_nome: string
  planilha_grupo_armazem: number | null
  inventario_numero_contagem: number | null
}

export type EstoqueConsultaFiltros = {
  tipo: EstoqueTipoFiltro
  dataDe: string
  dataAte: string
  busca: string
  conferenteId: string
  grupoCamara: string
}

const CHUNK = 1000
const SELECT =
  'id,data_contagem,data_hora_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,lote,data_validade,origem,inventario_numero_contagem,inventario_repeticao,planilha_grupo_armazem,contagem_rascunho'

function todayYmdSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function daysAgoYmd(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export function estoqueFiltrosPadrao(): EstoqueConsultaFiltros {
  return {
    tipo: 'todos',
    dataDe: daysAgoYmd(7),
    dataAte: todayYmdSp(),
    busca: '',
    conferenteId: '',
    grupoCamara: '',
  }
}

async function fetchTabela(
  tabela: typeof TABLE_CONTAGEM_DIARIA | typeof TABLE_CONTAGEM_INVENTARIO,
  dataDe: string,
  dataAte: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(tabela)
      .select(SELECT)
      .gte('data_contagem', dataDe)
      .lte('data_contagem', dataAte)
      .order('data_contagem', { ascending: false })
      .order('codigo_interno', { ascending: true })
      .range(from, from + CHUNK - 1)
    if (error) {
      const { data: data2, error: err2 } = await supabase
        .from(tabela)
        .select(
          'id,data_contagem,data_hora_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,lote,data_validade,contagem_rascunho',
        )
        .gte('data_contagem', dataDe)
        .lte('data_contagem', dataAte)
        .order('data_contagem', { ascending: false })
        .range(from, from + CHUNK - 1)
      if (err2) throw err2
      out.push(...((data2 ?? []) as Record<string, unknown>[]))
      if (!data2?.length || data2.length < CHUNK) break
      from += CHUNK
      if (from > 100000) break
      continue
    }
    out.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data?.length || data.length < CHUNK) break
    from += CHUNK
    if (from > 100000) break
  }
  return out.filter((r) => r.contagem_rascunho !== true)
}

function mapLinha(
  r: Record<string, unknown>,
  fonte: 'contagem_diaria' | 'inventario',
  nomes: Map<string, string>,
): EstoqueLinha {
  const cid = String(r.conferente_id ?? '')
  return {
    id: String(r.id ?? ''),
    fonte,
    data_contagem: String(r.data_contagem ?? '').slice(0, 10),
    data_hora_contagem: String(r.data_hora_contagem ?? ''),
    codigo_interno: String(r.codigo_interno ?? ''),
    descricao: String(r.descricao ?? ''),
    unidade_medida: r.unidade_medida != null ? String(r.unidade_medida) : null,
    quantidade_up: Number(r.quantidade_up ?? 0),
    lote: r.lote != null ? String(r.lote) : null,
    data_validade: r.data_validade != null ? String(r.data_validade).slice(0, 10) : null,
    conferente_id: cid,
    conferente_nome: nomes.get(cid) ?? (cid ? cid.slice(0, 8) : '—'),
    planilha_grupo_armazem:
      r.planilha_grupo_armazem != null && String(r.planilha_grupo_armazem).trim() !== ''
        ? Number(r.planilha_grupo_armazem)
        : null,
    inventario_numero_contagem:
      r.inventario_numero_contagem != null ? Number(r.inventario_numero_contagem) : null,
  }
}

function aplicarFiltrosCliente(rows: EstoqueLinha[], f: EstoqueConsultaFiltros): EstoqueLinha[] {
  const q = f.busca.trim().toUpperCase()
  return rows.filter((r) => {
    if (f.tipo !== 'todos' && r.fonte !== f.tipo) return false
    if (f.conferenteId && r.conferente_id !== f.conferenteId) return false
    if (f.grupoCamara) {
      const g = Number(f.grupoCamara)
      if (!Number.isFinite(g) || r.planilha_grupo_armazem !== g) return false
    }
    if (!q) return true
    return (
      r.codigo_interno.toUpperCase().includes(q) ||
      r.descricao.toUpperCase().includes(q) ||
      (r.lote ?? '').toUpperCase().includes(q)
    )
  })
}

export async function fetchEstoqueConsulta(f: EstoqueConsultaFiltros): Promise<EstoqueLinha[]> {
  if (f.tipo === 'todos' || f.tipo === 'contagem_diaria') {
    try {
      await ensureContagensDiariaSessaoSincronizadas({
        startYmd: f.dataDe,
        endYmd: f.dataAte,
      })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[estoqueConsulta] sync contagem diária', e)
    }
  }
  if (f.tipo === 'todos' || f.tipo === 'inventario') {
    try {
      await ensureInventariosSessaoSincronizados({
        startYmd: f.dataDe,
        endYmd: f.dataAte,
      })
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[estoqueConsulta] sync inventário', e)
    }
  }
  const merged: Record<string, unknown>[] = []

  if (f.tipo === 'todos' || f.tipo === 'contagem_diaria') {
    const raw = await fetchTabela(TABLE_CONTAGEM_DIARIA, f.dataDe, f.dataAte)
    const planilhaIds = await fetchPlanilhaContagemIdsParaIntervalo(
      supabase,
      f.dataDe,
      f.dataAte,
      'contagens_estoque_id',
    )
    const origemAusente = raw.every((r) => r.origem == null || String(r.origem) === '')
    const diaria = filterContagensPorModoListagem(raw, 'contagem_diaria', planilhaIds, origemAusente)
    for (const r of diaria) merged.push({ ...r, __fonte: 'contagem_diaria' })
  }

  if (f.tipo === 'todos' || f.tipo === 'inventario') {
    const invTable = await fetchTabela(TABLE_CONTAGEM_INVENTARIO, f.dataDe, f.dataAte)
    for (const r of invTable) merged.push({ ...r, __fonte: 'inventario' })

    const rawEst = await fetchTabela(TABLE_CONTAGEM_DIARIA, f.dataDe, f.dataAte)
    const planilhaIds = await fetchPlanilhaContagemIdsParaIntervalo(
      supabase,
      f.dataDe,
      f.dataAte,
      'contagens_inventario_id',
    )
    const origemAusente = rawEst.every((r) => r.origem == null || String(r.origem) === '')
    const invLegado = filterContagensPorModoListagem(rawEst, 'inventario', planilhaIds, origemAusente)
    const ids = new Set(merged.map((r) => String(r.id)))
    for (const r of invLegado) {
      const id = String(r.id)
      if (!ids.has(id)) merged.push({ ...r, __fonte: 'inventario' })
    }
  }

  const nomes = await fetchConferentesNomesPorIds(
    merged.map((r) => String(r.conferente_id ?? '')).filter(Boolean),
  )

  const linhas = merged.map((r) =>
    mapLinha(r, (r.__fonte as 'contagem_diaria' | 'inventario') ?? 'contagem_diaria', nomes),
  )

  return aplicarFiltrosCliente(linhas, f)
}

export function camaraLabelFromGrupo(grupo: number | null): string {
  if (grupo == null || !Number.isFinite(grupo)) return '—'
  const map: Record<number, string> = {
    1: '11-A',
    2: '11-B',
    3: '12-A',
    4: '12-B',
    5: '13-W',
    6: '13-Z',
    7: '21-G',
    8: '21-H',
  }
  return map[grupo] ?? `G${grupo}`
}
