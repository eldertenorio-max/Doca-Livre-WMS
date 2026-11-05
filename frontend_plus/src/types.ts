export type AddressId = string

export type LocalizacaoEstoque = 'armazem' | 'stage'

export type NfeItem = {
  index: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  allocatedAddresses: AddressId[]
  /** Stage (separação) ou armazém físico. Padrão: armazém. */
  localizacao?: LocalizacaoEstoque
  pesoBruto?: number
  /** Peso líquido da linha (quando unidade comercial não é peso). */
  pesoLiquido?: number
  valorUnitario?: number
  valorTotal?: number
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
  /** Quantidade de paletes = máximo de endereços para este item na entrada. */
  paletes?: number
}

export type NotaFiscal = {
  id: string
  numero: string
  serie: string
  chave: string
  emitente: string
  /** CNPJ (ou CPF) do emitente da NF — usado para vincular ao cliente no Financeiro. */
  emitenteCnpj?: string
  dataEmissao: string
  /** Data a partir da qual a armazenagem começa a ser cobrada. */
  dataArmazenagem?: string
  items: NfeItem[]
  status: 'em_andamento' | 'concluida'
  createdAt: string
  /** Totais do documento (XML transp/total). */
  pesoBruto?: number
  pesoLiquido?: number
  valorTotalNota?: number
  quantidadeVolume?: string
  /** NF cancelada vinculada a esta nota (substituição). */
  nfCanceladaOrigemId?: string | null
  nfCanceladaOrigemNumero?: string | null
  /** Agendamento do Hub de Integração que originou esta entrada. */
  hubAgendamentoId?: number
}

/** Documento NF-e de saída (XML) vinculado à NF de origem no estoque. */
export type NfeDocumentoResumo = {
  numero: string
  serie: string
  chave: string
  emitente: string
  dataEmissao: string
}

export type SaidaXmlDocumento = NfeDocumentoResumo & {
  items: NfeItem[]
  pesoBruto?: number
  pesoLiquido?: number
  valorTotalNota?: number
}

export type NfeItemCancelado = {
  index: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  pesoBruto?: number
  pesoLiquido?: number
  valorUnitario?: number
  valorTotal?: number
}

export type NotaFiscalCancelada = {
  id: string
  numero: string
  serie: string
  chave: string
  emitente: string
  dataEmissao: string
  items: NfeItemCancelado[]
  pesoBruto?: number
  pesoLiquido?: number
  valorTotal?: number
  vinculoNfNovaId: string | null
  vinculoNfNovaNumero: string | null
  createdAt: string
  /** Registro mantido no histórico após exclusão na aba NF cancelada. */
  excluido?: boolean
  excluidoEm?: string
}

export type MovimentoTipo = 'entrada' | 'saida' | 'movimentacao'

export type JustificativaSaidaId =
  | 'venda'
  | 'transferencia'
  | 'descarte'
  | 'devolucao_remessa'
  | 'acerto_estoque'
  | 'revenda'

export type MotivoRemocaoEstoqueId =
  | 'nf_incorreta'
  | 'enderecamento_incorreto'
  | 'entrada_duplicada'
  | 'dados_item_incorretos'
  | 'xml_errado'
  | 'quantidade_incorreta'
  | 'entrada_indevida'
  | 'outro_erro'

export type MovimentoItemSnapshot = {
  itemIndex: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  addressIds: AddressId[]
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
  paletes?: number
  pesoBruto?: number
  pesoLiquido?: number
  valorUnitario?: number
  valorTotal?: number
  /** Quantidade retirada nesta saída parcial. */
  quantidadeSaida?: number
  /** Quantidade que permanece no estoque após a saída. */
  quantidadeSobra?: number
}

export type MovimentoRegistro = {
  id: string
  tipo: MovimentoTipo
  nfId: string
  nfNumero: string
  emitente: string
  createdAt: string
  itens: MovimentoItemSnapshot[]
  /** Totais do documento no momento do registro (entrada). */
  pesoBruto?: number
  pesoLiquido?: number
  valorTotal?: number
  /** Motivo da saída (venda, transferência, etc.). */
  justificativaSaida?: JustificativaSaidaId
  /** Motivo informado ao remover a NF do estoque pela aba Movimentação. */
  motivoRemocaoEstoque?: MotivoRemocaoEstoqueId
  /** NF de saída (documento) quando a retirada foi iniciada por XML de saída. */
  nfSaida?: NfeDocumentoResumo
  /** Data em que a mercadoria saiu (YYYY-MM-DD). Pode ser anterior ao registro no sistema. */
  dataSaida?: string
  /** Registro mantido no histórico após exclusão na aba Movimentação. */
  excluido?: boolean
  excluidoEm?: string
}

export type AddressOccupancy = {
  nfId: string
  nfNumero: string
  itemIndex: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
}

export type AppState = {
  notas: NotaFiscal[]
  notasCanceladas: NotaFiscalCancelada[]
  movimentos: MovimentoRegistro[]
  emitentes: string[]
  activeNfId: string | null
  activeItemIndex: number | null
}

export type PersistedData = {
  notas: NotaFiscal[]
  notasCanceladas: NotaFiscalCancelada[]
  movimentos: MovimentoRegistro[]
  emitentes: string[]
}
