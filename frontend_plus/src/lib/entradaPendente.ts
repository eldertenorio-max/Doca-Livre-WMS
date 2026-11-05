import type { NfeItem, NotaFiscal } from '../types'
import { itemEnderecamentoCompleto } from './paletes'
import { allItemsAllocated } from './repository'

export function contarItensSemEndereco(nf: NotaFiscal): number {
  return nf.items.filter((it) => !itemEnderecamentoCompleto(it)).length
}

export function nfEntradaIncompleta(nf: NotaFiscal | null | undefined): boolean {
  return !!nf && nf.status === 'em_andamento' && !allItemsAllocated(nf)
}

/** Item com algum dado de entrada já preenchido (mesmo sem ter sido salvo). */
export function itemTemDadosEntrada(item: NfeItem): boolean {
  if (item.allocatedAddresses.length > 0) return true
  if (item.paletes != null && item.paletes > 0) return true
  if (item.up?.trim()) return true
  if (item.lote?.trim()) return true
  if (item.dataFabricacao?.trim()) return true
  if (item.dataValidade?.trim()) return true
  return false
}

/** Item ainda sem nenhum dado de entrada preenchido. */
export function itemEntradaEmBranco(item: NfeItem): boolean {
  if (itemEnderecamentoCompleto(item)) return false
  return !itemTemDadosEntrada(item)
}

/** Próximo item a abrir após Salvar: prioriza linhas em branco, pulando as já preenchidas/salvas. */
export function proximoItemEntradaPendente(
  nf: NotaFiscal,
  currentItemIndex: number,
): NfeItem | null {
  const pos = nf.items.findIndex((it) => it.index === currentItemIndex)
  const order =
    pos >= 0
      ? [...nf.items.slice(pos + 1), ...nf.items.slice(0, pos)]
      : [...nf.items]

  const emBranco = order.find((it) => itemEntradaEmBranco(it))
  if (emBranco) return emBranco

  return order.find((it) => !itemEnderecamentoCompleto(it)) ?? null
}
