import type { FinanceiroData } from '../types'

export type FinanceiroSaveOptions = {
  /** Permite gravar lista vazia (ex.: usuário excluiu o último registro). */
  permitirListaVazia?: boolean
}

export type FinanceiroRepository = {
  load: () => Promise<FinanceiroData>
  save: (data: FinanceiroData, opts?: FinanceiroSaveOptions) => Promise<void>
}
