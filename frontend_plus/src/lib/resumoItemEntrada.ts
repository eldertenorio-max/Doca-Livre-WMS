import { quantidadeEstoqueItem, unidadeEstoqueItem } from './nfeUnidades'
import {
  caixasJaSaidasItem,
  pesoBrutoTotalItem,
  pesoLiquidoTotalItem,
  quantidadeBaseSaida,
  type SaidaItemDraft,
  type SaidaLimitesPorItem,
  type SaidaPaleteDraft,
} from './saidaParcial'
import type { NfeItem, NotaFiscal } from '../types'

export type ResumoItemEntradaSaida = {
  nfNumero: string
  dataArmazenagem?: string
  codigo: string
  descricao: string
  unidade: string
  quantidadeEstoque: number
  quantidadeDisponivel: number
  quantidadeConfirmada: number
  limiteXml?: number
  pesoBruto?: number
  pesoLiquido?: number
  valorTotal?: number
  paletes: number
  noStage: boolean
  lote?: string
  up?: string
  dataValidade?: string
  dataFabricacao?: string
}

export function buildResumoItemEntradaSaida(
  nf: NotaFiscal,
  item: NfeItem,
  opts?: {
    limitesPorItem?: SaidaLimitesPorItem
    paletesConfirmados?: SaidaPaleteDraft[]
    stageConfirmados?: SaidaItemDraft[]
  },
): ResumoItemEntradaSaida {
  const unidade = unidadeEstoqueItem(item)
  const quantidadeEstoque = quantidadeEstoqueItem(item)
  const limiteXml = opts?.limitesPorItem?.[item.index]
  const quantidadeBase = quantidadeBaseSaida(item, opts?.limitesPorItem)

  const confirmadaPaletes = caixasJaSaidasItem(item.index, opts?.paletesConfirmados ?? [])
  const confirmadaStage =
    opts?.stageConfirmados?.find((s) => s.itemIndex === item.index)?.quantidadeSaida ?? 0
  const quantidadeConfirmada = confirmadaPaletes + confirmadaStage
  const quantidadeDisponivel = Math.max(0, quantidadeBase - quantidadeConfirmada)

  return {
    nfNumero: nf.numero,
    ...(nf.dataArmazenagem ? { dataArmazenagem: nf.dataArmazenagem } : {}),
    codigo: item.codigo,
    descricao: item.descricao,
    unidade,
    quantidadeEstoque,
    quantidadeDisponivel,
    quantidadeConfirmada,
    ...(limiteXml != null && limiteXml < quantidadeEstoque - 1e-9 ? { limiteXml } : {}),
    pesoBruto: pesoBrutoTotalItem(nf, item),
    pesoLiquido: pesoLiquidoTotalItem(nf, item),
    ...(item.valorTotal != null && item.valorTotal > 0 ? { valorTotal: item.valorTotal } : {}),
    paletes: item.allocatedAddresses.length,
    noStage: item.allocatedAddresses.length === 0,
    ...(item.lote ? { lote: item.lote } : {}),
    ...(item.up ? { up: item.up } : {}),
    ...(item.dataValidade ? { dataValidade: item.dataValidade } : {}),
    ...(item.dataFabricacao ? { dataFabricacao: item.dataFabricacao } : {}),
  }
}
