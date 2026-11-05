import { supabase } from './supabaseClient'
import {
  lookupProductOptionByCodigoGeneric,
  normalizeCodigoInternoCompareKey,
} from './codigoInternoCompare'

const TABELA_PRODUTOS = 'Todos os Produtos'

function normEanDun(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isColumnMissingError(e: unknown): boolean {
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = (
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  ).toLowerCase()
  return code === '42703' || msg.includes('does not exist')
}

/**
 * Após gravar em `contagens_estoque`, alinha o cadastro `Todos os Produtos` com EAN/DUN informados na contagem
 * e atualiza `ean_alterado_em` / `dun_alterado_em` (e legado `ean_dun_alterado_em` quando necessário),
 * no mesmo espírito da tela Base de produtos.
 */
export async function atualizarTodosOsProdutosEanDunAposFinalizacao<
  T extends { id: string; codigo: string; ean?: string | null; dun?: string | null },
>(
  rows: Array<{ codigo_interno: string; ean: string | null; dun: string | null }>,
  productByCode: Map<string, T>,
  productByCodeNoDots: Map<string, T>,
  opts?: { conferenteNome?: string | null },
): Promise<{ atualizados: number; avisos: string[] }> {
  const avisos: string[] = []
  const lastByNorm = new Map<string, (typeof rows)[0]>()
  for (const r of rows) {
    const k = normalizeCodigoInternoCompareKey(String(r.codigo_interno ?? ''))
    if (!k) continue
    lastByNorm.set(k, r)
  }

  let atualizados = 0
  const today = todayYmdLocal()
  const agoraIso = new Date().toISOString()
  const nomeConf = String(opts?.conferenteNome ?? '').trim() || 'Contagem diária'

  for (const it of lastByNorm.values()) {
    const codRaw = String(it.codigo_interno ?? '').trim()
    if (!codRaw) continue

    const cat = lookupProductOptionByCodigoGeneric(codRaw, productByCode, productByCodeNoDots)
    if (!cat) continue

    const finalEan = normEanDun(it.ean)
    const finalDun = normEanDun(it.dun)
    const catEan = normEanDun(cat.ean)
    const catDun = normEanDun(cat.dun)

    const eanChanged = finalEan !== catEan
    const dunChanged = finalDun !== catDun
    if (!eanChanged && !dunChanged) continue

    const patchBase: Record<string, unknown> = {}
    if (eanChanged) {
      patchBase.ean = finalEan
      patchBase.ean_alterado_em = today
      patchBase.ean_alterado_em_hora = agoraIso
      patchBase.ean_alterado_conferente = nomeConf
    }
    if (dunChanged) {
      patchBase.dun = finalDun
      patchBase.dun_alterado_em = today
      patchBase.dun_alterado_em_hora = agoraIso
      patchBase.dun_alterado_conferente = nomeConf
    }
    if (eanChanged || dunChanged) {
      patchBase.ean_dun_alterado_em = today
    }

    const runUpdate = (payload: Record<string, unknown>) => {
      let q = supabase.from(TABELA_PRODUTOS).update(payload)
      if (isUuid(String(cat.id).trim())) {
        q = q.eq('id', String(cat.id).trim()) as typeof q
      } else {
        q = q.eq('codigo_interno', cat.codigo.trim()) as typeof q
      }
      return q.select('id,codigo_interno').limit(1)
    }

    const tryUpdate = async (payload: Record<string, unknown>) => {
      let res = await runUpdate(payload)
      if (
        (!res.data || res.data.length === 0) &&
        !res.error &&
        isUuid(String(cat.id).trim()) &&
        cat.codigo.trim()
      ) {
        res = await supabase
          .from(TABELA_PRODUTOS)
          .update(payload)
          .eq('codigo_interno', cat.codigo.trim())
          .select('id,codigo_interno')
          .limit(1)
      }
      return res
    }

    const p1 = { ...patchBase }
    const p2 = { ...patchBase }
    delete p2.ean_dun_alterado_em
    const p3: Record<string, unknown> = {}
    if (eanChanged) p3.ean = finalEan
    if (dunChanged) p3.dun = finalDun
    if (eanChanged || dunChanged) p3.ean_dun_alterado_em = today
    const p4: Record<string, unknown> = {}
    if (eanChanged) p4.ean = finalEan
    if (dunChanged) p4.dun = finalDun

    const tries = [p1, p2, p3, p4].filter((x) => Object.keys(x).length > 0)

    let ok = false
    let lastErr: string | null = null
    for (const payload of tries) {
      const res = await tryUpdate(payload)
      if (res.error && isColumnMissingError(res.error)) continue
      if (res.error) {
        lastErr = res.error.message ?? 'erro ao atualizar cadastro'
        break
      }
      if (res.data && res.data.length > 0) {
        atualizados += 1
        ok = true
        break
      }
    }
    if (!ok) {
      if (lastErr) avisos.push(`${codRaw}: ${lastErr}`)
      else avisos.push(`${codRaw}: nenhuma linha atualizada em "${TABELA_PRODUTOS}" (confira RLS/código).`)
    }
  }

  return { atualizados, avisos }
}
