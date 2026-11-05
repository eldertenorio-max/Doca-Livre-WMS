export type InventarioLinhaCaptura = {
  id: string
  endereco: string
  codigoBarras: string
  codigoInterno: string
  descricao: string
  quantidade: number
  unidade: string
  up: string
  lote: string
  fabricacao: string
  validade: string
  /** Câmara do endereço (extraída do cadastro ou do código). */
  camara?: number | null
  /** Conferente que registrou a linha. */
  conferenteNome?: string
  createdAt: string
}

export type InventarioSessao = {
  id: string
  numero: number
  titulo: string
  local: string
  posicoesNome?: string
  posicoesCodigos?: string[]
  catalogoProdutos?: 'ultrapao'
  listaEnderecamentoId?: string
  listaEnderecamentoNome?: string
  listaProdutosId?: string
  listaProdutosNome?: string
  dataInicio: string
  dataFim: string | null
  status: 'aberto' | 'fechado'
  linhas: InventarioLinhaCaptura[]
  createdAt: string
  updatedAt?: string
}
