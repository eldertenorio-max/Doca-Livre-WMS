import type { CapturaLinhaMobileItem } from '../components/inventario/CapturaLinhasMobile'
import { camaraFromEnderecoCodigo } from './enderecamentoStore'

type LinhaCapturaBase = {
  id: string
  endereco: string
  codigoInterno: string
  descricao: string
  quantidade: number
  unidade: string
  up: string
  lote: string
  fabricacao: string
  validade: string
  camara?: number | null
  conferenteNome?: string
  createdAt: string
}

function formatYmdBR(isoYmd: string) {
  if (!isoYmd?.trim()) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoYmd.slice(0, 10))
  if (!m) return isoYmd
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatDataLinha(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHora(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function camaraLabel(linha: LinhaCapturaBase): string {
  if (linha.camara != null && Number.isFinite(linha.camara)) return String(linha.camara)
  const parsed = camaraFromEnderecoCodigo(linha.endereco)
  return parsed != null ? String(parsed) : ''
}

export function linhaCapturaParaMobile(
  linha: LinhaCapturaBase,
  numero: number,
  editando: boolean,
  enderecoRepetido = false,
): CapturaLinhaMobileItem {
  return {
    id: linha.id,
    numero,
    codigo: linha.codigoInterno,
    descricao: linha.descricao,
    quantidade: `${linha.quantidade}${linha.unidade ? ` ${linha.unidade}` : ''}`,
    data: formatDataLinha(linha.createdAt),
    hora: formatHora(linha.createdAt),
    camara: camaraLabel(linha),
    conferente: linha.conferenteNome?.trim() || '',
    endereco: linha.endereco?.trim() || '',
    up: linha.up?.trim() || '',
    lote: linha.lote?.trim() || '',
    fabricacao: formatYmdBR(linha.fabricacao ?? ''),
    validade: formatYmdBR(linha.validade ?? ''),
    editando,
    enderecoRepetido,
  }
}
