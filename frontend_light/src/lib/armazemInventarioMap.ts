import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import { ARMAZEM_LISTA_OFICIAL_FALLBACK, type ArmazemListaOficialRow } from './armazemListaOficial'
import type { OfflineChecklistItem } from './offlineContagemSession'

/** Grupos 1–8 no inventário; alinhado a `INVENTARIO_ARMAZEM_NUM_GRUPOS` em inventarioPlanilhaModel. */
const INVENTARIO_ARMAZEM_NUM_GRUPOS = 8

function buildArmazemContagemCodes(lista: readonly ArmazemListaOficialRow[]): Record<number, string[]> {
  const out: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] }
  for (const row of lista) {
    out[row.grupo].push(row.codigo)
  }
  return out
}

function buildPosByCodigo(lista: readonly ArmazemListaOficialRow[]): Map<string, { contagem: number; pos: number }> {
  const contagemCodes = buildArmazemContagemCodes(lista)
  const m = new Map<string, { contagem: number; pos: number }>()
  for (const contagemStr of Object.keys(contagemCodes)) {
    const contagem = Number(contagemStr)
    const codes = contagemCodes[contagem] ?? []
    codes.forEach((codigo, pos) => {
      const meta = { contagem, pos }
      m.set(codigo, meta)
      const norm = normalizeCodigoInternoCompareKey(codigo)
      if (norm && !m.has(norm)) m.set(norm, meta)
    })
  }
  return m
}

let listaMapa: readonly ArmazemListaOficialRow[] = ARMAZEM_LISTA_OFICIAL_FALLBACK
let armazemPosByCodigo = buildPosByCodigo(listaMapa)

/** Recalcula grupo/ordem após carregar a aba Base Principal. */
export function rebuildArmazemInventarioMap(lista: readonly ArmazemListaOficialRow[]): void {
  listaMapa = lista.length > 0 ? lista : ARMAZEM_LISTA_OFICIAL_FALLBACK
  armazemPosByCodigo = buildPosByCodigo(listaMapa)
}

/** Códigos do mapa armazém na ordem oficial (grupos 1–8). */
export function listArmazemContagemCodigosOrdered(): ReadonlyArray<{ grupo: number; pos: number; codigo: string }> {
  const posInGrupo: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 }
  return listaMapa.map((row) => {
    const pos = posInGrupo[row.grupo] ?? 0
    posInGrupo[row.grupo] = pos + 1
    return { grupo: row.grupo, pos, codigo: row.codigo }
  })
}

/** Chaves candidatas para bater o mapa (cadastro às vezes perde zero à esquerda no 1º bloco). */
function armazemCodigoLookupCandidates(codigo: string): string[] {
  const t = String(codigo ?? '').trim()
  const keys: string[] = []
  const push = (s: string) => {
    if (s && !keys.includes(s)) keys.push(s)
  }
  push(t)
  push(normalizeCodigoInternoCompareKey(t))
  const dig = t.replace(/\D/g, '')
  if (dig.length === 7) push(dig.padStart(8, '0'))
  if (dig.length === 8) push(dig)
  return keys
}

export function getArmazemContagem(codigo: string): number | null {
  for (const k of armazemCodigoLookupCandidates(codigo)) {
    const c = armazemPosByCodigo.get(k)?.contagem
    if (c != null) return c
  }
  return null
}

/** Índice na rota do grupo (0-based). Não confundir com POS da planilha física — usado para ordenar como na lista. */
export function getArmazemPos(codigo: string): number {
  for (const k of armazemCodigoLookupCandidates(codigo)) {
    const p = armazemPosByCodigo.get(k)?.pos
    if (p != null) return p
  }
  return Number.MAX_SAFE_INTEGER
}

export function getArmazemContagemForItem(it: OfflineChecklistItem): number | null {
  const g = it.armazem_grupo
  if (g != null && g >= 1 && g <= INVENTARIO_ARMAZEM_NUM_GRUPOS) return g
  return getArmazemContagem(it.codigo_interno)
}

/**
 * Ordem canônica: grupo armazém (1ª–4ª contagem), posição no mapa, código e (no inventário) 1ª–3ª repetição.
 * Usada em POS/Nível ao finalizar (`buildPlanilhaLayoutPorItens` → `inventario_planilha_linhas`) e na checklist.
 */
export function compareInventarioPlanilhaItens(a: OfflineChecklistItem, b: OfflineChecklistItem): number {
  const oa = a.planilha_ordem_na_aba
  const ob = b.planilha_ordem_na_aba
  if (oa != null && ob != null && oa !== ob) return oa - ob
  if (oa != null && ob == null) return -1
  if (oa == null && ob != null) return 1
  const ga = getArmazemContagemForItem(a)
  const gb = getArmazemContagemForItem(b)
  if (ga != null && gb != null && ga !== gb) return ga - gb
  if (ga != null && gb == null) return -1
  if (ga == null && gb != null) return 1
  const pa = getArmazemPos(a.codigo_interno)
  const pb = getArmazemPos(b.codigo_interno)
  if (pa !== pb) return pa - pb
  const na = normalizeCodigoInternoCompareKey(a.codigo_interno)
  const nb = normalizeCodigoInternoCompareKey(b.codigo_interno)
  const c = na !== nb ? na.localeCompare(nb, 'pt-BR') : a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR')
  if (c !== 0) return c
  const r = (a.inventario_repeticao ?? 0) - (b.inventario_repeticao ?? 0)
  if (r !== 0) return r
  return String(a.key).localeCompare(String(b.key), 'pt-BR')
}
