import { formatAddressLabel, parseAddressId } from '../layout/camaras'
import { itemNoStage } from '../layout/stage'
import type { AddressId, MovimentoRegistro, NfeItem, NotaFiscal } from '../types'
import { calcularResumoEstoqueArmazem, type ResumoCamaraEstoque } from './painelEstoqueArmazem'

export type LinhaInventarioCamara = {
  addressId: AddressId
  endereco: string
  nfId: string
  nfNumero: string
  nfSerie: string
  nfEmitente: string
  nfDataEmissao: string
  nfValorTotal?: number
  nfPesoBruto?: number
  itemIndex: number
  codigo: string
  descricao: string
  quantidade: number
  quantidadeNaPosicao: number
  unidade: string
  valorUnitario?: number
  valorTotal?: number
  valorNaPosicao?: number
  pesoBruto?: number
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
  dataArmazenagem: string | null
  paletesItem?: number
}

export type NotaInventarioCamara = {
  nfId: string
  numero: string
  serie: string
  emitente: string
  dataEmissao: string
  valorTotal?: number
  pesoBruto?: number
  status: NotaFiscal['status']
  linhas: LinhaInventarioCamara[]
}

export type InventarioCamaraDetalhado = {
  camaraId: number
  tipo: string
  resumo: ResumoCamaraEstoque
  linhas: LinhaInventarioCamara[]
  notas: NotaInventarioCamara[]
}

function dataArmazenagemEndereco(
  movimentos: MovimentoRegistro[],
  nfId: string,
  addressId: AddressId,
): string | null {
  const relevant = movimentos
    .filter(
      (m) =>
        !m.excluido &&
        m.nfId === nfId &&
        (m.tipo === 'entrada' || m.tipo === 'movimentacao'),
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  for (const mov of relevant) {
    for (const snap of mov.itens) {
      if (snap.addressIds.includes(addressId)) return mov.createdAt
    }
  }

  const entrada = relevant.find((m) => m.tipo === 'entrada')
  return entrada?.createdAt ?? null
}

function quantidadePorPosicao(item: NfeItem): number {
  const n = item.allocatedAddresses.length
  if (n <= 0) return item.quantidade
  return item.quantidade / n
}

function valorPorPosicao(item: NfeItem): number | undefined {
  if (item.valorTotal == null || item.valorTotal <= 0) return undefined
  const n = item.allocatedAddresses.length
  if (n <= 0) return item.valorTotal
  return item.valorTotal / n
}

function linhaFromEndereco(
  nf: NotaFiscal,
  item: NfeItem,
  addressId: AddressId,
  movimentos: MovimentoRegistro[],
): LinhaInventarioCamara | null {
  const parsed = parseAddressId(addressId)
  if (!parsed) return null

  const qtdPos = quantidadePorPosicao(item)
  const valPos = valorPorPosicao(item)

  return {
    addressId,
    endereco: formatAddressLabel(addressId),
    nfId: nf.id,
    nfNumero: nf.numero,
    nfSerie: nf.serie,
    nfEmitente: nf.emitente,
    nfDataEmissao: nf.dataEmissao,
    nfValorTotal: nf.valorTotalNota,
    nfPesoBruto: nf.pesoBruto,
    itemIndex: item.index,
    codigo: item.codigo,
    descricao: item.descricao,
    quantidade: item.quantidade,
    quantidadeNaPosicao: qtdPos,
    unidade: item.unidade,
    valorUnitario: item.valorUnitario,
    valorTotal: item.valorTotal,
    valorNaPosicao: valPos,
    pesoBruto: item.pesoBruto,
    up: item.up,
    lote: item.lote,
    dataFabricacao: item.dataFabricacao,
    dataValidade: item.dataValidade,
    dataArmazenagem:
      dataArmazenagemEndereco(movimentos, nf.id, addressId) ?? nf.createdAt ?? null,
    paletesItem: item.paletes,
  }
}

export function coletarInventarioCamara(
  camaraId: number,
  tipo: string,
  notas: NotaFiscal[],
  movimentos: MovimentoRegistro[],
): InventarioCamaraDetalhado {
  const resumo =
    calcularResumoEstoqueArmazem(notas).camaras.find((c) => c.camaraId === camaraId) ?? {
      camaraId,
      label: `Cam. ${camaraId}`,
      posicoesTotal: 0,
      posicoesOcupadas: 0,
      posicoesLivres: 0,
      valorArmazenado: 0,
      valorPaletes: 0,
      ocupacaoPct: 0,
      qtdItens: 0,
      qtdNotas: 0,
    }

  const linhas: LinhaInventarioCamara[] = []

  for (const nf of notas) {
    for (const item of nf.items) {
      if (itemNoStage(item)) continue
      for (const addressId of item.allocatedAddresses) {
        const parsed = parseAddressId(addressId)
        if (!parsed || parsed.camara !== camaraId) continue
        const linha = linhaFromEndereco(nf, item, addressId, movimentos)
        if (linha) linhas.push(linha)
      }
    }
  }

  linhas.sort((a, b) => {
    const nfCmp = a.nfNumero.localeCompare(b.nfNumero, 'pt-BR', { numeric: true })
    if (nfCmp !== 0) return nfCmp
    const addrCmp = a.endereco.localeCompare(b.endereco, 'pt-BR', { numeric: true })
    if (addrCmp !== 0) return addrCmp
    return a.codigo.localeCompare(b.codigo, 'pt-BR')
  })

  const notasMap = new Map<string, NotaInventarioCamara>()
  for (const linha of linhas) {
    let grupo = notasMap.get(linha.nfId)
    if (!grupo) {
      const nf = notas.find((n) => n.id === linha.nfId)
      grupo = {
        nfId: linha.nfId,
        numero: linha.nfNumero,
        serie: linha.nfSerie,
        emitente: linha.nfEmitente,
        dataEmissao: linha.nfDataEmissao,
        valorTotal: linha.nfValorTotal,
        pesoBruto: linha.nfPesoBruto,
        status: nf?.status ?? 'concluida',
        linhas: [],
      }
      notasMap.set(linha.nfId, grupo)
    }
    grupo.linhas.push(linha)
  }

  const notasAgrupadas = [...notasMap.values()].sort((a, b) =>
    a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }),
  )

  return {
    camaraId,
    tipo,
    resumo,
    linhas,
    notas: notasAgrupadas,
  }
}
