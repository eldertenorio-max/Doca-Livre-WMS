import type { NfeItem, NotaFiscal } from '../types'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from './formatNfeItem'

export type NfResumo = {
  pesoBruto: number | undefined
  pesoLiquido: number | undefined
  valorTotalNota: number | undefined
  quantidadeVolume: string
}

function quantidadeVolumeFromItems(items: NfeItem[]): string {
  const byUnit = new Map<string, number>()
  for (const it of items) {
    const u = it.unidade.trim() || 'UN'
    byUnit.set(u, (byUnit.get(u) ?? 0) + it.quantidade)
  }
  if (byUnit.size === 0) return '—'
  return [...byUnit.entries()]
    .map(([u, q]) => `${formatQuantidadeNfe(q)} ${u}`)
    .join(' · ')
}

export function buildNfResumo(nf: NotaFiscal): NfResumo {
  let pesoBruto = nf.pesoBruto
  let pesoLiquido = nf.pesoLiquido
  let valorTotalNota = nf.valorTotalNota

  if (pesoBruto == null) {
    const sum = nf.items.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
    if (sum > 0) pesoBruto = sum
  }

  if (valorTotalNota == null) {
    const sum = nf.items.reduce((s, it) => s + (it.valorTotal ?? 0), 0)
    if (sum > 0) valorTotalNota = sum
  }

  const quantidadeVolume = nf.quantidadeVolume?.trim() || quantidadeVolumeFromItems(nf.items)

  return {
    pesoBruto,
    pesoLiquido,
    valorTotalNota,
    quantidadeVolume,
  }
}

export function formatPesoKg(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${formatPesoBruto(value)} kg`
}

/** Extrai a quantidade numérica do campo qtd./vol. do XML (ex.: "3 CX" → 3). */
export function parseQuantidadeVolumeNumero(quantidadeVolume: string | undefined): number | null {
  if (!quantidadeVolume?.trim()) return null
  const match = quantidadeVolume.trim().match(/^([\d.,]+)/)
  if (!match) return null
  const n = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

export function formatNfResumoLinha(resumo: NfResumo): string {
  return [
    `P. bruto: ${formatPesoKg(resumo.pesoBruto)}`,
    `P. líq.: ${formatPesoKg(resumo.pesoLiquido)}`,
    `V. total: ${formatValorNfe(resumo.valorTotalNota)}`,
    `Qtd./vol.: ${resumo.quantidadeVolume}`,
  ].join(' · ')
}
