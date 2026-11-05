import { itemNoStage } from '../layout/stage'
import type { NfeItem, NotaFiscal } from '../types'

export type LocalizacaoBadge = 'Físico' | 'Stage' | 'Físico/Stage'

export function nfTemEstoqueFisico(nf: NotaFiscal): boolean {
  return nf.items.some((it) => !itemNoStage(it) && it.allocatedAddresses.length > 0)
}

export function nfTemEstoqueStage(nf: NotaFiscal): boolean {
  return nf.items.some(itemNoStage)
}

export function badgeLocalizacaoNf(nf: NotaFiscal): LocalizacaoBadge | null {
  const fisico = nfTemEstoqueFisico(nf)
  const stage = nfTemEstoqueStage(nf)
  if (fisico && stage) return 'Físico/Stage'
  if (fisico) return 'Físico'
  if (stage) return 'Stage'
  return null
}

export function labelLocalizacaoItem(item: NfeItem): 'Físico' | 'Stage' {
  return itemNoStage(item) ? 'Stage' : 'Físico'
}

export function suffixLocalizacaoEndereco(item: NfeItem): string {
  return ` · ${labelLocalizacaoItem(item)}`
}
