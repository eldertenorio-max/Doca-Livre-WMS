import { formatAddressLabel } from '../layout/camaras'
import { STAGE_LABEL, itemNoStage } from '../layout/stage'
import type { NotaFiscal } from '../types'
import { contagemPaletesItem } from './paletes'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from './formatNfeItem'

export type RelatorioOrigem = 'armazem' | 'stage' | 'todos'

export type LinhaRelatorioNota = {
  nfNumero: string
  serie: string
  emitente: string
  dataEmissao: string
  status: string
  qtdItens: number
  quantidadeProdutos: number
  qtdPosicoes: number
  qtdPaletes: number
  valorTotal?: number
  pesoBruto?: number
}

export type LinhaRelatorioItem = {
  nfNumero: string
  emitente: string
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  lote?: string
  up?: string
  dataValidade?: string
  localizacao: 'armazem' | 'stage'
  enderecos: string
  paletes: number
  valorTotal?: number
}

export type RelatorioEstoqueResumo = {
  notas: LinhaRelatorioNota[]
  itens: LinhaRelatorioItem[]
  totalNotas: number
  totalItens: number
  totalPosicoes: number
}

function itemIncluido(item: NotaFiscal['items'][number], origem: RelatorioOrigem): boolean {
  const noStage = itemNoStage(item)
  const noArmazem = item.allocatedAddresses.length > 0
  if (origem === 'armazem') return noArmazem
  if (origem === 'stage') return noStage
  return noArmazem || noStage
}

function ordenarNotas(notas: NotaFiscal[]): NotaFiscal[] {
  return [...notas].sort((a, b) => {
    const na = Number(a.numero.replace(/\D/g, '') || 0)
    const nb = Number(b.numero.replace(/\D/g, '') || 0)
    if (nb !== na) return nb - na
    return a.numero.localeCompare(b.numero, 'pt-BR')
  })
}

export function coletarRelatorioEstoque(
  notas: NotaFiscal[],
  origem: RelatorioOrigem,
): RelatorioEstoqueResumo {
  const linhasItens: LinhaRelatorioItem[] = []
  const linhasNotas: LinhaRelatorioNota[] = []
  let totalPosicoes = 0

  for (const nf of ordenarNotas(notas)) {
    const itensNf: LinhaRelatorioItem[] = []

    for (const item of nf.items) {
      if (!itemIncluido(item, origem)) continue

      const noStage = itemNoStage(item)
      const enderecos = noStage
        ? STAGE_LABEL
        : item.allocatedAddresses.map((id) => formatAddressLabel(id)).join('; ')

      const linha: LinhaRelatorioItem = {
        nfNumero: nf.numero,
        emitente: nf.emitente,
        codigo: item.codigo,
        descricao: item.descricao,
        quantidade: item.quantidade,
        unidade: item.unidade,
        localizacao: noStage ? 'stage' : 'armazem',
        enderecos,
        paletes: noStage ? 0 : contagemPaletesItem(item),
        ...(item.lote ? { lote: item.lote } : {}),
        ...(item.up ? { up: item.up } : {}),
        ...(item.dataValidade ? { dataValidade: item.dataValidade } : {}),
        ...(item.valorTotal != null ? { valorTotal: item.valorTotal } : {}),
      }
      itensNf.push(linha)
      linhasItens.push(linha)
      if (!noStage) totalPosicoes += item.allocatedAddresses.length
    }

    if (itensNf.length === 0) continue

    const qtdPosicoes = itensNf
      .filter((it) => it.localizacao === 'armazem')
      .reduce((s, it) => s + (it.enderecos ? it.enderecos.split('; ').length : 0), 0)

    linhasNotas.push({
      nfNumero: nf.numero,
      serie: nf.serie,
      emitente: nf.emitente,
      dataEmissao: nf.dataEmissao,
      status: nf.status === 'concluida' ? 'Concluída' : 'Em andamento',
      qtdItens: itensNf.length,
      quantidadeProdutos: itensNf.reduce((s, it) => s + it.quantidade, 0),
      qtdPosicoes,
      qtdPaletes: itensNf.reduce((s, it) => s + it.paletes, 0),
      ...(nf.valorTotalNota != null ? { valorTotal: nf.valorTotalNota } : {}),
      ...(nf.pesoBruto != null ? { pesoBruto: nf.pesoBruto } : {}),
    })
  }

  return {
    notas: linhasNotas,
    itens: linhasItens,
    totalNotas: linhasNotas.length,
    totalItens: linhasItens.length,
    totalPosicoes,
  }
}

