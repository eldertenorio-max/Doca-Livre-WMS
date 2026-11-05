import {
  isPresencaAtiva,
  PRESENCA_PING_INTERVAL_MS,
  PRESENCA_POLL_INTERVAL_MS,
} from './contagemDiariaPresenca'
import { supabase } from './supabaseClient'
import type { CapturaPresencaSessaoRow } from './capturaPresencaStatus'

export { PRESENCA_PING_INTERVAL_MS, PRESENCA_POLL_INTERVAL_MS, isPresencaAtiva }

const TABELA = 'contagem_diaria_captura_presenca'

export type ContagemDiariaCapturaPresencaRow = {
  contagem_id: string
  usuario_nome: string
  atualizado_em: string
}

export async function upsertContagemDiariaCapturaPresenca(
  contagemId: string,
  usuarioNome: string,
): Promise<void> {
  const id = String(contagemId ?? '').trim()
  const nome = String(usuarioNome ?? '').trim()
  if (!id || !nome) return
  try {
    const { error } = await supabase.from(TABELA).upsert(
      {
        contagem_id: id,
        usuario_nome: nome,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'contagem_id,usuario_nome' },
    )
    if (error && import.meta.env.DEV) console.warn(`[${TABELA}] upsert`, error)
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[${TABELA}] upsert`, e)
  }
}

export async function fetchContagemDiariaCapturaPresenca(contagemId: string): Promise<ContagemDiariaCapturaPresencaRow[]> {
  const id = String(contagemId ?? '').trim()
  if (!id) return []
  try {
    const { data, error } = await supabase
      .from(TABELA)
      .select('contagem_id,usuario_nome,atualizado_em')
      .eq('contagem_id', id)
    if (error) {
      if (import.meta.env.DEV) console.warn(`[${TABELA}] select`, error)
      return []
    }
    const out: ContagemDiariaCapturaPresencaRow[] = []
    for (const r of data ?? []) {
      const rec = r as ContagemDiariaCapturaPresencaRow
      const nome = String(rec.usuario_nome ?? '').trim()
      const em = String(rec.atualizado_em ?? '').trim()
      if (nome && em) out.push({ contagem_id: id, usuario_nome: nome, atualizado_em: em })
    }
    return out
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[${TABELA}] select`, e)
    return []
  }
}

export async function fetchContagemDiariaCapturaPresencaBatch(
  contagemIds: string[],
): Promise<CapturaPresencaSessaoRow[]> {
  const ids = [...new Set(contagemIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (ids.length === 0) return []
  try {
    const { data, error } = await supabase
      .from(TABELA)
      .select('contagem_id,usuario_nome,atualizado_em')
      .in('contagem_id', ids)
    if (error) {
      if (import.meta.env.DEV) console.warn(`[${TABELA}] select batch`, error)
      return []
    }
    const out: CapturaPresencaSessaoRow[] = []
    for (const r of data ?? []) {
      const rec = r as ContagemDiariaCapturaPresencaRow
      const sessaoId = String(rec.contagem_id ?? '').trim()
      const nome = String(rec.usuario_nome ?? '').trim()
      const em = String(rec.atualizado_em ?? '').trim()
      if (sessaoId && nome && em) {
        out.push({ sessaoId, usuario_nome: nome, atualizado_em: em })
      }
    }
    return out
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[${TABELA}] select batch`, e)
    return []
  }
}

/** Nomes únicos de quem está ativo nesta contagem (últimos 3 min). */
export function nomesContadoresAtivosContagemDiaria(
  rows: ContagemDiariaCapturaPresencaRow[],
  fallbackNome?: string,
): string {
  const ativos = rows
    .filter((r) => isPresencaAtiva(r.atualizado_em))
    .map((r) => r.usuario_nome.trim())
    .filter(Boolean)
  const unique = [...new Set(ativos)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (unique.length > 0) return unique.join(', ')
  const fb = String(fallbackNome ?? '').trim()
  return fb || '—'
}
