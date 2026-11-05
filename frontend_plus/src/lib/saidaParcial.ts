import { enderecosDaNf } from './movimentos'
import { patchNfeItemQuantidade } from './desmembrarItem'
import { isUnidadePeso, pesoKgItem, quantidadeEstoqueItem, unidadeEstoqueItem } from './nfeUnidades'
import type { AddressId, MovimentoItemSnapshot, NfeItem, NotaFiscal } from '../types'

export type SaidaLimitesPorItem = Record<number, number>

export function quantidadeBaseSaida(item: NfeItem, limites?: SaidaLimitesPorItem): number {
  const qtd = quantidadeEstoqueItem(item)
  const lim = limites?.[item.index]
  if (lim == null) return qtd
  return Math.min(qtd, lim)
}

export type SaidaItemDraft = {
  itemIndex: number
  quantidadeSaida: number
}

export type SaidaPaleteDraft = {
  addressId: AddressId
  itemIndex: number
  quantidadeCaixas: number
}

export type SaidaPaleteCalculo = {
  addressId: AddressId
  itemIndex: number
  quantidadeCaixas: number
  quantidadeEstoque: number
  quantidadeSobra: number
  unidade: string
  pesoBrutoSaida?: number
  pesoLiquidoSaida?: number
  valorTotalSaida?: number
  liberaPalete: boolean
}

function ratio(qtd: number, total: number): number {
  if (total <= 0) return 0
  return qtd / total
}

/** Paletes ainda não confirmados na saída em andamento. */
export function paletesDisponiveisNf(
  nf: NotaFiscal,
  confirmados: SaidaPaleteDraft[],
): number {
  const confirmadosSet = new Set(confirmados.map((p) => p.addressId))
  return enderecosDaNf(nf).filter((a) => !confirmadosSet.has(a)).length
}

export function paletesDisponiveisItem(
  item: NfeItem,
  confirmados: SaidaPaleteDraft[],
): number {
  const confirmadosSet = new Set(confirmados.map((p) => p.addressId))
  return item.allocatedAddresses.filter((a) => !confirmadosSet.has(a)).length
}

export function sobraItem(
  item: NfeItem,
  confirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): number {
  const qtd = quantidadeBaseSaida(item, limites)
  const saido = confirmados
    .filter((p) => p.itemIndex === item.index)
    .reduce((s, p) => s + p.quantidadeCaixas, 0)
  return Math.max(0, qtd - saido)
}

