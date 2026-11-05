import type { PlanilhaLayoutMeta } from '../components/inventario/inventarioPlanilhaModel'
import { conferenteIdParaBanco } from './conferentesStore'
import { TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import { fetchContagensPaged } from './contagensSelectCompat'
import { deleteInventarioPlanilhaLinhasForContagensIds } from './inventarioPlanilhaLinhasDelete'
import { supabase } from './supabaseClient'

const UPSERT_FETCH_COLUMNS = [
  'id',
  'data_hora_contagem',
  'inventario_numero_contagem',
  'planilha_grupo_armazem',
  'planilha_ordem_na_aba',
  'contagem_rascunho',
] as const

export function inventarioEnderecoKeyFromPayload(
  ymd: string,
  row: Record<string, unknown>,
): string | null {
  const grupoRaw = row.planilha_grupo_armazem
  const ordemRaw = row.planilha_ordem_na_aba
  const grupo = grupoRaw != null && Number.isFinite(Number(grupoRaw)) ? Number(grupoRaw) : null
  const ordem = ordemRaw != null && Number.isFinite(Number(ordemRaw)) ? Number(ordemRaw) : null
  if (grupo == null || ordem == null) return null
  const ncRaw = row.inventario_numero_contagem
  const rodada =
    ncRaw != null && String(ncRaw).trim() !== '' && Number.isFinite(Number(ncRaw))
      ? Math.min(4, Math.max(1, Math.round(Number(ncRaw))))
      : 1
  return `${ymd}|rod${rodada}|g${grupo}|o${ordem}`
}

function isMissingDbColumnError(e: unknown, columnSqlName: string): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const code = o && 'code' in o ? String(o.code) : ''
  const msg = [
    o && 'message' in o ? String(o.message) : '',
    o && 'details' in o ? String(o.details) : '',
    String(e),
  ]
    .join(' ')
    .toLowerCase()
  const col = columnSqlName.toLowerCase()
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (msg.includes('does not exist') && msg.includes(col)) ||
    (msg.includes('could not find') && msg.includes(col)) ||
    (msg.includes('schema cache') && msg.includes(col))
  )
}

function isMissingAnyInventarioContagensColumn(e: unknown): boolean {
  return (
    isMissingDbColumnError(e, 'origem') ||
    isMissingDbColumnError(e, 'inventario_repeticao') ||
    isMissingDbColumnError(e, 'inventario_numero_contagem') ||
    isMissingDbColumnError(e, 'planilha_grupo_armazem') ||
    isMissingDbColumnError(e, 'planilha_ordem_na_aba')
  )
}

function stripContagensEstoqueInventarioColumns(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.origem
  delete r.inventario_repeticao
  delete r.inventario_numero_contagem
  return r
}

function stripContagensEstoqueFinalizacaoSessaoColumn(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.finalizacao_sessao_id
  return r
}

function stripContagensEstoqueContagemRascunhoColumn(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.contagem_rascunho
  return r
}

function stripContagensInventarioPlanilhaMergeColumns(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row }
  delete r.planilha_grupo_armazem
  delete r.planilha_ordem_na_aba
  return r
}

function isMissingInventarioPlanilhaTableError(e: unknown): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const msg = [o && 'message' in o ? String(o.message) : '', String(e)].join(' ').toLowerCase()
  return msg.includes('inventario_planilha_linhas') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

/**
 * Remove registros anteriores no mesmo endereço (dia + câmara/rua + POS/NÍVEL/linha + rodada),
 * independente do conferente — a nova gravação substitui a anterior.
 */
export async function replaceInventarioExistentePorEndereco(
  dataContagemYmd: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || rows.length === 0) return 0

  const keysAlvo = new Set<string>()
  for (const row of rows) {
    const key = inventarioEnderecoKeyFromPayload(ymd, row)
    if (key) keysAlvo.add(key)
  }
  if (keysAlvo.size === 0) return 0

  const { data: existentes, error } = await fetchContagensPaged({
    table: TABLE_CONTAGEM_INVENTARIO,
    columns: UPSERT_FETCH_COLUMNS,
    eq: { data_contagem: ymd },
    order: { column: 'id', ascending: true },
  })
  if (error || !existentes.length) return 0

  const idsRemover = new Set<string>()
  for (const r of existentes) {
    if ('contagem_rascunho' in r && r.contagem_rascunho === true) continue
    const key = inventarioEnderecoKeyFromPayload(ymd, r as Record<string, unknown>)
    if (!key || !keysAlvo.has(key)) continue
    const id = r.id != null ? String(r.id) : ''
    if (id) idsRemover.add(id)
  }
  if (idsRemover.size === 0) return 0

  const ids = [...idsRemover]
  await deleteInventarioPlanilhaLinhasForContagensIds(supabase, ids)
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { error: delErr } = await supabase.from(TABLE_CONTAGEM_INVENTARIO).delete().in('id', chunk)
    if (delErr) throw delErr
  }
  return ids.length
}

