import type { AddressId, NotaFiscal } from '../types'
import { STAGE_AREA_ID, itemNoStage } from '../layout/stage'
import { contagemPaletesItem } from './paletes'
import { normNumero } from './nfDuplicate'

export type ConsultaOrigemEstoque = 'armazem' | 'stage' | 'ambos'

export type ConsultaEstoqueFiltros = {
  nfNumero: string
  item: string
  remetente: string
  lote: string
  origem: ConsultaOrigemEstoque
}

export type ConsultaEstoqueResultado = {
  addressId: AddressId
  nfId: string
  nfNumero: string
  emitente: string
  itemIndex: number
  codigo: string
  descricao: string
  lote?: string
  up?: string
  /** Item localizado no stage (sem endereço físico). */
  isStage?: boolean
}

export const CONSULTA_FILTROS_VAZIOS: ConsultaEstoqueFiltros = {
  nfNumero: '',
  item: '',
  remetente: '',
  lote: '',
  origem: 'armazem',
}

function norm(value: string): string {
  return value.trim().toLowerCase()
}

function nfNumeroCoincide(nfNumero: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const normNf = normNumero(nfNumero)
  const normQ = normNumero(q)
  return normNf.includes(normQ) || normNf === normQ || nfNumero.toLowerCase().includes(norm(q))
}

export function temFiltroConsulta(filtros: ConsultaEstoqueFiltros): boolean {
  return (
    filtros.nfNumero.trim().length > 0 ||
    filtros.item.trim().length > 0 ||
    filtros.remetente.trim().length > 0 ||
    filtros.lote.trim().length > 0
  )
}

export function buscarEstoque(
  notas: NotaFiscal[],
  filtros: ConsultaEstoqueFiltros,
): ConsultaEstoqueResultado[] {
  const nfQ = norm(filtros.nfNumero)
  const itemQ = norm(filtros.item)
  const remQ = norm(filtros.remetente)
  const loteQ = norm(filtros.lote)
  const origem = filtros.origem ?? 'armazem'

  if (!nfQ && !itemQ && !remQ && !loteQ) return []

  const results: ConsultaEstoqueResultado[] = []

  for (const nf of notas) {
    if (remQ && !nf.emitente.toLowerCase().includes(remQ)) continue
    if (nfQ && !nfNumeroCoincide(nf.numero, filtros.nfNumero)) continue

    for (const item of nf.items) {
      if (itemQ) {
        const codigo = item.codigo.toLowerCase()
        const descricao = item.descricao.toLowerCase()
        if (!codigo.includes(itemQ) && !descricao.includes(itemQ)) continue
      }
      if (loteQ && !(item.lote ?? '').toLowerCase().includes(loteQ)) continue

      const noStage = itemNoStage(item)
      const noArmazem = item.allocatedAddresses.length > 0

      if (noStage && (origem === 'stage' || origem === 'ambos')) {
        results.push({
          addressId: STAGE_AREA_ID,
          nfId: nf.id,
          nfNumero: nf.numero,
          emitente: nf.emitente,
          itemIndex: item.index,
          codigo: item.codigo,
          descricao: item.descricao,
          isStage: true,
          ...(item.lote ? { lote: item.lote } : {}),
          ...(item.up ? { up: item.up } : {}),
        })
      }

      if (noArmazem && (origem === 'armazem' || origem === 'ambos')) {
        for (const addressId of item.allocatedAddresses) {
          results.push({
            addressId,
            nfId: nf.id,
            nfNumero: nf.numero,
            emitente: nf.emitente,
            itemIndex: item.index,
            codigo: item.codigo,
            descricao: item.descricao,
            ...(item.lote ? { lote: item.lote } : {}),
            ...(item.up ? { up: item.up } : {}),
          })
        }
      }
    }
  }

  return results
}

export type EstoqueItemInventario = {
  itemIndex: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  paletes?: number
  lote?: string
  up?: string
  dataFabricacao?: string
  dataValidade?: string
  enderecos: AddressId[]
}

export type EstoqueNfInventario = {
  nfId: string
  nfNumero: string
  serie: string
  emitente: string
  dataEmissao: string
  status: NotaFiscal['status']
  itens: EstoqueItemInventario[]
  totalEnderecos: number
  totalPaletes: number
}

