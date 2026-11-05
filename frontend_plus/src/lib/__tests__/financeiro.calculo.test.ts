import { describe, expect, it } from 'vitest'
import {
  calcularCobrancaDetalhada,
  dataNoPeriodoCobranca,
  debitosEntradaPeriodo,
  diasPeriodoCobrancaArmazenagem,
  pesoBrutoParaCobrancaPeriodo,
  saidasNoPeriodoCobranca,
  valorAcumuladoArmazenagem,
  valorCobrancaPeriodo,
  valorDiariaPorKilo,
  type ResumoNfArmazenada,
} from '../financeiro/calculo'
import type { ContratoCliente, TabelaCobranca } from '../financeiro/types'

const tabelaBase = (): TabelaCobranca => ({
  id: 't1',
  nome: 'Padrão',
  custoPosicaoPalete: 10,
  custoPorKilo: 0.05,
  custoPorPalete: 15,
  custoEntrada: 50,
  custoSaida: 30,
  criadoEm: '2026-01-01T00:00:00.000Z',
})

const contratoBase = (overrides: Partial<ContratoCliente> = {}): ContratoCliente => ({
  id: 'c1',
  cnpj: '12345678000199',
  razaoSocial: 'Cliente Teste',
  tabelaId: 't1',
  ciclo: 'mensal',
  regraTempo: 'proporcional',
  cobrarPosicaoPalete: false,
  cobrarKilo: false,
  cobrarPalete: true,
  cobrarEntrada: true,
  cobrarSaida: false,
  kiloPorDia: false,
  ativo: true,
  criadoEm: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const resumoNf = (overrides: Partial<ResumoNfArmazenada> = {}): ResumoNfArmazenada => ({
  nfId: 'nf1',
  nfNumero: '206658',
  emitente: 'ASTRAPLUS',
  dataEntrada: '2026-07-05',
  dataSaida: null,
  dataUltimaSaida: null,
  diasArmazenados: 1,
  diasCobranca: 1,
  pesoBruto: 27500,
  pesoBrutoRestante: 27500,
  pesoAtual: 27500,
  pesoSaidoBruto: 0,
  pesoLiquido: 23500,
  pesoEntrada: 23500,
  pesoRestante: 23500,
  pesoSaido: 0,
  paletesEntrada: 20,
  paletesSaidos: 0,
  saidas: [],
  totalItens: 1,
  totalCaixas: 0,
  totalPaletes: 20,
  valorMercadoria: 0,
  status: 'armazenada',
  ...overrides,
})

describe('valorDiariaPorKilo', () => {
  it('exemplo ASTRAPLUS: 27794,92 kg × R$0,18 ÷ 30 = R$166,76/dia', () => {
    expect(valorDiariaPorKilo(27_794.92, 0.18, 'mensal')).toBe(166.76)
  })

  it('usa divisor 15 no ciclo quinzenal', () => {
    expect(valorDiariaPorKilo(3000, 0.3, 'quinzenal')).toBe(60)
  })
})

describe('valorAcumuladoArmazenagem e valorCobrancaPeriodo', () => {
  it('125 dias × R$166,76 = R$20.845,00', () => {
    expect(valorAcumuladoArmazenagem(125, 166.76)).toBe(20_845)
  })

  it('6 dias do período × R$166,76 = R$1.000,56', () => {
    expect(valorCobrancaPeriodo(6, 166.76)).toBe(1000.56)
  })
})

describe('calcularCobrancaDetalhada', () => {
  it('cobra palete proporcional ao ciclo mensal (1 dia = 1/30)', () => {
    const cobranca = calcularCobrancaDetalhada(resumoNf(), contratoBase(), tabelaBase(), {
      posicoes: 20,
      pesoBase: 23500,
      paletes: 20,
    })

    expect(cobranca.totalRecorrente).toBeCloseTo(20 * 15 * (1 / 30), 4)
    expect(cobranca.valorDiaria).toBeCloseTo(cobranca.totalRecorrente, 4)
    expect(cobranca.valorVigente).toBeCloseTo(cobranca.valorDiaria, 4)
    expect(cobranca.total).toBeCloseTo(cobranca.totalRecorrente + 20 * 50, 4)
  })

  it('kilo: diaria por peso bruto e acumulado = dias × diaria (exemplo NF 211264)', () => {
    const pesoBruto = 27_794.92
    const dias = 125
    const diaria = valorDiariaPorKilo(pesoBruto, 0.18, 'mensal')

    const cobranca = calcularCobrancaDetalhada(
      resumoNf({
        diasArmazenados: dias,
        diasCobranca: dias,
        pesoEntrada: 26_897.32,
        pesoBruto,
        pesoBrutoRestante: pesoBruto,
        pesoAtual: pesoBruto,
        pesoLiquido: 26_897.32,
        pesoRestante: 26_897.32,
      }),
      contratoBase({ cobrarPalete: false, cobrarKilo: true, cobrarEntrada: false, kiloPorDia: true }),
      { ...tabelaBase(), custoPorKilo: 0.18 },
      { posicoes: 0, pesoBase: 26_897.32, paletes: 0 },
    )

    expect(diaria).toBe(166.76)
    expect(cobranca.valorDiaria).toBe(166.76)
    expect(cobranca.valorVigente).toBe(20_845)
    expect(cobranca.detalhes[0]?.valor).toBe(20_845)
    expect(cobranca.total).toBe(20_845)
    expect(valorCobrancaPeriodo(6, diaria)).toBe(1000.56)
  })

  it('kilo após saída parcial: dias desde última saída × diária sobre peso atual', () => {
    const pesoBrutoEntrada = 27_794.92
    const pesoBrutoRestante = 13_897.46
    const diasPosSaida = 6
    const diaria = valorDiariaPorKilo(pesoBrutoRestante, 0.18, 'mensal')

    const cobranca = calcularCobrancaDetalhada(
      resumoNf({
        pesoBruto: pesoBrutoEntrada,
        pesoBrutoRestante,
        pesoAtual: pesoBrutoRestante,
        pesoEntrada: 13_448.66,
        pesoLiquido: 13_448.66,
        pesoRestante: 13_448.66,
        pesoSaido: 13_448.66,
        diasArmazenados: 125,
        diasCobranca: diasPosSaida,
        dataUltimaSaida: '2026-07-01',
        saidas: [
          {
            id: 's1',
            data: '2026-07-01',
            nfSaidaNumero: null,
            pesoSaida: 13_448.66,
            caixasSaida: 660,
            paletesSaida: 10,
          },
        ],
      }),
      contratoBase({ cobrarPalete: false, cobrarKilo: true, cobrarEntrada: false, kiloPorDia: true }),
      { ...tabelaBase(), custoPorKilo: 0.18 },
      { posicoes: 0, pesoBase: 13_448.66, paletes: 0 },
    )

    expect(diaria).toBe(83.38)
    expect(cobranca.valorDiaria).toBe(83.38)
    expect(cobranca.valorVigente).toBe(500.28)
    expect(valorCobrancaPeriodo(6, diaria)).toBe(500.28)
  })

  it('cobra posição de palete quando habilitado no contrato', () => {
    const cobranca = calcularCobrancaDetalhada(
      resumoNf(),
      contratoBase({ cobrarPalete: false, cobrarPosicaoPalete: true, cobrarEntrada: false }),
      tabelaBase(),
      { posicoes: 25, pesoBase: 0, paletes: 0 },
    )

    expect(cobranca.totalRecorrente).toBeCloseTo(25 * 10 * (1 / 30), 4)
    expect(cobranca.valorDiaria).toBeGreaterThan(0)
  })

  it('retorna zero sem contrato ou tabela', () => {
    const cobranca = calcularCobrancaDetalhada(resumoNf(), null, null, {
      posicoes: 20,
      pesoBase: 23500,
      paletes: 20,
    })

    expect(cobranca.valorDiaria).toBe(0)
    expect(cobranca.valorVigente).toBe(0)
  })
})

describe('diasPeriodoCobrancaArmazenagem', () => {
  it('após saída parcial no 1º dia do período, conta o período inteiro com estoque', () => {
    expect(
      diasPeriodoCobrancaArmazenagem(
        '2026-07-01',
        '2026-07-06',
        '2026-03-03',
        '2026-07-01',
        null,
        'armazenada',
        13_897.46,
      ),
    ).toBe(6)
  })

  it('finalizada: período limitado até a data de saída', () => {
    expect(
      diasPeriodoCobrancaArmazenagem(
        '2026-07-01',
        '2026-07-06',
        '2026-05-01',
        '2026-07-01',
        '2026-07-01',
        'finalizada',
        0,
      ),
    ).toBe(1)
  })

  it('estoque esgotado: limita período até a última saída', () => {
    expect(
      diasPeriodoCobrancaArmazenagem(
        '2026-07-01',
        '2026-07-06',
        '2026-05-06',
        '2026-07-02',
        '2026-07-02',
        'finalizada',
        0,
      ),
    ).toBe(2)
  })

  it('sem saída, período respeita data de entrada', () => {
    expect(
      diasPeriodoCobrancaArmazenagem(
        '2026-07-01',
        '2026-07-06',
        '2026-07-05',
        null,
        null,
        'armazenada',
        24_474,
      ),
    ).toBe(2)
  })
})

describe('pesoBrutoParaCobrancaPeriodo', () => {
  it('usa peso de entrada quando estoque zerou após saída', () => {
    expect(pesoBrutoParaCobrancaPeriodo(0, 24_474, true)).toBe(24_474)
    expect(pesoBrutoParaCobrancaPeriodo(13_897, 24_474, true)).toBe(13_897)
    expect(pesoBrutoParaCobrancaPeriodo(0, 24_474, false)).toBe(0)
  })
})

describe('debitosEntradaPeriodo', () => {
  it('cobra paletes da movimentação de entrada quando data cai no período', () => {
    const contrato = contratoBase({ cobrarEntrada: true })
    const tabela = { ...tabelaBase(), custoEntrada: 50 }
    expect(debitosEntradaPeriodo('2026-07-03', 10, '2026-07-01', '2026-07-31', contrato, tabela)).toBe(500)
    expect(debitosEntradaPeriodo('2026-06-01', 10, '2026-07-01', '2026-07-31', contrato, tabela)).toBe(0)
  })
})

describe('dataNoPeriodoCobranca', () => {
  it('respeita intervalo inclusivo', () => {
    expect(dataNoPeriodoCobranca('2026-07-06T23:59:00.000Z', '2026-07-01', '2026-07-06')).toBe(true)
    expect(dataNoPeriodoCobranca('2026-06-30', '2026-07-01', '2026-07-06')).toBe(false)
  })
})
