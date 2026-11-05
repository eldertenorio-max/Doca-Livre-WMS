import { supabase } from './supabaseClient'

const CONFERENTES_CHUNK = 200

/**
 * Quando o SELECT não traz `conferentes(nome)` (embed bloqueado por RLS ou PostgREST),
 * busca nomes em lote na tabela `conferentes`.
 */
export async function fetchConferentesNomesPorIds(conferenteIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  const uniq = [...new Set(conferenteIds.map((id) => String(id).trim()).filter(Boolean))]
  if (uniq.length === 0) return m
  for (let i = 0; i < uniq.length; i += CONFERENTES_CHUNK) {
    const chunk = uniq.slice(i, i + CONFERENTES_CHUNK)
    const { data, error } = await supabase.from('conferentes').select('id,nome').in('id', chunk)
    if (error) {
      if (import.meta.env.DEV) console.warn('[conferentesNomesBatch]', error)
      continue
    }
    for (const row of data ?? []) {
      const rec = row as { id?: string; nome?: string | null }
      const id = rec.id != null ? String(rec.id) : ''
      const nome = rec.nome != null ? String(rec.nome).trim() : ''
      if (id && nome) m.set(id, nome)
    }
  }
  return m
}
