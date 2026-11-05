import { describe, expect, it } from 'vitest'
import { dataArmazenagemNf, normalizarDataArmazenagemInput } from '../dataArmazenagem'
import { diasArmazenados, resumirNfArmazenada } from '../financeiro/calculo'
import type { MovimentoRegistro, NotaFiscal } from '../../types'

describe('normalizarDataArmazenagemInput', () => {
  it('aceita YYYY-MM-DD', () => {
    expect(normalizarDataArmazenagemInput('2026-05-06')).toBe('2026-05-06')
  })

  it('extrai data de ISO completo', () => {
    expect(normalizarDataArmazenagemInput('2026-07-08T18:50:00.000Z')).toBe('2026-07-08')
  })

  it('retorna null para vazio', () => {
    expect(normalizarDataArmazenagemInput('')).toBeNull()
  })
})

describe('dataArmazenagemNf', () => {
  it('prioriza dataArmazenagem sobre createdAt', () => {
    expect(
      dataArmazenagemNf({
        dataArmazenagem: '2026-05-06',
        createdAt: '2026-07-08T18:50:00.000Z',
      }),
    ).toBe('2026-05-06')
  })

  it('usa createdAt quando dataArmazenagem ausente', () => {
    expect(dataArmazenagemNf({ createdAt: '2026-07-08T18:50:00.000Z' })).toBe('2026-07-08')
  })
})

describe('resumirNfArmazenada — data de armazenagem', () => {
  const nfBase = (): NotaFiscal => ({
    id: 'nf-1',
    numero: '352',
    serie: '1',
    chave: 'chave',
    emitente: 'ASTRAPLUS',
    dataEmissao: '2026-07-01',
    status: 'concluida',
    createdAt: '2026-07-08T18:50:00.000Z',
    dataArmazenagem: '2026-05-06',
    items: [
      {
        index: 0,
        codigo: '1',
        descricao: 'Item',
        quantidade: 660,
        unidade: 'CX',
        allocatedAddresses: [{ id: 'a1', quantidade: 660 }],
        paletes: 10,
      },
    ],
  })

  const movEntrada = (): MovimentoRegistro => ({
    id: 'mov-1',
    tipo: 'entrada',
    nfId: 'nf-1',
    nfNumero: '352',
    emitente: 'ASTRAPLUS',
    createdAt: '2026-07-08T18:50:00.000Z',
    itens: [],
  })

  it('usa dataArmazenagem da NF no financeiro, não createdAt do movimento', () => {
    const agora = new Date('2026-07-08T21:50:00.000Z')
    const resumo = resumirNfArmazenada(nfBase(), [movEntrada()], agora)

    expect(resumo.dataEntrada).toBe('2026-05-06')
    expect(resumo.diasArmazenados).toBe(63)
  })

  it('conta 125 dias entre 03/03/2026 e 06/07/2026', () => {
    const agora = new Date(2026, 6, 6)
    expect(diasArmazenados('2026-03-03', null, agora)).toBe(125)
  })
})
