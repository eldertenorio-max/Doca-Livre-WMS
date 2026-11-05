import { describe, expect, it } from 'vitest'
import { pesoBrutoReferenciaNf, resumirNfArmazenada } from '../financeiro/calculo'
import { sincronizarPesoBrutoNota } from '../parseNfeXml'
import { patchNfeItemQuantidade } from '../desmembrarItem'
import type { MovimentoRegistro, NotaFiscal } from '../../types'

const nfLegada = (): NotaFiscal => ({
  id: 'nf-211264',
  numero: '211264',
  serie: '2',
  chave: '35260308982321000302550020002112641002062945',
  emitente: 'ASTRAPLUS',
  dataEmissao: '2026-03-05',
  dataArmazenagem: '2026-03-03',
  status: 'concluida',
  createdAt: '2026-07-06T00:00:00.000Z',
  pesoLiquido: 26_897.32,
  quantidadeVolume: '1.320 CX',
  items: [
    {
      index: 0,
      codigo: '4152168',
      descricao: 'FRANGO CX VAR',
      quantidade: 660,
      unidade: 'CX',
      allocatedAddresses: ['a1'],
      pesoBruto: 13_697.32,
    },
    {
      index: 1,
      codigo: '5035900',
      descricao: 'COXA CX20KG',
      quantidade: 660,
      unidade: 'CX',
      allocatedAddresses: ['a2'],
      pesoBruto: 13_200,
    },
  ],
})

const movLiquido = (): MovimentoRegistro => ({
  id: 'mov-1',
  tipo: 'entrada',
  nfId: 'nf-211264',
  nfNumero: '211264',
  emitente: 'ASTRAPLUS',
  createdAt: '2026-07-06T00:00:00.000Z',
  pesoLiquido: 26_897.32,
  itens: [],
})

describe('sincronizarPesoBrutoNota', () => {
  it('repara NF legada sem pesoB no cabeçalho (itens CX + peso líquido)', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    expect(nf.pesoBruto).toBeCloseTo(27_794.92, 2)
    const soma = nf.items.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
    expect(soma).toBeCloseTo(27_794.92, 2)
  })
})