/** Remove linha da planilha no mesmo endereço físico (caso órfã sem FK). */
export async function deletePlanilhaLinhaPorEndereco(
  ymd: string,
  layout: PlanilhaLayoutMeta,
  inventarioRepeticao: number | null,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
  let q = supabase
    .from('inventario_planilha_linhas')
    .delete()
    .eq('data_inventario', ymd)
    .eq('grupo_armazem', layout.grupo_armazem)
    .eq('posicao', layout.posicao)
    .eq('nivel', layout.nivel)
    .eq('numero_contagem', layout.numero_contagem)
  if (inventarioRepeticao != null && Number.isFinite(inventarioRepeticao)) {
    q = q.eq('inventario_repeticao', Math.round(inventarioRepeticao))
  }
  const { error } = await q
  if (error && !isMissingInventarioPlanilhaTableError(error)) throw error
}

export type InsertInventarioResult = {
  ids: string[]
  insertWithoutInventarioColumns: boolean
}

function sanitizeConferenteIdRow(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, conferente_id: conferenteIdParaBanco(row.conferente_id as string | null | undefined) }
}

/** Insere linhas em `contagens_inventario` (compatível com colunas ausentes no banco). */
export async function insertInventarioContagensRows(
  rows: Record<string, unknown>[],
  opts?: { onProgress?: (msg: string) => void },
): Promise<InsertInventarioResult> {
  const CHUNK = 250
  let insertWithoutInventarioColumns = false
  const ids: string[] = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    opts?.onProgress?.(`Salvando: ${Math.min(i + CHUNK, rows.length)}/${rows.length} registros...`)
    const chunk = rows.slice(i, i + CHUNK).map(sanitizeConferenteIdRow) as Record<string, unknown>[]
    let attemptPayload: Record<string, unknown>[] = chunk
    let { data: insertedChunk, error: insErr } = await supabase
      .from(TABLE_CONTAGEM_INVENTARIO)
      .insert(attemptPayload)
      .select('id')
    if (insErr && isMissingAnyInventarioContagensColumn(insErr)) {
      insertWithoutInventarioColumns = true
      attemptPayload = chunk.map((r) => stripContagensEstoqueInventarioColumns(r))
      const res = await supabase.from(TABLE_CONTAGEM_INVENTARIO).insert(attemptPayload).select('id')
      insertedChunk = res.data
      insErr = res.error
    }
    if (insErr && isMissingDbColumnError(insErr, 'finalizacao_sessao_id')) {
      attemptPayload = attemptPayload.map((r) => stripContagensEstoqueFinalizacaoSessaoColumn(r))
      const res = await supabase.from(TABLE_CONTAGEM_INVENTARIO).insert(attemptPayload).select('id')
      insertedChunk = res.data
      insErr = res.error
    }
    if (insErr && isMissingDbColumnError(insErr, 'contagem_rascunho')) {
      attemptPayload = attemptPayload.map((r) => stripContagensEstoqueContagemRascunhoColumn(r))
      const res = await supabase.from(TABLE_CONTAGEM_INVENTARIO).insert(attemptPayload).select('id')
      insertedChunk = res.data
      insErr = res.error
    }
    if (insErr && isMissingDbColumnError(insErr, 'planilha_grupo_armazem')) {
      attemptPayload = attemptPayload.map((r) => stripContagensInventarioPlanilhaMergeColumns(r))
      const res = await supabase.from(TABLE_CONTAGEM_INVENTARIO).insert(attemptPayload).select('id')
      insertedChunk = res.data
      insErr = res.error
    }
    if (insErr) throw insErr
    if (insertedChunk?.length) {
      for (const r of insertedChunk) {
        if (r && typeof r === 'object' && 'id' in r && (r as { id: unknown }).id != null) {
          ids.push(String((r as { id: string }).id))
        }
      }
    }
  }
  return { ids, insertWithoutInventarioColumns }
}
