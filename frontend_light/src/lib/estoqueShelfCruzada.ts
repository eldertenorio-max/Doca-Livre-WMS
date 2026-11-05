import type { ShelfLifeRow, ShelfLifeStatus } from '../components/ControleShelfLifePanel'
import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'

export type CondClass = 'Excedido' | 'Verde' | 'Amarelo' | 'Vermelho' | 'Analisar'

export type NivelEstoque = 'pouco' | 'ok' | 'muito'
export type NivelShelf = 'boa' | 'atencao' | 'ruim' | 'sem'

export type PrioridadeCruzada =
  | 'critico'
  | 'desperdicio'
  | 'produzir'
  | 'validade'
  | 'excedente_ok'
  | 'avaliar'
  | 'ok'
  | 'sem_shelf'
  | 'sem_estoque'

export type RowEstoqueCruzada = {
  sku: string
  descricao: string
  Categoria: string
  'Para condicional': string
  'Estoque Atual': string
  'Média ult. 5 dias': string
  'Pedido Méd. Abril': string
}

export type LinhaCruzada = {
  codigo: string
  descricao: string
  condicional: CondClass | null
  shelfStatus: ShelfLifeStatus | null
  shelfPct: string
  diasParaVencer: string
  estoqueAtual: string
  nivelEstoque: NivelEstoque | 'sem'
  nivelShelf: NivelShelf
  prioridade: PrioridadeCruzada
  acao: string
}

const PRIORIDADE_ORDEM: PrioridadeCruzada[] = [
  'critico',
  'desperdicio',
  'produzir',
  'validade',
  'avaliar',
  'excedente_ok',
  'sem_shelf',
  'sem_estoque',
  'ok',
]

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function paraCondicionalFromRow(raw: string): CondClass {
  const key = normalize(raw)
  const map: Record<string, CondClass> = {
    excedido: 'Excedido',
    verde: 'Verde',
    amarelo: 'Amarelo',
    vermelho: 'Vermelho',
    analisar: 'Analisar',
  }
  if (map[key]) return map[key]
  if (key.includes('exced')) return 'Excedido'
  if (key.includes('vermelh')) return 'Vermelho'
  if (key.includes('amarel')) return 'Amarelo'
  if (key.includes('verde')) return 'Verde'
  if (key.includes('analis')) return 'Analisar'
  return 'Analisar'
}

export function nivelEstoqueFromCond(c: CondClass | null): NivelEstoque | 'sem' {
  if (!c) return 'sem'
  if (c === 'Excedido') return 'muito'
  if (c === 'Vermelho') return 'pouco'
  return 'ok'
}

export function nivelShelfFromStatus(s: ShelfLifeStatus | null): NivelShelf {
  if (!s || s === 'Sem dado') return 'sem'
  if (s === 'Verde') return 'boa'
  if (s === 'Amarelo') return 'atencao'
  return 'ruim'
}

function shelfRuim(s: ShelfLifeStatus | null): boolean {
  return s === 'Laranja' || s === 'Vermelho'
}

export function calcPrioridadeCruzada(cond: CondClass | null, shelf: ShelfLifeStatus | null): PrioridadeCruzada {
  if (!cond && shelf && shelf !== 'Sem dado') return 'sem_estoque'
  if (cond && (!shelf || shelf === 'Sem dado')) return 'sem_shelf'

  if (cond === 'Vermelho' && shelfRuim(shelf)) return 'critico'
  if (cond === 'Excedido' && shelfRuim(shelf)) return 'desperdicio'
  if (cond === 'Vermelho') return 'produzir'
  if (cond === 'Excedido' && shelf === 'Verde') return 'excedente_ok'
  if ((cond === 'Verde' || cond === 'Analisar') && shelfRuim(shelf)) return 'validade'
  if (cond === 'Amarelo') return 'avaliar'
  return 'ok'
}

export function acaoSugeridaCruzada(p: PrioridadeCruzada): string {
  switch (p) {
    case 'critico':
      return 'Crítico: pouco estoque e validade curta — conferir lote, FIFO; evitar pedido grande de lote novo.'
    case 'desperdicio':
      return 'Desperdício: muito estoque e validade curta — não produzir; priorizar consumo do que vence.'
    case 'produzir':
      return 'Produzir / reabastecer — estoque baixo com shelf ainda aceitável.'
    case 'validade':
      return 'Priorizar giro — estoque ok na planilha, mas shelf em atenção ou crítico.'
    case 'excedente_ok':
      return 'Não produzir — excedente com data boa; não piorar estoque.'
    case 'avaliar':
      return 'Avaliar manualmente — semáforo Amarelo na planilha de estoque.'
    case 'sem_shelf':
      return 'Sem shelf na planilha — conferir cadastro ou lote no controle shelf life.'
    case 'sem_estoque':
      return 'Só no shelf life — item fora da lista de estoque de segurança ou SKU diferente.'
    default:
      return 'Ok — estoque e validade dentro das faixas usuais.'
  }
}

