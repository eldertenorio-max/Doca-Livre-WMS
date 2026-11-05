import type { MovimentoRegistro, NfeItem, NotaFiscal } from '../../types'
import type { ContratoCliente, RegraTempo, TabelaCobranca } from './types'
import { pesoBrutoTotalItem, pesoLiquidoTotalItem } from '../saidaParcial'
import { quantidadeEstoqueItem } from '../nfeUnidades'
import { dataArmazenagemNf, normalizarDataArmazenagemInput } from '../dataArmazenagem'

export type SaidaNfFinanceiro = {
  id: string
  data: string
  nfSaidaNumero: string | null
  pesoSaida: number
  caixasSaida: number
  paletesSaida: number
}

export type ResumoNfArmazenada = {
  nfId: string
  nfNumero: string
  emitente: string
  emitenteCnpj?: string
  dataEntrada: string
  dataSaida: string | null
  /** Data da saída mais recente (parcial ou total), se houver. */
  dataUltimaSaida: string | null
  /** Dias totais desde a entrada (referência histórica). */
  diasArmazenados: number
  /** Dias usados na cobrança por kilo (desde a última saída se ainda houver estoque). */
  diasCobranca: number
  pesoBruto: number
  /** Peso bruto ainda em estoque — base para cobrança por kilo. */
  pesoBrutoRestante: number
  /** Peso bruto atual = peso bruto entrada − peso bruto saído. */
  pesoAtual: number
  /** Peso bruto total das saídas registradas. */
  pesoSaidoBruto: number
  pesoLiquido: number
  /** Peso líquido na entrada — base para movimentações e saldo em estoque. */
  pesoEntrada: number
  /** Peso ainda em estoque (líquido). */
  pesoRestante: number
  /** Soma das saídas parciais ou totais. */
  pesoSaido: number
  /** Paletes registrados na entrada da NF. */
  paletesEntrada: number
  /** Paletes movimentados em saídas (parciais ou total). */
  paletesSaidos: number
  saidas: SaidaNfFinanceiro[]
  totalItens: number
  totalCaixas: number
  totalPaletes: number
  valorMercadoria: number
  status: 'armazenada' | 'finalizada'
}

export type DetalheCobranca = {
  label: string
  valor: number
}

export type CobrancaNf = {
  nfId: string
  nfNumero: string
  detalhes: DetalheCobranca[]
  total: number
}

export type ResumoClienteFinanceiro = {
  cnpj: string
  razaoSocial: string
  contrato: ContratoCliente | null
  tabela: TabelaCobranca | null
  nfsArmazenadas: ResumoNfArmazenada[]
  nfsFinalizadas: ResumoNfArmazenada[]
  cobrancas: CobrancaNf[]
  totalArmazenado: number
  totalFinalizado: number
  totalGeral: number
}

const MS_DIA = 86_400_000

export function normalizarCnpj(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function formatarCnpj(cnpj: string): string {
  const d = normalizarCnpj(cnpj)
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  }
  return cnpj
}

function parseDate(iso: string): Date {
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Number(y), Number(m) - 1, Number(d))
  }
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Dias corridos de armazenagem entre a data de entrada e a data de referência (mínimo 1). */
export function diasArmazenados(dataEntrada: string, dataSaida: string | null, agora = new Date()): number {
  const inicio = startOfDay(parseDate(dataEntrada))
  const fim = startOfDay(dataSaida ? parseDate(dataSaida) : agora)
  const diff = Math.floor((fim.getTime() - inicio.getTime()) / MS_DIA)
  return Math.max(1, diff)
}

function diasNoPeriodo(ciclo: 'mensal' | 'quinzenal'): number {
  return ciclo === 'quinzenal' ? 15 : 30
}

