import { nfTemEnderecos } from './movimentos'
import { nfTemEstoqueStage } from './stageEstoque'
import { itemNoStage } from '../layout/stage'
import {
  corrigirQuantidadeItemSePeso,
  normalizarQuantidadeItensNf,
  quantidadeEstoqueItem,
  unidadeEstoqueItem,
} from './nfeUnidades'
import type { NfeItem, NotaFiscal, SaidaXmlDocumento } from '../types'

export type SaidaOrigemVinculo = 'armazem' | 'stage'

export type VinculoSaidaXmlResult = {
  limitesPorItem: Record<number, number>
  itensExibicao: NfeItem[]
  avisos: string[]
}

function normCodigo(codigo: string): string {
  const t = codigo.trim().toUpperCase()
  const semZeros = t.replace(/^0+/, '')
  return semZeros || t
}

function itemNormalizadoParaVinculo(item: NfeItem): NfeItem {
  return corrigirQuantidadeItemSePeso(item)
}

function itemComEstoqueVinculo(item: NfeItem, origem: SaidaOrigemVinculo): boolean {
  const norm = itemNormalizadoParaVinculo(item)
  const qtd = quantidadeEstoqueItem(norm)
  if (qtd <= 1e-9) return false
  if (origem === 'stage') return itemNoStage(norm)
  if (itemNoStage(norm)) return false
  return norm.allocatedAddresses.length > 0 || qtd > 0
}

function itensOrigemParaVinculo(origem: NotaFiscal): NfeItem[] {
  return normalizarQuantidadeItensNf(origem.items.map((it) => ({ ...it })))
}

function itensEstoqueOrigem(origem: NotaFiscal, origemEstoque: SaidaOrigemVinculo): NfeItem[] {
  return itensOrigemParaVinculo(origem).filter((it) => itemComEstoqueVinculo(it, origemEstoque))
}

function quantidadesXmlPorCodigo(doc: SaidaXmlDocumento): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of doc.items) {
    const cod = normCodigo(item.codigo)
    if (!cod) continue
    const norm = itemNormalizadoParaVinculo(item)
    map.set(cod, (map.get(cod) ?? 0) + quantidadeEstoqueItem(norm))
  }
  return map
}

export function documentoSaidaFromNota(nf: NotaFiscal): SaidaXmlDocumento {
  return {
    numero: nf.numero,
    serie: nf.serie,
    chave: nf.chave,
    emitente: nf.emitente,
    dataEmissao: nf.dataEmissao,
    items: nf.items.map((it) => ({ ...it })),
    ...(nf.pesoBruto != null ? { pesoBruto: nf.pesoBruto } : {}),
    ...(nf.pesoLiquido != null ? { pesoLiquido: nf.pesoLiquido } : {}),
    ...(nf.valorTotalNota != null ? { valorTotalNota: nf.valorTotalNota } : {}),
  }
}

export function notasDisponiveisParaSaida(notas: NotaFiscal[]): NotaFiscal[] {
  return notas
    .filter((n) => nfTemEnderecos(n) || nfTemEstoqueStage(n))
    .sort((a, b) => b.numero.localeCompare(a.numero))
}

/** Extrai o número da NF (nNF) da chave de acesso de 44 dígitos. */
export function numeroFromChave(chave: string): string {
  const digits = chave.replace(/\D/g, '')
  if (digits.length < 34) return ''
  const nNF = digits.slice(25, 34).replace(/^0+/, '')
  return nNF || digits.slice(25, 34)
}

export type SaidaReferencia = {
  chave: string
  numero: string
  /** NF de entrada correspondente com estoque no sistema, ou null se indisponível. */
  nf: NotaFiscal | null
}

/**
 * Resolve as NFs de entrada referenciadas (NFref) pelo XML de saída,
 * indicando quais estão com estoque disponível para dar saída.
 */
export function resolverReferenciasSaida(
  notas: NotaFiscal[],
  refChaves: string[],
): SaidaReferencia[] {
  const comEstoque = notasDisponiveisParaSaida(notas)
  const vistos = new Set<string>()
  const referencias: SaidaReferencia[] = []

  for (const ch of refChaves) {
    const chNorm = ch.replace(/^NFe/, '').replace(/\D/g, '')
    if (!chNorm || vistos.has(chNorm)) continue
    vistos.add(chNorm)
    const nf =
      comEstoque.find(
        (n) => n.chave === chNorm || (chNorm.length >= 8 && n.chave.endsWith(chNorm)),
      ) ?? null
    referencias.push({ chave: chNorm, numero: numeroFromChave(chNorm), nf })
  }

  return referencias
}

