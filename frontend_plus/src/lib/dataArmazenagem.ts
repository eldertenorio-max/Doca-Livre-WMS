/** Normaliza data de armazenagem (input date ou ISO) para YYYY-MM-DD. */
export function normalizarDataArmazenagemInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Data de armazenagem da NF para cobrança (prioriza campo editado na Entrada). */
export function dataArmazenagemNf(nf: {
  dataArmazenagem?: string
  createdAt?: string
}): string | undefined {
  const fromField = nf.dataArmazenagem
    ? normalizarDataArmazenagemInput(nf.dataArmazenagem) ?? undefined
    : undefined
  if (fromField) return fromField
  if (nf.createdAt) {
    return normalizarDataArmazenagemInput(nf.createdAt) ?? undefined
  }
  return undefined
}