/** Valor diário por kilo: peso bruto × (R$/kg da tabela) ÷ dias do ciclo (30 mensal, 15 quinzenal). */
export function valorDiariaPorKilo(
  pesoBrutoKg: number,
  custoPorKiloPeriodo: number,
  ciclo: 'mensal' | 'quinzenal' = 'mensal',
): number {
  if (pesoBrutoKg <= 0 || custoPorKiloPeriodo <= 0) return 0
  const bruto = (pesoBrutoKg * custoPorKiloPeriodo) / diasNoPeriodo(ciclo)
  return Math.floor(bruto * 100) / 100
}

/** Valor acumulado = dias armazenados × valor diária. */
export function valorAcumuladoArmazenagem(diasArmazenados: number, valorDiaria: number): number {
  const dias = Math.max(1, diasArmazenados)
  return Math.round(dias * valorDiaria * 100) / 100
}

/** Valor a cobrar no período = dias do período × valor diária. */
export function valorCobrancaPeriodo(diasPeriodo: number, valorDiaria: number): number {
  if (diasPeriodo <= 0 || valorDiaria <= 0) return 0
  return Math.round(diasPeriodo * valorDiaria * 100) / 100
}

/** Dias inclusivos entre duas datas YYYY-MM-DD. */
export function diasEntreDatasInclusive(inicio: string, fim: string): number {
  const refInicio = dataReferenciaIso(inicio)
  const refFim = dataReferenciaIso(fim)
  if (!refInicio || !refFim) return 0
  const start = startOfDay(parseDate(refInicio))
  const end = startOfDay(parseDate(refFim))
  const diff = Math.floor((end.getTime() - start.getTime()) / MS_DIA)
  return Math.max(0, diff + 1)
}

/**
 * Dias do período de cobrança por kilo.
 * - Com estoque: desde a última saída parcial até o fim do período (peso atual).
 * - Esgotada/finalizada: do início efetivo até a data de saída (peso de entrada).
 */
export function diasPeriodoCobrancaArmazenagem(
  periodoInicio: string,
  periodoFim: string,
  dataEntrada: string,
  dataUltimaSaida: string | null,
  dataSaidaFinal: string | null,
  status: 'armazenada' | 'finalizada',
  pesoAtual: number,
): number {
  if (!periodoInicio || !periodoFim) return 0

  let inicioEfetivo = periodoInicio
  let fimEfetivo = periodoFim

  const refEntrada = dataReferenciaIso(dataEntrada)
  if (refEntrada && refEntrada > inicioEfetivo) inicioEfetivo = refEntrada

  const estoqueEsgotado = pesoAtual <= 1e-6

  if (status === 'finalizada' || estoqueEsgotado) {
    const refSaidaRaw = dataSaidaFinal ?? dataUltimaSaida
    const refSaida = refSaidaRaw ? dataReferenciaIso(refSaidaRaw) : null
    if (refSaida) {
      if (refSaida < inicioEfetivo) return 0
      if (refSaida < fimEfetivo) fimEfetivo = refSaida
    }
  } else if (dataUltimaSaida) {
    const refSaida = dataReferenciaIso(dataUltimaSaida)
    if (refSaida && refSaida > inicioEfetivo) inicioEfetivo = refSaida
  }

  const refFim = dataReferenciaIso(fimEfetivo)
  if (refFim && inicioEfetivo > refFim) return 0

  return diasEntreDatasInclusive(inicioEfetivo, fimEfetivo)
}

/** Peso bruto base para cobrança do período (atual ou entrada se já saiu tudo). */
export function pesoBrutoParaCobrancaPeriodo(
  pesoAtual: number,
  pesoBrutoEntrada: number,
  teveSaida: boolean,
): number {
  if (pesoAtual > 1e-6) return pesoAtual
  if (teveSaida && pesoBrutoEntrada > 0) return pesoBrutoEntrada
  return 0
}

function dataUltimaSaidaRegistrada(saidas: SaidaNfFinanceiro[]): string | null {
  if (saidas.length === 0) return null
  return saidas.reduce((latest, s) => (s.data > latest ? s.data : latest), saidas[0].data)
}

