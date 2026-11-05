import { labelJustificativaSaida } from './justificativaSaida'
import { formatValorNfe } from './formatNfeItem'
import { calcularResumoEstoqueArmazem } from './painelEstoqueArmazem'
import { itemNoStage } from '../layout/stage'
import type { MovimentoRegistro, NotaFiscal, MovimentoTipo } from '../types'

export type PainelGraficoId =
  | 'estoque-valor-total'
  | 'estoque-valor-paletes'
  | 'estoque-pos-ocupadas'
  | 'estoque-pos-livres'
  | 'estoque-ocupacao'
  | 'entradas-saidas-dia'
  | 'movimentos-tipo'
  | 'movimentos-linha'
  | 'top-emitentes'
  | 'saidas-motivo'
  | 'paletes-dia'
  | 'nfs-dia'
  | 'stage-armazem'

export type PainelFiltros = {
  dataInicio: string
  horaInicio: string
  dataFim: string
  horaFim: string
}

export type PainelGraficoSugestao = {
  id: PainelGraficoId
  titulo: string
  descricao: string
  categoria: 'movimentacao' | 'estoque' | 'operacao'
}

export type PainelSerie = {
  label: string
  value: number
  cor?: string
  /** Rótulo formatado na barra (ex.: moeda, %). */
  displayValue?: string
}

export const PAINEL_GRAFICOS_FIXOS: PainelGraficoId[] = [
  'estoque-valor-total',
  'estoque-valor-paletes',
  'estoque-pos-ocupadas',
  'estoque-pos-livres',
  'estoque-ocupacao',
  'entradas-saidas-dia',
  'movimentos-tipo',
  'movimentos-linha',
  'top-emitentes',
  'saidas-motivo',
  'paletes-dia',
  'nfs-dia',
  'stage-armazem',
]

export const PAINEL_GRAFICOS_SUGESTOES: PainelGraficoSugestao[] = [
  {
    id: 'estoque-valor-total',
    titulo: 'Valor total armazenado',
    descricao: 'Soma do valor dos itens em estoque (armazém e stage), total e por câmara.',
    categoria: 'estoque',
  },
  {
    id: 'estoque-valor-paletes',
    titulo: 'Valor em paletes (armazém)',
    descricao: 'Valor proporcional alocado aos endereços físicos ocupados.',
    categoria: 'estoque',
  },
  {
    id: 'estoque-pos-ocupadas',
    titulo: 'Posições ocupadas',
    descricao: 'Endereços físicos com palete, total e por câmara.',
    categoria: 'estoque',
  },
  {
    id: 'estoque-pos-livres',
    titulo: 'Posições livres',
    descricao: 'Endereços disponíveis no armazém, total e por câmara.',
    categoria: 'estoque',
  },
  {
    id: 'estoque-ocupacao',
    titulo: 'Ocupação do armazém',
    descricao: 'Percentual de posições ocupadas, total e por câmara.',
    categoria: 'estoque',
  },
  {
    id: 'entradas-saidas-dia',
    titulo: 'Entradas vs saídas por dia',
    descricao: 'Comparativo diário de NFs que entraram e saíram do estoque.',
    categoria: 'movimentacao',
  },
  {
    id: 'movimentos-tipo',
    titulo: 'Movimentos por tipo',
    descricao: 'Distribuição entre entrada, saída e movimentação interna.',
    categoria: 'movimentacao',
  },
  {
    id: 'movimentos-linha',
    titulo: 'Volume ao longo do tempo',
    descricao: 'Total de registros por dia no período selecionado.',
    categoria: 'movimentacao',
  },
  {
    id: 'top-emitentes',
    titulo: 'Top emitentes (entradas)',
    descricao: 'Remetentes com mais entradas registradas no período.',
    categoria: 'operacao',
  },
  {
    id: 'saidas-motivo',
    titulo: 'Saídas por motivo',
    descricao: 'Motivos informados nas saídas finalizadas.',
    categoria: 'operacao',
  },
  {
    id: 'paletes-dia',
    titulo: 'Paletes movimentados por dia',
    descricao: 'Soma de endereços/paletes envolvidos em movimentos.',
    categoria: 'movimentacao',
  },
  {
    id: 'nfs-dia',
    titulo: 'NFs processadas por dia',
    descricao: 'Quantidade de notas distintas com movimento por dia.',
    categoria: 'operacao',
  },
  {
    id: 'stage-armazem',
    titulo: 'Stage vs armazém (atual)',
    descricao: 'Itens hoje em separação no stage e no armazém físico.',
    categoria: 'estoque',
  },
]