export const PRIORIDADE_LABEL: Record<PrioridadeCruzada, string> = {
  critico: 'Crítico',
  desperdicio: 'Desperdício',
  produzir: 'Produzir',
  validade: 'Validade',
  excedente_ok: 'Excedente OK',
  avaliar: 'Avaliar',
  ok: 'Ok',
  sem_shelf: 'Sem shelf',
  sem_estoque: 'Só shelf',
}

export function codigoEstoqueParaCruzada(r: RowEstoqueCruzada): string {
  const sku = r.sku.trim()
  if (sku) return sku
  const cat = r.Categoria.trim()
  if (/^\d{2}\.\d{2}\.\d{3,4}$/.test(cat)) return cat
  return ''
}

function buildLinha(est: RowEstoqueCruzada, shelf: ShelfLifeRow | undefined): LinhaCruzada {
  const codigo = codigoEstoqueParaCruzada(est) || est.sku.trim() || est.Categoria.trim()
  const cond = paraCondicionalFromRow(est['Para condicional'])
  const shelfStatus = shelf?.status ?? null
  const prioridade = calcPrioridadeCruzada(cond, shelfStatus)
  return {
    codigo,
    descricao: est.descricao.trim() || shelf?.descricao || est.Categoria || '',
    condicional: cond,
    shelfStatus,
    shelfPct: shelf?.shelfLifePct ?? '',
    diasParaVencer: shelf?.diasParaVencer ?? '',
    estoqueAtual: est['Estoque Atual'] ?? '',
    nivelEstoque: nivelEstoqueFromCond(cond),
    nivelShelf: nivelShelfFromStatus(shelfStatus),
    prioridade,
    acao: acaoSugeridaCruzada(prioridade),
  }
}

function buildLinhaSemEstoque(shelf: ShelfLifeRow): LinhaCruzada {
  const prioridade = calcPrioridadeCruzada(null, shelf.status)
  return {
    codigo: shelf.codigo,
    descricao: shelf.descricao,
    condicional: null,
    shelfStatus: shelf.status,
    shelfPct: shelf.shelfLifePct,
    diasParaVencer: shelf.diasParaVencer,
    estoqueAtual: '',
    nivelEstoque: 'sem',
    nivelShelf: nivelShelfFromStatus(shelf.status),
    prioridade,
    acao: acaoSugeridaCruzada(prioridade),
  }
}

export function mergeEstoqueShelfCruzada(rowsEstoque: RowEstoqueCruzada[], shelfRows: ShelfLifeRow[]): LinhaCruzada[] {
  const shelfMap = new Map<string, ShelfLifeRow>()
  for (const s of shelfRows) {
    const k = normalizeCodigoInternoCompareKey(s.codigo)
    if (k) shelfMap.set(k, s)
  }

  const seen = new Set<string>()
  const out: LinhaCruzada[] = []

  for (const r of rowsEstoque) {
    const codigo = codigoEstoqueParaCruzada(r)
    const k = normalizeCodigoInternoCompareKey(codigo)
    if (!k) continue
    seen.add(k)
    out.push(buildLinha(r, shelfMap.get(k)))
  }

  for (const s of shelfRows) {
    const k = normalizeCodigoInternoCompareKey(s.codigo)
    if (!k || seen.has(k)) continue
    out.push(buildLinhaSemEstoque(s))
  }

  out.sort((a, b) => {
    const ia = PRIORIDADE_ORDEM.indexOf(a.prioridade)
    const ib = PRIORIDADE_ORDEM.indexOf(b.prioridade)
    if (ia !== ib) return ia - ib
    return a.codigo.localeCompare(b.codigo, 'pt-BR')
  })

  return out
}

export function isUrgenteCruzada(l: LinhaCruzada): boolean {
  return l.prioridade === 'critico' || l.prioridade === 'desperdicio'
}

export type MatrizCruzadaKey = `${NivelEstoque}-${Exclude<NivelShelf, 'sem'>}`

export function contagemMatrizCruzada(linhas: LinhaCruzada[]): Record<MatrizCruzadaKey, number> {
  const keys: MatrizCruzadaKey[] = [
    'pouco-boa',
    'pouco-atencao',
    'pouco-ruim',
    'ok-boa',
    'ok-atencao',
    'ok-ruim',
    'muito-boa',
    'muito-atencao',
    'muito-ruim',
  ]
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<MatrizCruzadaKey, number>
  for (const l of linhas) {
    if (l.nivelEstoque === 'sem' || l.nivelShelf === 'sem') continue
    const key = `${l.nivelEstoque}-${l.nivelShelf}` as MatrizCruzadaKey
    if (key in out) out[key] += 1
  }
  return out
}
