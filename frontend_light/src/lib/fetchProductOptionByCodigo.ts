import { codigoInternoIguais, normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import { mapRowToProductOption, TABELA_PRODUTOS, type ProductOption } from './productOptionMapper'
import { supabase } from './supabaseClient'

function codigoLookupCandidates(codigo: string): string[] {
  const c = String(codigo ?? '').trim()
  if (!c) return []
  const out: string[] = []
  const push = (s: string) => {
    const t = String(s ?? '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  push(c)
  const norm = normalizeCodigoInternoCompareKey(c)
  if (norm) {
    push(norm)
    if (norm.length === 8) {
      push(`${norm.slice(0, 2)}.${norm.slice(2, 4)}.${norm.slice(4)}`)
      push(`${norm.slice(0, 2)}.${norm.slice(2, 4)}.${norm.slice(4, 8)}`)
    }
  }
  const digits = c.replace(/\D/g, '')
  if (digits.length === 7) {
    const padded = `${digits.slice(0, 4)}${digits.slice(4).padStart(4, '0')}`
    push(padded)
    push(`${padded.slice(0, 2)}.${padded.slice(2, 4)}.${padded.slice(4)}`)
  }
  return out
}

/**
 * Busca um produto recém-cadastrado direto no Supabase (quando ainda não está no cache local).
 */
export async function fetchProductOptionByCodigoFromDb(codigo: string): Promise<ProductOption | null> {
  const c = String(codigo ?? '').trim()
  if (!c) return null
  const candidates = codigoLookupCandidates(c)

  for (const cand of candidates) {
    for (const col of ['codigo_interno', 'codigo'] as const) {
      try {
        const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').eq(col, cand).limit(5)
        if (error) continue
        for (const row of data ?? []) {
          const p = mapRowToProductOption(row as Record<string, unknown>)
          if (p && codigoInternoIguais(p.codigo, c)) return p
        }
      } catch {
        /* rede / RLS */
      }
    }
  }

  const norm = normalizeCodigoInternoCompareKey(c)
  if (norm && norm.length >= 6) {
    try {
      const tail = norm.slice(-4)
      const { data, error } = await supabase
        .from(TABELA_PRODUTOS)
        .select('*')
        .ilike('codigo_interno', `%${tail}%`)
        .limit(40)
      if (!error && data?.length) {
        for (const row of data) {
          const p = mapRowToProductOption(row as Record<string, unknown>)
          if (p && codigoInternoIguais(p.codigo, c)) return p
        }
      }
    } catch {
      /* rede / RLS */
    }
  }

  return null
}

/** Busca por trecho da descrição (quando código/EAN não batem no cache local). */
export async function fetchProductOptionByDescricaoFromDb(desc: string): Promise<ProductOption | null> {
  const q = String(desc ?? '').trim()
  if (q.length < 2) return null
  try {
    const { data, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .ilike('descricao', `%${q}%`)
      .limit(8)
    if (error || !data?.length) return null
    const ql = q.toLowerCase()
    const mapped = data
      .map((row) => mapRowToProductOption(row as Record<string, unknown>))
      .filter(Boolean) as ProductOption[]
    const exact = mapped.find((p) => p.descricao.toLowerCase() === ql)
    if (exact) return exact
    const starts = mapped.find((p) => p.descricao.toLowerCase().startsWith(ql))
    if (starts) return starts
    return mapped[0] ?? null
  } catch {
    return null
  }
}
