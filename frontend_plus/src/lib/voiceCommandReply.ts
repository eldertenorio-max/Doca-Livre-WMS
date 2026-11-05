import { formatAddressLabel } from '../layout/camaras'
import { STAGE_LABEL } from '../layout/stage'
import {
  buscarEstoque,
  CONSULTA_FILTROS_VAZIOS,
  type ConsultaEstoqueFiltros,
} from './consultaEstoque'
import type { VoiceCommand } from './parseVoiceCommand'
import type { NotaFiscal } from '../types'

function consultaLabel(filtros: Partial<ConsultaEstoqueFiltros>): string {
  const nf = filtros.nfNumero?.trim()
  const item = filtros.item?.trim()
  const rem = filtros.remetente?.trim()
  const lote = filtros.lote?.trim()
  if (nf) return `a NF ${nf}`
  if (item) return `o item “${item}”`
  if (rem) return `o remetente ${rem}`
  if (lote) return `o lote ${lote}`
  return 'o estoque'
}

export function formatEstoqueChatReply(
  notas: NotaFiscal[],
  filtros: Partial<ConsultaEstoqueFiltros>,
): string {
  const full: ConsultaEstoqueFiltros = {
    ...CONSULTA_FILTROS_VAZIOS,
    origem: 'ambos',
    ...filtros,
  }
  const rows = buscarEstoque(notas, full)
  const alvo = consultaLabel(full)
  if (rows.length === 0) {
    return `Não encontrei ${alvo} no estoque visível. Confira o número ou se a nota já foi endereçada.`
  }

  const linhas = rows.slice(0, 8).map((r) => {
    const where = r.isStage ? STAGE_LABEL : formatAddressLabel(r.addressId)
    const item = [r.codigo, r.descricao].filter(Boolean).join(' ')
    return `• NF ${r.nfNumero}${item ? ` · ${item}` : ''} · ${where}`
  })
  const extra = rows.length > 8 ? `\n… e mais ${rows.length - 8}` : ''
  const titulo =
    rows.length === 1
      ? `Encontrei 1 posição para ${alvo}:`
      : `Encontrei ${rows.length} posições para ${alvo}:`
  return `${titulo}\n${linhas.join('\n')}${extra}`
}

export function enrichCommandReply(
  cmd: VoiceCommand | null,
  notas: NotaFiscal[],
  fallback: string,
): string {
  if (!cmd) return fallback
  if (cmd.type === 'consultar') return formatEstoqueChatReply(notas, cmd.filtros)
  if (cmd.type === 'buscar_nota') {
    return formatEstoqueChatReply(notas, { nfNumero: cmd.numero, origem: 'ambos' })
  }
  return fallback
}

export function commandIsExecutable(cmd: VoiceCommand | null | undefined): cmd is VoiceCommand {
  return !!cmd && cmd.type !== 'assistente' && cmd.type !== 'desconhecido'
}
