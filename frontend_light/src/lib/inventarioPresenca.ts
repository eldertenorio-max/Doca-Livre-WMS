import { TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import { contagensColumnAvailable, fetchContagensPaged } from './contagensSelectCompat'

/** Conferentes necessários para concluir uma rodada de inventário (1ª–4ª contagem). */
export const INVENTARIO_CONFERENTES_META_RODADA = 8

const PRESENCA_INVENTARIO_COLUMNS = [
  'id',
  'conferente_id',
  'data_hora_contagem',
  'inventario_numero_contagem',
  'contagem_rascunho',
] as const

/**
 * Conferentes com ao menos uma linha finalizada (`contagem_rascunho = false`) na rodada do inventário.
 */
export async function fetchResumoFinalizadosInventarioRodada(
  dataInventarioYmd: string,
  numeroContagemRodada: number,
): Promise<Map<string, { count: number; ultima: string | null }>> {
  const map = new Map<string, { count: number; ultima: string | null }>()
  const ymd = String(dataInventarioYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map
  const rodada = Math.min(4, Math.max(1, Math.round(numeroContagemRodada)))

  const { data: rows, error } = await fetchContagensPaged({
    table: TABLE_CONTAGEM_INVENTARIO,
    columns: PRESENCA_INVENTARIO_COLUMNS,
    eq: { data_contagem: ymd },
    order: { column: 'id', ascending: true },
  })
  if (error || !rows) return map

  const hasRascunhoCol = contagensColumnAvailable(TABLE_CONTAGEM_INVENTARIO, 'contagem_rascunho')

  for (const r of rows) {
    if (hasRascunhoCol && r.contagem_rascunho === true) continue
    const ncRaw = r.inventario_numero_contagem
    const nc = ncRaw != null && String(ncRaw).trim() !== '' ? Number(ncRaw) : 1
    if (Number.isFinite(nc) && Math.round(nc) !== rodada) continue
    const id = r.conferente_id != null ? String(r.conferente_id).trim() : ''
    if (!id) continue
    const dhRaw = r.data_hora_contagem != null ? String(r.data_hora_contagem) : ''
    const dh = dhRaw.trim() !== '' ? dhRaw : null
    const prev = map.get(id)
    const nextCount = (prev?.count ?? 0) + 1
    let ultima = prev?.ultima ?? null
    if (dh) {
      const t = new Date(dh).getTime()
      if (Number.isFinite(t)) {
        if (!ultima || t > new Date(ultima).getTime()) ultima = dh
      }
    }
    map.set(id, { count: nextCount, ultima })
  }
  return map
}

export function inventarioRodadaCompleta(
  finalizados: Map<string, { count: number; ultima: string | null }>,
): boolean {
  return finalizados.size >= INVENTARIO_CONFERENTES_META_RODADA
}