const TIPO_LABEL: Record<MovimentoTipo, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  movimentacao: 'Movimentação',
}

const CORES_TIPO: Record<MovimentoTipo, string> = {
  entrada: '#22c55e',
  saida: '#f59e0b',
  movimentacao: '#3b82f6',
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function defaultPainelFiltros(): PainelFiltros {
  return painelFiltrosPorDias(30)
}

export function painelFiltrosPorDias(dias: number): PainelFiltros {
  const fim = new Date()
  const inicio = new Date()
  if (dias > 0) inicio.setDate(inicio.getDate() - dias)
  return {
    dataInicio: inicio.toISOString().slice(0, 10),
    horaInicio: '00:00',
    dataFim: fim.toISOString().slice(0, 10),
    horaFim: '23:59',
  }
}

export function filtrosParaIntervalo(filtros: PainelFiltros): { inicio: Date; fim: Date } | null {
  if (!filtros.dataInicio || !filtros.dataFim) return null
  const inicio = new Date(`${filtros.dataInicio}T${filtros.horaInicio || '00:00'}:00`)
  const fim = new Date(`${filtros.dataFim}T${filtros.horaFim || '23:59'}:59`)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return null
  if (inicio > fim) return null
  return { inicio, fim }
}

export function filtrarMovimentos(
  movimentos: MovimentoRegistro[],
  filtros: PainelFiltros,
): MovimentoRegistro[] {
  const intervalo = filtrosParaIntervalo(filtros)
  if (!intervalo) return movimentos
  const { inicio, fim } = intervalo
  return movimentos.filter((m) => {
    const t = new Date(m.createdAt).getTime()
    return t >= inicio.getTime() && t <= fim.getTime()
  })
}

function diaKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDiaLabel(key: string): string {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

function diasNoIntervalo(filtros: PainelFiltros): string[] {
  const intervalo = filtrosParaIntervalo(filtros)
  if (!intervalo) return []
  const dias: string[] = []
  const cur = new Date(intervalo.inicio)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(intervalo.fim)
  end.setHours(0, 0, 0, 0)
  while (cur <= end) {
    dias.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return dias.length > 31 ? dias.slice(-31) : dias
}

function contarPaletesMovimento(m: MovimentoRegistro): number {
  return m.itens.reduce((s, it) => s + (it.paletes ?? it.addressIds.length), 0)
}

const COR_CAMARA = '#3b82f6'
const COR_TOTAL = '#6366f1'
const COR_STAGE = '#a855f7'

function seriesEstoqueCamara(
  resumo: ReturnType<typeof calcularResumoEstoqueArmazem>,
  pick: (c: (typeof resumo.camaras)[0]) => number,
  pickTotal: number,
  format?: (v: number) => string,
): PainelSerie[] {
  const fmt = format ?? ((v: number) => String(Math.round(v)))
  const series: PainelSerie[] = [
    {
      label: 'Total',
      value: pickTotal,
      cor: COR_TOTAL,
      displayValue: fmt(pickTotal),
    },
    ...resumo.camaras.map((c) => ({
      label: c.label,
      value: pick(c),
      cor: COR_CAMARA,
      displayValue: fmt(pick(c)),
    })),
  ]
  return series
}

export function graficoEstoqueAtual(id: PainelGraficoId): boolean {
  return (
    id === 'estoque-valor-total' ||
    id === 'estoque-valor-paletes' ||
    id === 'estoque-pos-ocupadas' ||
    id === 'estoque-pos-livres' ||
    id === 'estoque-ocupacao'
  )
}

export function dadosGrafico(
  id: PainelGraficoId,
  movimentos: MovimentoRegistro[],
  notas: NotaFiscal[],
  filtros: PainelFiltros,
): PainelSerie[] {
  const filtrados = filtrarMovimentos(movimentos, filtros)

  switch (id) {
    case 'estoque-valor-total': {
      const r = calcularResumoEstoqueArmazem(notas)
      const series = seriesEstoqueCamara(
        r,
        (c) => c.valorArmazenado,
        r.total.valorTotalArmazenado,
        (v) => formatValorNfe(v),
      )
      if (r.total.valorStage > 0) {
        series.push({
          label: 'Stage',
          value: r.total.valorStage,
          cor: COR_STAGE,
          displayValue: formatValorNfe(r.total.valorStage),
        })
      }
      return series
    }

    case 'estoque-valor-paletes': {
      const r = calcularResumoEstoqueArmazem(notas)
      return seriesEstoqueCamara(
        r,
        (c) => c.valorPaletes,
        r.total.valorPaletesArmazenado,
        (v) => formatValorNfe(v),
      )
    }

    case 'estoque-pos-ocupadas': {
      const r = calcularResumoEstoqueArmazem(notas)
      return seriesEstoqueCamara(
        r,
        (c) => c.posicoesOcupadas,
        r.total.posicoesOcupadas,
        (v) => String(v),
      )
    }

    case 'estoque-pos-livres': {
      const r = calcularResumoEstoqueArmazem(notas)
      return seriesEstoqueCamara(
        r,
        (c) => c.posicoesLivres,
        r.total.posicoesLivres,
        (v) => String(v),
      )
    }

    case 'estoque-ocupacao': {
      const r = calcularResumoEstoqueArmazem(notas)
      return seriesEstoqueCamara(
        r,
        (c) => c.ocupacaoPct,
        r.total.ocupacaoPct,
        (v) => `${v.toFixed(1)}%`,
      )
    }

    case 'entradas-saidas-dia': {
      const dias = diasNoIntervalo(filtros)
      const entradas = new Map<string, number>()
      const saidas = new Map<string, number>()
      for (const d of dias) {
        entradas.set(d, 0)
        saidas.set(d, 0)
      }
      for (const m of filtrados) {
        if (m.tipo !== 'entrada' && m.tipo !== 'saida') continue
        const k = diaKey(m.createdAt)
        const map = m.tipo === 'entrada' ? entradas : saidas
        map.set(k, (map.get(k) ?? 0) + 1)
      }
      const result: PainelSerie[] = []
      for (const d of dias) {
        result.push({ label: `${formatDiaLabel(d)} · Ent`, value: entradas.get(d) ?? 0, cor: CORES_TIPO.entrada })
        result.push({ label: `${formatDiaLabel(d)} · Sai`, value: saidas.get(d) ?? 0, cor: CORES_TIPO.saida })
      }
      return result.filter((s) => s.value > 0).length > 0 ? result : dias.map((d) => ({ label: formatDiaLabel(d), value: 0 }))
    }

    case 'movimentos-tipo': {
      const counts: Record<MovimentoTipo, number> = { entrada: 0, saida: 0, movimentacao: 0 }
      for (const m of filtrados) counts[m.tipo]++
      return (['entrada', 'saida', 'movimentacao'] as MovimentoTipo[]).map((t) => ({
        label: TIPO_LABEL[t],
        value: counts[t],
        cor: CORES_TIPO[t],
      }))
    }

    case 'movimentos-linha': {
      const dias = diasNoIntervalo(filtros)
      const map = new Map(dias.map((d) => [d, 0]))
      for (const m of filtrados) {
        const k = diaKey(m.createdAt)
        map.set(k, (map.get(k) ?? 0) + 1)
      }
      return dias.map((d) => ({ label: formatDiaLabel(d), value: map.get(d) ?? 0, cor: '#6366f1' }))
    }

    case 'top-emitentes': {
      const map = new Map<string, number>()
      for (const m of filtrados.filter((x) => x.tipo === 'entrada')) {
        const e = m.emitente.trim() || 'Sem emitente'
        map.set(e, (map.get(e) ?? 0) + 1)
      }
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, value]) => ({ label, value, cor: '#22c55e' }))
    }

    case 'saidas-motivo': {
      const map = new Map<string, number>()
      for (const m of filtrados.filter((x) => x.tipo === 'saida')) {
        const label =
          (m.justificativaSaida ? labelJustificativaSaida(m.justificativaSaida) : null) ??
          'Não informado'
        map.set(label, (map.get(label) ?? 0) + 1)
      }
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value, cor: '#f59e0b' }))
    }

    case 'paletes-dia': {
      const dias = diasNoIntervalo(filtros)
      const map = new Map(dias.map((d) => [d, 0]))
      for (const m of filtrados) {
        const k = diaKey(m.createdAt)
        map.set(k, (map.get(k) ?? 0) + contarPaletesMovimento(m))
      }
      return dias.map((d) => ({ label: formatDiaLabel(d), value: map.get(d) ?? 0, cor: '#8b5cf6' }))
    }

    case 'nfs-dia': {
      const dias = diasNoIntervalo(filtros)
      const porDia = new Map<string, Set<string>>()
      for (const d of dias) porDia.set(d, new Set())
      for (const m of filtrados) {
        const k = diaKey(m.createdAt)
        porDia.get(k)?.add(m.nfId)
      }
      return dias.map((d) => ({
        label: formatDiaLabel(d),
        value: porDia.get(d)?.size ?? 0,
        cor: '#0ea5e9',
      }))
    }

    case 'stage-armazem': {
      let stage = 0
      let armazem = 0
      for (const nf of notas) {
        for (const item of nf.items) {
          if (itemNoStage(item)) stage++
          else if (item.allocatedAddresses.length > 0) armazem++
        }
      }
      return [
        { label: 'Stage', value: stage, cor: '#a855f7' },
        { label: 'Armazém', value: armazem, cor: '#3b82f6' },
      ]
    }

    default:
      return []
  }
}

