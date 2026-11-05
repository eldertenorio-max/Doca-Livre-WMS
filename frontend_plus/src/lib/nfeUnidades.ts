import type { NfeItem } from '../types'

/** Unidades de medida de peso na NF-e. */
export function isUnidadePeso(unidade: string): boolean {
  const u = unidade.trim().toUpperCase()
  return u === 'KG' || u === 'KGM' || u === 'QUILO' || u === 'QUILOGRAMA'
}

/** Descrição indica produto vendido em caixas (CX, CX20KG, CX VAR, etc.). */
export function descricaoIndicaCaixas(descricao: string): boolean {
  return /\bCX(?:\s*\d|\b)/i.test(descricao)
}

function caixasFromValorTributario(
  vUnCom: number,
  vUnTrib: number,
  vProd: number,
): number | null {
  if (!(vUnTrib > 0 && vUnCom > 0 && vProd > 0)) return null
  if (vUnTrib <= vUnCom * 2) return null
  const caixas = Math.round(vProd / vUnTrib)
  if (caixas < 1) return null
  const residual = Math.abs(vProd - caixas * vUnTrib) / vProd
  if (residual > 0.02) return null
  return caixas
}

/** Resolve quantidade/unidade comercial a partir dos campos do XML (prod). */
export function resolverQuantidadeComercialNfe(input: {
  qCom: number
  uCom: string
  qTrib: number
  uTrib: string
  descricao: string
  vUnCom?: number
  vUnTrib?: number
  vProd?: number
}): { quantidade: number; unidade: string } {
  const { qCom, uCom, qTrib, uTrib, descricao } = input
  const vUnCom = input.vUnCom ?? 0
  const vUnTrib = input.vUnTrib ?? 0
  const vProd = input.vProd ?? 0
  const comPeso = isUnidadePeso(uCom)
  const tribPeso = isUnidadePeso(uTrib)

  if (comPeso && qCom > 0) {
    const kgCx = kgPorCaixaFromDescricao(descricao)
    if (kgCx != null) {
      const caixas = qCom / kgCx
      if (caixas >= 1 && Math.abs(caixas - Math.round(caixas)) < 0.02) {
        return { quantidade: Math.round(caixas), unidade: 'CX' }
      }
    }
  }

  if (comPeso && qCom > 0 && descricaoIndicaCaixas(descricao)) {
    const caixasValor = caixasFromValorTributario(vUnCom, vUnTrib, vProd)
    if (caixasValor != null) {
      return { quantidade: caixasValor, unidade: 'CX' }
    }
  }

  if (comPeso && qCom > 0 && qTrib > 0 && qTrib < qCom * 0.15) {
    const caixas = Math.round(qTrib)
    if (caixas >= 1 && Math.abs(qTrib - caixas) < 0.02) {
      if (descricaoIndicaCaixas(descricao) || (uTrib && !isUnidadePeso(uTrib))) {
        return {
          quantidade: caixas,
          unidade: uTrib && !isUnidadePeso(uTrib) ? uTrib : 'CX',
        }
      }
    }
  }

  if (comPeso && uTrib && !tribPeso && qTrib > 0) {
    return { quantidade: qTrib, unidade: uTrib }
  }

  if (!comPeso && tribPeso && qCom > 0) {
    return { quantidade: qCom, unidade: uCom }
  }

  if (comPeso && qTrib > 0 && !tribPeso && qTrib !== qCom) {
    return { quantidade: qTrib, unidade: uTrib || 'UN' }
  }

  return { quantidade: qCom, unidade: uCom || 'UN' }
}

