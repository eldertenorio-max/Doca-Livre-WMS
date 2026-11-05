import type { FinanceiroData } from '../types'
import { financeiroVazio } from '../types'
import type { FinanceiroRepository } from './types'

const STORAGE_KEY = 'ultrafrio-financeiro'

function readLocal(): FinanceiroData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return financeiroVazio
    const parsed = JSON.parse(raw) as FinanceiroData
    return {
      tabelas: parsed.tabelas ?? [],
      contratos: parsed.contratos ?? [],
      clientes: parsed.clientes ?? [],
    }
  } catch {
    return financeiroVazio
  }
}

function writeLocal(data: FinanceiroData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const localFinanceiroRepository: FinanceiroRepository = {
  async load() {
    return readLocal()
  },
  async save(data) {
    writeLocal(data)
  },
}