function diasCobrancaArmazenagem(
  dataEntrada: string,
  dataUltimaSaida: string | null,
  dataSaidaFinal: string | null,
  armazenada: boolean,
  agora = new Date(),
): number {
  if (armazenada && dataUltimaSaida) {
    return diasArmazenados(dataUltimaSaida, null, agora)
  }
  return diasArmazenados(dataEntrada, dataSaidaFinal, agora)
}

function dataReferenciaIso(iso: string): string | null {
  const dateOnly = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dateOnly) return dateOnly[1]
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Verifica se a data (ISO ou data-hora) está no intervalo inclusivo YYYY-MM-DD. */
export function dataNoPeriodoCobranca(dataIso: string, periodoInicio: string, periodoFim: string): boolean {
  const ref = dataReferenciaIso(dataIso)
  if (!ref) return false
  if (periodoInicio && ref < periodoInicio) return false
  if (periodoFim && ref > periodoFim) return false
  return true
}

export function saidasNoPeriodoCobranca(
  saidas: SaidaNfFinanceiro[],
  periodoInicio: string,
  periodoFim: string,
): SaidaNfFinanceiro[] {
  if (!periodoInicio || !periodoFim) return []
  return saidas.filter((s) => dataNoPeriodoCobranca(s.data, periodoInicio, periodoFim))
}

/** Débitos de entrada no período (custo × paletes da movimentação de entrada). */
export function debitosEntradaPeriodo(
  dataEntrada: string,
  paletesEntrada: number,
  periodoInicio: string,
  periodoFim: string,
  contrato: ContratoCliente | null,
  tabela: TabelaCobranca | null,
): number {
  if (!contrato?.cobrarEntrada || !tabela || tabela.custoEntrada <= 0) return 0
  if (!dataNoPeriodoCobranca(dataEntrada, periodoInicio, periodoFim)) return 0
  const paletes = paletesEntrada > 0 ? paletesEntrada : 0
  if (paletes <= 0) return 0
  return Math.round(paletes * tabela.custoEntrada * 100) / 100
}

function pesoBrutoArmazenagem(resumo: ResumoNfArmazenada): number {
  if (resumo.status === 'armazenada') {
    return resumo.pesoAtual > 0 ? resumo.pesoAtual : 0
  }
  if (resumo.pesoBruto > 0) return resumo.pesoBruto
  return 0
}

/** Peso bruto da NF para cobrança de armazenagem (pesoB do XML / cabeçalho). */
export function pesoBrutoReferenciaNf(nf: NotaFiscal): number {
  if (nf.pesoBruto != null && nf.pesoBruto > 0) return nf.pesoBruto

  const brutoItens = nf.items.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
  const liqItens = nf.items.reduce((s, it) => s + (it.pesoLiquido ?? 0), 0)
  if (brutoItens > 0 && brutoItens > liqItens + 0.01) return brutoItens
  if (brutoItens > 0 && nf.pesoLiquido == null) return brutoItens

  return 0
}

/** Peso líquido da NF para movimentações (pesoL / movimentos / itens). */
export function pesoLiquidoReferenciaNf(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[] = [],
): number {
  const entrada = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id && !m.excluido)
  const movPeso = entrada ? pesoMovimentoRegistro(entrada) : 0
  if (movPeso > 0) return movPeso
  if (nf.pesoLiquido != null && nf.pesoLiquido > 0) return nf.pesoLiquido
  return pesoItensLiquidoNf(nf)
}

function fatorTempo(dias: number, ciclo: 'mensal' | 'quinzenal', regra: RegraTempo): number {
  const periodo = diasNoPeriodo(ciclo)
  if (regra === 'cheia') return Math.max(1, Math.ceil(dias / periodo))
  return dias / periodo
}


function pesoMovimentoRegistro(m: MovimentoRegistro): number {
  if (m.pesoLiquido != null && m.pesoLiquido > 0) return m.pesoLiquido
  if (m.pesoBruto != null && m.pesoBruto > 0) return m.pesoBruto
  return m.itens.reduce((s, it) => s + (it.pesoLiquido ?? it.pesoBruto ?? 0), 0)
}