export function parseQuantidadeSaida(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const n = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** Caixas atribuídas a cada palete do item (média estimada — só referência visual). */
export function caixasPorPalete(item: NfeItem): number {
  const qtd = quantidadeEstoqueItem(item)
  const n = item.allocatedAddresses.length
  if (n <= 0) return qtd
  return qtd / n
}

/** Rateia caixas entre N posições selecionadas (última leva o arredondamento). */
export function distribuirCaixasSaidaEntrePaletes(totalCaixas: number, numPaletes: number): number[] {
  const n = Math.floor(numPaletes)
  if (n <= 0 || totalCaixas <= 0) return Array(Math.max(0, n)).fill(0)
  const base = Math.floor(totalCaixas / n)
  const amounts = Array<number>(n).fill(base)
  amounts[n - 1] = totalCaixas - base * (n - 1)
  return amounts
}

function quantidadeTotalItens(items: NfeItem[]): number {
  return items.reduce((s, it) => s + it.quantidade, 0)
}

/** Peso bruto total do item — usa peso da linha (kg) quando disponível. */
export function pesoBrutoTotalItem(nf: NotaFiscal, item: NfeItem): number | undefined {
  if (item.pesoBruto != null) return item.pesoBruto

  const pesoKg = pesoKgItem(item)
  if (pesoKg != null) return pesoKg

  const pesoItens = nf.items.map((it) => pesoKgItem(it)).filter((p): p is number => p != null)
  const qtdTotal = pesoItens.reduce((s, p) => s + p, 0)
  const itemPeso = pesoKgItem(item)
  if (nf.pesoBruto != null && qtdTotal > 0 && itemPeso != null) {
    return nf.pesoBruto * (itemPeso / qtdTotal)
  }

  return undefined
}

/** Peso líquido total do item — proporcional ao peso bruto ou valor na NF. */
export function pesoLiquidoTotalItem(nf: NotaFiscal, item: NfeItem): number | undefined {
  if (item.pesoLiquido != null) return item.pesoLiquido

  const pesoBruto = pesoBrutoTotalItem(nf, item)
  if (nf.pesoLiquido != null && pesoBruto != null && nf.pesoBruto != null && nf.pesoBruto > 0) {
    return nf.pesoLiquido * (pesoBruto / nf.pesoBruto)
  }

  if (isUnidadePeso(item.unidade) && item.quantidade > 0) {
    return item.quantidade
  }

  if (nf.pesoLiquido != null && item.valorTotal != null && item.valorTotal > 0) {
    const valorItens = nf.items.reduce((s, it) => s + (it.valorTotal ?? 0), 0)
    if (valorItens > 0) {
      return nf.pesoLiquido * (item.valorTotal / valorItens)
    }
  }

  const qtdTotal = quantidadeTotalItens(nf.items)
  if (nf.pesoLiquido != null && qtdTotal > 0 && nf.items.every((it) => it.unidade === item.unidade)) {
    return nf.pesoLiquido * (item.quantidade / qtdTotal)
  }

  return undefined
}

/** @deprecated Use pesoLiquidoTotalItem */
export function pesoLiquidoItem(nf: NotaFiscal, item: NfeItem): number | undefined {
  return pesoLiquidoTotalItem(nf, item)
}

export function caixasJaSaidasItem(
  itemIndex: number,
  paletes: SaidaPaleteDraft[],
  excetoAddressId?: AddressId,
): number {
  return paletes
    .filter((p) => p.itemIndex === itemIndex && p.addressId !== excetoAddressId)
    .reduce((s, p) => s + p.quantidadeCaixas, 0)
}

export function itemSaidaPendente(
  item: NfeItem,
  confirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): boolean {
  if (item.allocatedAddresses.length === 0) return false
  const sobra = sobraItem(item, confirmados, limites)
  if (sobra > 1e-9) return true
  return sobra <= 1e-9 && paletesDisponiveisItem(item, confirmados) > 0
}

/** Próximo item da saída (ex.: devolução) ainda pendente após confirmar o item atual. */
export function proximoItemSaidaPendente(
  itensOrdem: NfeItem[],
  currentItemIndex: number,
  confirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): NfeItem | null {
  const pos = itensOrdem.findIndex((it) => it.index === currentItemIndex)
  const order =
    pos >= 0
      ? [...itensOrdem.slice(pos + 1), ...itensOrdem.slice(0, pos)]
      : [...itensOrdem]

  return order.find((it) => itemSaidaPendente(it, confirmados, limites)) ?? null
}

export function calcularSaidaPalete(
  nf: NotaFiscal,
  item: NfeItem,
  addressId: AddressId,
  quantidadeCaixas: number,
  paletesConfirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): SaidaPaleteCalculo | null {
  if (!item.allocatedAddresses.includes(addressId)) return null
  if (quantidadeCaixas < 0) return null

  const qtdItem = quantidadeBaseSaida(item, limites)
  const jaSaido = caixasJaSaidasItem(item.index, paletesConfirmados)
  const disponivel = qtdItem - jaSaido
  // Item sem saldo mas que ainda ocupa posição: permite liberar a posição (0 caixas).
  const soLiberarPosicao = disponivel <= 1e-9
  if (quantidadeCaixas <= 0 && !soLiberarPosicao) return null
  if (quantidadeCaixas > disponivel + 1e-9) return null

  const quantidadeSobra = Math.max(0, qtdItem - jaSaido - quantidadeCaixas)
  // Peso e valor totais correspondem ao estoque completo do item; ratear pela
  // quantidade completa (não pelo limite do XML) para não superestimar o peso.
  const r = ratio(quantidadeCaixas, quantidadeEstoqueItem(item))
  const pesoBrutoTotal = pesoBrutoTotalItem(nf, item)
  const pesoLiquidoTotal = pesoLiquidoTotalItem(nf, item)
  const capPalete = caixasPorPalete(item)
  const liberaPalete =
    soLiberarPosicao ||
    quantidadeSobra <= 1e-9 ||
    quantidadeCaixas >= capPalete - 1e-6

  return {
    addressId,
    itemIndex: item.index,
    quantidadeCaixas,
    quantidadeEstoque: qtdItem,
    quantidadeSobra,
    unidade: unidadeEstoqueItem(item),
    ...(pesoBrutoTotal != null ? { pesoBrutoSaida: pesoBrutoTotal * r } : {}),
    ...(pesoLiquidoTotal != null ? { pesoLiquidoSaida: pesoLiquidoTotal * r } : {}),
    ...(item.valorTotal != null
      ? { valorTotalSaida: item.valorTotal * r }
      : item.valorUnitario != null
        ? { valorTotalSaida: item.valorUnitario * quantidadeCaixas }
        : {}),
    liberaPalete,
  }
}

export type SaidaStageCalculo = {
  quantidadeSaida: number
  quantidadeSobra: number
  unidade: string
  pesoBrutoSaida?: number
  pesoLiquidoSaida?: number
  valorTotalSaida?: number
}

/** Calcula peso/valor proporcionais para saída de um item que está no stage. */
export function calcularSaidaStageItem(
  nf: NotaFiscal,
  item: NfeItem,
  quantidadeSaida: number,
): SaidaStageCalculo | null {
  if (quantidadeSaida <= 0) return null
  const qtdItem = quantidadeEstoqueItem(item)
  if (quantidadeSaida > qtdItem + 1e-9) return null

  const r = ratio(quantidadeSaida, qtdItem)
  const pesoBrutoTotal = pesoBrutoTotalItem(nf, item)
  const pesoLiquidoTotal = pesoLiquidoTotalItem(nf, item)

  return {
    quantidadeSaida,
    quantidadeSobra: Math.max(0, qtdItem - quantidadeSaida),
    unidade: unidadeEstoqueItem(item),
    ...(pesoBrutoTotal != null ? { pesoBrutoSaida: pesoBrutoTotal * r } : {}),
    ...(pesoLiquidoTotal != null ? { pesoLiquidoSaida: pesoLiquidoTotal * r } : {}),
    ...(item.valorTotal != null
      ? { valorTotalSaida: item.valorTotal * r }
      : item.valorUnitario != null
        ? { valorTotalSaida: item.valorUnitario * quantidadeSaida }
        : {}),
  }
}

export type TotaisSaidaItem = {
  caixas: number
  pesoBruto: number
  pesoLiquido: number
  valor: number
  sobra: number
}

export type SaidaResumoPalete = {
  addressId: AddressId
  quantidadeCaixas: number
  pesoBruto?: number
  pesoLiquido?: number
  valor?: number
}

export type SaidaResumoItem = {
  itemIndex: number
  codigo: string
  descricao: string
  unidade: string
  paletes: SaidaResumoPalete[]
  caixas: number
  pesoBruto: number
  pesoLiquido: number
  valor: number
}

export type ResumoSaidaNf = {
  itens: SaidaResumoItem[]
  totalPaletes: number
  totalCaixas: number
  pesoBruto: number
  pesoLiquido: number
  valor: number
}

export function totaisSaidaItem(
  nf: NotaFiscal,
  item: NfeItem,
  paletesConfirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): TotaisSaidaItem {
  const drafts = paletesConfirmados.filter((p) => p.itemIndex === item.index)
  let caixas = 0
  let pesoBruto = 0
  let pesoLiquido = 0
  let valor = 0
  for (const p of drafts) {
    const c = calcularSaidaPalete(nf, item, p.addressId, p.quantidadeCaixas, [], limites)
    if (!c) continue
    caixas += p.quantidadeCaixas
    pesoBruto += c.pesoBrutoSaida ?? 0
    pesoLiquido += c.pesoLiquidoSaida ?? 0
    valor += c.valorTotalSaida ?? 0
  }
  return {
    caixas,
    pesoBruto,
    pesoLiquido,
    valor,
    sobra: sobraItem(item, paletesConfirmados, limites),
  }
}

export function resumoSaidaNf(
  nf: NotaFiscal,
  paletesConfirmados: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): ResumoSaidaNf {
  const byItem = new Map<number, SaidaPaleteDraft[]>()
  for (const p of paletesConfirmados) {
    const list = byItem.get(p.itemIndex) ?? []
    list.push(p)
    byItem.set(p.itemIndex, list)
  }

  const itens: SaidaResumoItem[] = []
  let totalPaletes = 0
  let totalCaixas = 0
  let pesoBruto = 0
  let pesoLiquido = 0
  let valor = 0

  for (const [itemIndex, drafts] of byItem) {
    const item = nf.items.find((it) => it.index === itemIndex)
    if (!item) continue

    const paletes: SaidaResumoPalete[] = drafts.map((p) => {
      const c = calcularSaidaPalete(nf, item, p.addressId, p.quantidadeCaixas, [], limites)
      return {
        addressId: p.addressId,
        quantidadeCaixas: p.quantidadeCaixas,
        ...(c?.pesoBrutoSaida != null ? { pesoBruto: c.pesoBrutoSaida } : {}),
        ...(c?.pesoLiquidoSaida != null ? { pesoLiquido: c.pesoLiquidoSaida } : {}),
        ...(c?.valorTotalSaida != null ? { valor: c.valorTotalSaida } : {}),
      }
    })

    const t = totaisSaidaItem(nf, item, paletesConfirmados, limites)
    itens.push({
      itemIndex,
      codigo: item.codigo,
      descricao: item.descricao,
      unidade: unidadeEstoqueItem(item),
      paletes,
      caixas: t.caixas,
      pesoBruto: t.pesoBruto,
      pesoLiquido: t.pesoLiquido,
      valor: t.valor,
    })
    totalPaletes += drafts.length
    totalCaixas += t.caixas
    pesoBruto += t.pesoBruto
    pesoLiquido += t.pesoLiquido
    valor += t.valor
  }

  itens.sort((a, b) => a.itemIndex - b.itemIndex)

  return {
    itens,
    totalPaletes,
    totalCaixas,
    pesoBruto,
    pesoLiquido,
    valor,
  }
}

export function consolidarDraftsPorItem(paletes: SaidaPaleteDraft[]): SaidaItemDraft[] {
  const map = new Map<number, number>()
  for (const p of paletes) {
    map.set(p.itemIndex, (map.get(p.itemIndex) ?? 0) + p.quantidadeCaixas)
  }
  return [...map.entries()].map(([itemIndex, quantidadeSaida]) => ({
    itemIndex,
    quantidadeSaida,
  }))
}

export function enderecosALiberar(
  nf: NotaFiscal,
  paletes: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): AddressId[] {
  const liberar = new Set<AddressId>()
  const anteriores: SaidaPaleteDraft[] = []

  for (const p of paletes) {
    const item = nf.items.find((it) => it.index === p.itemIndex)
    if (!item || !item.allocatedAddresses.includes(p.addressId)) continue

    const calc = calcularSaidaPalete(
      nf,
      item,
      p.addressId,
      p.quantidadeCaixas,
      anteriores,
      limites,
    )
    if (!calc) continue
    anteriores.push(p)

    if (calc.liberaPalete) liberar.add(p.addressId)
  }
  return [...liberar]
}

export function sobrasPorItem(
  items: NfeItem[],
  paletes: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): Record<number, number> {
  const saido = new Map<number, number>()
  for (const p of paletes) {
    saido.set(p.itemIndex, (saido.get(p.itemIndex) ?? 0) + p.quantidadeCaixas)
  }
  const sobras: Record<number, number> = {}
  for (const item of items) {
    const qtd = quantidadeBaseSaida(item, limites)
    sobras[item.index] = Math.max(0, qtd - (saido.get(item.index) ?? 0))
  }
  return sobras
}

export function aplicarSaidaPaletes(
  nf: NotaFiscal,
  paletes: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): NotaFiscal {
  const itemDrafts = consolidarDraftsPorItem(paletes)
  const liberar = new Set(enderecosALiberar(nf, paletes, limites))
  return aplicarSaidaParcial(nf, itemDrafts, [...liberar])
}

export function aplicarSaidaParcial(
  nf: NotaFiscal,
  saidas: SaidaItemDraft[],
  addressIds: AddressId[],
): NotaFiscal {
  const saidaMap = new Map(saidas.map((s) => [s.itemIndex, s.quantidadeSaida]))
  const pickAddr = new Set(addressIds)

  const items = nf.items
    .map((it) => {
      const qSaida = saidaMap.get(it.index) ?? 0
      const addresses = it.allocatedAddresses.filter((a) => !pickAddr.has(a))
      const hadPick = it.allocatedAddresses.some((a) => pickAddr.has(a))

      if (qSaida <= 0 && !hadPick) return it
      if (qSaida <= 0 && hadPick) {
        // Liberação de posições sem retirada de mercadoria (item esgotado).
        if (addresses.length === 0 && it.quantidade <= 0) return null
        return { ...it, allocatedAddresses: addresses }
      }

      const qtdItem = quantidadeEstoqueItem(it)
      const sobraQtd = qtdItem - qSaida

      if (sobraQtd <= 0) {
        return {
          ...it,
          quantidade: 0,
          allocatedAddresses: addresses,
          ...(it.valorTotal != null ? { valorTotal: 0 } : {}),
          ...(it.pesoBruto != null ? { pesoBruto: 0 } : {}),
          ...(it.pesoLiquido != null ? { pesoLiquido: 0 } : {}),
        }
      }

      return patchNfeItemQuantidade({ ...it, allocatedAddresses: addresses }, sobraQtd)
    })
    .filter((it): it is NfeItem => it != null && (it.quantidade > 0 || it.allocatedAddresses.length > 0))

  return { ...nf, items }
}

export function snapshotSaidaPaletes(
  nf: NotaFiscal,
  paletes: SaidaPaleteDraft[],
  limites?: SaidaLimitesPorItem,
): MovimentoItemSnapshot[] {
  const liberar = new Set(enderecosALiberar(nf, paletes, limites))
  const snapshots: MovimentoItemSnapshot[] = []
  const anteriores: SaidaPaleteDraft[] = []

  for (const p of paletes) {
    const item = nf.items.find((it) => it.index === p.itemIndex)
    if (!item) continue
    const calc = calcularSaidaPalete(nf, item, p.addressId, p.quantidadeCaixas, anteriores, limites)
    if (!calc) continue
    anteriores.push(p)

    snapshots.push({
      itemIndex: item.index,
      codigo: item.codigo,
      descricao: item.descricao,
      quantidade: p.quantidadeCaixas,
      unidade: unidadeEstoqueItem(item),
      addressIds: [p.addressId],
      paletes: liberar.has(p.addressId) || calc.liberaPalete ? 1 : 0,
      quantidadeSaida: p.quantidadeCaixas,
      quantidadeSobra: calc.quantidadeSobra,
      ...(calc.pesoBrutoSaida != null ? { pesoBruto: calc.pesoBrutoSaida } : {}),
      ...(calc.pesoLiquidoSaida != null ? { pesoLiquido: calc.pesoLiquidoSaida } : {}),
      ...(calc.valorTotalSaida != null ? { valorTotal: calc.valorTotalSaida } : {}),
      ...(item.up ? { up: item.up } : {}),
      ...(item.lote ? { lote: item.lote } : {}),
      ...(item.dataFabricacao ? { dataFabricacao: item.dataFabricacao } : {}),
      ...(item.dataValidade ? { dataValidade: item.dataValidade } : {}),
    })
  }

  return snapshots
}

export function snapshotSaidaItens(
  nf: NotaFiscal,
  saidas: SaidaItemDraft[],
  addressIds: AddressId[],
): MovimentoItemSnapshot[] {
  const pick = new Set(addressIds)
  const saidaMap = new Map(saidas.map((s) => [s.itemIndex, s.quantidadeSaida]))
  const snapshots: MovimentoItemSnapshot[] = []

  for (const it of nf.items) {
    const qSaida = saidaMap.get(it.index) ?? 0
    if (qSaida <= 0) continue
    const ids = it.allocatedAddresses.filter((a) => pick.has(a))
    snapshots.push({
      itemIndex: it.index,
      codigo: it.codigo,
      descricao: it.descricao,
      quantidade: qSaida,
      unidade: it.unidade,
      addressIds: ids,
      paletes: ids.length,
      quantidadeSaida: qSaida,
      quantidadeSobra: it.quantidade - qSaida,
      ...(it.up ? { up: it.up } : {}),
      ...(it.lote ? { lote: it.lote } : {}),
      ...(it.dataFabricacao ? { dataFabricacao: it.dataFabricacao } : {}),
      ...(it.dataValidade ? { dataValidade: it.dataValidade } : {}),
    })
  }

  return snapshots
}
