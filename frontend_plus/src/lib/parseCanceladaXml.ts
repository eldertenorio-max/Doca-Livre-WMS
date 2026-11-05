import type { NfeItem, NotaFiscal } from '../types'
import { parseNfeXml } from './parseNfeXml'

const TP_EVENTO_CANCELAMENTO = '110111'

function textOf(el: Element | null, tag: string): string {
  if (!el) return ''
  const node = el.getElementsByTagName(tag)[0]
  return node?.textContent?.trim() ?? ''
}

function normNumero(numero: string): string {
  return numero.trim().replace(/^0+/, '') || '0'
}

function parseChaveNfe(chave: string): { numero: string; serie: string } | null {
  const digits = chave.replace(/\D/g, '')
  if (digits.length !== 44) return null
  return {
    serie: String(Number(digits.slice(22, 25))),
    numero: String(Number(digits.slice(25, 34))),
  }
}

function findInfEventoCancelamento(doc: Document): Element | null {
  const eventos = Array.from(doc.getElementsByTagName('infEvento'))
  for (const inf of eventos) {
    if (textOf(inf, 'tpEvento') === TP_EVENTO_CANCELAMENTO) return inf
    const desc = inf.getElementsByTagName('descEvento')[0]?.textContent?.toLowerCase() ?? ''
    if (desc.includes('cancelamento')) return inf
  }
  return null
}

function notaReferencia(
  chave: string,
  numero: string,
  serie: string,
  notas: NotaFiscal[],
): NotaFiscal | undefined {
  return notas.find((n) => {
    if (chave && n.chave === chave) return true
    if (!numero) return false
    if (normNumero(n.numero) !== normNumero(numero)) return false
    if (!serie) return true
    return normNumero(n.serie) === normNumero(serie)
  })
}

function itemsFromReferencia(ref: NotaFiscal | undefined): NfeItem[] {
  if (!ref) return []
  return ref.items.map((it) => ({
    index: it.index,
    codigo: it.codigo,
    descricao: it.descricao,
    quantidade: it.quantidade,
    unidade: it.unidade,
    allocatedAddresses: [],
  }))
}

function parseProcEventoCancelamento(xmlText: string, notas: NotaFiscal[]): NotaFiscal {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('XML inválido ou corrompido.')
  }

  const inf = findInfEventoCancelamento(doc)
  if (!inf) {
    throw new Error('Evento de cancelamento não encontrado no XML.')
  }

  const chave = textOf(inf, 'chNFe')
  if (!chave) {
    throw new Error('Chave da NF-e não encontrada no evento de cancelamento.')
  }

  const fromChave = parseChaveNfe(chave)
  const numero = fromChave?.numero ?? ''
  const serie = fromChave?.serie ?? ''
  const dataEvento = textOf(inf, 'dhEvento')

  const ref = notaReferencia(chave, numero, serie, notas)

  return {
    id: chave,
    numero: ref?.numero ?? numero,
    serie: ref?.serie ?? serie,
    chave,
    emitente: ref?.emitente ?? '',
    dataEmissao: ref?.dataEmissao ?? dataEvento,
    items: itemsFromReferencia(ref),
    status: 'em_andamento',
    createdAt: new Date().toISOString(),
  }
}

function isEventoCancelamentoXml(xmlText: string): boolean {
  return /procEventoNFe|infEvento|tpEvento/i.test(xmlText) && !/<infNFe[\s>]/i.test(xmlText)
}

/** Aceita XML da NF-e completa ou XML do evento de cancelamento (procEventoNFe). */
export function parseCanceladaXml(xmlText: string, notas: NotaFiscal[] = []): NotaFiscal {
  if (isEventoCancelamentoXml(xmlText)) {
    return parseProcEventoCancelamento(xmlText, notas)
  }

  try {
    return parseNfeXml(xmlText)
  } catch (err) {
    if (isEventoCancelamentoXml(xmlText) || /procEventoNFe/i.test(xmlText)) {
      return parseProcEventoCancelamento(xmlText, notas)
    }
    throw err
  }
}