function caixasMovimento(m: MovimentoRegistro): number {
  return m.itens.reduce((s, it) => {
    const q = it.quantidadeSaida ?? it.quantidade
    const u = it.unidade.trim().toUpperCase()
    if (u === 'CX' || u === 'CAIXA' || u === 'FD' || u === 'FARDO') return s + q
    return s
  }, 0)
}

function paletesMovimento(m: MovimentoRegistro): number {
  const fromItems = m.itens.reduce((s, it) => s + (it.paletes ?? it.addressIds.length), 0)
  if (fromItems > 0) return fromItems
  return m.itens.reduce((s, it) => s + it.addressIds.length, 0)
}

function pesoItensLiquidoNf(nf: NotaFiscal): number {
  return nf.items.reduce((s, it) => {
    const qtd = quantidadeEstoqueItem(it)
    if (qtd <= 1e-9 && it.allocatedAddresses.length === 0) return s
    if (it.pesoLiquido != null && it.pesoLiquido > 0) return s + it.pesoLiquido
    const total = pesoLiquidoTotalItem(nf, it) ?? pesoBrutoTotalItem(nf, it)
    return s + (total ?? 0)
  }, 0)
}

function pesoSaidaLiquidoMovimento(
  m: MovimentoRegistro,
  pesoLiquidoEntrada: number,
  caixasEntrada: number,
): number {
  const direct = pesoMovimentoRegistro(m)
  if (direct > 0) return direct
  const caixas = caixasMovimento(m)
  if (caixas > 0 && caixasEntrada > 0 && pesoLiquidoEntrada > 0) {
    return caixas * (pesoLiquidoEntrada / caixasEntrada)
  }
  return 0
}

function caixasEntradaNf(nf: NotaFiscal, movimentos: MovimentoRegistro[]): number {
  const entradaMov = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id && !m.excluido)
  if (entradaMov) {
    const fromMov = caixasMovimento(entradaMov)
    if (fromMov > 0) return fromMov
  }
  return totalCaixasNf(nf)
}

function pesoSaidoLiquidoNf(
  nf: NotaFiscal,
  nfId: string,
  movimentos: MovimentoRegistro[],
  pesoLiquidoEntrada: number,
): number {
  const caixasEntrada = caixasEntradaNf(nf, movimentos)
  const saidas = listarSaidasNf(nfId, movimentos)
  let total = 0
  for (const s of saidas) {
    const mov = movimentos.find((m) => m.id === s.id)
    if (mov) {
      total += pesoSaidaLiquidoMovimento(mov, pesoLiquidoEntrada, caixasEntrada)
      continue
    }
    total += s.pesoSaida
  }
  if (pesoLiquidoEntrada > 0) return Math.min(total, pesoLiquidoEntrada)
  return total
}

function pesoBrutoAtualNf(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
  pesoBrutoEntrada: number,
  pesoLiquidoEntrada: number,
): number {
  if (!nfTemEstoque(nf)) return 0

  const pesoLiquidoItens = pesoItensLiquidoNf(nf)
  if (pesoLiquidoItens <= 1e-6) return 0

  const ratioBruto =
    pesoBrutoEntrada > 0 && pesoLiquidoEntrada > 0 ? pesoBrutoEntrada / pesoLiquidoEntrada : 0
  const fromItens = ratioBruto > 0 ? pesoLiquidoItens * ratioBruto : pesoLiquidoItens

  const pesoSaidoBruto = pesoSaidoBrutoNf(nf, nf.id, movimentos, pesoBrutoEntrada, pesoLiquidoEntrada)
  const fromSaidas = Math.max(0, pesoBrutoEntrada - pesoSaidoBruto)

  if (fromSaidas <= 1e-6) return 0
  return Math.min(fromItens, fromSaidas)
}

