import type { NotaFiscal } from '../types'
import { buscarEstoque, CONSULTA_FILTROS_VAZIOS, type ConsultaEstoqueFiltros } from './consultaEstoque'

export type WmsVoiceSnapshot = {
  notasAtivas: number
  emAndamento: number
  concluidas: number
  emitentes: string[]
  amostra: string[]
}

export function buildWmsVoiceSnapshot(notas: NotaFiscal[]): WmsVoiceSnapshot {
  const emitentes = [...new Set(notas.map((n) => n.emitente).filter(Boolean))].slice(0, 20)
  const amostra: string[] = []
  for (const nf of notas.slice(0, 25)) {
    const itens = nf.items
      .slice(0, 3)
      .map((i) => i.descricao || i.codigo)
      .filter(Boolean)
      .join(', ')
    amostra.push(`NF ${nf.numero} · ${nf.emitente} · ${nf.status}${itens ? ` · ${itens}` : ''}`)
  }
  return {
    notasAtivas: notas.length,
    emAndamento: notas.filter((n) => n.status === 'em_andamento').length,
    concluidas: notas.filter((n) => n.status === 'concluida').length,
    emitentes,
    amostra,
  }
}

export function queryEstoqueSnapshot(
  notas: NotaFiscal[],
  filtros: Partial<ConsultaEstoqueFiltros>,
): { count: number; linhas: string[] } {
  const full: ConsultaEstoqueFiltros = {
    ...CONSULTA_FILTROS_VAZIOS,
    ...filtros,
    origem: filtros.origem ?? 'ambos',
  }
  const rows = buscarEstoque(notas, full).slice(0, 12)
  return {
    count: rows.length,
    linhas: rows.map((r) => {
      const where = r.isStage ? 'stage' : r.addressId
      return `${r.nfNumero} · ${r.codigo} ${r.descricao} · ${where} · ${r.emitente}`
    }),
  }
}