describe('pesoBrutoReferenciaNf', () => {
  it('prioriza peso bruto da NF sobre peso líquido do movimento de entrada', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    expect(pesoBrutoReferenciaNf(nf)).toBeCloseTo(27_794.92, 2)

    const agora = new Date(2026, 6, 6)
    const resumo = resumirNfArmazenada(nf, [movLiquido()], agora)
    expect(resumo.pesoBruto).toBeCloseTo(27_794.92, 2)
    expect(resumo.pesoBrutoRestante).toBeCloseTo(27_794.92, 2)
    expect(resumo.pesoAtual).toBeCloseTo(27_794.92, 2)
    expect(resumo.pesoSaidoBruto).toBe(0)
    expect(resumo.pesoEntrada).toBeCloseTo(26_897.32, 2)
    expect(resumo.pesoRestante).toBeCloseTo(26_897.32, 2)
    expect(resumo.diasArmazenados).toBe(125)
  })

  it('após saída parcial, peso bruto restante reflete estoque para cobrança', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    nf.items = nf.items.map((it) => patchNfeItemQuantidade(it, it.quantidade / 2))

    const saida: MovimentoRegistro = {
      id: 'mov-saida-1',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-06T00:00:00.000Z',
      pesoLiquido: 13_448.66,
      itens: [
        { itemIndex: 0, codigo: '4152168', descricao: 'FRANGO', quantidade: 330, unidade: 'CX', addressIds: [], pesoBruto: 6848.66, pesoLiquido: 6848.66 },
        { itemIndex: 1, codigo: '5035900', descricao: 'COXA', quantidade: 330, unidade: 'CX', addressIds: [], pesoBruto: 6600, pesoLiquido: 6600 },
      ],
    }

    const agora = new Date(2026, 6, 6)
    const resumo = resumirNfArmazenada(nf, [movLiquido(), saida], agora)
    expect(resumo.pesoBruto).toBeCloseTo(27_794.92, 1)
    expect(resumo.pesoBrutoRestante).toBeCloseTo(13_897.46, 1)
    expect(resumo.pesoAtual).toBeCloseTo(13_897.46, 1)
    expect(resumo.pesoSaidoBruto).toBeCloseTo(13_897.46, 1)
    expect(resumo.pesoAtual).toBeCloseTo(resumo.pesoBruto - resumo.pesoSaidoBruto, 2)
    expect(resumo.dataUltimaSaida).toBeTruthy()
    expect(resumo.diasCobranca).toBeLessThan(resumo.diasArmazenados)
    expect(resumo.pesoRestante).toBeCloseTo(13_448.66, 1)
  })

  it('após duas saídas totais, peso atual zera', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    nf.items = nf.items.map((it) => ({
      ...it,
      quantidade: 0,
      allocatedAddresses: [],
      pesoBruto: 0,
      pesoLiquido: 0,
    }))

    const movEntrada = movLiquido()
    const saida1: MovimentoRegistro = {
      id: 'mov-saida-1',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-05T10:00:00.000Z',
      dataSaida: '2026-07-05',
      pesoLiquido: 13_448.66,
      itens: [],
    }
    const saida2: MovimentoRegistro = {
      id: 'mov-saida-2',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-06T10:00:00.000Z',
      dataSaida: '2026-07-06',
      pesoLiquido: 13_448.66,
      itens: [],
    }

    const resumo = resumirNfArmazenada(nf, [movEntrada, saida1, saida2])
    expect(resumo.status).toBe('finalizada')
    expect(resumo.pesoAtual).toBe(0)
    expect(resumo.pesoBrutoRestante).toBe(0)
    expect(resumo.pesoRestante).toBe(0)
    expect(resumo.pesoSaido).toBeCloseTo(26_897.32, 1)
    expect(resumo.pesoSaidoBruto).toBeCloseTo(27_794.92, 1)
  })

  it('duas saídas parciais somam peso saído e reduzem peso atual', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    nf.items = nf.items.map((it) => patchNfeItemQuantidade(it, it.quantidade / 2))

    const saida1: MovimentoRegistro = {
      id: 'mov-saida-1',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-05T10:00:00.000Z',
      dataSaida: '2026-07-05',
      pesoLiquido: 6724.33,
      itens: [],
    }
    const saida2: MovimentoRegistro = {
      id: 'mov-saida-2',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-06T10:00:00.000Z',
      dataSaida: '2026-07-06',
      pesoLiquido: 6724.33,
      itens: [],
    }

    const agora = new Date(2026, 6, 6)
    const resumo = resumirNfArmazenada(nf, [movLiquido(), saida1, saida2], agora)
    expect(resumo.pesoSaido).toBeCloseTo(13_448.66, 0)
    expect(resumo.pesoAtual).toBeCloseTo(13_897.46, 0)
    expect(resumo.pesoAtual).toBeLessThan(resumo.pesoBruto)
  })

  it('saída total com itens fantasma (qty sem endereço/peso) fica finalizada e zera totais', () => {
    const nf = nfLegada()
    sincronizarPesoBrutoNota(nf)
    nf.items = nf.items.map((it) => ({
      ...it,
      allocatedAddresses: [],
      pesoBruto: 0,
      pesoLiquido: 0,
    }))

    const saida: MovimentoRegistro = {
      id: 'mov-saida-total',
      tipo: 'saida',
      nfId: nf.id,
      nfNumero: nf.numero,
      emitente: nf.emitente,
      createdAt: '2026-07-02T00:00:00.000Z',
      dataSaida: '2026-07-02',
      pesoLiquido: 26_897.32,
      pesoBruto: 27_794.92,
      itens: [],
    }

    const resumo = resumirNfArmazenada(nf, [movLiquido(), saida])
    expect(resumo.status).toBe('finalizada')
    expect(resumo.pesoAtual).toBe(0)
    expect(resumo.totalCaixas).toBe(0)
    expect(resumo.totalPaletes).toBe(0)
    expect(resumo.dataSaida).toBe('2026-07-02')
  })
})
