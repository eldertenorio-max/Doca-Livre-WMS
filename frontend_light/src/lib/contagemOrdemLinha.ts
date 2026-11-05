/**
 * Critério único para “qual registro de contagem vale” no mesmo dia/código:
 * maior `data_hora_contagem`, depois maior `id` (numérico como BigInt; senão localeCompare).
 * Usado na prévia, no merge da checklist e em `fetchUltimasPorCodigo`.
 */
export function parseDataHoraContagemMs(dh: string): number {
  const t = new Date(dh).getTime()
  return Number.isFinite(t) ? t : -1
}

/** True se a linha `a` deve substituir `b` como mais recente. */
export function contagemLinhaAVenceB(
  a: { data_hora_contagem: string; id: string },
  b: { data_hora_contagem: string; id: string },
): boolean {
  const ta = parseDataHoraContagemMs(String(a.data_hora_contagem ?? ''))
  const tb = parseDataHoraContagemMs(String(b.data_hora_contagem ?? ''))
  if (ta !== tb) return ta > tb
  const ida = String(a.id ?? '')
  const idb = String(b.id ?? '')
  if (/^\d+$/.test(ida) && /^\d+$/.test(idb)) {
    try {
      return BigInt(ida) > BigInt(idb)
    } catch {
      /* fall through */
    }
  }
  return ida.localeCompare(idb, 'en') > 0
}
