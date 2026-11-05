import type { NfeItem, NotaFiscal } from '../types'

export function canDesmembrarNfeItem(item: NfeItem): boolean {
  return item.allocatedAddresses.length === 0
}

export function patchNfeItemQuantidade(item: NfeItem, rawQty: string | number): NfeItem {
  const novaQuantidade =
    typeof rawQty === 'string' ? Number(String(rawQty).replace(',', '.')) : rawQty
  if (!Number.isFinite(novaQuantidade) || novaQuantidade < 0) return item

  const prevQty = item.quantidade
  const ratio = prevQty > 0 ? novaQuantidade / prevQty : 1

  return {
    ...item,
    quantidade: novaQuantidade,
    ...(item.pesoBruto != null ? { pesoBruto: item.pesoBruto * ratio } : {}),
    ...(item.pesoLiquido != null ? { pesoLiquido: item.pesoLiquido * ratio } : {}),
    ...(item.valorUnitario != null
      ? { valorTotal: item.valorUnitario * novaQuantidade }
      : item.valorTotal != null && prevQty > 0
        ? { valorTotal: (item.valorTotal / prevQty) * novaQuantidade }
        : {}),
  }
}

export function desmembrarNfeItem(
  nf: NotaFiscal,
  itemIndex: number,
): { items: NfeItem[]; newItemIndex: number } | null {
  const pos = nf.items.findIndex((it) => it.index === itemIndex)
  if (pos < 0) return null

  const source = nf.items[pos]
  const maxIndex = nf.items.reduce((max, it) => Math.max(max, it.index), -1)

  const newItem: NfeItem = {
    index: maxIndex + 1,
    codigo: source.codigo,
    descricao: source.descricao,
    quantidade: 0,
    unidade: source.unidade,
    allocatedAddresses: [],
    ...(source.valorUnitario != null ? { valorUnitario: source.valorUnitario, valorTotal: 0 } : {}),
  }

  const items = [...nf.items]
  items.splice(pos + 1, 0, newItem)
  return { items, newItemIndex: newItem.index }
}