export type PainelSecaoId = 'estoque' | 'movimentacao' | 'operacao'

export type PainelSecao = {
  id: PainelSecaoId
  titulo: string
  subtitulo: string
  graficos: PainelGraficoId[]
}

/** Gráficos agrupados por seção na aba Painel. */
export const PAINEL_SECOES: PainelSecao[] = [
  {
    id: 'estoque',
    titulo: 'Estoque atual',
    subtitulo: 'Situação em tempo real do armazém',
    graficos: [
      'estoque-ocupacao',
      'estoque-valor-total',
      'estoque-valor-paletes',
      'estoque-pos-ocupadas',
      'estoque-pos-livres',
      'stage-armazem',
    ],
  },
  {
    id: 'movimentacao',
    titulo: 'Movimentação',
    subtitulo: 'Fluxo e volume no período selecionado',
    graficos: ['entradas-saidas-dia', 'movimentos-linha', 'movimentos-tipo', 'paletes-dia', 'nfs-dia'],
  },
  {
    id: 'operacao',
    titulo: 'Operação',
    subtitulo: 'Emitentes e motivos de saída',
    graficos: ['top-emitentes', 'saidas-motivo'],
  },
]

export function tituloGrafico(id: PainelGraficoId): string {
  return PAINEL_GRAFICOS_SUGESTOES.find((g) => g.id === id)?.titulo ?? id
}

