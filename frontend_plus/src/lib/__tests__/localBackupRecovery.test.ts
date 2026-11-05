import { describe, expect, it } from 'vitest'
import { wouldWipePersistedStock } from '../localBackupRecovery'
import type { MovimentoRegistro, NotaFiscal, PersistedData } from '../../types'

const nfComEndereco = (): NotaFiscal => ({
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
      quantidade: 100,
      unidade: 'CX',
      allocatedAddresses: ['P1'],
    },
  ],
})

const saidaMov = (id: string): MovimentoRegistro => ({
  id,
  tipo: 'saida',
  nfId: 'nf1',
  nfNumero: '100',
  emitente: 'Cliente',
  createdAt: '2026-07-06T00:00:00.000Z',
  itens: [],
})

describe('wouldWipePersistedStock', () => {
  it('bloqueia apagar estoque sem saída registrada', () => {
    const prev: PersistedData = {
      notas: [nfComEndereco()],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    const next: PersistedData = {
      notas: [{ ...nfComEndereco(), items: [{ ...nfComEndereco().items[0], allocatedAddresses: [] }] }],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    expect(wouldWipePersistedStock(prev, next)).toBe(true)
  })

  it('permite zerar endereços após saída registrada (2ª saída total)', () => {
    const prev: PersistedData = {
      notas: [nfComEndereco()],
      movimentos: [saidaMov('s1')],
      notasCanceladas: [],
      emitentes: [],
    }
    const next: PersistedData = {
      notas: [{ ...nfComEndereco(), items: [{ ...nfComEndereco().items[0], allocatedAddresses: [], quantidade: 0 }] }],
      movimentos: [saidaMov('s1'), saidaMov('s2')],
      notasCanceladas: [],
      emitentes: [],
    }
    expect(wouldWipePersistedStock(prev, next)).toBe(false)
  })
})
