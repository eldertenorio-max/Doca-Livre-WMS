import { isSupabaseConfigured } from '../../supabaseClient'
import { localFinanceiroRepository } from './localFinanceiroRepository'
import { supabaseFinanceiroRepository } from './supabaseFinanceiroRepository'
import type { FinanceiroRepository } from './types'

export function getFinanceiroRepository(): FinanceiroRepository {
  return isSupabaseConfigured() ? supabaseFinanceiroRepository : localFinanceiroRepository
}

export type { FinanceiroRepository } from './types'