function pesoSaidaBrutoMovimento(m: MovimentoRegistro): number {
  if (m.pesoBruto != null && m.pesoBruto > 0) return m.pesoBruto
  const fromItems = m.itens.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
  if (fromItems > 0) return fromItems
  return 0
}

function pesoSaidoBrutoNf(
  nf: NotaFiscal,
  nfId: string,
  movimentos: MovimentoRegistro[],
  pesoBrutoEntrada: number,
  pesoLiquidoEntrada: number,
): number {
  const pesoSaidoLiquido = pesoSaidoLiquidoNf(nf, nfId, movimentos, pesoLiquidoEntrada)
  if (pesoBrutoEntrada > 0 && pesoLiquidoEntrada > 0 && pesoSaidoLiquido > 0) {
    return Math.min(pesoBrutoEntrada, pesoSaidoLiquido * (pesoBrutoEntrada / pesoLiquidoEntrada))
  }

  const saidas = listarSaidasNf(nfId, movimentos)
  let pesoSaidoBruto = 0
  for (const s of saidas) {
    const mov = movimentos.find((m) => m.id === s.id)
    const brutoMov = mov ? pesoSaidaBrutoMovimento(mov) : 0
    if (brutoMov > 0) pesoSaidoBruto += brutoMov
  }
  return pesoSaidoBruto
}

function pesoBrutoRestanteNf(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
  pesoBrutoEntrada: number,
  pesoLiquidoEntrada: number,
): number {
  return pesoBrutoAtualNf(nf, movimentos, pesoBrutoEntrada, pesoLiquidoEntrada)
}

export function listarSaidasNf(nfId: string, movimentos: MovimentoRegistro[]): SaidaNfFinanceiro[] {
  return movimentos
    .filter((m) => m.tipo === 'saida' && m.nfId === nfId && !m.excluido)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((m) => ({
      id: m.id,
      data: m.dataSaida ?? m.createdAt,
      nfSaidaNumero: m.nfSaida?.numero ?? null,
      pesoSaida: pesoMovimentoRegistro(m),
      caixasSaida: caixasMovimento(m),
      paletesSaida: paletesMovimento(m),
    }))
}

function pesoRestanteNf(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
  pesoEntrada: number,
): number {
  if (!nfTemEstoque(nf)) return 0

  const fromItens = pesoItensLiquidoNf(nf)
  if (fromItens <= 1e-6) return 0

  const pesoSaido = pesoSaidoLiquidoNf(nf, nf.id, movimentos, pesoEntrada)
  if (pesoEntrada > 0) {
    return Math.min(fromItens, Math.max(0, pesoEntrada - pesoSaido))
  }

  return fromItens
}

function itemTemSaldoEstoque(it: NfeItem): boolean {
  if (it.allocatedAddresses.length > 0) return true
  const qtd = quantidadeEstoqueItem(it)
  if (qtd <= 1e-9) return false
  const pesoLiq = it.pesoLiquido ?? 0
  const pesoBr = it.pesoBruto ?? 0
  if (pesoLiq <= 1e-9 && pesoBr <= 1e-9) return false
  return true
}

function totalPaletesNf(nf: NotaFiscal): number {
  return nf.items.reduce((s, it) => {
    if (!itemTemSaldoEstoque(it)) return s
    if (it.paletes != null && it.paletes > 0) return s + it.paletes
    return s + it.allocatedAddresses.length
  }, 0)
}

function totalCaixasNf(nf: NotaFiscal): number {
  return nf.items.reduce((s, it) => {
    if (!itemTemSaldoEstoque(it)) return s
    const u = it.unidade.trim().toUpperCase()
    if (u === 'CX' || u === 'CAIXA' || u === 'FD' || u === 'FARDO') {
      return s + quantidadeEstoqueItem(it)
    }
    return s
  }, 0)
}

function dataEntradaNf(nf: NotaFiscal, movimentos: MovimentoRegistro[]): string {
  const armazenagem = dataArmazenagemNf(nf)
  if (armazenagem) return armazenagem
  const mov = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id)
  const fallback = mov?.createdAt ?? nf.createdAt
  return normalizarDataArmazenagemInput(fallback) ?? fallback
}