function csvEscape(value: string | number | undefined): string {
  const s = value == null ? '' : String(value)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function csvLine(cols: (string | number | undefined)[]): string {
  return cols.map(csvEscape).join(';')
}

export function gerarCsvNotas(linhas: LinhaRelatorioNota[]): string {
  const header = csvLine([
    'NF',
    'Série',
    'Emitente',
    'Data emissão',
    'Status',
    'Qtd itens',
    'Quantidade produtos',
    'Qtd posições',
    'Qtd paletes',
    'Valor total',
    'Peso bruto (kg)',
  ])
  const rows = linhas.map((n) =>
    csvLine([
      n.nfNumero,
      n.serie,
      n.emitente,
      n.dataEmissao,
      n.status,
      n.qtdItens,
      formatQuantidadeNfe(n.quantidadeProdutos),
      n.qtdPosicoes,
      n.qtdPaletes,
      n.valorTotal != null ? formatValorNfe(n.valorTotal) : '',
      n.pesoBruto != null ? formatPesoBruto(n.pesoBruto) : '',
    ]),
  )
  return [header, ...rows].join('\r\n')
}

export function gerarCsvItens(linhas: LinhaRelatorioItem[]): string {
  const header = csvLine([
    'NF',
    'Emitente',
    'Código',
    'Descrição',
    'Quantidade',
    'Unidade',
    'Lote',
    'UP',
    'Validade',
    'Localização',
    'Endereços',
    'Paletes',
    'Valor item',
  ])
  const rows = linhas.map((it) =>
    csvLine([
      it.nfNumero,
      it.emitente,
      it.codigo,
      it.descricao,
      formatQuantidadeNfe(it.quantidade),
      it.unidade,
      it.lote ?? '',
      it.up ?? '',
      it.dataValidade ?? '',
      it.localizacao === 'stage' ? 'Stage' : 'Armazém',
      it.enderecos,
      it.paletes,
      it.valorTotal != null ? formatValorNfe(it.valorTotal) : '',
    ]),
  )
  return [header, ...rows].join('\r\n')
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob(['\ufeff', content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function htmlTable(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function printReportHtml(title: string, subtitle: string, tableHtml: string): void {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 16mm; color: #111; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.meta { margin: 0 0 16px; color: #555; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #f9db00; font-weight: 700; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(subtitle)}</p>
  ${tableHtml}
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

function labelOrigem(origem: RelatorioOrigem): string {
  if (origem === 'armazem') return 'Armazém'
  if (origem === 'stage') return 'Stage'
  return 'Armazém + Stage'
}

export function imprimirRelatorioNotas(linhas: LinhaRelatorioNota[], origem: RelatorioOrigem): void {
  const gerado = new Date().toLocaleString('pt-BR')
  const subtitle = `${labelOrigem(origem)} · ${linhas.length} nota(s) · Gerado em ${gerado}`
  const table = htmlTable(
    ['NF', 'Série', 'Emitente', 'Emissão', 'Status', 'Itens', 'Qtd produtos', 'Posições', 'Paletes', 'Valor', 'Peso'],
    linhas.map((n) => [
      n.nfNumero,
      n.serie,
      n.emitente,
      n.dataEmissao,
      n.status,
      String(n.qtdItens),
      formatQuantidadeNfe(n.quantidadeProdutos),
      String(n.qtdPosicoes),
      String(n.qtdPaletes),
      n.valorTotal != null ? formatValorNfe(n.valorTotal) : '—',
      n.pesoBruto != null ? `${formatPesoBruto(n.pesoBruto)} kg` : '—',
    ]),
  )
  printReportHtml('Relatório de Notas Fiscais Armazenadas', subtitle, table)
}

export function imprimirRelatorioItens(linhas: LinhaRelatorioItem[], origem: RelatorioOrigem): void {
  const gerado = new Date().toLocaleString('pt-BR')
  const subtitle = `${labelOrigem(origem)} · ${linhas.length} item(ns) · Gerado em ${gerado}`
  const table = htmlTable(
    ['NF', 'Emitente', 'Código', 'Descrição', 'Qtd', 'Un', 'Lote', 'Local', 'Endereços', 'Paletes', 'Valor'],
    linhas.map((it) => [
      it.nfNumero,
      it.emitente,
      it.codigo,
      it.descricao,
      formatQuantidadeNfe(it.quantidade),
      it.unidade,
      it.lote ?? '—',
      it.localizacao === 'stage' ? 'Stage' : 'Armazém',
      it.enderecos,
      String(it.paletes),
      it.valorTotal != null ? formatValorNfe(it.valorTotal) : '—',
    ]),
  )
  printReportHtml('Relatório de Itens Armazenados', subtitle, table)
}

export function nomeArquivoRelatorio(tipo: 'notas' | 'itens', origem: RelatorioOrigem): string {
  const data = new Date().toISOString().slice(0, 10)
  const sufixo = origem === 'todos' ? 'completo' : origem
  return `ultrafrio-${tipo}-${sufixo}-${data}.csv`
}
