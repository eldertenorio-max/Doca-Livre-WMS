import { TABLE_CONTAGEM_DIARIA, TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import { formatUnknownError, isColumnMissingError } from './supabaseError'
import { supabase } from './supabaseClient'

export type ContagensTableName = typeof TABLE_CONTAGEM_DIARIA | typeof TABLE_CONTAGEM_INVENTARIO

const ABSENT_COLS_LS = {
  [TABLE_CONTAGEM_DIARIA]: 'dis-contagens-absent-cols:v2:estoque',
  [TABLE_CONTAGEM_INVENTARIO]: 'dis-contagens-absent-cols:v2:inventario',
} as const

/** Colunas que nunca entram em SELECT em lote (payload grande / desnecessário na lista). */
const ALWAYS_OMIT_BULK = new Set(['foto_base64'])

const CORE_COLUMNS: Record<ContagensTableName, readonly string[]> = {
  [TABLE_CONTAGEM_DIARIA]: [
    'id',
    'data_hora_contagem',
    'data_contagem',
    'conferente_id',
    'codigo_interno',
    'descricao',
    'unidade_medida',
    'quantidade_up',
    'lote',
    'observacao',
    'data_fabricacao',
    'data_validade',
  ],
  [TABLE_CONTAGEM_INVENTARIO]: [
    'id',
    'data_hora_contagem',
    'data_contagem',
    'conferente_id',
    'codigo_interno',
    'descricao',
    'unidade_medida',
    'quantidade_up',
    'lote',
    'observacao',
    'data_fabricacao',
    'data_validade',
  ],
}

const OPTIONAL_COLUMNS: Record<ContagensTableName, readonly string[]> = {
  [TABLE_CONTAGEM_DIARIA]: [
    'up_adicional',
    'ean',
    'dun',
    'origem',
    'inventario_repeticao',
    'inventario_numero_contagem',
    'finalizacao_sessao_id',
    'contagem_rascunho',
  ],
  [TABLE_CONTAGEM_INVENTARIO]: [
    'up_adicional',
    'ean',
    'dun',
    'inventario_repeticao',
    'inventario_numero_contagem',
    'finalizacao_sessao_id',
    'contagem_rascunho',
    'planilha_grupo_armazem',
    'planilha_ordem_na_aba',
  ],
}

/** `contagens_inventario` não possui coluna `origem`. */
const TABLE_NEVER_SELECT: Record<ContagensTableName, ReadonlySet<string>> = {
  [TABLE_CONTAGEM_DIARIA]: new Set(),
  [TABLE_CONTAGEM_INVENTARIO]: new Set(['origem']),
}

export function parseMissingColumnFromError(e: unknown): string | null {
  const msg = formatUnknownError(e)
  const m1 = msg.match(/could not find the '([^']+)' column/i)
  if (m1?.[1]) return m1[1]
  const m2 = msg.match(/column "([^"]+)" (?:of relation .* )?does not exist/i)
  if (m2?.[1]) return m2[1]
  return null
}

export function readAbsentContagensColumns(table: ContagensTableName): Set<string> {
  const absent = new Set<string>(ALWAYS_OMIT_BULK)
  for (const c of TABLE_NEVER_SELECT[table]) absent.add(c)
  try {
    const raw = localStorage.getItem(ABSENT_COLS_LS[table])
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (typeof c === 'string' && c.trim()) absent.add(c.trim())
        }
      }
    }
    /** Migração do cache antigo da prévia (`dis-preview-absent-cols:v2:*`). */
    const legacyKey =
      table === TABLE_CONTAGEM_INVENTARIO
        ? 'dis-preview-absent-cols:v2:inventario'
        : 'dis-preview-absent-cols:v2:estoque'
    const legacyRaw = localStorage.getItem(legacyKey)
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as unknown
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (typeof c === 'string' && c.trim()) absent.add(c.trim())
        }
      }
    }
  } catch {
    /* ignore */
  }
  return absent
}

export function persistAbsentContagensColumns(table: ContagensTableName, absent: Set<string>) {
  try {
    const toSave = [...absent].filter(
      (c) => !ALWAYS_OMIT_BULK.has(c) && !TABLE_NEVER_SELECT[table].has(c),
    )
    localStorage.setItem(ABSENT_COLS_LS[table], JSON.stringify(toSave))
  } catch {
    /* ignore */
  }
}

export function buildContagensSelect(
  table: ContagensTableName,
  absent: Set<string>,
  /** Colunas extras a incluir além do núcleo + opcionais conhecidas (ex.: merge só precisa de um subconjunto). */
  only?: readonly string[],
): string {
  if (only && only.length > 0) {
    return only.filter((c) => !absent.has(c) && !TABLE_NEVER_SELECT[table].has(c)).join(',')
  }
  const cols: string[] = [...CORE_COLUMNS[table]]
  for (const c of OPTIONAL_COLUMNS[table]) {
    if (!absent.has(c)) cols.push(c)
  }
  return cols.join(',')
}

export function contagensColumnAvailable(table: ContagensTableName, col: string): boolean {
  if (ALWAYS_OMIT_BULK.has(col) || TABLE_NEVER_SELECT[table].has(col)) return false
  return !readAbsentContagensColumns(table).has(col)
}

export type FetchContagensPagedOpts = {
  table: ContagensTableName
  /** Subconjunto fixo de colunas; quando omitido, usa núcleo + opcionais disponíveis. */
  columns?: readonly string[]
  eq?: Record<string, string | number | boolean>
  order?: { column: string; ascending: boolean }
  pageSize?: number
  maxRows?: number
}

/**
 * Busca paginada com SELECT adaptativo: omite colunas ausentes (cache local) e retenta sem coluna inválida.
 */
export async function fetchContagensPaged(
  opts: FetchContagensPagedOpts,
): Promise<{ data: Record<string, unknown>[]; error: unknown | null }> {
  const pageSize = opts.pageSize ?? 1000
  const maxRows = opts.maxRows ?? 120000
  let absent = readAbsentContagensColumns(opts.table)
  let selectStr = buildContagensSelect(opts.table, absent, opts.columns)

  const pullOnce = async (sel: string): Promise<{ data: Record<string, unknown>[] | null; error: unknown | null }> => {
    const acc: Record<string, unknown>[] = []
    let from = 0
    while (true) {
      let q = supabase.from(opts.table).select(sel)
      if (opts.eq) {
        for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
      }
      if (opts.order) {
        q = q.order(opts.order.column, { ascending: opts.order.ascending })
      }
      const { data, error } = await q.range(from, from + pageSize - 1)
      if (error) return { data: null, error }
      const batch = (data ?? []) as Record<string, unknown>[]
      acc.push(...batch)
      if (batch.length < pageSize) break
      from += pageSize
      if (from > maxRows) break
    }
    return { data: acc, error: null }
  }

  for (let attempt = 0; attempt < 14; attempt++) {
    const result = await pullOnce(selectStr)
    if (!result.error) return { data: result.data ?? [], error: null }
    if (!isColumnMissingError(result.error)) return { data: null, error: result.error }
    const col = parseMissingColumnFromError(result.error)
    if (!col || absent.has(col)) return { data: null, error: result.error }
    absent.add(col)
    persistAbsentContagensColumns(opts.table, absent)
    selectStr = buildContagensSelect(opts.table, absent, opts.columns)
  }

  return { data: null, error: new Error('fetchContagensPaged: esgotou tentativas de SELECT') }
}