function dataSaidaNf(nfId: string, movimentos: MovimentoRegistro[]): string | null {
  const saidas = movimentos.filter((m) => m.tipo === 'saida' && m.nfId === nfId && !m.excluido)
  if (saidas.length === 0) return null
  return saidas.reduce((latest, m) => {
    const d = m.dataSaida ?? m.createdAt
    return d > latest ? d : latest
  }, saidas[0].dataSaida ?? saidas[0].createdAt)
}

function totalPosicoesNf(nf: NotaFiscal): number {
  return nf.items.reduce((s, it) => s + it.allocatedAddresses.length, 0)
}

function nfTemEstoque(nf: NotaFiscal): boolean {
  return nf.items.some((it) => it.quantidade > 1e-9 || it.allocatedAddresses.length > 0)
}

export function resumirNfArmazenada(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
  agora = new Date(),
): ResumoNfArmazenada {
  const entrada = dataEntradaNf(nf, movimentos)
  const saidas = listarSaidasNf(nf.id, movimentos)
  const dataUltimaSaida = dataUltimaSaidaRegistrada(saidas)
  const pesoBruto = pesoBrutoReferenciaNf(nf)
  const pesoLiquidoEntrada = pesoLiquidoReferenciaNf(nf, movimentos)
  const pesoSaidoBruto = pesoSaidoBrutoNf(nf, nf.id, movimentos, pesoBruto, pesoLiquidoEntrada)
  const pesoAtualBruto = nfTemEstoque(nf)
    ? pesoBrutoAtualNf(nf, movimentos, pesoBruto, pesoLiquidoEntrada)
    : 0
  const esgotada =
    saidas.length > 0 &&
    (pesoAtualBruto <= 1e-6 ||
      (pesoBruto > 0 && pesoSaidoBruto >= pesoBruto - 1e-3))
  const armazenada = nfTemEstoque(nf) && !esgotada
  const saida = esgotada ? (dataUltimaSaida ?? dataSaidaNf(nf.id, movimentos)) : dataSaidaNf(nf.id, movimentos)
  const pesoBrutoRestante = armazenada
    ? pesoBrutoRestanteNf(nf, movimentos, pesoBruto, pesoLiquidoEntrada)
    : 0
  const pesoAtual = armazenada ? pesoAtualBruto : 0
  const pesoRestante = armazenada ? pesoRestanteNf(nf, movimentos, pesoLiquidoEntrada) : 0
  const pesoSaidoLiquido = pesoSaidoLiquidoNf(nf, nf.id, movimentos, pesoLiquidoEntrada)
  const pesoSaido =
    pesoSaidoLiquido ||
    (pesoLiquidoEntrada > 0 ? Math.max(0, pesoLiquidoEntrada - pesoRestante) : 0)
  const pesoCobranca = armazenada ? pesoRestante : pesoLiquidoEntrada
  const entradaMov = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id && !m.excluido)
  const paletesEntrada = entradaMov ? paletesMovimento(entradaMov) : totalPaletesNf(nf)
  const paletesSaidos = saidas.reduce((s, x) => s + x.paletesSaida, 0)
  const diasCobranca = diasCobrancaArmazenagem(
    entrada,
    dataUltimaSaida,
    armazenada ? null : saida,
    armazenada,
    agora,
  )

  return {
    nfId: nf.id,
    nfNumero: nf.numero,
    emitente: nf.emitente,
    ...(nf.emitenteCnpj ? { emitenteCnpj: nf.emitenteCnpj } : {}),
    dataEntrada: entrada,
    dataSaida: armazenada ? null : saida,
    dataUltimaSaida,
    diasArmazenados: diasArmazenados(entrada, armazenada ? null : saida, agora),
    diasCobranca,
    pesoBruto,
    pesoBrutoRestante,
    pesoAtual,
    pesoSaidoBruto,
    pesoLiquido: pesoCobranca,
    pesoEntrada: pesoLiquidoEntrada,
    pesoRestante,
    pesoSaido,
    paletesEntrada,
    paletesSaidos,
    saidas,
    totalItens: nf.items.length,
    totalCaixas: totalCaixasNf(nf),
    totalPaletes: totalPaletesNf(nf),
    valorMercadoria: nf.valorTotalNota ?? nf.items.reduce((s, it) => s + (it.valorTotal ?? 0), 0),
    status: armazenada ? 'armazenada' : 'finalizada',
  }
}

