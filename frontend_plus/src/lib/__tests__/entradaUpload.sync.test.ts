import { describe, expect, it } from 'vitest'
import {
  mergePersistedData,
  protegerPersistedContraRegressao,
  remoteRegressedVersusLocal,
} from '../syncMerge'
import { upsertMovimentoEntrada } from '../movimentos'
import type { MovimentoRegistro, NotaFiscal, PersistedData } from '../../types'

function nfNova(id: string): NotaFiscal {
  return {
    id,
    numero: '352',
    serie: '1',
    chave: `chave-${id}`,
    emitente: 'ASTRAPLUS',
    dataEmissao: '2026-07-01',
    status: 'em_andamento',
    createdAt: '2026-07-08T18:50:00.000Z',
    items: [
      {
        index: 0,
        codigo: '1',
        descricao: 'Item',
        quantidade: 660,
        unidade: 'CX',
        allocatedAddresses: [],
        localizacao: 'armazem',
      },
    ],
  }
}

describe('entrada upload — sync remoto atrasado', () => {
  it('detecta remoto sem a NF recém-importada', () => {
    const nf = nfNova('nf-nova')
    const local: PersistedData = {
      notas: [nf],
      movimentos: upsertMovimentoEntrada([], nf),
      notasCanceladas: [],
      emitentes: [],
    }
    const remote: PersistedData = {
      notas: [],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }

    expect(remoteRegressedVersusLocal(local, remote)).toBe(true)
  })

  it('mantém NF nova no merge quando remoto ainda não propagou', () => {
    const base: PersistedData = {
      notas: [],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    const nf = nfNova('nf-nova')
    const local: PersistedData = {
      notas: [nf],
      movimentos: upsertMovimentoEntrada([], nf),
      notasCanceladas: [],
      emitentes: [],
    }
    const remote: PersistedData = { ...base }

    const merged = protegerPersistedContraRegressao(
      local,
      mergePersistedData(base, local, remote),
    )

    expect(merged.notas.some((n) => n.id === 'nf-nova')).toBe(true)
    expect(merged.notas[0].items[0].localizacao).toBe('armazem')
    expect(merged.movimentos.some((m) => m.tipo === 'entrada' && m.nfId === 'nf-nova')).toBe(true)
  })
})
