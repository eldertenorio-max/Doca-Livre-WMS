import type { OfflineChecklistItem } from '../../lib/offlineContagemSession'
import { compareInventarioPlanilhaItens } from '../../lib/armazemInventarioMap'
import { codigoInternoIguais } from '../../lib/codigoInternoCompare'

export { compareInventarioPlanilhaItens }

export function formatContagemLabel(contagem: number) {
  if (contagem === 1) return '1° CONTAGEM'
  if (contagem === 2) return '2° CONTAGEM'
  if (contagem === 3) return '3° CONTAGEM'
  if (contagem === 4) return '4° CONTAGEM'
  return `${contagem}° CONTAGEM`
}

function formatArmazemGroupLabel(contagem: number | null) {
  if (!contagem) return 'OUTROS'
  return formatContagemLabel(contagem)
}

/** Quantidade de abas (grupos) no inventário armazém / planilha. */
export const INVENTARIO_ARMAZEM_NUM_GRUPOS = 8

/** IDs dos grupos 1..N (abas CAMARA/RUA). */
export const INVENTARIO_ARMAZEM_GRUPO_IDS: readonly number[] = Array.from(
  { length: INVENTARIO_ARMAZEM_NUM_GRUPOS },
  (_, i) => i + 1,
)

/** Títulos das abas alinhados à planilha `CONTAGEM DE INVENTARIO.xlsx` (uma aba por grupo armazém). */
export const INVENTARIO_ARMAZEM_ABA_TITULOS: Partial<Record<number, string>> = {
  1: 'CAMARA 11 - RUA A',
  2: 'CAMARA 11 - RUA B',
  3: 'CAMARA 12 - RUA C',
  4: 'CAMARA 12 - RUA D',
  5: 'CAMARA 13 - RUA E',
  6: 'CAMARA 13 - RUA F',
  7: 'CAMARA 21 - RUA G',
  8: 'CAMARA 21 - RUA H',
}

/** Coluna RUA na planilha (letra da rua por grupo). */
export const INVENTARIO_ARMAZEM_RUA: Partial<Record<number, string>> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
  6: 'F',
  7: 'G',
  8: 'H',
}

export function getInventarioRuaArmazem(contagem: number | null | undefined): string {
  if (contagem == null) return '—'
  return INVENTARIO_ARMAZEM_RUA[contagem] ?? '—'
}

export const INVENTARIO_CAMARAS = [11, 12, 13, 21] as const

