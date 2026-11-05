import { rebuildArmazemInventarioMap } from './armazemInventarioMap'
import type { ArmazemListaOficialRow } from './armazemListaOficial'
import {
  ARMAZEM_LISTA_OFICIAL_FALLBACK,
  listArmazemListaOficialOrdered,
  setArmazemListaAtiva,
} from './armazemListaOficial'
import { fetchGoogleSheetCsv, parseGoogleSheetsCsv } from './googleSheetsCsv'

function aplicarListaArmazem(rows: ArmazemListaOficialRow[]): void {
  setArmazemListaAtiva(rows)
  rebuildArmazemInventarioMap(rows.length > 0 ? rows : [...ARMAZEM_LISTA_OFICIAL_FALLBACK])
}

/** Planilha CONTROLE DE ESTOQUE SP — aba Base Principal. */
export const ARMAZEM_BASE_PRINCIPAL_SHEET_ID = '1EoT2x4MHtAu7bVkuwqxl2swdwqUI7n1Hg2EL9WBNeTk'
export const ARMAZEM_BASE_PRINCIPAL_ABA = 'Base Principal'

function normalizeHeader(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/** Coluna D da planilha: «1ª Contagem» … «8ª Contagem» (abas CAMARA/RUA). */
export function parseGrupoContagemFromPlanilha(raw: string): ArmazemListaOficialRow['grupo'] {
  const t = normalizeHeader(raw)
  const m = t.match(/(\d+)/)
  const n = m ? Number(m[1]) : 1
  if (n >= 8) return 8
  if (n <= 1) return 1
  return n as ArmazemListaOficialRow['grupo']
}

export function parseBasePrincipalArmazemCsv(csvText: string): ArmazemListaOficialRow[] {
  const grid = parseGoogleSheetsCsv(csvText)
  if (grid.length < 2) return []
  const head = grid[0].map((h) => normalizeHeader(String(h || '')))
  let codigoIdx = head.findIndex((h) => h === 'codigo' || h.startsWith('codigo'))
  let descIdx = head.findIndex((h) => h.includes('descricao') || h === 'description')
  let unidadeIdx = head.findIndex((h) => h === 'unidade' || h === 'und')
  let contagemIdx = head.findIndex((h) => h === 'contagem' || h.includes('contagem'))
  if (codigoIdx < 0) codigoIdx = 0
  if (descIdx < 0) descIdx = 1
  if (unidadeIdx < 0) unidadeIdx = 2
  if (contagemIdx < 0) contagemIdx = 3

  const rows: ArmazemListaOficialRow[] = []
  for (let i = 1; i < grid.length; i++) {
    const line = grid[i]
    const codigo = String(line[codigoIdx] ?? '').trim()
    if (!codigo) continue
    const descricao = String(line[descIdx] ?? '').trim()
    const unidade = String(line[unidadeIdx] ?? '').trim()
    const grupo = parseGrupoContagemFromPlanilha(String(line[contagemIdx] ?? ''))
    rows.push({ grupo, codigo, descricao, unidade })
  }
  return rows
}

export type ArmazemListaLoadSource = 'planilha' | 'fallback'

let loadPromise: Promise<{ rows: ArmazemListaOficialRow[]; source: ArmazemListaLoadSource }> | null = null
let lastSource: ArmazemListaLoadSource = 'fallback'

export function getArmazemListaLastLoadSource(): ArmazemListaLoadSource {
  return lastSource
}

/**
 * Carrega a lista do armazém da aba Base Principal (Google Sheets).
 * Em falha, mantém o fallback embutido no app.
 */
export async function ensureArmazemListaFromBasePrincipal(
  force = false,
): Promise<{ rows: ArmazemListaOficialRow[]; source: ArmazemListaLoadSource }> {
  if (!force && lastSource === 'planilha' && listArmazemListaOficialOrdered().length > 0) {
    return { rows: listArmazemListaOficialOrdered(), source: 'planilha' }
  }
  if (!force && loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const { text } = await fetchGoogleSheetCsv(ARMAZEM_BASE_PRINCIPAL_SHEET_ID, {
        sheetName: ARMAZEM_BASE_PRINCIPAL_ABA,
      })
      const parsed = parseBasePrincipalArmazemCsv(text)
      if (!parsed.length) {
        throw new Error('A aba Base Principal está vazia ou sem colunas reconhecidas.')
      }
      aplicarListaArmazem(parsed)
      lastSource = 'planilha'
      return { rows: parsed, source: 'planilha' as const }
    } catch (e) {
      aplicarListaArmazem([...ARMAZEM_LISTA_OFICIAL_FALLBACK])
      lastSource = 'fallback'
      throw e instanceof Error ? e : new Error('Falha ao carregar Base Principal.')
    } finally {
      loadPromise = null
    }
  })()

  return loadPromise
}
