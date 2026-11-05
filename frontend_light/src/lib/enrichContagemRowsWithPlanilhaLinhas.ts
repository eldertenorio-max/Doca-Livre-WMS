import { supabase } from './supabaseClient'
import {
  getInventarioRuaArmazem,
  inventarioPlanilhaPosNivelFromIndex,
} from '../components/inventario/inventarioPlanilhaModel'

export const PLANILHA_ENRICH_CHUNK = 200

export type PlanilhaLinhasFields = {
  planilha_grupo_armazem: number | null
  planilha_rua: string | null
  planilha_posicao: number | null
  planilha_nivel: number | null
}

function withNullPlanilha<T extends { id: string }>(r: T): T & PlanilhaLinhasFields {
  return {
    ...r,
    planilha_grupo_armazem: (r as T & Partial<PlanilhaLinhasFields>).planilha_grupo_armazem ?? null,
    planilha_rua: (r as T & Partial<PlanilhaLinhasFields>).planilha_rua ?? null,
    planilha_posicao: (r as T & Partial<PlanilhaLinhasFields>).planilha_posicao ?? null,
    planilha_nivel: (r as T & Partial<PlanilhaLinhasFields>).planilha_nivel ?? null,
  }
}

function isEmptyField(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  return false
}

function ymdFromDb(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

type PlanilhaJoinRow = {
  grupo_armazem: number
  rua: string | null
  posicao: number
  nivel: number
  numero_contagem: number | null
  data_fabricacao: string | null
  data_validade: string | null
  lote: string | null
  up_quantidade: number | null
  observacao: string | null
}

/**
 * Preenche Câmara/Rua/POS/Nível a partir de `inventario_planilha_linhas` (uma linha por `contagens_estoque_id`).
 * Quando `contagens_estoque` não tiver datas/lote/UP/observação, usa os valores gravados na planilha (mesmo dia).
 * Em erro ou tabela ausente, devolve as linhas com campos nulos (não lança).
 */
export async function enrichContagemRowsWithPlanilhaLinhas<T extends { id: string }>(
  rows: T[],
  logLabel = 'enrichContagemRowsWithPlanilhaLinhas',
): Promise<Array<T & PlanilhaLinhasFields>> {
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (ids.length === 0) return rows.map(withNullPlanilha)
  const byContagem = new Map<string, PlanilhaJoinRow>()
  try {
    for (let i = 0; i < ids.length; i += PLANILHA_ENRICH_CHUNK) {
      const chunk = ids.slice(i, i + PLANILHA_ENRICH_CHUNK)
      const sel =
        'contagens_estoque_id, contagens_inventario_id, grupo_armazem, rua, posicao, nivel, numero_contagem, data_fabricacao, data_validade, lote, up_quantidade, observacao'
      const [resInv, resLeg] = await Promise.all([
        supabase.from('inventario_planilha_linhas').select(sel).in('contagens_inventario_id', chunk),
        supabase.from('inventario_planilha_linhas').select(sel).in('contagens_estoque_id', chunk),
      ])
      const error = resInv.error ?? resLeg.error
      const data = [...(resInv.data ?? []), ...(resLeg.data ?? [])]
      if (error) {
        console.warn(`[${logLabel}] inventario_planilha_linhas:`, error)
        return rows.map(withNullPlanilha)
      }
      for (const row of data ?? []) {
        const cidRaw =
          row.contagens_inventario_id != null
            ? row.contagens_inventario_id
            : row.contagens_estoque_id
        const cid = cidRaw != null ? String(cidRaw) : ''
        if (!cid || byContagem.has(cid)) continue
        const nc = row.numero_contagem
        const upq = row.up_quantidade
        byContagem.set(cid, {
          grupo_armazem: Number(row.grupo_armazem),
          rua: row.rua != null ? String(row.rua) : null,
          posicao: Number(row.posicao),
          nivel: Number(row.nivel),
          numero_contagem: nc != null && nc !== '' && Number.isFinite(Number(nc)) ? Number(nc) : null,
          data_fabricacao: ymdFromDb(row.data_fabricacao),
          data_validade: ymdFromDb(row.data_validade),
          lote: row.lote != null && String(row.lote).trim() !== '' ? String(row.lote).trim() : null,
          up_quantidade:
            upq != null && upq !== '' && Number.isFinite(Number(upq)) ? Number(upq) : null,
          observacao:
            row.observacao != null && String(row.observacao).trim() !== ''
              ? String(row.observacao).trim()
              : null,
        })
      }
    }
  } catch (e) {
    console.warn(`[${logLabel}] inventario_planilha_linhas:`, e)
    return rows.map(withNullPlanilha)
  }
  return rows.map((r) => {
    const p = byContagem.get(r.id)
    if (!p) return withNullPlanilha(r)
    const existingNc = (r as { inventario_numero_contagem?: number | null }).inventario_numero_contagem
    const hasNc =
      existingNc != null &&
      String(existingNc).trim() !== '' &&
      Number.isFinite(Number(existingNc))
    const rr = r as Record<string, unknown>
    const out: Record<string, unknown> = {
      ...r,
      planilha_grupo_armazem: p.grupo_armazem,
      planilha_rua: p.rua,
      planilha_posicao: p.posicao,
      planilha_nivel: p.nivel,
      inventario_numero_contagem: hasNc ? Number(existingNc) : p.numero_contagem,
    }
    if (isEmptyField(rr.data_fabricacao) && p.data_fabricacao != null) {
      out.data_fabricacao = p.data_fabricacao
    }
    if (isEmptyField(rr.data_validade) && p.data_validade != null) {
      out.data_validade = p.data_validade
    }
    if (isEmptyField(rr.lote) && p.lote != null) {
      out.lote = p.lote
    }
    if (isEmptyField(rr.observacao) && p.observacao != null) {
      out.observacao = p.observacao
    }
    if (rr.up_adicional == null && p.up_quantidade != null) {
      out.up_adicional = p.up_quantidade
    }
    return out as T & PlanilhaLinhasFields
  })
}

/** Preenche Rua/POS/Nível a partir de `planilha_grupo_armazem` + `planilha_ordem_na_aba` quando o join da planilha não trouxe. */
export function enrichPlanilhaFieldsFromGrupoOrdem<
  T extends {
    planilha_grupo_armazem?: number | null
    planilha_ordem_na_aba?: number | null
    planilha_rua?: string | null
    planilha_posicao?: number | null
    planilha_nivel?: number | null
  },
>(rows: T[]): T[] {
  return rows.map((r) => {
    const grupoRaw = r.planilha_grupo_armazem
    const ordemRaw = r.planilha_ordem_na_aba
    const grupo =
      grupoRaw != null && Number.isFinite(Number(grupoRaw)) ? Number(grupoRaw) : null
    const ordem =
      ordemRaw != null && Number.isFinite(Number(ordemRaw)) ? Number(ordemRaw) : null
    const needsRua = r.planilha_rua == null || String(r.planilha_rua).trim() === ''
    const needsPos = r.planilha_posicao == null || !Number.isFinite(Number(r.planilha_posicao))
    const needsNivel = r.planilha_nivel == null || !Number.isFinite(Number(r.planilha_nivel))
    if (grupo == null && ordem == null) return r
    if (!needsRua && !needsPos && !needsNivel) return r
    const { pos, nivel } =
      ordem != null ? inventarioPlanilhaPosNivelFromIndex(ordem) : { pos: null as number | null, nivel: null as number | null }
    const ruaFromGrupo = grupo != null ? getInventarioRuaArmazem(grupo) : '—'
    return {
      ...r,
      ...(needsRua && ruaFromGrupo !== '—' ? { planilha_rua: ruaFromGrupo } : {}),
      ...(needsPos && pos != null ? { planilha_posicao: pos } : {}),
      ...(needsNivel && nivel != null ? { planilha_nivel: nivel } : {}),
    }
  })
}