export function getCamaraFromGrupo(grupo: number | null | undefined): number | null {
  if (grupo == null || !Number.isFinite(grupo)) return null
  const t = INVENTARIO_ARMAZEM_ABA_TITULOS[grupo]
  if (!t) return null
  const m = t.match(/CAMARA\s+(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Ruas disponíveis na câmara (ex.: 11 → A, B). */
export function getRuasPorCamara(camara: number): string[] {
  const ruas: string[] = []
  for (let g = 1; g <= INVENTARIO_ARMAZEM_NUM_GRUPOS; g++) {
    if (getCamaraFromGrupo(g) === camara) {
      const r = INVENTARIO_ARMAZEM_RUA[g]
      if (r) ruas.push(r)
    }
  }
  return ruas
}

export function getGrupoArmazemFromCamaraRua(camara: number, rua: string): number | null {
  const r = String(rua ?? '').trim().toUpperCase()
  for (let g = 1; g <= INVENTARIO_ARMAZEM_NUM_GRUPOS; g++) {
    if (getCamaraFromGrupo(g) === camara && INVENTARIO_ARMAZEM_RUA[g] === r) return g
  }
  return null
}

/** Níveis por posição na planilha (1–5). */
export const INVENTARIO_PLANILHA_NIVEIS = 5

/** Cada nível repete esta quantidade de linhas antes de subir o nível (ex.: três caixas no mesmo nível). */
export const INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL = 3

/** Linhas por POS = 5 níveis × 3 repetições = 15 (padrão da planilha). */
export const INVENTARIO_PLANILHA_LINHAS_POR_POSICAO =
  INVENTARIO_PLANILHA_NIVEIS * INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL

/** Referência: a planilha física tem 15 posições por RUA (POS 1–15); acima disso o índice segue a mesma lógica. */
export const INVENTARIO_PLANILHA_NUM_POSICOES = 15

/** Uma aba Excel = 15 POS × 15 linhas/POS (cobrindo todos os níveis em cada posição). */
export const INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA =
  INVENTARIO_PLANILHA_NUM_POSICOES * INVENTARIO_PLANILHA_LINHAS_POR_POSICAO

/** Índice 0-based da linha na aba a partir de POS, NÍVEL e repetição (1–3). */
export function planilhaOrdemFromPosNivel(pos: number, nivel: number, repeticao = 1): number {
  const p = Math.min(INVENTARIO_PLANILHA_NUM_POSICOES, Math.max(1, Math.round(pos)))
  const n = Math.min(INVENTARIO_PLANILHA_NIVEIS, Math.max(1, Math.round(nivel)))
  const r = Math.min(INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL, Math.max(1, Math.round(repeticao))) - 1
  return (p - 1) * INVENTARIO_PLANILHA_LINHAS_POR_POSICAO + (n - 1) * INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL + r
}

function planilhaLinhaSemCodigo(it: OfflineChecklistItem): boolean {
  return !String(it.codigo_interno ?? '').trim()
}

function planilhaLinhaSemQuantidade(it: OfflineChecklistItem): boolean {
  return String(it.quantidade_contada ?? '').trim() === ''
}

/** Linha já usada nesta repetição (código ou quantidade informados). */
export function planilhaLinhaPreenchida(it: OfflineChecklistItem): boolean {
  return !planilhaLinhaSemCodigo(it) || !planilhaLinhaSemQuantidade(it)
}

/** Código e quantidade já informados — bloqueia nova seleção nesta repetição. */
export function planilhaLinhaTotalmentePreenchida(it: OfflineChecklistItem): boolean {
  return !planilhaLinhaSemCodigo(it) && !planilhaLinhaSemQuantidade(it)
}

export type PlanilhaRepeticao = 1 | 2 | 3

/** Repetição física (1ª–3ª) a partir do índice da linha na aba. */
export function planilhaRepeticaoFromOrdemNaAba(
  ordem: number,
  pos: number,
  nivel: number,
): PlanilhaRepeticao | null {
  const base = planilhaOrdemFromPosNivel(pos, nivel, 1)
  const rep = ordem - base + 1
  if (rep >= 1 && rep <= INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL) return rep as PlanilhaRepeticao
  return null
}

/** Linha da planilha que corresponde ao endereço + repetição escolhidos no seletor. */
export function isPlanilhaItemLinhaSelecionada(
  it: OfflineChecklistItem,
  grupo: number,
  pos: number,
  nivel: number,
  repeticao: PlanilhaRepeticao,
): boolean {
  if (it.armazem_grupo !== grupo || it.planilha_ordem_na_aba == null) return false
  const pn = inventarioPlanilhaPosNivelFromIndex(it.planilha_ordem_na_aba)
  if (pn.pos !== pos || pn.nivel !== nivel) return false
  const rep = planilhaRepeticaoFromOrdemNaAba(it.planilha_ordem_na_aba, pn.pos, pn.nivel)
  return rep === repeticao
}

/** Retorna as 3 repetições do POS/NÍVEL na ordem (1ª, 2ª, 3ª). */
export function planilhaSlotsAtPosNivel(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): OfflineChecklistItem[] {
  const inGrupo = items
    .filter((it) => it.armazem_grupo === grupo)
    .sort((a, b) => (a.planilha_ordem_na_aba ?? 0) - (b.planilha_ordem_na_aba ?? 0))
  const base = planilhaOrdemFromPosNivel(pos, nivel, 1)
  const slots: OfflineChecklistItem[] = []
  for (let rep = 0; rep < INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL; rep++) {
    const ordem = base + rep
    const it = inGrupo.find((x) => x.planilha_ordem_na_aba === ordem)
    if (it) slots.push(it)
  }
  return slots
}

export function getPlanilhaSlotPorRepeticao(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
  repeticao: PlanilhaRepeticao,
): OfflineChecklistItem | undefined {
  const slots = planilhaSlotsAtPosNivel(items, grupo, pos, nivel)
  const idx = Math.min(INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL, Math.max(1, Math.round(repeticao))) - 1
  return slots[idx]
}

/** Código já informado nesta repetição — bloqueia no seletor de linha. */
export function planilhaLinhaOcupada(it: OfflineChecklistItem): boolean {
  return !planilhaLinhaSemCodigo(it)
}

export function planilhaRepeticoesOcupadas(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): Record<PlanilhaRepeticao, boolean> {
  const slots = planilhaSlotsAtPosNivel(items, grupo, pos, nivel)
  return {
    1: slots[0] ? planilhaLinhaOcupada(slots[0]) : false,
    2: slots[1] ? planilhaLinhaOcupada(slots[1]) : false,
    3: slots[2] ? planilhaLinhaOcupada(slots[2]) : false,
  }
}

export function planilhaRepeticoesPreenchidas(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): Record<PlanilhaRepeticao, boolean> {
  const slots = planilhaSlotsAtPosNivel(items, grupo, pos, nivel)
  return {
    1: slots[0] ? planilhaLinhaTotalmentePreenchida(slots[0]) : false,
    2: slots[1] ? planilhaLinhaTotalmentePreenchida(slots[1]) : false,
    3: slots[2] ? planilhaLinhaTotalmentePreenchida(slots[2]) : false,
  }
}

export function primeiraPlanilhaRepeticaoLivre(
  bloqueadas: Record<PlanilhaRepeticao, boolean>,
): PlanilhaRepeticao | null {
  for (const r of [1, 2, 3] as const) {
    if (!bloqueadas[r]) return r
  }
  return null
}

export function primeiraPlanilhaRepeticaoSemCodigo(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): PlanilhaRepeticao | null {
  const slots = planilhaSlotsAtPosNivel(items, grupo, pos, nivel)
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] && planilhaLinhaSemCodigo(slots[i])) return (i + 1) as PlanilhaRepeticao
  }
  return null
}

