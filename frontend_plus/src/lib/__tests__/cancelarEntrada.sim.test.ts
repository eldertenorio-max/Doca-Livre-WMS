import { describe, expect, it } from 'vitest'
import { podeApagarTodasNotasSemEstoque, removerNfDoEstoque } from '../movimentos'
import {
  consolidarRemocoesLocais,
  mergePersistedData,
  nfIdsRemovidosDesde,
  protegerPersistedContraRegressao,
} from '../syncMerge'
import type { NotaFiscal, PersistedData } from '../../types'

function nfEmAndamento(id: string, numero: string): NotaFiscal {
  return {
    id,
    numero,
    serie: '1',
    chave: `chave-${id}`,
    emitente: 'Fornecedor Teste',
    dataEmissao: '2026-07-01',
    status: 'em_andamento',
    createdAt: '2026-07-01T12:00:00.000Z',
    items: [
      {
        index: 1,
        codigo: '1001',
        descricao: 'Produto teste',
        quantidade: 10,
        unidade: 'CX',
        allocatedAddresses: [],
      },
    ],
  }
}

function simularGravacaoCancelamento(base: PersistedData, local: PersistedData): PersistedData {
  const removeuNotas = nfIdsRemovidosDesde(base, local).size > 0
  if (removeuNotas) return local

  let dataToSave = mergePersistedData(base, local, base)
  dataToSave = protegerPersistedContraRegressao(local, dataToSave)
  return consolidarRemocoesLocais(base, local, dataToSave)
}

describe('Simulação: cancelar entrada', () => {
  it('remove a única NF em andamento e grava sem restaurar na sincronização', () => {
    const nf = nfEmAndamento('nf-entrada-1', '12345')
    const base: PersistedData = {
      notas: [nf],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }

    const local = removerNfDoEstoque(base, nf.id)
    expect(local.notas).toHaveLength(0)
    expect(local.movimentos.some((m) => m.tipo === 'entrada' && m.nfId === nf.id && m.excluido)).toBe(
      true,
    )

    const gravado = simularGravacaoCancelamento(base, local)
    expect(gravado.notas).toHaveLength(0)
    expect(gravado.notas.some((n) => n.id === nf.id)).toBe(false)
  })

  it('remove NF em andamento quando há outras concluídas no estoque', () => {
    const concluida = { ...nfEmAndamento('nf-ok', '999'), status: 'concluida' as const }
    const pendente = nfEmAndamento('nf-cancel', '555')
    const base: PersistedData = {
      notas: [concluida, pendente],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }

    const local = removerNfDoEstoque(base, pendente.id)
    expect(local.notas.map((n) => n.id)).toEqual(['nf-ok'])

    const gravado = simularGravacaoCancelamento(base, local)
    expect(gravado.notas.map((n) => n.id)).toEqual(['nf-ok'])
  })

  it('permite apagar a única NF em andamento sem endereços no Supabase', () => {
    const nf = nfEmAndamento('nf-entrada-1', '12345')
    const base: PersistedData = {
      notas: [nf],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    const local = removerNfDoEstoque(base, nf.id)
    expect(podeApagarTodasNotasSemEstoque(local, base)).toBe(true)
  })

  it('bloqueia apagar estoque endereçado no Supabase', () => {
    const nf = {
      ...nfEmAndamento('nf-ok', '100'),
      status: 'concluida' as const,
      items: [
        {
          ...nfEmAndamento('nf-ok', '100').items[0],
          allocatedAddresses: ['cam6-r1-p1-c1'],
        },
      ],
    }
    const base: PersistedData = {
      notas: [nf],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    const local: PersistedData = { notas: [], movimentos: [], notasCanceladas: [], emitentes: [] }
    expect(podeApagarTodasNotasSemEstoque(local, base)).toBe(false)
  })
})
