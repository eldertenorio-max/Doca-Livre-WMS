import { buildProductByBarcodeMap, lookupProductByBarcode } from './barcodeProductLookup'
import { lookupProductOptionByCodigoGeneric, normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import type { ProductOption } from './productOptionMapper'

export type ProductLookupMaps = {
  byEan: Map<string, ProductOption>
  byDun: Map<string, ProductOption>
  byCode: Map<string, ProductOption>
  byCodeNoDots: Map<string, ProductOption>
}

export function buildProductLookupMaps(produtos: ProductOption[]): ProductLookupMaps {
  const byCode = new Map<string, ProductOption>()
  const byCodeNoDots = new Map<string, ProductOption>()
  for (const p of produtos) {
    byCode.set(p.codigo, p)
    byCode.set(p.codigo.replace(/\./g, ''), p)
    const key = normalizeCodigoInternoCompareKey(p.codigo)
    if (key) byCodeNoDots.set(key, p)
  }
  return {
    byEan: buildProductByBarcodeMap(produtos, 'ean'),
    byDun: buildProductByBarcodeMap(produtos, 'dun'),
    byCode,
    byCodeNoDots,
  }
}

export function buscarProdutoUnicoLocal(
  q: string,
  produtos: readonly ProductOption[],
  maps: ProductLookupMaps,
): ProductOption | null {
  const trimmed = q.trim()
  if (!trimmed) return null

  const barcode = lookupProductByBarcode(
    trimmed,
    produtos,
    maps.byDun,
    maps.byEan,
    maps.byCode,
    maps.byCodeNoDots,
  )
  if (barcode) return barcode.product

  const byCode = lookupProductOptionByCodigoGeneric(trimmed, maps.byCode, maps.byCodeNoDots)
  if (byCode) return byCode

  const ql = trimmed.toLowerCase()
  const byDesc = produtos.filter((p) => p.descricao.toLowerCase().includes(ql))
  if (byDesc.length === 1) return byDesc[0]
  const exactDesc = byDesc.find((p) => p.descricao.toLowerCase() === ql)
  if (exactDesc) return exactDesc

  return null
}

export function filtrarSugestoesProduto(
  q: string,
  produtos: readonly ProductOption[],
  maps: ProductLookupMaps,
  limit = 15,
): ProductOption[] {
  const trimmed = q.trim()
  const out: ProductOption[] = []
  const seen = new Set<string>()
  const add = (p: ProductOption) => {
    if (!seen.has(p.codigo)) {
      seen.add(p.codigo)
      out.push(p)
    }
  }

  if (!trimmed) {
    return [...produtos].slice(0, limit)
  }

  const unico = buscarProdutoUnicoLocal(trimmed, produtos, maps)
  if (unico) add(unico)

  const ql = trimmed.toLowerCase()
  const qDigits = trimmed.replace(/\D/g, '')

  for (const p of produtos) {
    if (out.length >= limit) break
    if (p.codigo.toLowerCase().includes(ql)) add(p)
    if (qDigits && p.codigo.replace(/\./g, '').includes(qDigits)) add(p)
    if (p.descricao.toLowerCase().includes(ql)) add(p)
    if (p.ean && (p.ean.includes(trimmed) || p.ean.replace(/\D/g, '').includes(qDigits))) add(p)
    if (p.dun && (p.dun.includes(trimmed) || p.dun.replace(/\D/g, '').includes(qDigits))) add(p)
  }

  return out.slice(0, limit)
}