/** Bip: preenche só a 1ª repetição ainda sem código nesta RUA/POS/NÍVEL. */
export function findPlanilhaSlotParaBip(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): OfflineChecklistItem | undefined {
  return planilhaSlotsAtPosNivel(items, grupo, pos, nivel).find(planilhaLinhaSemCodigo)
}

/** Gravar quantidade/dados: somente a repetição escolhida (1ª–3ª) no endereço RUA/POS/NÍVEL. */
export function findPlanilhaSlotParaGravacao(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
  codigo: string,
  preferKey?: string | null,
  repeticao?: PlanilhaRepeticao | null,
): OfflineChecklistItem | undefined {
  const cod = String(codigo ?? '').trim()

  if (repeticao != null) {
    const sel = getPlanilhaSlotPorRepeticao(items, grupo, pos, nivel, repeticao)
    if (!sel) return undefined
    if (!cod) return sel
    if (planilhaLinhaSemCodigo(sel)) return sel
    if (codigoInternoIguais(sel.codigo_interno, cod)) return sel
    if (preferKey && sel.key === preferKey) return sel
    return undefined
  }

  const slots = planilhaSlotsAtPosNivel(items, grupo, pos, nivel)

  if (!cod) return findPlanilhaSlotParaBip(items, grupo, pos, nivel)

  if (preferKey) {
    const pref = slots.find((s) => s.key === preferKey)
    if (pref && codigoInternoIguais(pref.codigo_interno, cod)) return pref
  }

  const vazio = slots.find(planilhaLinhaSemCodigo)
  if (vazio) return vazio

  const mesmoCodSemQtd = slots.find(
    (s) => codigoInternoIguais(s.codigo_interno, cod) && planilhaLinhaSemQuantidade(s),
  )
  if (mesmoCodSemQtd) return mesmoCodSemQtd

  const mesmoCod = slots.find((s) => codigoInternoIguais(s.codigo_interno, cod))
  if (mesmoCod) return mesmoCod

  return undefined
}

