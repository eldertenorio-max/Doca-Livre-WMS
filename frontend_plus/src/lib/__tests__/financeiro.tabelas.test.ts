import { describe, expect, it } from 'vitest'
import { sincronizarClientesFromNotas } from '../financeiro/clientes'
import { financeiroVazio, type FinanceiroData, type TabelaCobranca } from '../financeiro/types'

describe('Financeiro: tabelas de cobrança', () => {
  const tabelaLocal: TabelaCobranca = {
    id: 'tab-1',
    nome: 'Padrão',
    custoPosicaoPalete: 10,
    custoPorKilo: 0,
    custoPorPalete: 0,
    custoEntrada: 0,
    custoSaida: 0,
    criadoEm: '2026-07-01T12:00:00.000Z',
  }

  it('sincronizar clientes das NFs não apaga tabelas locais', () => {
    const local: FinanceiroData = {
      ...financeiroVazio,
      tabelas: [tabelaLocal],
    }
    const synced = sincronizarClientesFromNotas(local, [])
    expect(synced.tabelas).toEqual([tabelaLocal])
    expect(synced.contratos).toEqual([])
  })
})
