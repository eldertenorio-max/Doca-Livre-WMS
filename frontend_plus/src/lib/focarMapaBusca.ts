import { itemNoStage, STAGE_AREA_ID } from '../layout/stage'
import type { AddressId, NotaFiscal } from '../types'
import { enderecosDaNf } from './movimentos'
import type { ConsultaEstoqueResultado } from './consultaEstoque'

export type MapFocusTarget =
  | { type: 'address'; addressId: AddressId }
  | { type: 'stage' }

export type BuscaEncontradaAviso = {
  titulo: string
  detalhe: string
}

export function primeiroEnderecoConsulta(
  resultados: ConsultaEstoqueResultado[],
): MapFocusTarget | null {
  const fisico = resultados.find((r) => !r.isStage)
  if (fisico) return { type: 'address', addressId: fisico.addressId }
  if (resultados.some((r) => r.isStage)) return { type: 'stage' }
  return null
}

export function primeiroEnderecoNf(nf: NotaFiscal): MapFocusTarget | null {
  const addrs = enderecosDaNf(nf)
  if (addrs.length > 0) return { type: 'address', addressId: addrs[0] }
  if (nf.items.some((it) => itemNoStage(it))) return { type: 'stage' }
  return null
}

export function primeiroEnderecoIds(ids: Iterable<AddressId>): MapFocusTarget | null {
  for (const addressId of ids) {
    return { type: 'address', addressId }
  }
  return null
}

export function avisoConsultaEncontrada(
  resultados: ConsultaEstoqueResultado[],
): BuscaEncontradaAviso {
  const nfNums = [...new Set(resultados.map((r) => r.nfNumero))]
  const fisicos = resultados.filter((r) => !r.isStage)
  const stageOnly = fisicos.length === 0 && resultados.some((r) => r.isStage)

  if (stageOnly) {
    return {
      titulo: 'Encontrado no stage',
      detalhe: `NF ${nfNums[0]} — item aguardando endereço no stage.`,
    }
  }

  const nfLabel = nfNums.length === 1 ? `NF ${nfNums[0]}` : `${nfNums.length} notas`
  const endLabel =
    fisicos.length === 1 ? '1 endereço no mapa' : `${fisicos.length} endereços no mapa`

  return {
    titulo: 'NF encontrada',
    detalhe: `${nfLabel} — ${endLabel}. A tela rolou até a primeira posição.`,
  }
}

export function avisoNfEncontrada(
  nf: NotaFiscal,
  contexto: 'consulta' | 'movimentacao' | 'saida',
): BuscaEncontradaAviso {
  const target = primeiroEnderecoNf(nf)
  const addrs = enderecosDaNf(nf).length

  if (target?.type === 'stage') {
    return {
      titulo: 'NF encontrada',
      detalhe: `NF ${nf.numero} — estoque no stage. A tela rolou até o stage.`,
    }
  }

  const ctx =
    contexto === 'saida'
      ? 'Saída pronta'
      : contexto === 'movimentacao'
        ? 'Movimentação'
        : 'Consulta'

  return {
    titulo: 'NF encontrada',
    detalhe: `${ctx}: NF ${nf.numero} — ${addrs} endereço(s). A tela rolou até a primeira posição.`,
  }
}

/** Evita focar stage quando não há endereço físico. */
export function enderecoOuStage(resultados: ConsultaEstoqueResultado[]): AddressId | 'stage' | null {
  const t = primeiroEnderecoConsulta(resultados)
  if (!t) return null
  if (t.type === 'stage') return 'stage'
  return t.addressId
}

export { STAGE_AREA_ID }