/** @deprecated Use findPlanilhaSlotParaBip ou findPlanilhaSlotParaGravacao. */
export function findPlanilhaItemInGrupo(
  items: OfflineChecklistItem[],
  grupo: number,
  pos: number,
  nivel: number,
): OfflineChecklistItem | undefined {
  return findPlanilhaSlotParaBip(items, grupo, pos, nivel)
}

/** Lista em branco: 8 abas × 225 linhas (POS/NÍVEL fixos; código e descrição vazios). */
export function buildBlankPlanilhaInventarioItems(): OfflineChecklistItem[] {
  const items: OfflineChecklistItem[] = []
  for (let grupo = 1; grupo <= INVENTARIO_ARMAZEM_NUM_GRUPOS; grupo++) {
    for (let ordem = 0; ordem < INVENTARIO_PLANILHA_LINHAS_TOTAIS_POR_ABA; ordem++) {
      items.push({
        key: `planilha-g${grupo}-o${ordem}`,
        codigo_interno: '',
        descricao: '',
        armazem_grupo: grupo,
        planilha_ordem_na_aba: ordem,
        quantidade_contada: '',
        quantidade_local_dirty: false,
        foto_base64: '',
        up_quantidade: '',
        lote: '',
        observacao: '',
        data_fabricacao: '',
        data_validade: '',
        unidade_medida: null,
        ean: null,
        dun: null,
      })
    }
  }
  return items
}

/**
 * POS e NIVEL a partir da ordem da linha (0-based), igual ao Excel:
 * em cada POS, NIVEL 1 repete 3×, depois NIVEL 2 repete 3×, … até NIVEL 5; a cada 15 linhas incrementa POS.
 */
export function inventarioPlanilhaPosNivelFromIndex(idx: number): { pos: number; nivel: number } {
  const rows = INVENTARIO_PLANILHA_LINHAS_POR_POSICAO
  const rep = INVENTARIO_PLANILHA_REPETICOES_POR_NIVEL
  const pos = Math.floor(idx / rows) + 1
  const within = idx % rows
  const nivel = Math.floor(within / rep) + 1
  return { pos, nivel }
}

/** Repetição física (1ª–3ª linha) no mesmo POS/NÍVEL — usada no relatório e ao gravar no banco. */
export function inventarioPlanilhaRepeticaoFromItem(
  it: { inventario_repeticao?: number | null; planilha_ordem_na_aba?: number | null },
): 1 | 2 | 3 | null {
  if (it.inventario_repeticao != null) {
    const r = Math.round(Number(it.inventario_repeticao))
    if (r >= 1 && r <= 3) return r as 1 | 2 | 3
  }
  if (it.planilha_ordem_na_aba != null && Number.isFinite(it.planilha_ordem_na_aba)) {
    const { pos, nivel } = inventarioPlanilhaPosNivelFromIndex(it.planilha_ordem_na_aba)
    const rep = planilhaRepeticaoFromOrdemNaAba(it.planilha_ordem_na_aba, pos, nivel)
    if (rep != null) return rep
  }
  return null
}

export function formatPlanilhaLinhaRelatorio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return ''
  const r = Math.round(Number(n))
  if (r >= 1 && r <= 3) return `${r}ª`
  return String(r)
}

