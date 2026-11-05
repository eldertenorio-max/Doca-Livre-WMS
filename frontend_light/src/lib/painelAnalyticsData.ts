import { fetchConferentesNomesPorIds } from './conferentesNomesBatch'
import { TABLE_CONTAGEM_DIARIA, TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import { listInventarios } from './inventarioSessaoStore'
import type { InventarioSessao } from './inventarioSessaoTypes'
import { supabase } from './supabaseClient'
import { isColumnMissingError } from './supabaseError'

const CHUNK = 1000

export type PainelFiltroAtivo = {
  ymd: string | null
  conferenteId: string | null
  camara: string | null
  codigoInterno: string | null
}

export type PainelChartPoint = {
  id: string
  label: string
  value: number
}

export type PainelLinhaContagem = {
  id: string
  data_contagem: string
  conferente_id: string
  conferente_nome: string
  codigo_interno: string
  quantidade: number
}

export type PainelLinhaInventario = {
  id: string
  data_contagem: string
  conferente_id: string
  conferente_nome: string
  codigo_interno: string
  quantidade: number
  camara: string | null
  numero_contagem: number | null
}

export function todayYmdSp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

export function daysAgoYmdSp(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export function labelDiaBr(ymd: string): string {
  const [, m, day] = ymd.split('-')
  return `${day}/${m}`
}

export function formatYmdBr(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

function enumerateDays(dataDe: string, dataAte: string): string[] {
  const out: string[] = []
  const start = new Date(`${dataDe}T12:00:00`)
  const end = new Date(`${dataAte}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out
  const cur = new Date(start)
  while (cur <= end) {
    out.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function numQty(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function fetchTabelaPainel(
  tabela: typeof TABLE_CONTAGEM_DIARIA | TABLE_CONTAGEM_INVENTARIO,
  dataDe: string,
  dataAte: string,
  select: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(tabela)
      .select(select)
      .gte('data_contagem', dataDe)
      .lte('data_contagem', dataAte)
      .range(from, from + CHUNK - 1)
    if (error) {
      if (isColumnMissingError(error)) return out
      throw error
    }
    if (!data?.length) break
    out.push(...data)
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return out
}

export async function fetchPainelLinhasContagem(
  dataDe: string,
  dataAte: string,
): Promise<PainelLinhaContagem[]> {
  const select =
    'id,data_contagem,conferente_id,codigo_interno,quantidade_up,origem,contagem_rascunho'
  let rows = await fetchTabelaPainel(TABLE_CONTAGEM_DIARIA, dataDe, dataAte, select)
  rows = rows.filter((r) => r.contagem_rascunho !== true && r.origem !== 'inventario')

  const ids = rows.map((r) => String(r.conferente_id ?? '')).filter(Boolean)
  const nomes = await fetchConferentesNomesPorIds(ids)

  return rows.map((r) => {
    const cid = String(r.conferente_id ?? '')
    return {
      id: String(r.id ?? ''),
      data_contagem: String(r.data_contagem ?? ''),
      conferente_id: cid,
      conferente_nome: nomes.get(cid) ?? (cid ? 'Conferente' : '—'),
      codigo_interno: String(r.codigo_interno ?? ''),
      quantidade: numQty(r.quantidade_up),
    }
  })
}

export async function fetchPainelLinhasInventario(
  dataDe: string,
  dataAte: string,
): Promise<PainelLinhaInventario[]> {
  const select =
    'id,data_contagem,conferente_id,codigo_interno,quantidade_up,planilha_grupo_armazem,inventario_numero_contagem,contagem_rascunho'
  let rows = await fetchTabelaPainel(TABLE_CONTAGEM_INVENTARIO, dataDe, dataAte, select)
  rows = rows.filter((r) => r.contagem_rascunho !== true)

  const ids = rows.map((r) => String(r.conferente_id ?? '')).filter(Boolean)
  const nomes = await fetchConferentesNomesPorIds(ids)

  return rows.map((r) => {
    const cid = String(r.conferente_id ?? '')
    const grupo = r.planilha_grupo_armazem
    return {
      id: String(r.id ?? ''),
      data_contagem: String(r.data_contagem ?? ''),
      conferente_id: cid,
      conferente_nome: nomes.get(cid) ?? (cid ? 'Conferente' : '—'),
      codigo_interno: String(r.codigo_interno ?? ''),
      quantidade: numQty(r.quantidade_up),
      camara: grupo != null && grupo !== '' ? String(grupo) : null,
      numero_contagem:
        r.inventario_numero_contagem != null ? Number(r.inventario_numero_contagem) : null,
    }
  })
}

export async function fetchPainelSessoesInventario(): Promise<InventarioSessao[]> {
  try {
    return await listInventarios()
  } catch {
    return []
  }
}

export async function fetchPresencaContagemDia(ymd: string): Promise<number> {
  const { count } = await supabase
    .from('contagem_diaria_presenca')
    .select('conferente_id', { count: 'exact', head: true })
    .eq('data_contagem', ymd)
  return count ?? 0
}

export function filtrarLinhasContagem(
  linhas: PainelLinhaContagem[],
  filtro: PainelFiltroAtivo,
  exceto?: keyof PainelFiltroAtivo,
): PainelLinhaContagem[] {
  return linhas.filter((ln) => {
    if (exceto !== 'ymd' && filtro.ymd && ln.data_contagem !== filtro.ymd) return false
    if (exceto !== 'conferenteId' && filtro.conferenteId && ln.conferente_id !== filtro.conferenteId)
      return false
    if (exceto !== 'codigoInterno' && filtro.codigoInterno && ln.codigo_interno !== filtro.codigoInterno)
      return false
    return true
  })
}

export function filtrarLinhasInventario(
  linhas: PainelLinhaInventario[],
  filtro: PainelFiltroAtivo,
  exceto?: keyof PainelFiltroAtivo,
): PainelLinhaInventario[] {
  return linhas.filter((ln) => {
    if (exceto !== 'ymd' && filtro.ymd && ln.data_contagem !== filtro.ymd) return false
    if (exceto !== 'conferenteId' && filtro.conferenteId && ln.conferente_id !== filtro.conferenteId)
      return false
    if (exceto !== 'camara' && filtro.camara && ln.camara !== filtro.camara) return false
    if (exceto !== 'codigoInterno' && filtro.codigoInterno && ln.codigo_interno !== filtro.codigoInterno)
      return false
    return true
  })
}

export function seriePorDia<T extends { data_contagem: string }>(
  linhas: T[],
  dataDe: string,
  dataAte: string,
): PainelChartPoint[] {
  const dias = enumerateDays(dataDe, dataAte)
  const map = new Map<string, number>()
  for (const d of dias) map.set(d, 0)
  for (const ln of linhas) {
    if (!map.has(ln.data_contagem)) continue
    map.set(ln.data_contagem, (map.get(ln.data_contagem) ?? 0) + 1)
  }
  return dias.map((ymd) => ({
    id: ymd,
    label: labelDiaBr(ymd),
    value: map.get(ymd) ?? 0,
  }))
}

export function seriePorConferente<T extends { conferente_id: string; conferente_nome: string }>(
  linhas: T[],
  limit = 8,
): PainelChartPoint[] {
  const map = new Map<string, { nome: string; count: number }>()
  for (const ln of linhas) {
    if (!ln.conferente_id) continue
    const cur = map.get(ln.conferente_id) ?? { nome: ln.conferente_nome, count: 0 }
    cur.count++
    map.set(ln.conferente_id, cur)
  }
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([id, v]) => ({ id, label: v.nome, value: v.count }))
}

export function seriePorCamara(linhas: PainelLinhaInventario[]): PainelChartPoint[] {
  const map = new Map<string, number>()
  for (const ln of linhas) {
    const key = ln.camara ?? '—'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .filter(([k]) => k !== '—')
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({ id, label: `Câm. ${id}`, value }))
}

export function seriePorNumeroContagem(linhas: PainelLinhaInventario[]): PainelChartPoint[] {
  const map = new Map<string, number>()
  for (const ln of linhas) {
    const n = ln.numero_contagem
    if (n == null || !Number.isFinite(n)) continue
    const key = String(n)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, value]) => ({ id, label: `${id}ª contagem`, value }))
}

export function seriePorProduto<T extends { codigo_interno: string }>(
  linhas: T[],
  limit = 8,
): PainelChartPoint[] {
  const map = new Map<string, number>()
  for (const ln of linhas) {
    const cod = ln.codigo_interno.trim()
    if (!cod) continue
    map.set(cod, (map.get(cod) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, value]) => ({
      id,
      label: id.length > 16 ? `${id.slice(0, 14)}…` : id,
      value,
    }))
}

export function serieQuantidadePorDia<T extends { data_contagem: string; quantidade: number }>(
  linhas: T[],
  dataDe: string,
  dataAte: string,
): PainelChartPoint[] {
  const dias = enumerateDays(dataDe, dataAte)
  const map = new Map<string, number>()
  for (const d of dias) map.set(d, 0)
  for (const ln of linhas) {
    if (!map.has(ln.data_contagem)) continue
    map.set(ln.data_contagem, (map.get(ln.data_contagem) ?? 0) + ln.quantidade)
  }
  return dias.map((ymd) => ({
    id: ymd,
    label: labelDiaBr(ymd),
    value: Math.round((map.get(ymd) ?? 0) * 100) / 100,
  }))
}

export function serieQuantidadePorCamara(linhas: PainelLinhaInventario[]): PainelChartPoint[] {
  const map = new Map<string, number>()
  for (const ln of linhas) {
    if (!ln.camara) continue
    map.set(ln.camara, (map.get(ln.camara) ?? 0) + ln.quantidade)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({
      id,
      label: `Câm. ${id}`,
      value: Math.round(value * 100) / 100,
    }))
}

export function serieStatusSessoesInventario(sessoes: InventarioSessao[]): PainelChartPoint[] {
  const abertos = sessoes.filter((s) => s.status === 'aberto').length
  const fechados = sessoes.filter((s) => s.status === 'fechado').length
  return [
    { id: 'aberto', label: 'Abertos', value: abertos },
    { id: 'fechado', label: 'Fechados', value: fechados },
  ].filter((p) => p.value > 0)
}

export function kpisContagem(linhas: PainelLinhaContagem[]) {
  const conferentes = new Set(linhas.map((l) => l.conferente_id).filter(Boolean))
  const produtos = new Set(linhas.map((l) => l.codigo_interno).filter(Boolean))
  const mediaConf = conferentes.size > 0 ? Math.round(linhas.length / conferentes.size) : 0
  const qtdTotal = linhas.reduce((s, l) => s + l.quantidade, 0)
  return {
    itens: linhas.length,
    conferentes: conferentes.size,
    skus: produtos.size,
    mediaPorConferente: mediaConf,
    quantidadeTotal: Math.round(qtdTotal * 100) / 100,
  }
}

export function kpisInventario(
  linhas: PainelLinhaInventario[],
  sessoes: InventarioSessao[],
) {
  const conferentes = new Set(linhas.map((l) => l.conferente_id).filter(Boolean))
  const enderecos = new Set(
    linhas.map((l) => l.codigo_interno).filter(Boolean),
  )
  return {
    linhas: linhas.length,
    conferentes: conferentes.size,
    skus: enderecos.size,
    abertos: sessoes.filter((s) => s.status === 'aberto').length,
    fechados: sessoes.filter((s) => s.status === 'fechado').length,
    quantidadeTotal: Math.round(linhas.reduce((s, l) => s + l.quantidade, 0) * 100) / 100,
  }
}
