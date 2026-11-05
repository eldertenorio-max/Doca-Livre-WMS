import { describe, expect, it } from 'vitest'
import { resetRemotoDetectado } from '../localBackupRecovery'
import type { PersistedData } from '../../types'

const vazio = (): PersistedData => ({
  notas: [],
  movimentos: [],
  notasCanceladas: [],
  emitentes: [],
})

const comNfEnderecos = (): PersistedData => ({
  notas: [
    {
      id: 'nf1',
      numero: '100',
      serie: '1',
      chave: '1',
      emitente: 'Cliente',
      dataEmissao: '2026-07-01',
      status: 'concluida',
      createdAt: '2026-07-01',
      items: [
        {
          index: 0,
          codigo: 'A',
          descricao: 'Item',
          quantidade: 10,
          unidade: 'CX',
          allocatedAddresses: ['P1', 'P2'],
        },
      ],
    },
  ],
  movimentos: [
    {
      id: 'm1',
      tipo: 'entrada',
      nfId: 'nf1',
      nfNumero: '100',
      emitente: 'Cliente',
      createdAt: '2026-07-01',
      itens: [],
    },
  ],
  notasCanceladas: [],
  emitentes: [],
})

describe('resetRemotoDetectado', () => {
  it('detecta aba parada após reset quando local = último snapshot persistido', () => {
    const base = comNfEnderecos()
    expect(resetRemotoDetectado(vazio(), base, base)).toBe(true)
  })

  it('não bloqueia cadastro novo após reset (local ainda não persistido)', () => {
    const local = comNfEnderecos()
    expect(resetRemotoDetectado(vazio(), local, vazio())).toBe(false)
    expect(resetRemotoDetectado(vazio(), local, null)).toBe(false)
  })

  it('não detecta reset quando a nuvem ainda tem estoque', () => {
    const dados = comNfEnderecos()
    expect(resetRemotoDetectado(dados, dados, dados)).toBe(false)
  })
})