export function descricaoGrafico(id: PainelGraficoId): string {
  return PAINEL_GRAFICOS_SUGESTOES.find((g) => g.id === id)?.descricao ?? ''
}

export function categoriaGrafico(id: PainelGraficoId): PainelSecaoId {
  return PAINEL_GRAFICOS_SUGESTOES.find((g) => g.id === id)?.categoria ?? 'operacao'
}

export function tipoVisualGrafico(id: PainelGraficoId): 'bar' | 'line' | 'donut' | 'grouped-bar' {
  if (graficoEstoqueAtual(id)) return 'bar'
  if (id === 'movimentos-tipo' || id === 'stage-armazem' || id === 'saidas-motivo') return 'donut'
  if (id === 'movimentos-linha' || id === 'paletes-dia' || id === 'nfs-dia') return 'line'
  if (id === 'entradas-saidas-dia') return 'grouped-bar'
  return 'bar'
}

export function resumoPeriodo(filtros: PainelFiltros, totalMovimentos: number): string {
  const intervalo = filtrosParaIntervalo(filtros)
  if (!intervalo) return `${totalMovimentos} movimento(s) — período inválido`
  const fmt = (d: Date) =>
    d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `${totalMovimentos} movimento(s) · ${fmt(intervalo.inicio)} — ${fmt(intervalo.fim)}`
}
