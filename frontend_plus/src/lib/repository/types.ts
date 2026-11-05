import type { AppState, MovimentoRegistro, NotaFiscal, PersistedData } from '../../types'

export type StorageMode = 'local' | 'supabase'

export type SaveDataOptions = {
  /** Snapshot já persistido anteriormente, usado para salvar só o que mudou (save incremental). */
  previous?: Omit<PersistedData, 'emitentes'> | null
}

export type EnderecamentoRepository = {
  mode: StorageMode
  loadData: () => Promise<PersistedData>
  saveData: (data: Omit<PersistedData, 'emitentes'>, opts?: SaveDataOptions) => Promise<void>
  registrarEmitente: (nome: string) => Promise<void>
  loadUiPrefs: () => Pick<AppState, 'activeNfId' | 'activeItemIndex'>
  saveUiPrefs: (prefs: Pick<AppState, 'activeNfId' | 'activeItemIndex'>) => void
}

export type { NotaFiscal, MovimentoRegistro, PersistedData }
