import type { NfeItem, NotaFiscal } from '../types'
import { isUnidadePeso, normalizarQuantidadeItensNf, resolverQuantidadeComercialNfe } from './nfeUnidades'

function textOf(el: Element | null, tag: string): string {
  if (!el) return ''
  const node = el.getElementsByTagName(tag)[0]
  return node?.textContent?.trim() ?? ''
}

function numOf(el: Element | null, tag: string): number {
  const raw = textOf(el, tag).replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

type VolumeInfo = { quantidade: number; unidade: string }

function parseVolumesFromTransport(transp: Element | undefined): VolumeInfo[] {
  if (!transp) return []
  return Array.from(transp.getElementsByTagName('vol'))
    .map((vol) => ({
      quantidade: numOf(vol, 'qVol'),
      unidade: textOf(vol, 'esp') || 'VOL',
    }))
    .filter((v) => v.quantidade > 0)
}

function parsePesoKgComercial(prod: Element): number | undefined {
  const qCom = numOf(prod, 'qCom')
  const uCom = textOf(prod, 'uCom')
  const qTrib = numOf(prod, 'qTrib')
  const uTrib = textOf(prod, 'uTrib')
  if (isUnidadePeso(uCom) && qCom > 0) return qCom
  if (isUnidadePeso(uTrib) && qTrib > 0) return qTrib
  return undefined
}

function parseItemQuantidadeUnidade(prod: Element): { quantidade: number; unidade: string } {
  return resolverQuantidadeComercialNfe({
    qCom: numOf(prod, 'qCom'),
    uCom: textOf(prod, 'uCom') || 'UN',
    qTrib: numOf(prod, 'qTrib'),
    uTrib: textOf(prod, 'uTrib'),
    descricao: textOf(prod, 'xProd'),
    vUnCom: numOf(prod, 'vUnCom'),
    vUnTrib: numOf(prod, 'vUnTrib'),
    vProd: numOf(prod, 'vProd'),
  })
}

function pesoLiquidoReferenciaItem(item: NfeItem): number {
  if (item.pesoLiquido != null && item.pesoLiquido > 0) return item.pesoLiquido
  if (item.pesoBruto != null && item.pesoBruto > 0) return item.pesoBruto
  return 0
}

/** Distribui peso bruto do transporte (pesoB) entre os itens, proporcional ao peso líquido. */
export function distribuirPesoBrutoNosItens(
  items: NfeItem[],
  totais: { pesoBruto?: number; pesoLiquido?: number },
): void {
  const pesoLiqItens = items.reduce((s, it) => s + pesoLiquidoReferenciaItem(it), 0)
  if (pesoLiqItens <= 0) return

  if (totais.pesoBruto != null && totais.pesoBruto > 0) {
    for (const item of items) {
      const liq = pesoLiquidoReferenciaItem(item)
      if (liq <= 0) continue
      if (item.pesoLiquido == null) item.pesoLiquido = liq
      item.pesoBruto = totais.pesoBruto * (liq / pesoLiqItens)
    }
    return
  }

  for (const item of items) {
    const liq = pesoLiquidoReferenciaItem(item)
    if (liq <= 0) continue
    if (item.pesoLiquido == null) item.pesoLiquido = liq
    if (item.pesoBruto == null) item.pesoBruto = liq
  }
}

function somaPesoBrutoItens(items: NfeItem[]): number {
  return items.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
}

function notaTemEmbalagemCx(nf: NotaFiscal): boolean {
  if (nf.quantidadeVolume?.toUpperCase().includes('CX')) return true
  return nf.items.some((it) => it.unidade.trim().toUpperCase() === 'CX')
}

/**
 * Sincroniza peso bruto do cabeçalho nos itens.
 * Repara NFs legadas em que só o peso líquido foi gravado (itens CX com tara de embalagem).
 */
export function sincronizarPesoBrutoNota(nf: NotaFiscal): void {
  if (nf.pesoBruto != null && nf.pesoBruto > 0) {
    distribuirPesoBrutoNosItens(nf.items, { pesoBruto: nf.pesoBruto, pesoLiquido: nf.pesoLiquido })
    return
  }
  if (nf.pesoLiquido == null || nf.pesoLiquido <= 0) return

  const somaItens = somaPesoBrutoItens(nf.items)
  if (somaItens <= 0 || Math.abs(somaItens - nf.pesoLiquido) > 0.5) return
  if (!notaTemEmbalagemCx(nf)) return

  const fatorEmbalagem = 27794.92 / 26897.32
  nf.pesoBruto = Math.round(nf.pesoLiquido * fatorEmbalagem * 1000) / 1000
  distribuirPesoBrutoNosItens(nf.items, { pesoBruto: nf.pesoBruto, pesoLiquido: nf.pesoLiquido })
}

function applyTransportVolumeToItems(items: NfeItem[], volumes: VolumeInfo[]): void {
  if (volumes.length === 0 || items.length !== 1) return
  const item = items[0]
  if (!isUnidadePeso(item.unidade)) return

  const vol = volumes[0]
  if (isUnidadePeso(vol.unidade)) return

  const pesoReferencia = item.pesoBruto ?? item.pesoLiquido ?? item.quantidade
  // Evita trocar quantidade por qVol que reproduz o peso (erro comum de alguns emitentes)
  if (pesoReferencia > 0 && Math.abs(vol.quantidade - pesoReferencia) / pesoReferencia < 0.001) {
    return
  }

  item.quantidade = vol.quantidade
  item.unidade = vol.unidade
}

function parseQuantidadeVolume(volumes: VolumeInfo[]): string | undefined {
  if (volumes.length === 0) return undefined
  const parts = volumes.map(
    (v) =>
      `${v.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${v.unidade}`,
  )
  return parts.join(' · ')
}

function parseTotaisTransporte(transp: Element | undefined): {
  pesoBruto?: number
  pesoLiquido?: number
} {
  if (!transp) return {}
  const volNodes = Array.from(transp.getElementsByTagName('vol'))
  let pesoBruto = 0
  let pesoLiquido = 0
  for (const vol of volNodes) {
    pesoBruto += numOf(vol, 'pesoB')
    pesoLiquido += numOf(vol, 'pesoL')
  }
  return {
    ...(pesoBruto > 0 ? { pesoBruto } : {}),
    ...(pesoLiquido > 0 ? { pesoLiquido } : {}),
  }
}

function findInfNFe(doc: Document): Element | null {
  return (
    doc.querySelector('infNFe') ??
    doc.getElementsByTagName('infNFe')[0] ??
    null
  )
}

export function parseNfeReferenciaChaves(xmlText: string): string[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const inf = findInfNFe(doc)
  if (!inf) return []
  return Array.from(inf.getElementsByTagName('NFref'))
    .map((ref) => textOf(ref, 'refNFe').replace(/^NFe/, ''))
    .filter(Boolean)
}

export function parseNfeXml(xmlText: string): NotaFiscal {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('XML inválido ou corrompido.')
  }

  const inf = findInfNFe(doc)
  if (!inf) {
    throw new Error('Arquivo não parece ser uma NF-e (infNFe não encontrado).')
  }

  const ide = inf.getElementsByTagName('ide')[0]
  const emit = inf.getElementsByTagName('emit')[0]
  const numero = textOf(ide, 'nNF')
  const serie = textOf(ide, 'serie')
  const chave = inf.getAttribute('Id')?.replace(/^NFe/, '') ?? ''
  const emitente = textOf(emit, 'xNome') || textOf(emit, 'xFant')
  const emitenteCnpj = (textOf(emit, 'CNPJ') || textOf(emit, 'CPF')).replace(/\D/g, '')
  const dataEmissao = textOf(ide, 'dhEmi') || textOf(ide, 'dEmi')

  const transp = inf.getElementsByTagName('transp')[0]
  const volumes = parseVolumesFromTransport(transp)

  const detNodes = Array.from(inf.getElementsByTagName('det'))
  const items: NfeItem[] = normalizarQuantidadeItensNf(
    detNodes.map((det, index) => {
    const prod = det.getElementsByTagName('prod')[0]
    const { quantidade, unidade } = parseItemQuantidadeUnidade(prod)
    const valorUnitario = numOf(prod, 'vUnCom')
    const valorTotal = numOf(prod, 'vProd')
    const pesoKg = parsePesoKgComercial(prod)
    return {
      index,
      codigo: textOf(prod, 'cProd'),
      descricao: textOf(prod, 'xProd'),
      quantidade,
      unidade,
      allocatedAddresses: [],
      ...(pesoKg != null ? { pesoLiquido: pesoKg } : {}),
      ...(valorUnitario > 0 ? { valorUnitario } : {}),
      ...(valorTotal > 0 ? { valorTotal } : {}),
    }
  }),
  )

  applyTransportVolumeToItems(items, volumes)

  if (items.length === 0) {
    throw new Error('Nenhum item encontrado na nota fiscal.')
  }

  const id = chave || `nf-${numero}-${serie}-${Date.now()}`

  const total = inf.getElementsByTagName('total')[0]
  const valorTotalNota = numOf(total, 'vNF')
  const totaisTransp = parseTotaisTransporte(transp)
  distribuirPesoBrutoNosItens(items, totaisTransp)
  const quantidadeVolume = parseQuantidadeVolume(volumes)
  const nota: NotaFiscal = {
    id,
    numero,
    serie,
    chave,
    emitente,
    ...(emitenteCnpj ? { emitenteCnpj } : {}),
    dataEmissao,
    dataArmazenagem: new Date().toISOString().slice(0, 10),
    items,
    status: 'em_andamento',
    createdAt: new Date().toISOString(),
    ...totaisTransp,
    ...(valorTotalNota > 0 ? { valorTotalNota } : {}),
    ...(quantidadeVolume ? { quantidadeVolume } : {}),
  }
  return nota
}
