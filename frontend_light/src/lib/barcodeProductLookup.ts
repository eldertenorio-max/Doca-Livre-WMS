import { lookupProductOptionByCodigoGeneric } from './codigoInternoCompare'

export type BarcodeLookupProduct = { codigo: string }

export function barcodeDigitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '')
}

function indexBarcodeKeys(map: Map<string, BarcodeLookupProduct>, raw: string | null | undefined, product: BarcodeLookupProduct) {
  const t = String(raw ?? '').trim()
  if (!t) return
  if (!map.has(t)) map.set(t, product)
  const dig = barcodeDigitsOnly(t)
  if (dig && !map.has(dig)) map.set(dig, product)
}

/** Índice EAN/DUN com chave exata e só dígitos (bipador pode omitir zero à esquerda). */
export function buildProductByBarcodeMap<T extends BarcodeLookupProduct>(
  products: readonly T[],
  field: 'ean' | 'dun',
): Map<string, T> {
  const map = new Map<string, T>()
  for (const p of products) {
    const raw = field === 'ean' ? (p as T & { ean?: string | null }).ean : (p as T & { dun?: string | null }).dun
    indexBarcodeKeys(map as Map<string, BarcodeLookupProduct>, raw, p)
  }
  return map
}

export function lookupProductByBarcode<T extends BarcodeLookupProduct>(
  scanned: string,
  products: readonly T[],
  byDun: Map<string, T>,
  byEan: Map<string, T>,
  productByCode: Map<string, T>,
  productByCodeNoDots: Map<string, T>,
): { product: T; tipo: 'DUN' | 'EAN' | null } | null {
  const q = scanned.trim()
  if (!q) return null

  const pDun = byDun.get(q) ?? byDun.get(barcodeDigitsOnly(q))
  if (pDun) return { product: pDun, tipo: 'DUN' }

  const pEan = byEan.get(q) ?? byEan.get(barcodeDigitsOnly(q))
  if (pEan) return { product: pEan, tipo: 'EAN' }

  const qDig = barcodeDigitsOnly(q)
  if (qDig.length >= 8) {
    for (const p of products) {
      const eanDig = barcodeDigitsOnly(String((p as T & { ean?: string | null }).ean ?? ''))
      const dunDig = barcodeDigitsOnly(String((p as T & { dun?: string | null }).dun ?? ''))
      if (dunDig && dunDig === qDig) return { product: p, tipo: 'DUN' }
      if (eanDig && eanDig === qDig) return { product: p, tipo: 'EAN' }
      if (eanDig && qDig.length === 12 && eanDig === `0${qDig}`) return { product: p, tipo: 'EAN' }
      if (eanDig && qDig.length === 13 && qDig.startsWith('0') && eanDig === qDig.slice(1)) {
        return { product: p, tipo: 'EAN' }
      }
    }
  }

  const pCode = lookupProductOptionByCodigoGeneric(q, productByCode, productByCodeNoDots)
  if (pCode) return { product: pCode, tipo: null }

  return null
}
