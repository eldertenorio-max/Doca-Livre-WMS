/** Ciclo de cobrança da armazenagem. */
export type CicloCobranca = 'mensal' | 'quinzenal'

/**
 * Regra de tempo:
 * - proporcional: cobra só pelos dias armazenados dentro do período.
 * - cheia: cobra o período inteiro mesmo que fique poucos dias.
 */
export type RegraTempo = 'proporcional' | 'cheia'

/** Tabela de preços de armazenagem que pode ser vinculada a um contrato. */
export type TabelaCobranca = {
  id: string
  nome: string
  /** R$ por posição de palete ocupada, por período. */
  custoPosicaoPalete: number
  /** R$ por kg armazenado (por período; ou por dia se o contrato usar kiloPorDia). */
  custoPorKilo: number
  /** R$ por palete, por período. */
  custoPorPalete: number
  /** R$ por NF na entrada (cobrança única). */
  custoEntrada: number
  /** R$ por NF na saída (cobrança única). */
  custoSaida: number
  criadoEm: string
}

/** Contrato de armazenagem de um cliente (define o que será cobrado). */
export type ContratoCliente = {
  id: string
  /** CNPJ (somente dígitos) — chave lógica do cliente. */
  cnpj: string
  razaoSocial: string
  tabelaId: string | null
  ciclo: CicloCobranca
  regraTempo: RegraTempo
  cobrarPosicaoPalete: boolean
  cobrarKilo: boolean
  cobrarPalete: boolean
  cobrarEntrada: boolean
  cobrarSaida: boolean
  /** Se true, custo por kilo é multiplicado pelos dias armazenados. */
  kiloPorDia: boolean
  ativo: boolean
  observacao?: string
  criadoEm: string
}

/** Cliente cadastrado (auto ao dar entrada de NF ou manual). Nunca duplica CNPJ. */
export type ClienteFinanceiro = {
  /** CNPJ (somente dígitos) quando houver; senão chave derivada do nome. */
  cnpj: string
  razaoSocial: string
  origem: 'auto' | 'manual'
  criadoEm: string
}

export type FinanceiroData = {
  tabelas: TabelaCobranca[]
  contratos: ContratoCliente[]
  clientes: ClienteFinanceiro[]
}

export const financeiroVazio: FinanceiroData = {
  tabelas: [],
  contratos: [],
  clientes: [],
}
