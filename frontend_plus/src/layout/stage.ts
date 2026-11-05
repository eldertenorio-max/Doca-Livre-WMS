import type { AddressId, LocalizacaoEstoque, NfeItem, NotaFiscal } from '../types'

/** ID virtual da área Stage (célula única no painel). */
export const STAGE_AREA_ID = 'STAGE-AREA' as AddressId

export const STAGE_LABEL = 'Stage · Separação'

export type { LocalizacaoEstoque }

export function isStageAreaId(id: string): boolean {
  return id === STAGE_AREA_ID
}

export function itemNoStage(item: NfeItem): boolean {
  return item.localizacao === 'stage'
}

export function itemNoArmazem(item: NfeItem): boolean {
  return item.localizacao !== 'stage'
}

export function localizacaoItem(item: NfeItem): LocalizacaoEstoque {
  return item.localizacao === 'stage' ? 'stage' : 'armazem'
}

export type StageItemRef = {
  nfId: string
  nfNumero: string
  emitente: string
  itemIndex: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  lote?: string
  up?: string
}

export function listarItensStage(notas: NotaFiscal[]): StageItemRef[] {
  const refs: StageItemRef[] = []
  for (const nf of notas) {
    for (const item of nf.items) {
      if (!itemNoStage(item)) continue
      refs.push({
        nfId: nf.id,
        nfNumero: nf.numero,
        emitente: nf.emitente,
        itemIndex: item.index,
        codigo: item.codigo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        unidade: item.unidade,
        ...(item.lote ? { lote: item.lote } : {}),
        ...(item.up ? { up: item.up } : {}),
      })
    }
  }
  return refs
}

export function contarItensStage(notas: NotaFiscal[]): number {
  return listarItensStage(notas).length
}

export function nfTemItensStage(nf: NotaFiscal): boolean {
  return nf.items.some(itemNoStage)
}

export function nfTemItensArmazem(nf: NotaFiscal): boolean {
  return nf.items.some((it) => itemNoArmazem(it) && it.allocatedAddresses.length > 0)
}
