import type { MotivoRemocaoEstoqueId } from '../types'

export type { MotivoRemocaoEstoqueId }

export const MOTIVOS_REMOCAO_ESTOQUE: { id: MotivoRemocaoEstoqueId; label: string }[] = [
  { id: 'nf_incorreta', label: 'NF incorreta' },
  { id: 'enderecamento_incorreto', label: 'Endereçamento incorreto' },
  { id: 'entrada_duplicada', label: 'Entrada duplicada' },
  { id: 'dados_item_incorretos', label: 'Dados do item incorretos' },
  { id: 'xml_errado', label: 'XML com erro' },
  { id: 'quantidade_incorreta', label: 'Quantidade incorreta' },
  { id: 'entrada_indevida', label: 'Entrada indevida' },
  { id: 'outro_erro', label: 'Outro erro operacional' },
]

const LEGACY_MOTIVO_LABELS: Record<string, string> = {
  venda: 'Entrada indevida',
  transferencia: 'Outro erro operacional',
  descarte: 'Outro erro operacional',
  devolucao_remessa: 'Outro erro operacional',
  acerto_estoque: 'Outro erro operacional',
  revenda: 'Outro erro operacional',
}

export function labelMotivoRemocaoEstoque(id: MotivoRemocaoEstoqueId | undefined): string | null {
  if (!id) return null
  return (
    MOTIVOS_REMOCAO_ESTOQUE.find((m) => m.id === id)?.label ??
    LEGACY_MOTIVO_LABELS[id] ??
    id
  )
}
