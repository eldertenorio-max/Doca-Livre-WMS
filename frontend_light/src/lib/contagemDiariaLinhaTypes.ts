export type ContagemDiariaLinhaCaptura = {
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
  conferenteNome?: string
  createdAt: string
}