/** Endereço legível para cards mobile (Rua · Pos. · Nível · Linha). */
export function formatPlanilhaEnderecoLegivel(opts: {
  rua?: string | null
  pos?: number | null
  nivel?: number | null
  linhaRepeticao?: number | null
}): string {
  const parts: string[] = []
  const rua = String(opts.rua ?? '').trim()
  if (rua) parts.push(`Rua ${rua}`)
  if (opts.pos != null && Number.isFinite(Number(opts.pos))) parts.push(`Pos. ${Math.round(Number(opts.pos))}`)
  if (opts.nivel != null && Number.isFinite(Number(opts.nivel))) {
    parts.push(`Nível ${Math.round(Number(opts.nivel))}`)
  }
  const lin = formatPlanilhaLinhaRelatorio(opts.linhaRepeticao)
  if (lin) parts.push(`Linha ${lin}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export function inventarioArmazemPosNivel(
  itemsSorted: OfflineChecklistItem[],
  it: OfflineChecklistItem,
): { pos: number; nivel: number } {
  if (it.planilha_ordem_na_aba != null) {
    return inventarioPlanilhaPosNivelFromIndex(it.planilha_ordem_na_aba)
  }
  const idx = itemsSorted.findIndex((x) => x.key === it.key)
  if (idx < 0) return { pos: 1, nivel: 1 }
  return inventarioPlanilhaPosNivelFromIndex(idx)
}

export function inventarioAbaTitulo(contagem: number | null | undefined): string {
  if (contagem == null) return '—'
  return INVENTARIO_ARMAZEM_ABA_TITULOS[contagem] ?? formatArmazemGroupLabel(contagem)
}

/** Primeira parte do título da aba, ex.: "CAMARA 11" (antes de " - RUA …"). */
export function inventarioCamaraLabelFromGrupo(grupo: number | null | undefined): string {
  if (grupo == null || !Number.isFinite(grupo)) return '—'
  const t = INVENTARIO_ARMAZEM_ABA_TITULOS[grupo]
  if (!t) return '—'
  const first = t.split(' - ')[0]?.trim()
  return first ?? '—'
}

/**
 * Para a tabela estilo planilha (e lista mobile alinhada), remove linhas de cabeçalho de grupo.
 */
export function filtrarItensPlanilhaInventario(
  items: Array<OfflineChecklistItem | { kind: string; key: string; contagem: number | null }>,
): OfflineChecklistItem[] {
  return items.filter(
    (x): x is OfflineChecklistItem => !('kind' in x && (x as { kind?: string }).kind === 'header'),
  )
}

/** Metadados alinhados à planilha / tabela `inventario_planilha_linhas`. */
export type PlanilhaLayoutMeta = {
  /** Aba física (CAMARA + RUA), 1–8. */
  grupo_armazem: number
  /** Rodada da contagem escolhida pelo usuário (1–4), mesma em todas as abas. */
  numero_contagem: number
  rua: string
  posicao: number
  nivel: number
}

/**
 * Calcula RUA, POS, NIVEL e grupo por item da sessão, para gravar em `inventario_planilha_linhas`.
 * `getGrupo` deve retornar 1..N (mapa de armazém por código, `armazem_grupo` na linha em branco, etc.).
 */
function clampNumeroContagemRodada(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(4, Math.max(1, Math.round(n)))
}

export function buildPlanilhaLayoutPorItens(
  items: OfflineChecklistItem[],
  getGrupo: (it: OfflineChecklistItem) => number | null,
  /** 1–4: qual contagem da rodada (cabeçalho da coluna na planilha). */
  numeroContagemRodada: number,
): Map<string, PlanilhaLayoutMeta> {
  const rodada = clampNumeroContagemRodada(numeroContagemRodada)
  const byGrupo = new Map<number, OfflineChecklistItem[]>()
  for (const it of items) {
    const raw = getGrupo(it)
    const g =
      raw != null ? Math.min(INVENTARIO_ARMAZEM_NUM_GRUPOS, Math.max(1, raw)) : 1
    if (!byGrupo.has(g)) byGrupo.set(g, [])
    byGrupo.get(g)!.push(it)
  }
  for (const arr of byGrupo.values()) {
    arr.sort(compareInventarioPlanilhaItens)
  }
  const out = new Map<string, PlanilhaLayoutMeta>()
  for (const [grupo, arr] of byGrupo) {
    const rua = getInventarioRuaArmazem(grupo)
    arr.forEach((it, idx) => {
      const ordemIdx = it.planilha_ordem_na_aba ?? idx
      const { pos, nivel } = inventarioPlanilhaPosNivelFromIndex(ordemIdx)
      out.set(it.key, {
        grupo_armazem: grupo,
        numero_contagem: rodada,
        rua,
        posicao: pos,
        nivel,
      })
    })
  }
  return out
}
