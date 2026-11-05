import type { AddressId, AppState, NfeItem, NotaFiscal } from '../types'
import { pickItemCampos } from './entradaCampos'
import { upsertMovimentoEntrada } from './movimentos'
import { mensagemNfDuplicada } from './nfDuplicate'

export type ManualNfItemInput = {
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
}

export type ManualNfInput = {
  numero: string
  serie?: string
  emitente?: string
  items: ManualNfItemInput[]
}

export function criarNotaManual(input: ManualNfInput): NotaFiscal {
  const numero = input.numero.trim()
  const items: NfeItem[] = input.items.map((it, index) => ({
    index,
    codigo: it.codigo.trim(),
    descricao: it.descricao.trim(),
    quantidade: it.quantidade,
    unidade: it.unidade.trim() || 'UN',
    allocatedAddresses: [],
    ...pickItemCampos(it),
  }))

  return {
    id: `nf-manual-${numero}-${Date.now()}`,
    numero,
    serie: input.serie?.trim() ?? '',
    chave: '',
    emitente: input.emitente?.trim() || 'Cadastro manual',
    dataEmissao: new Date().toISOString(),
    dataArmazenagem: new Date().toISOString().slice(0, 10),
    items,
    status: 'em_andamento',
    createdAt: new Date().toISOString(),
  }
}

export function validarManualNfInput(input: ManualNfInput): string | null {
  if (!input.numero.trim()) return 'Informe o número da NF.'
  if (input.items.length === 0) return 'Informe ao menos um item.'

  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]
    const label = input.items.length > 1 ? ` (item ${i + 1})` : ''
    if (!item.codigo.trim()) return `Informe o código do item${label}.`
    if (!item.descricao.trim()) return `Informe a descrição do item${label}.`
    if (!(item.quantidade > 0)) return `Informe uma quantidade válida${label}.`
  }

  return null
}

export function alocarEnderecoEmItem(
  data: Pick<AppState, 'notas' | 'movimentos'>,
  addressId: AddressId,
  nfId: string,
  itemIndex: number,
): Pick<AppState, 'notas' | 'movimentos'> {
  const notas = data.notas.map((nf) => ({
    ...nf,
    items: nf.items.map((it) => ({
      ...it,
      allocatedAddresses: it.allocatedAddresses.filter((a) => a !== addressId),
    })),
  }))

  const notasFinal = notas.map((nf) => {
    if (nf.id !== nfId) return nf
    return {
      ...nf,
      items: nf.items.map((it) => {
        if (it.index !== itemIndex) return it
        if (it.allocatedAddresses.includes(addressId)) return it
        return { ...it, allocatedAddresses: [...it.allocatedAddresses, addressId] }
      }),
    }
  })

  const updatedNf = notasFinal.find((n) => n.id === nfId)!
  return {
    notas: notasFinal,
    movimentos: upsertMovimentoEntrada(data.movimentos, updatedNf),
  }
}

export function adicionarNotaManual(
  data: Pick<AppState, 'notas' | 'movimentos' | 'notasCanceladas'>,
  input: ManualNfInput,
): { notas: NotaFiscal[]; movimentos: AppState['movimentos']; nf: NotaFiscal } | { error: string } {
  const validation = validarManualNfInput(input)
  if (validation) return { error: validation }

  const nf = criarNotaManual(input)
  const dup = mensagemNfDuplicada(nf, data.notas, data.notasCanceladas)
  if (dup) return { error: dup }

  return {
    notas: [nf, ...data.notas],
    movimentos: upsertMovimentoEntrada(data.movimentos, nf),
    nf,
  }
}
