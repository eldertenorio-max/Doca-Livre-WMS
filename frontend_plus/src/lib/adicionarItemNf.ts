import { pickItemCampos } from './entradaCampos'
import type { NfeItem, NotaFiscal } from '../types'

export type ItemManualInput = {
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  paletes: number
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
}

export function validarItemManualInput(input: ItemManualInput): string | null {
  if (!input.codigo.trim()) return 'Informe o código do item.'
  if (!input.descricao.trim()) return 'Informe a descrição do item.'
  if (!(input.quantidade > 0)) return 'Informe uma quantidade válida.'
  if (!(input.paletes > 0)) return 'Informe a quantidade de paletes.'
  return null
}

/** Duplica um item da NF para nova linha (lote/data), reabrindo entrada se concluída. */
export function replicarItemNotaFiscal(
  nf: NotaFiscal,
  sourceItemIndex: number,
  paletes: number,
): { nota: NotaFiscal; newItemIndex: number } | null {
  if (!(paletes > 0)) return null
  const pos = nf.items.findIndex((it) => it.index === sourceItemIndex)
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
    paletes,
    ...(source.valorUnitario != null ? { valorUnitario: source.valorUnitario, valorTotal: 0 } : {}),
  }

  const items = [...nf.items]
  items.splice(pos + 1, 0, newItem)

  return {
    nota: {
      ...nf,
      status: 'em_andamento',
      items,
    },
    newItemIndex: newItem.index,
  }
}

/** Inclui item novo preenchido manualmente na NF, reabrindo entrada se concluída. */
export function adicionarItemManualNotaFiscal(
  nf: NotaFiscal,
  input: ItemManualInput,
): { nota: NotaFiscal; newItemIndex: number } | null {
  const erro = validarItemManualInput(input)
  if (erro) return null

  const maxIndex = nf.items.reduce((max, it) => Math.max(max, it.index), -1)
  const newItem: NfeItem = {
    index: maxIndex + 1,
    codigo: input.codigo.trim(),
    descricao: input.descricao.trim(),
    quantidade: input.quantidade,
    unidade: input.unidade.trim() || 'UN',
    allocatedAddresses: [],
    paletes: input.paletes,
    ...pickItemCampos(input),
  }

  return {
    nota: {
      ...nf,
      status: 'em_andamento',
      items: [...nf.items, newItem],
    },
    newItemIndex: newItem.index,
  }
}
