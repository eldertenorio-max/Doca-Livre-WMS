import { isSupabaseConfigured, supabase } from './supabaseClient'
import { isTableMissingError } from './supabaseError'

const memory = new Map<string, boolean>()

function sessionKey(table: string) {
  return `dis-supabase-table:${table}`
}

export function resetSupabaseTableProbe(table: string): void {
  memory.delete(table)
  try {
    sessionStorage.removeItem(sessionKey(table))
  } catch {
    /* ignore */
  }
}

/** Verifica se a tabela existe no PostgREST (cache por aba do navegador). */
export async function isSupabaseTableAvailable(table: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  const cached = memory.get(table)
  if (cached !== undefined) return cached

  try {
    const flag = sessionStorage.getItem(sessionKey(table))
    if (flag === 'ok') {
      memory.set(table, true)
      return true
    }
    if (flag === 'missing') {
      memory.set(table, false)
      return false
    }
  } catch {
    /* ignore */
  }

  const { error } = await supabase.from(table).select('id').limit(1)
  if (!error) {
    memory.set(table, true)
    try {
      sessionStorage.setItem(sessionKey(table), 'ok')
    } catch {
      /* ignore */
    }
    return true
  }

  if (isTableMissingError(error, table)) {
    memory.set(table, false)
    try {
      sessionStorage.setItem(sessionKey(table), 'missing')
    } catch {
      /* ignore */
    }
    return false
  }

  return true
}
