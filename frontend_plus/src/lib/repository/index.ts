import { isSupabaseConfigured } from '../supabaseClient'
import { localRepository } from './localRepository'
import { supabaseRepository } from './supabaseRepository'
import type { EnderecamentoRepository, StorageMode } from './types'
import { itemEnderecamentoCompleto } from '../paletes'

export type { EnderecamentoRepository, StorageMode }

export function getRepository(): EnderecamentoRepository {
  return isSupabaseConfigured() ? supabaseRepository : localRepository
}

export function getStorageMode(): StorageMode {
  return isSupabaseConfigured() ? 'supabase' : 'local'
}

export function allItemsAllocated(nf: import('../../types').NotaFiscal): boolean {
  return nf.items.every(itemEnderecamentoCompleto)
}