export type EstoqueInventario = {
  notas: EstoqueNfInventario[]
  totalNotas: number
  totalItens: number
  totalEnderecos: number
  totalPaletes: number
}

/** Lista todas as NFs com itens endereçados (estoque armazenado). */
export function inventariarEstoque(notas: NotaFiscal[]): EstoqueInventario {
  const notasArmazenadas: EstoqueNfInventario[] = []
  let totalItens = 0
  let totalEnderecos = 0
  let totalPaletes = 0

  const ordenadas = [...notas].sort((a, b) => {
    const na = Number(a.numero.replace(/\D/g, '') || 0)
    const nb = Number(b.numero.replace(/\D/g, '') || 0)
    if (nb !== na) return nb - na
    return a.numero.localeCompare(b.numero, 'pt-BR')
  })

  for (const nf of ordenadas) {
    const itens: EstoqueItemInventario[] = []
    for (const item of nf.items) {
      if (item.allocatedAddresses.length === 0) continue
      itens.push({
        itemIndex: item.index,
        codigo: item.codigo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        unidade: item.unidade,
        paletes: contagemPaletesItem(item),
        ...(item.lote ? { lote: item.lote } : {}),
        ...(item.up ? { up: item.up } : {}),
        ...(item.dataFabricacao ? { dataFabricacao: item.dataFabricacao } : {}),
        ...(item.dataValidade ? { dataValidade: item.dataValidade } : {}),
        enderecos: [...item.allocatedAddresses],
      })
    }
    if (itens.length === 0) continue

    const nfEnderecos = itens.reduce((s, it) => s + it.enderecos.length, 0)
    const nfPaletes = itens.reduce((s, it) => s + (it.paletes ?? 0), 0)
    totalItens += itens.length
    totalEnderecos += nfEnderecos
    totalPaletes += nfPaletes

    notasArmazenadas.push({
      nfId: nf.id,
      nfNumero: nf.numero,
      serie: nf.serie,
      emitente: nf.emitente,
      dataEmissao: nf.dataEmissao,
      status: nf.status,
      itens,
      totalEnderecos: nfEnderecos,
      totalPaletes: nfPaletes,
    })
  }

  return {
    notas: notasArmazenadas,
    totalNotas: notasArmazenadas.length,
    totalItens,
    totalEnderecos,
    totalPaletes,
  }
}

export function nfInventarioParaResultados(nf: EstoqueNfInventario): ConsultaEstoqueResultado[] {
  const results: ConsultaEstoqueResultado[] = []
  for (const item of nf.itens) {
    for (const addressId of item.enderecos) {
      results.push({
        addressId,
        nfId: nf.nfId,
        nfNumero: nf.nfNumero,
        emitente: nf.emitente,
        itemIndex: item.itemIndex,
        codigo: item.codigo,
        descricao: item.descricao,
        ...(item.lote ? { lote: item.lote } : {}),
        ...(item.up ? { up: item.up } : {}),
      })
    }
  }
  return results
}

export function inventarioParaResultados(inventario: EstoqueInventario): ConsultaEstoqueResultado[] {
  return inventario.notas.flatMap(nfInventarioParaResultados)
}

export function resultadosEstaoDestacados(
  resultados: ConsultaEstoqueResultado[],
  destacados: ConsultaEstoqueResultado[],
): boolean {
  if (resultados.length === 0) return false
  const ids = new Set(destacados.map((r) => r.addressId))
  return resultados.every((r) => ids.has(r.addressId))
}

export function alternarDestaqueConsulta(
  atuais: ConsultaEstoqueResultado[],
  toggle: ConsultaEstoqueResultado[],
): ConsultaEstoqueResultado[] {
  if (resultadosEstaoDestacados(toggle, atuais)) {
    const remove = new Set(toggle.map((r) => r.addressId))
    return atuais.filter((r) => !remove.has(r.addressId))
  }
  const existing = new Set(atuais.map((r) => r.addressId))
  const next = [...atuais]
  for (const r of toggle) {
    if (!existing.has(r.addressId)) next.push(r)
  }
  return next
}
