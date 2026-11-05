import type { ContagemDiariaLinhaCaptura } from './contagemDiariaLinhaTypes'

export type { ContagemDiariaLinhaCaptura } from './contagemDiariaLinhaTypes'

export type ContagemDiariaSessao = {
  id: string
  numero: number
  titulo: string
  local: string
  dataContagem: string
  conferenteNome?: string
  listaProdutosId?: string
  listaProdutosNome?: string
  dataInicio: string
  dataFim: string | null
  status: 'aberto' | 'fechado'
  iniciada: boolean
  linhas: ContagemDiariaLinhaCaptura[]
  createdAt: string
  updatedAt?: string
}