/**
 * Verifica se a NF possui estoque (físico OU stage) com código correspondente
 * a algum item do XML de saída. Usado para liberar o fluxo de saída também
 * quando a mercadoria referenciada está no stage.
 */
export function saidaXmlCorrespondeNf(nf: NotaFiscal, doc: SaidaXmlDocumento): boolean {
  if (vincularSaidaXmlOrigem(nf, doc, 'armazem').itensExibicao.length > 0) return true
  return vincularSaidaXmlOrigem(nf, doc, 'stage').itensExibicao.length > 0
}

export function sugerirOrigemSaida(
  notas: NotaFiscal[],
  doc: SaidaXmlDocumento,
  refChaves: string[],
): NotaFiscal | null {
  const comEstoque = notasDisponiveisParaSaida(notas)

  for (const ch of refChaves) {
    const chNorm = ch.replace(/^NFe/, '')
    const found = comEstoque.find(
      (n) => n.chave === chNorm || (chNorm.length >= 8 && n.chave.endsWith(chNorm)),
    )
    if (found) return found
  }

  const xmlCodigos = [...quantidadesXmlPorCodigo(doc).keys()]
  if (xmlCodigos.length === 0) return null

  const candidatos = comEstoque.filter((nf) => {
    const origCodigos = new Set(
      [...itensEstoqueOrigem(nf, 'armazem'), ...itensEstoqueOrigem(nf, 'stage')].map((it) =>
        normCodigo(it.codigo),
      ),
    )
    return xmlCodigos.some((c) => origCodigos.has(c))
  })

  return candidatos.length === 1 ? candidatos[0] : null
}

export function vincularSaidaXmlOrigem(
  origem: NotaFiscal,
  doc: SaidaXmlDocumento,
  origemEstoque: SaidaOrigemVinculo = 'armazem',
): VinculoSaidaXmlResult {
  const avisos: string[] = []
  const limitesPorItem: Record<number, number> = {}
  const itensExibicao: NfeItem[] = []
  const usadoPorItem = new Map<number, number>()

  const estoqueOrigem = itensEstoqueOrigem(origem, origemEstoque)

  for (const xmlItem of doc.items) {
    const cod = normCodigo(xmlItem.codigo)
    const qtdXml = quantidadeEstoqueItem(itemNormalizadoParaVinculo(xmlItem))
    if (!cod || qtdXml <= 1e-9) continue

    const origItem = estoqueOrigem.find((it) => {
      if (normCodigo(it.codigo) !== cod) return false
      const qtdEstoque = quantidadeEstoqueItem(itemNormalizadoParaVinculo(it))
      const jaUsado = usadoPorItem.get(it.index) ?? 0
      return jaUsado < qtdEstoque - 1e-9
    })

    if (!origItem) continue

    const normOrig = itemNormalizadoParaVinculo(origItem)
    const qtdEstoque = quantidadeEstoqueItem(normOrig)
    const jaUsado = usadoPorItem.get(origItem.index) ?? 0
    const disponivel = qtdEstoque - jaUsado
    const limite = Math.min(qtdXml, disponivel)

    if (qtdXml > disponivel + 1e-9) {
      avisos.push(
        `${origItem.codigo}: XML pede ${qtdXml} ${unidadeEstoqueItem(normOrig)}, mas há ${disponivel} disponível nesta linha de estoque.`,
      )
    }

    limitesPorItem[origItem.index] = (limitesPorItem[origItem.index] ?? 0) + limite
    usadoPorItem.set(origItem.index, jaUsado + limite)

    if (!itensExibicao.some((i) => i.index === origItem.index)) {
      itensExibicao.push(origItem)
    }
  }

  itensExibicao.sort((a, b) => a.index - b.index)
  return { limitesPorItem, itensExibicao, avisos }
}

/** Escolhe armazém ou stage conforme onde o XML consegue vincular itens. */
export function origemEstoqueParaSaidaXml(
  nf: NotaFiscal,
  doc: SaidaXmlDocumento,
): SaidaOrigemVinculo | null {
  const arm = vincularSaidaXmlOrigem(nf, doc, 'armazem')
  const stage = vincularSaidaXmlOrigem(nf, doc, 'stage')
  const okArm = arm.itensExibicao.length > 0
  const okStage = stage.itensExibicao.length > 0
  if (okArm && !okStage) return 'armazem'
  if (okStage && !okArm) return 'stage'
  if (okArm && okStage) return 'armazem'
  return null
}
