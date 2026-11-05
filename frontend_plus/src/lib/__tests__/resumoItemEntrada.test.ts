import { describe, expect, it } from 'vitest'
import { buildResumoItemEntradaSaida } from '../resumoItemEntrada'
import type { NfeItem, NotaFiscal } from '../../types'

const nfBase: NotaFiscal = {
  id: 'nf-1',
  numero: '12345',
  serie: '1',
  chave: '',
  emitente: 'Teste',
  dataEmissao: '2026-01-01',
  dataArmazenagem: '2026-01-15',
  items: [],
  status: 'concluida',
  createdAt: '2026-01-01',
}

const itemBase: NfeItem = {
  index: 0,
  codigo: '4152168',
  descricao: 'FRANGO CONG PCT CX VAR',
  quantidade: 660,
  unidade: 'CX',
  allocatedAddresses: ['A1', 'A2'],
  pesoBruto: 13697.32,
  pesoLiquido: 13697.32,
  valorTotal: 91635.07,
  lote: 'L123',
}

describe('buildResumoItemEntradaSaida', () => {
  it('mostra total na entrada e disponível após confirmação parcial', () => {
    const r = buildResumoItemEntradaSaida(nfBase, itemBase, {
      paletesConfirmados: [{ addressId: 'A1', itemIndex: 0, quantidadeCaixas: 200 }],
    })
    expect(r.nfNumero).toBe('12345')
    expect(r.quantidadeEstoque).toBe(660)
    expect(r.quantidadeConfirmada).toBe(200)
    expect(r.quantidadeDisponivel).toBe(460)
    expect(r.paletes).toBe(2)
    expect(r.lote).toBe('L123')
    expect(r.pesoBruto).toBeCloseTo(13697.32)
  })

  it('aplica limite do XML de saída quando menor que estoque', () => {
    const r = buildResumoItemEntradaSaida(nfBase, itemBase, {
      limitesPorItem: { 0: 400 },
    })
    expect(r.quantidadeEstoque).toBe(660)
    expect(r.limiteXml).toBe(400)
    expect(r.quantidadeDisponivel).toBe(400)
  })
})
