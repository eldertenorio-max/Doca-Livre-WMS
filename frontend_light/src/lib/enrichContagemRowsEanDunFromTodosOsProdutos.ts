import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import { supabase } from './supabaseClient'

const CATALOGO_CHUNK = 200
const TABELA_PRODUTOS = 'Todos os Produtos'

function isEmptyField(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  return false
}

/**
 * Preenche EAN, DUN e unidade de medida a partir do cadastro `Todos os Produtos` quando a contagem veio sem esses campos.
 */
export async function enrichContagemRowsEanDunFromTodosOsProdutos<
  T extends {
    codigo_interno?: string | null
    ean?: string | null
    dun?: string | null
    unidade_medida?: string | null
  },
>(rows: T[], logLabel = 'enrichEanDunCatalogo'): Promise<T[]> {
  const needEan = rows.some((r) => isEmptyField(r.ean))
  const needDun = rows.some((r) => isEmptyField(r.dun))
  const needUn = rows.some((r) => isEmptyField(r.unidade_medida))
  if (!needEan && !needDun && !needUn) return rows

  const cods = [
    ...new Set(
      rows
        .map((r) => String(r.codigo_interno ?? '').trim())
        .filter(Boolean),
    ),
  ]
  if (cods.length === 0) return rows

  const eanByCod = new Map<string, string>()
  const dunByCod = new Map<string, string>()
  const unByCod = new Map<string, string>()

  try {
    for (let i = 0; i < cods.length; i += CATALOGO_CHUNK) {
      const chunk = cods.slice(i, i + CATALOGO_CHUNK)
      let q = supabase.from(TABELA_PRODUTOS).select('codigo_interno,ean,dun,unidade').in('codigo_interno', chunk)
      let { data, error } = await q
      if (error) {
        const res2 = await supabase
          .from(TABELA_PRODUTOS)
          .select('codigo_interno,ean,dun,unidade_medida')
          .in('codigo_interno', chunk)
        data = res2.data
        error = res2.error
      }
      if (error) {
        const res3 = await supabase.from(TABELA_PRODUTOS).select('codigo_interno,ean,dun').in('codigo_interno', chunk)
        data = res3.data
        error = res3.error
      }
      if (error) {
        console.warn(`[${logLabel}] ${TABELA_PRODUTOS}:`, error)
        continue
      }
      for (const row of data ?? []) {
        const rec = row as {
          codigo_interno?: string
          ean?: string | null
          dun?: string | null
          unidade?: string | null
          unidade_medida?: string | null
        }
        const c = String(rec.codigo_interno ?? '').trim()
        if (!c) continue
        const keyNorm = normalizeCodigoInternoCompareKey(c)
        const e = rec.ean != null && String(rec.ean).trim() !== '' ? String(rec.ean).trim() : null
        const d = rec.dun != null && String(rec.dun).trim() !== '' ? String(rec.dun).trim() : null
        const u =
          rec.unidade != null && String(rec.unidade).trim() !== ''
            ? String(rec.unidade).trim()
            : rec.unidade_medida != null && String(rec.unidade_medida).trim() !== ''
              ? String(rec.unidade_medida).trim()
              : null
        const setMaps = (key: string) => {
          if (e && !eanByCod.has(key)) eanByCod.set(key, e)
          if (d && !dunByCod.has(key)) dunByCod.set(key, d)
          if (u && !unByCod.has(key)) unByCod.set(key, u)
        }
        setMaps(c)
        if (keyNorm && keyNorm !== c) setMaps(keyNorm)
      }
    }
  } catch (e) {
    console.warn(`[${logLabel}]`, e)
    return rows
  }

  return rows.map((r) => {
    const cod = String(r.codigo_interno ?? '').trim()
    if (!cod) return r
    const keyNorm = normalizeCodigoInternoCompareKey(cod)
    const eanCat = eanByCod.get(cod) ?? (keyNorm ? eanByCod.get(keyNorm) : undefined)
    const dunCat = dunByCod.get(cod) ?? (keyNorm ? dunByCod.get(keyNorm) : undefined)
    const unCat = unByCod.get(cod) ?? (keyNorm ? unByCod.get(keyNorm) : undefined)
    const next = { ...r } as T
    if (needEan && isEmptyField(r.ean) && eanCat) (next as { ean?: string | null }).ean = eanCat
    if (needDun && isEmptyField(r.dun) && dunCat) (next as { dun?: string | null }).dun = dunCat
    if (needUn && isEmptyField(r.unidade_medida) && unCat)
      (next as { unidade_medida?: string | null }).unidade_medida = unCat
    return next
  })
}
