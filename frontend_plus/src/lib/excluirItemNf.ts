import { itemEnderecamentoCompleto } from './paletes'
import type { NotaFiscal } from '../types'

export type ExcluirItemResult =
  | { acao: 'atualizar'; nota: NotaFiscal }
  | { acao: 'remover_nf' }

export function podeExcluirItemNf(nf: NotaFiscal, itemIndex: number): boolean {
  const item = nf.items.find((it) => it.index === itemIndex)
  if (!item) return false
  if (nf.items.length > 1) return true
  return item.allocatedAddresses.length === 0
}

export function todosItensEnderecados(nf: NotaFiscal): boolean {
  return nf.items.length > 0 && nf.items.every(itemEnderecamentoCompleto)
}

export function excluirItemNotaFiscal(nf: NotaFiscal, itemIndex: number): ExcluirItemResult | null {
  const item = nf.items.find((it) => it.index === itemIndex)
  if (!item || !podeExcluirItemNf(nf, itemIndex)) return null

  const items = nf.items.filter((it) => it.index !== itemIndex)
  if (items.length === 0) return { acao: 'remover_nf' }

  let status = nf.status
  if (status === 'em_andamento' && todosItensEnderecados({ ...nf, items })) {
    status = 'concluida'
  }

  return { acao: 'atualizar', nota: { ...nf, items, status } }
}

/** Remove entradas fantasmas (em andamento sem itens). */
export function sanitizarNotasEntrada(notas: NotaFiscal[]): NotaFiscal[] {
  return notas.filter((n) => !(n.status === 'em_andamento' && n.items.length === 0))
}