export function calcularCobrancaNf(
  nf: NotaFiscal,
  contrato: ContratoCliente,
  tabela: TabelaCobranca,
  movimentos: MovimentoRegistro[],
  agora = new Date(),
): CobrancaNf {
  const resumo = resumirNfArmazenada(nf, movimentos, agora)
  const cobranca = calcularCobrancaDetalhada(resumo, contrato, tabela, {
    posicoes: totalPosicoesNf(nf),
    pesoBase:
      resumo.status === 'armazenada'
        ? resumo.pesoRestante > 0
          ? resumo.pesoRestante
          : resumo.pesoEntrada
        : resumo.pesoEntrada,
    paletes: resumo.totalPaletes,
  })
  return { nfId: nf.id, nfNumero: nf.numero, detalhes: cobranca.detalhes, total: cobranca.total }
}

function formatMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatFator(f: number): string {
  if (Math.abs(f - Math.round(f)) < 0.01) return String(Math.round(f))
  return f.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export type CobrancaDetalhada = {
  fatorTempo: number
  detalhes: DetalheCobranca[]
  /** Inclui taxas únicas (entrada/saída). */
  total: number
  /** Só armazenagem recorrente (posição, kilo, palete). */
  totalRecorrente: number
  valorDiaria: number
  valorVigente: number
}

/** Detalha cobrança conforme contrato/tabela (posição, kilo, palete, entrada, saída). */
export function calcularCobrancaDetalhada(
  resumo: ResumoNfArmazenada,
  contrato: ContratoCliente | null,
  tabela: TabelaCobranca | null,
  opts: { posicoes: number; pesoBase: number; paletes: number },
): CobrancaDetalhada {
  if (!contrato || !tabela) {
    return {
      fatorTempo: 0,
      detalhes: [],
      total: 0,
      totalRecorrente: 0,
      valorDiaria: 0,
      valorVigente: 0,
    }
  }

  const fator = fatorTempo(resumo.diasArmazenados, contrato.ciclo, contrato.regraTempo)
  const detalhes: DetalheCobranca[] = []
  let totalRecorrente = 0

  if (contrato.cobrarPosicaoPalete && tabela.custoPosicaoPalete > 0 && opts.posicoes > 0) {
    const valor = opts.posicoes * tabela.custoPosicaoPalete * fator
    detalhes.push({
      label: `Posição palete (${opts.posicoes} × ${formatMoeda(tabela.custoPosicaoPalete)} × ${formatFator(fator)})`,
      valor,
    })
    totalRecorrente += valor
  }

  if (contrato.cobrarKilo && tabela.custoPorKilo > 0) {
    const pesoBruto = pesoBrutoArmazenagem(resumo)
    if (pesoBruto > 0) {
      const periodoDias = diasNoPeriodo(contrato.ciclo)
      const diaria = valorDiariaPorKilo(pesoBruto, tabela.custoPorKilo, contrato.ciclo)
      const diasKilo = Math.max(1, resumo.diasCobranca)
      const acumulado = valorAcumuladoArmazenagem(diasKilo, diaria)
      const refDias = resumo.dataUltimaSaida && resumo.status === 'armazenada' ? 'última saída' : 'entrada'
      detalhes.push({
        label: `Kilo/dia (${pesoBruto.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg × ${formatMoeda(tabela.custoPorKilo)} ÷ ${periodoDias} dias × ${diasKilo} dias desde ${refDias})`,
        valor: acumulado,
      })
      totalRecorrente += acumulado
    }
  }

  if (contrato.cobrarPalete && tabela.custoPorPalete > 0 && opts.paletes > 0) {
    const valor = opts.paletes * tabela.custoPorPalete * fator
    detalhes.push({
      label: `Palete (${opts.paletes} × ${formatMoeda(tabela.custoPorPalete)} × ${formatFator(fator)})`,
      valor,
    })
    totalRecorrente += valor
  }

  if (contrato.cobrarEntrada && tabela.custoEntrada > 0 && resumo.paletesEntrada > 0) {
    const valor = resumo.paletesEntrada * tabela.custoEntrada
    detalhes.push({
      label: `Entrada (${resumo.paletesEntrada} paletes × ${formatMoeda(tabela.custoEntrada)})`,
      valor,
    })
  }

  const total = detalhes.reduce((s, d) => s + d.valor, 0)
  const diasRecorrente = Math.max(1, resumo.diasArmazenados)
  const diasKilo = Math.max(1, resumo.diasCobranca)
  let valorDiaria = 0
  let valorVigente = 0

  if (contrato.cobrarKilo && tabela.custoPorKilo > 0) {
    const pesoBruto = pesoBrutoArmazenagem(resumo)
    valorDiaria = valorDiariaPorKilo(pesoBruto, tabela.custoPorKilo, contrato.ciclo)
    valorVigente = valorAcumuladoArmazenagem(diasKilo, valorDiaria)
  } else if (totalRecorrente > 0) {
    valorDiaria = Math.floor((totalRecorrente / diasRecorrente) * 100) / 100
    valorVigente = valorAcumuladoArmazenagem(diasRecorrente, valorDiaria)
  }

  return { fatorTempo: fator, detalhes, total, totalRecorrente, valorDiaria, valorVigente }
}

export function totalPosicoesNotaFiscal(nf: NotaFiscal): number {
  return totalPosicoesNf(nf)
}

export function resumirClienteFinanceiro(
  cnpj: string,
  razaoSocial: string,
  contrato: ContratoCliente | null,
  tabela: TabelaCobranca | null,
  notas: NotaFiscal[],
  movimentos: MovimentoRegistro[],
  agora = new Date(),
): ResumoClienteFinanceiro {
  const nfsCliente = notas.filter((nf) => {
    const nfCnpj = nf.emitenteCnpj ? normalizarCnpj(nf.emitenteCnpj) : ''
    if (nfCnpj && nfCnpj === cnpj) return true
    return !nfCnpj && nf.emitente.trim().toLowerCase() === razaoSocial.trim().toLowerCase()
  })

  const resumos = nfsCliente.map((nf) => resumirNfArmazenada(nf, movimentos, agora))
  const nfsArmazenadas = resumos.filter((r) => r.status === 'armazenada')
  const nfsFinalizadas = resumos.filter((r) => r.status === 'finalizada')

  let cobrancas: CobrancaNf[] = []
  if (contrato && tabela) {
    cobrancas = nfsCliente.map((nf) => calcularCobrancaNf(nf, contrato, tabela, movimentos, agora))
  }

  const totalArmazenado = cobrancas
    .filter((c) => nfsArmazenadas.some((r) => r.nfId === c.nfId))
    .reduce((s, c) => s + c.total, 0)
  const totalFinalizado = cobrancas
    .filter((c) => nfsFinalizadas.some((r) => r.nfId === c.nfId))
    .reduce((s, c) => s + c.total, 0)

  return {
    cnpj,
    razaoSocial,
    contrato,
    tabela,
    nfsArmazenadas,
    nfsFinalizadas,
    cobrancas,
    totalArmazenado,
    totalFinalizado,
    totalGeral: totalArmazenado + totalFinalizado,
  }
}

export function formatarDataBr(iso: string): string {
  const d = parseDate(iso)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatarDataHoraBr(iso: string): string {
  const d = parseDate(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatMoedaFinanceiro(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