/** Peso por caixa indicado na descrição (ex.: "CX 20KG", "CX20KG"). */
export function kgPorCaixaFromDescricao(descricao: string): number | null {
  const m =
    descricao.match(/\bCX\s*(\d+(?:[.,]\d+)?)\s*KG\b/i) ??
    descricao.match(/\bCX(\d+(?:[.,]\d+)?)\s*KG\b/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return n > 0 ? n : null
}

/** Peso em kg do item quando a NF informa qCom/uCom em KG. */
export function pesoKgItem(item: NfeItem): number | undefined {
  if (item.pesoLiquido != null) return item.pesoLiquido
  if (item.pesoBruto != null) return item.pesoBruto
  if (isUnidadePeso(item.unidade) && item.quantidade > 0) return item.quantidade
  return undefined
}

function caixasFromPesoKg(item: NfeItem): number | null {
  const kgCx = kgPorCaixaFromDescricao(item.descricao)
  if (!kgCx) return null
  const peso = pesoKgItem(item)
  if (peso == null || peso <= 0) return null
  const caixas = peso / kgCx
  if (caixas < 1 || Math.abs(caixas - Math.round(caixas)) > 0.02) return null
  return Math.round(caixas)
}

function itemQuantidadeAindaEhPeso(item: NfeItem): boolean {
  if (!isUnidadePeso(item.unidade)) return false
  const peso = item.pesoBruto ?? item.pesoLiquido
  if (peso == null || peso <= 0) return false
  return Math.abs(item.quantidade - peso) / peso <= 0.001
}

/**
 * Quando um item da NF já foi convertido para caixas (ex. CX20KG) e outro ainda
 * está com quantidade = peso em KG (ex. CX VAR), usa a mesma contagem de caixas.
 */
export function aplicarQuantidadeComercialIrmaos(items: NfeItem[]): void {
  const caixasResolvidas = new Set<number>()
  for (const item of items) {
    if (isUnidadePeso(item.unidade)) continue
    const n = Math.round(item.quantidade)
    if (n >= 1 && Math.abs(item.quantidade - n) < 0.02) {
      caixasResolvidas.add(n)
    }
  }
  if (caixasResolvidas.size !== 1) return

  const caixasRef = [...caixasResolvidas][0]
  for (const item of items) {
    if (!itemQuantidadeAindaEhPeso(item)) continue
    if (!descricaoIndicaCaixas(item.descricao)) continue
    if (caixasFromPesoKg(item) != null) continue

    const peso = item.pesoBruto ?? item.pesoLiquido ?? item.quantidade
    const kgPorCaixa = peso / caixasRef
    if (kgPorCaixa < 8 || kgPorCaixa > 45) continue

    item.quantidade = caixasRef
    item.unidade = 'CX'
  }
}

/** Normaliza quantidade comercial de todos os itens de uma NF. */
export function normalizarQuantidadeItensNf(items: NfeItem[]): NfeItem[] {
  const next = items.map((it) => corrigirQuantidadeItemSePeso(it))
  aplicarQuantidadeComercialIrmaos(next)
  return next
}

/** Quantidade comercial para estoque/saída (caixas quando a NF traz peso em KG). */
export function quantidadeEstoqueItem(item: NfeItem): number {
  if (!isUnidadePeso(item.unidade)) return item.quantidade

  const caixas = caixasFromPesoKg(item)
  if (caixas != null) return caixas

  if (item.valorUnitario != null && item.valorUnitario > 0 && item.valorTotal != null && item.valorTotal > 0) {
    const porValor = item.valorTotal / item.valorUnitario
    if (porValor > 0 && porValor < item.quantidade * 0.95) {
      const diffRel = (item.quantidade - porValor) / item.quantidade
      if (diffRel > 0.05) return porValor
    }
  }

  return item.quantidade
}

/** Unidade exibida na saída/estoque (CX quando convertido a partir de KG). */
export function unidadeEstoqueItem(item: NfeItem): string {
  if (!isUnidadePeso(item.unidade)) return item.unidade
  if (caixasFromPesoKg(item) != null) return 'CX'
  return item.unidade
}

/**
 * Corrige itens gravados com quantidade = peso (uCom KG) quando a descrição indica caixas.
 * Útil ao carregar NF já importada antes da conversão comercial.
 */
export function corrigirQuantidadeItemSePeso(item: NfeItem): NfeItem {
  if (!isUnidadePeso(item.unidade)) return item
  const peso = item.pesoBruto ?? item.pesoLiquido
  if (peso == null || peso <= 0) return item
  if (Math.abs(item.quantidade - peso) / peso > 0.001) return item
  if (!descricaoIndicaCaixas(item.descricao)) return item

  const caixas = caixasFromPesoKg(item)
  if (caixas == null) return item

  return { ...item, quantidade: caixas, unidade: 'CX' }
}
