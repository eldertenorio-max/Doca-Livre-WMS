/**
 * Chave única para comparar código interno em **todo o app** (contagem, planilha, prévia,
 * relatório, armazém, enrich EAN/DUN, Base de produtos, filtros, etc.).
 *
 * Regras (cadastro costuma ser XX.XX.XXXX):
 * - Só dígitos (remove pontos, espaços e outros não numéricos).
 * - Com 8+ dígitos: usa a sequência inteira.
 * - Com 6 ou 7 dígitos: completa o último bloco para 4 dígitos (ex.: 0110003 → 01100003,
 *   equivalente a 01.10.0003 com um zero faltando no último grupo).
 */
export function normalizeCodigoInternoCompareKey(s: string): string {
  const digits = String(s ?? '').trim().replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length >= 8) return digits
  if (digits.length === 6 || digits.length === 7) {
    const head = digits.slice(0, 4)
    const tail = digits.slice(4).padStart(4, '0')
    return head + tail
  }
  return digits
}

export function codigoInternoIguais(a: string, b: string): boolean {
  return normalizeCodigoInternoCompareKey(a) === normalizeCodigoInternoCompareKey(b)
}

export function lookupProductOptionByCodigoGeneric<T extends { codigo: string }>(
  codigo: string,
  productByCode: Map<string, T>,
  productByCodeNoDots: Map<string, T>,
): T | undefined {
  const c = codigo.trim()
  if (!c) return undefined
  let p = productByCode.get(c)
  if (!p) {
    for (const [k, v] of productByCode) {
      if (k.trim() === c) {
        p = v
        break
      }
    }
  }
  if (!p) {
    const key = normalizeCodigoInternoCompareKey(c)
    if (key) p = productByCodeNoDots.get(key)
  }
  return p
}

export function lookupInCatalogMapGeneric<T extends { codigo: string }>(
  codigo: string,
  catalogMap: Map<string, T>,
): T | undefined {
  const c = codigo.trim()
  if (!c) return undefined
  let p = catalogMap.get(c)
  if (!p) {
    const key = normalizeCodigoInternoCompareKey(c)
    if (key) p = catalogMap.get(key)
  }
  if (!p) {
    for (const [k, v] of catalogMap) {
      if (k.trim() === c) {
        p = v
        break
      }
    }
  }
  return p
}
