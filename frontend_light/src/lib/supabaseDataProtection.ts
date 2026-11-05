/** Proteção ativa por padrão. Defina VITE_SUPABASE_ALLOW_DESTRUCTIVE=true só em ambiente de teste. */
export function isSupabaseDataProtectionEnabled(): boolean {
  const allow = String(import.meta.env.VITE_SUPABASE_ALLOW_DESTRUCTIVE ?? '').trim().toLowerCase()
  return allow !== 'true' && allow !== '1' && allow !== 'yes'
}

export class SupabaseDataProtectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseDataProtectionError'
  }
}

export type DeleteFilter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'or'; expr: string }
  | { kind: 'filter'; column: string; op: string; value: unknown }
  | { kind: 'other'; method: string }

const MASS_DELETE_COLUMNS = new Set(['data_contagem', 'data_inventario'])

const PROTECTED_TABLES = new Set([
  'contagens_estoque',
  'contagens_inventario',
  'inventario_planilha_linhas',
  'contagem_diaria_presenca',
  'inventario_captura_presenca',
  'contagem_diaria_captura_presenca',
  'contagem_temperatura_camaras',
  'contagem_ocupacao_camaras',
  'contagem_ocupacao_avaria_camaras',
  'sheet_outbox',
])

type DeleteState = {
  table: string
  filters: DeleteFilter[]
}

const deleteStates = new WeakMap<object, DeleteState>()

function recordFilter(state: DeleteState, method: string, args: unknown[]): void {
  if (method === 'eq' && args.length >= 2) {
    state.filters.push({ kind: 'eq', column: String(args[0]), value: args[1] })
    return
  }
  if (method === 'in' && args.length >= 2) {
    const values = Array.isArray(args[1]) ? args[1] : []
    state.filters.push({ kind: 'in', column: String(args[0]), values })
    return
  }
  if (method === 'or' && args.length >= 1) {
    state.filters.push({ kind: 'or', expr: String(args[0]) })
    return
  }
  if (method === 'filter' && args.length >= 3) {
    state.filters.push({
      kind: 'filter',
      column: String(args[0]),
      op: String(args[1]),
      value: args[2],
    })
    return
  }
  if (['neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'match'].includes(method)) {
    state.filters.push({ kind: 'other', method })
  }
}

export function validateSupabaseDelete(table: string, filters: DeleteFilter[]): void {
  if (!isSupabaseDataProtectionEnabled()) return

  const t = String(table ?? '').trim()
  if (!PROTECTED_TABLES.has(t)) return

  if (filters.length === 0) {
    throw new SupabaseDataProtectionError(
      `Exclusão bloqueada em "${t}": operação sem filtro (risco de zerar a tabela).`,
    )
  }

  for (const f of filters) {
    if (f.kind === 'eq' && MASS_DELETE_COLUMNS.has(f.column)) {
      throw new SupabaseDataProtectionError(
        `Exclusão bloqueada em "${t}": não é permitido apagar por "${f.column}" com a proteção de dados ativa.`,
      )
    }
    if (f.kind === 'in' && MASS_DELETE_COLUMNS.has(f.column)) {
      throw new SupabaseDataProtectionError(
        `Exclusão bloqueada em "${t}": não é permitido apagar em lote por "${f.column}".`,
      )
    }
  }

  const hasIdEq = filters.some((f) => f.kind === 'eq' && f.column === 'id')
  const hasIdIn = filters.some((f) => f.kind === 'in' && f.column === 'id')
  const hasFinalizacaoSessao = filters.some((f) => f.kind === 'eq' && f.column === 'finalizacao_sessao_id')
  const hasFkIn = filters.some(
    (f) =>
      f.kind === 'in' &&
      (f.column === 'contagens_inventario_id' || f.column === 'contagens_estoque_id'),
  )
  const hasPlanilhaEndereco =
    t === 'inventario_planilha_linhas' &&
    filters.some((f) => f.kind === 'eq' && f.column === 'grupo_armazem') &&
    filters.some((f) => f.kind === 'eq' && f.column === 'posicao')

  const onlyDataInventario =
    filters.length === 1 && filters[0].kind === 'eq' && filters[0].column === 'data_inventario'

  if (onlyDataInventario) {
    throw new SupabaseDataProtectionError(
      'Exclusão bloqueada: não é permitido apagar todas as linhas de um dia de inventário.',
    )
  }

  const allowed = hasIdEq || hasIdIn || hasFinalizacaoSessao || hasFkIn || hasPlanilhaEndereco
  if (!allowed) {
    throw new SupabaseDataProtectionError(
      `Exclusão bloqueada em "${t}": somente por id, finalizacao_sessao_id ou vínculo de planilha permitido.`,
    )
  }
}

function attachDeleteGuard(builder: object, state: DeleteState): object {
  deleteStates.set(builder, state)
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          validateSupabaseDelete(state.table, state.filters)
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        recordFilter(state, String(prop), args)
        const next = (value as (...a: unknown[]) => unknown).apply(target, args)
        if (next && typeof next === 'object') {
          return attachDeleteGuard(next, state)
        }
        return next
      }
    },
  })
}

function wrapTableBuilder(builder: object, table: string): object {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop !== 'delete' || typeof value !== 'function') {
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            const next = (value as (...a: unknown[]) => unknown).apply(target, args)
            if (next && typeof next === 'object' && next !== target) {
              return wrapTableBuilder(next, table)
            }
            return next
          }
        }
        return value
      }
      return () => {
        const chain = (value as () => object).call(target)
        const state: DeleteState = { table, filters: [] }
        return attachDeleteGuard(chain, state)
      }
    },
  })
}

export function wrapSupabaseClientWithDataProtection<T extends { from: (table: string) => object }>(
  client: T,
): T {
  if (!isSupabaseDataProtectionEnabled()) return client
  const origFrom = client.from.bind(client)
  const wrapped = Object.create(Object.getPrototypeOf(client)) as T
  Object.assign(wrapped, client)
  wrapped.from = (table: string) => wrapTableBuilder(origFrom(table), table) as ReturnType<T['from']>
  return wrapped
}
