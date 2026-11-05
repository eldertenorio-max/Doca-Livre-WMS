import { itemNoStage } from '../layout/stage'
import type { NfeItem, NotaFiscal } from '../types'

/** Item com estoque no armazém (endereçado) ou no stage — pode ser movimentado. */
export function itemMovimentavel(item: NfeItem): boolean {
  return itemNoStage(item) || item.allocatedAddresses.length > 0
}

export function itensMovimentaveisDaNf(nf: NotaFiscal): NfeItem[] {
  return nf.items.filter(itemMovimentavel).sort((a, b) => a.index - b.index)
}

/** Próximo item movimentável após `afterIndex` (ordem crescente de index). */
export function proximoItemMovimentavel(
  nf: NotaFiscal,
  afterIndex: number | null,
): NfeItem | null {
  const lista = itensMovimentaveisDaNf(nf)
  if (!lista.length) return null
  if (afterIndex == null) return lista[0] ?? null
  return lista.find((it) => it.index > afterIndex) ?? null
}
