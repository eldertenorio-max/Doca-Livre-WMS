import { supabase } from './supabaseClient'
import type { PlanilhaLayoutMeta } from '../components/inventario/inventarioPlanilhaModel'
import type { OfflineSessionMode } from './offlineContagemSession'
import {
  deletePlanilhaLinhaPorEndereco,
  insertInventarioContagensRows,
  replaceInventarioExistentePorEndereco,
} from './inventarioUpsertOnFinalize'

const QUEUE_KEY = 'contagem-offline-finalize-queue-v1'

export type FinalizeMetaSnapshot = {
  itemKey: string
  codigo_interno: string
  descricao: string
  inventario_repeticao?: number | null
  q: number
  up_adicional: number | null
  dfRaw: string
  dvRaw: string
  produtoId: string | null
  lote: string
  observacao: string
}

export type PendingContagemFinalize = {
  id: string
  mode: OfflineSessionMode
  inventario: boolean
  queuedAt: string
  ymd: string
  conferenteId: string
  sessionStartedAtIso: string
  sessionEndedAtIso: string
  finalizacaoSessaoId: string
  rows: Record<string, unknown>[]
  finalizeMeta: FinalizeMetaSnapshot[]
  planilhaLayoutEntries: Array<{ itemKey: string; layout: PlanilhaLayoutMeta }> | null
  pendAutoZero?: number
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

function isMissingInventarioPlanilhaTableError(e: unknown): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const msg = [o && 'message' in o ? String(o.message) : '', String(e)].join(' ').toLowerCase()
  return msg.includes('inventario_planilha_linhas') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export function loadPendingFinalizeQueue(): PendingContagemFinalize[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingContagemFinalize[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePendingFinalizeQueue(queue: PendingContagemFinalize[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    /* quota */
  }
}

export function enqueuePendingFinalize(entry: PendingContagemFinalize): void {
  const queue = loadPendingFinalizeQueue()
  queue.push(entry)
  savePendingFinalizeQueue(queue)
}

export function removePendingFinalize(id: string): void {
  savePendingFinalizeQueue(loadPendingFinalizeQueue().filter((e) => e.id !== id))
}

export function countPendingFinalize(): number {
  return loadPendingFinalizeQueue().length
}

export type UploadFinalizeResult = {
  registros: number
  planilhaGravada: boolean
  planilhaAviso: string | null
}

/** Envia ao Supabase uma finalização enfileirada offline. */
export async function uploadPendingFinalize(
  entry: PendingContagemFinalize,
  opts: {
    tContagens: string
    tPlanilhaFk: string
    onProgress?: (msg: string) => void
  },
): Promise<UploadFinalizeResult> {
  const { tContagens, tPlanilhaFk, onProgress } = opts
  const rows = entry.rows
  if (!rows.length) throw new Error('Nenhum registro para enviar.')

  const CHUNK = 250
  let insertWithoutInventarioColumns = false
  const insertedContagensIds: string[] = []

  if (entry.inventario) {
    onProgress?.('Substituindo gravações anteriores no mesmo endereço...')
    await replaceInventarioExistentePorEndereco(entry.ymd, rows)
    const ins = await insertInventarioContagensRows(rows, { onProgress })
    insertWithoutInventarioColumns = ins.insertWithoutInventarioColumns
    insertedContagensIds.push(...ins.ids)
  } else {
    for (let i = 0; i < rows.length; i += CHUNK) {
      onProgress?.(`Salvando: ${Math.min(i + CHUNK, rows.length)}/${rows.length} registros...`)
      const chunk = rows.slice(i, i + CHUNK) as Record<string, unknown>[]
      let attemptPayload: Record<string, unknown>[] = chunk
      let { data: insertedChunk, error: insErr } = await supabase
        .from(tContagens)
        .insert(attemptPayload)
        .select('id')
      if (insErr && isMissingDbColumnError(insErr, 'finalizacao_sessao_id')) {
        attemptPayload = attemptPayload.map((r) => stripContagensEstoqueFinalizacaoSessaoColumn(r))
        const res = await supabase.from(tContagens).insert(attemptPayload).select('id')
        insertedChunk = res.data
        insErr = res.error
      }
      if (insErr && isMissingDbColumnError(insErr, 'contagem_rascunho')) {
        attemptPayload = attemptPayload.map((r) => stripContagensEstoqueContagemRascunhoColumn(r))
        const res = await supabase.from(tContagens).insert(attemptPayload).select('id')
        insertedChunk = res.data
        insErr = res.error
      }
      if (insErr) throw insErr
      if (insertedChunk?.length) {
        for (const r of insertedChunk) {
          if (r && typeof r === 'object' && 'id' in r && (r as { id: unknown }).id != null) {
            insertedContagensIds.push(String((r as { id: string }).id))
          }
        }
      }
    }
  }

  if (insertedContagensIds.length !== rows.length) {
    throw new Error(`O banco não devolveu o id de cada linha em ${tContagens}.`)
  }

  let planilhaGravada = false
  let planilhaAviso: string | null = null
  if (entry.inventario && entry.planilhaLayoutEntries?.length) {
    onProgress?.('Gravando tabela inventário (planilha)...')
    const layoutMap = new Map(entry.planilhaLayoutEntries.map((e) => [e.itemKey, e.layout]))
    const planilhaRows: Record<string, unknown>[] = []
    for (const meta of entry.finalizeMeta) {
      const layout = layoutMap.get(meta.itemKey)
      if (!layout) throw new Error('Layout da planilha ausente para um item enfileirado.')
      await deletePlanilhaLinhaPorEndereco(entry.ymd, layout, meta.inventario_repeticao ?? null)
    }
    entry.finalizeMeta.forEach((meta, idx) => {
      const layout = layoutMap.get(meta.itemKey)!
      planilhaRows.push({
        conferente_id: entry.conferenteId,
        data_inventario: entry.ymd,
        grupo_armazem: layout.grupo_armazem,
        rua: layout.rua,
        posicao: layout.posicao,
        nivel: layout.nivel,
        numero_contagem: layout.numero_contagem,
        codigo_interno: meta.codigo_interno.trim(),
        descricao: meta.descricao.trim(),
        inventario_repeticao: meta.inventario_repeticao ?? null,
        quantidade: meta.q,
        data_fabricacao: meta.dfRaw === '' ? null : meta.dfRaw,
        data_validade: meta.dvRaw === '' ? null : meta.dvRaw,
        lote: meta.lote.trim() || null,
        up_quantidade: meta.up_adicional,
        observacao: meta.observacao.trim() || null,
        produto_id: meta.produtoId,
        [tPlanilhaFk]: insertedContagensIds[idx],
      })
    })
    for (let i = 0; i < planilhaRows.length; i += CHUNK) {
      const chunk = planilhaRows.slice(i, i + CHUNK)
      const { error: plErr } = await supabase.from('inventario_planilha_linhas').insert(chunk)
      if (plErr) {
        if (isMissingInventarioPlanilhaTableError(plErr)) {
          planilhaAviso =
            ' Tabela inventario_planilha_linhas não encontrada no banco — execute supabase/sql/create_inventario_planilha_linhas.sql.'
          break
        }
        throw plErr
      }
    }
    if (!planilhaAviso) planilhaGravada = true
  }

  void insertWithoutInventarioColumns
  return { registros: rows.length, planilhaGravada, planilhaAviso }
}
