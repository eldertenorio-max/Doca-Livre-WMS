import type { JustificativaSaidaId } from '../types'

export type { JustificativaSaidaId }

export const JUSTIFICATIVAS_SAIDA: { id: JustificativaSaidaId; label: string }[] = [
  { id: 'venda', label: 'Venda' },
  { id: 'transferencia', label: 'Transferência' },
  { id: 'descarte', label: 'Descarte' },
  { id: 'devolucao_remessa', label: 'Devolução de remessa' },
  { id: 'acerto_estoque', label: 'Acerto de estoque' },
  { id: 'revenda', label: 'Revenda' },
]

const LEGACY_JUSTIFICATIVA_LABELS: Record<string, string> = {
  descarga: 'Descarte',
}

export function labelJustificativaSaida(id: JustificativaSaidaId | undefined): string | null {
  if (!id) return null
  return (
    JUSTIFICATIVAS_SAIDA.find((j) => j.id === id)?.label ??
    LEGACY_JUSTIFICATIVA_LABELS[id] ??
    id
  )
}
