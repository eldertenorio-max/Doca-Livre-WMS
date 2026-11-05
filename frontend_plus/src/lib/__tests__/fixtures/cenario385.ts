import { makeAddressId } from '../../../layout/camaras'
import { criarMovimentoEntrada } from '../../movimentos'
import type { NotaFiscal, PersistedData } from '../../../types'
import type { SaidaLimitesPorItem, SaidaPaleteDraft } from '../../saidaParcial'
import { distribuirCaixasSaidaEntrePaletes } from '../../saidaParcial'

/** Cenário reportado: NF entrada 385 cx item 9501, 10 paletes; saída parcial 200 cx em 5 paletes. */
export const NF_ID = 'nf-teste-385'
export const ITEM_INDEX = 1
export const CODIGO_ITEM = '9501'

export function enderecosCamara6(count: number, colInicio = 1): string[] {
  return Array.from({ length: count }, (_, i) => makeAddressId(6, 1, 1, colInicio + i))
}

export function nfEntrada385(): NotaFiscal {
  const allocatedAddresses = enderecosCamara6(10)
  return {
    id: NF_ID,
    numero: 'ENT-385',
    serie: '1',
    chave: 'chave-entrada-385',
    emitente: 'Teste Ultrafrio',
    dataEmissao: '2026-01-01',
    status: 'concluida',
    createdAt: '2026-01-01T10:00:00.000Z',
    items: [
      {
        index: ITEM_INDEX,
        codigo: CODIGO_ITEM,
        descricao: 'Item teste 385 caixas',
        quantidade: 385,
        unidade: 'CX',
        allocatedAddresses,
        paletes: 10,
        localizacao: 'armazem',
      },
    ],
  }
}

/** Limite do XML de saída: 200 caixas deste item. */
export const LIMITES_SAIDA: SaidaLimitesPorItem = { [ITEM_INDEX]: 200 }

export function paletesSaida200(): SaidaPaleteDraft[] {
  const enderecos = enderecosCamara6(5)
  const caixas = distribuirCaixasSaidaEntrePaletes(200, 5)
  return enderecos.map((addressId, i) => ({
    addressId,
    itemIndex: ITEM_INDEX,
    quantidadeCaixas: caixas[i] ?? 0,
  }))
}

export function persistedEntrada385(): PersistedData {
  const nf = nfEntrada385()
  return {
    notas: [nf],
    movimentos: [criarMovimentoEntrada(nf)],
    notasCanceladas: [],
    emitentes: [nf.emitente],
  }
}
