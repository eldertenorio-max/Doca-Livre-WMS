import { syncInventarioSessaoParaContagens } from './inventarioSessaoFinalizeSync'
import {
  deleteInventarioSessaoSupabase,
  fetchInventarioSessaoByIdSupabase,
  fetchInventarioSessoesSupabase,
  fetchProximoNumeroInventarioSupabase,
  inventarioSyncHabilitado,
  upsertInventarioSessaoSupabase,
} from './inventarioSessaoSupabase'
import { isAppOnline } from './appConnectivity'
import {
  cacheInventario,
  cacheInventarioList,
  readCachedInventario,
  readCachedInventarioList,
  removeCachedInventario,
} from './inventarioLocalCache'
import { enqueuePendingInventarioSync } from './inventarioOfflineSync'
import { mergeLinhasCapturaPorId } from './capturaSessaoLinhasMerge'
import { mergeInventarioComFontesLocais } from './inventarioSessaoLocalMerge'

export type { InventarioLinhaCaptura, InventarioSessao } from './inventarioSessaoTypes'
import type { InventarioLinhaCaptura, InventarioSessao } from './inventarioSessaoTypes'
import { isTableMissingError } from './supabaseError'
import { isSupabaseTableAvailable, resetSupabaseTableProbe } from './supabaseTableProbe'

const LEGACY_STORAGE_KEY = 'inventario-sessoes-v2'
const LINHAS_OVERLAY_KEY = 'inventario-linhas-overlay-v1'
const TABELA_INV = 'inventario_sessoes'

let legacyMigrationPromise: Promise<void> | null = null

function readLegacyLocal(): InventarioSessao[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeLegacyInventario(item as Record<string, unknown>))
  } catch {
    return []
  }
}

function writeLegacyLocal(list: InventarioSessao[]): void {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function readLinhasOverlayMap(): Record<string, InventarioLinhaCaptura[]> {
  try {
    const raw = localStorage.getItem(LINHAS_OVERLAY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, InventarioLinhaCaptura[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLinhasOverlay(sessaoId: string, linhas: InventarioLinhaCaptura[]): void {
  try {
    const map = readLinhasOverlayMap()
    if (linhas.length === 0) delete map[sessaoId]
    else map[sessaoId] = linhas
    localStorage.setItem(LINHAS_OVERLAY_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

function clearLinhasOverlay(sessaoId: string): void {
  writeLinhasOverlay(sessaoId, [])
}

function mergeInventarioLinhas(sessao: InventarioSessao): InventarioSessao {
  const legacy = readLegacyLocal().find((l) => l.id === sessao.id)
  return mergeInventarioComFontesLocais(sessao, legacy ? [legacy] : undefined)
}

function sortInventarios(list: InventarioSessao[]): InventarioSessao[] {
  return [...list].sort((a, b) => b.numero - a.numero)
}

function proximoNumeroLocal(): number {
  const legacy = readLegacyLocal()
  if (!legacy.length) return 1
  return Math.max(...legacy.map((l) => l.numero)) + 1
}

async function usarSupabaseSessoes(): Promise<boolean> {
  if (!inventarioSyncHabilitado()) return false
  return isSupabaseTableAvailable(TABELA_INV)
}

export function resetInventarioSupabaseProbe(): void {
  resetSupabaseTableProbe(TABELA_INV)
}

export async function inventarioUsaArmazenamentoLocal(): Promise<boolean> {
  return !(await usarSupabaseSessoes())
}

function normalizeLegacyInventario(raw: Record<string, unknown>): InventarioSessao {
  const createdAt = String(raw.createdAt ?? raw.dataInicio ?? new Date().toISOString())
  const linhas = Array.isArray(raw.linhas) ? (raw.linhas as InventarioLinhaCaptura[]) : []
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    numero: typeof raw.numero === 'number' && Number.isFinite(raw.numero) ? raw.numero : 1,
    titulo: String(raw.titulo ?? 'Inventário'),
    local: String(raw.local ?? 'ULTRAPAO GUARULHOS DISTRI'),
    posicoesNome: raw.posicoesNome ? String(raw.posicoesNome).trim() || undefined : undefined,
    posicoesCodigos: Array.isArray(raw.posicoesCodigos)
      ? raw.posicoesCodigos.map((c) => String(c).trim()).filter(Boolean)
      : undefined,
    catalogoProdutos: raw.catalogoProdutos === 'ultrapao' ? 'ultrapao' : 'ultrapao',
    listaEnderecamentoId: raw.listaEnderecamentoId ? String(raw.listaEnderecamentoId) : undefined,
    listaEnderecamentoNome: raw.listaEnderecamentoNome ? String(raw.listaEnderecamentoNome) : undefined,
    listaProdutosId: raw.listaProdutosId ? String(raw.listaProdutosId) : undefined,
    listaProdutosNome: raw.listaProdutosNome ? String(raw.listaProdutosNome) : undefined,
    dataInicio: String(raw.dataInicio ?? createdAt),
    dataFim: raw.dataFim ? String(raw.dataFim) : null,
    status: raw.status === 'fechado' ? 'fechado' : 'aberto',
    linhas,
    createdAt,
    updatedAt: String(raw.updatedAt ?? createdAt),
  }
}

async function migrateLegacyInventariosToSupabase(): Promise<void> {
  if (!(await usarSupabaseSessoes())) return
  const legacy = readLegacyLocal()
  if (!legacy.length) return
  for (const sessao of legacy) {
    await upsertInventarioSessaoSupabase(sessao)
  }
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

async function ensureLegacyInventariosMigrated(): Promise<void> {
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = migrateLegacyInventariosToSupabase().catch((e) => {
      legacyMigrationPromise = null
      throw e
    })
  }
  await legacyMigrationPromise
}

function requireSupabase(): void {
  if (!inventarioSyncHabilitado()) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
  }
}

function wrapDbError(e: unknown, fallback: string): Error {
  if (isTableMissingError(e, 'inventario_sessoes')) {
    return new Error(
      'Tabela inventario_sessoes não existe no Supabase. No SQL Editor, execute supabase/sql/setup_inventario_listas_completo.sql (ou create_inventario_sessoes.sql).',
    )
  }
  return e instanceof Error ? e : new Error(fallback)
}

function preferLocalOnly(): boolean {
  return !isAppOnline()
}

function persistInventarioLocal(row: InventarioSessao): void {
  cacheInventario(row)
  const list = readLegacyLocal()
  const idx = list.findIndex((l) => l.id === row.id)
  if (idx >= 0) list[idx] = row
  else list.push(row)
  writeLegacyLocal(list)
  if (row.linhas.length > 0) writeLinhasOverlay(row.id, row.linhas)
}

async function persistInventario(row: InventarioSessao): Promise<void> {
  const next = withUpdatedAt(row)
  cacheInventario(next)

  if (preferLocalOnly()) {
    persistInventarioLocal(next)
    return
  }

  if (!(await usarSupabaseSessoes())) {
    persistInventarioLocal(next)
    return
  }

  try {
    const { linhasNoBanco } = await upsertInventarioSessaoSupabase(next)
    if (linhasNoBanco) {
      clearLinhasOverlay(next.id)
    } else if (next.linhas.length > 0) {
      writeLinhasOverlay(next.id, next.linhas)
    }
  } catch {
    persistInventarioLocal(next)
  }
}

function withUpdatedAt(sessao: InventarioSessao): InventarioSessao {
  return { ...sessao, updatedAt: new Date().toISOString() }
}

export function normalizarTituloInventario(titulo: string): string {
  return String(titulo ?? '')
    .trim()
    .toLowerCase()
}

export function inventarioAbertoComMesmoTitulo(
  lista: InventarioSessao[],
  titulo: string,
  ignorarId?: string,
): InventarioSessao | undefined {
  const key = normalizarTituloInventario(titulo)
  if (!key) return undefined
  return lista.find(
    (r) =>
      r.status === 'aberto' &&
      r.id !== ignorarId &&
      normalizarTituloInventario(r.titulo) === key,
  )
}

export function mensagemTituloInventarioEmUso(titulo: string, existente?: InventarioSessao): string {
  if (!existente) return 'Não foi possível usar este nome de inventário.'
  return `Já existe um inventário aberto com o nome "${existente.titulo}" (#${existente.numero}). Finalize-o antes de usar esse nome.`
}

export async function listInventarios(): Promise<InventarioSessao[]> {
  requireSupabase()

  if (preferLocalOnly()) {
    const cached = readCachedInventarioList()
    if (cached.length) return sortInventarios(cached.map(mergeInventarioLinhas))
    return sortInventarios(readLegacyLocal().map(mergeInventarioLinhas))
  }

  if (!(await usarSupabaseSessoes())) {
    return sortInventarios(readLegacyLocal())
  }
  try {
    await ensureLegacyInventariosMigrated()
    const list = await fetchInventarioSessoesSupabase()
    const sorted = sortInventarios(list.map(mergeInventarioLinhas))
    cacheInventarioList(sorted)
    return sorted
  } catch (e) {
    const cached = readCachedInventarioList()
    if (cached.length) return sortInventarios(cached.map(mergeInventarioLinhas))
    const legacy = readLegacyLocal()
    if (legacy.length) {
      return sortInventarios(legacy)
    }
    throw wrapDbError(e, 'Erro ao listar inventários.')
  }
}

export async function getInventario(id: string): Promise<InventarioSessao | null> {
  requireSupabase()

  if (preferLocalOnly()) {
    const cached = readCachedInventario(id) ?? readLegacyLocal().find((l) => l.id === id)
    return cached ? mergeInventarioLinhas(cached) : null
  }

  if (!(await usarSupabaseSessoes())) {
    return readLegacyLocal().find((l) => l.id === id) ?? null
  }
  try {
    await ensureLegacyInventariosMigrated()
    const s = await fetchInventarioSessaoByIdSupabase(id)
    if (s) {
      const merged = mergeInventarioLinhas(s)
      cacheInventario(merged)
      return merged
    }
    const cached = readCachedInventario(id)
    return cached ? mergeInventarioLinhas(cached) : null
  } catch (e) {
    const cached = readCachedInventario(id) ?? readLegacyLocal().find((l) => l.id === id)
    if (cached) return mergeInventarioLinhas(cached)
    throw wrapDbError(e, 'Erro ao carregar inventário.')
  }
}

export async function criarInventario(opts?: {
  titulo?: string
  local?: string
  posicoesNome?: string
  posicoesCodigos?: string[]
}): Promise<InventarioSessao | null> {
  requireSupabase()
  const lista = preferLocalOnly() ? readCachedInventarioList() : await listInventarios()
  const numero =
    preferLocalOnly() || !(await usarSupabaseSessoes())
      ? proximoNumeroLocal()
      : await fetchProximoNumeroInventarioSupabase()
  const tituloFinal = opts?.titulo?.trim() || `Inventário (Validade) #${numero}`
  if (inventarioAbertoComMesmoTitulo(lista, tituloFinal)) return null

  const now = new Date().toISOString()
  const row: InventarioSessao = {
    id: crypto.randomUUID(),
    numero: numero ?? lista.length + 1,
    titulo: tituloFinal,
    local: opts?.local?.trim() || 'ULTRAPAO GUARULHOS DISTRI',
    posicoesNome: opts?.posicoesNome?.trim() || undefined,
    posicoesCodigos: opts?.posicoesCodigos?.length ? [...opts.posicoesCodigos] : undefined,
    catalogoProdutos: 'ultrapao',
    dataInicio: now,
    dataFim: null,
    status: 'aberto',
    linhas: [],
    createdAt: now,
    updatedAt: now,
  }
  if (await usarSupabaseSessoes()) {
    if (!preferLocalOnly()) {
      try {
        await upsertInventarioSessaoSupabase(row)
      } catch {
        persistInventarioLocal(row)
      }
    } else {
      persistInventarioLocal(row)
    }
  } else {
    persistInventarioLocal(row)
  }
  cacheInventario(row)
  return row
}

export async function saveInventario(sessao: InventarioSessao): Promise<void> {
  requireSupabase()
  await persistInventario(sessao)
}

export async function addLinhaInventario(
  inventarioId: string,
  linha: Omit<InventarioLinhaCaptura, 'id' | 'createdAt'>,
): Promise<InventarioLinhaCaptura | null> {
  const sessao = await getInventario(inventarioId)
  if (!sessao || sessao.status !== 'aberto') return null
  const row: InventarioLinhaCaptura = {
    ...linha,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  sessao.linhas = [...sessao.linhas, row]
  await saveInventario(sessao)
  return row
}

export async function updateLinhaInventario(
  inventarioId: string,
  linhaId: string,
  linha: Omit<InventarioLinhaCaptura, 'id' | 'createdAt'>,
): Promise<InventarioLinhaCaptura | null> {
  const sessao = await getInventario(inventarioId)
  if (!sessao || sessao.status !== 'aberto') return null
  const idx = sessao.linhas.findIndex((l) => l.id === linhaId)
  if (idx < 0) return null
  const prev = sessao.linhas[idx]!
  const row: InventarioLinhaCaptura = {
    ...linha,
    id: linhaId,
    createdAt: prev.createdAt,
  }
  const next = [...sessao.linhas]
  next[idx] = row
  sessao.linhas = next
  await saveInventario(sessao)
  return row
}

export async function deleteLinhaInventario(inventarioId: string, linhaId: string): Promise<boolean> {
  const sessao = await getInventario(inventarioId)
  if (!sessao || sessao.status !== 'aberto') return false
  const antes = sessao.linhas.length
  sessao.linhas = sessao.linhas.filter((l) => l.id !== linhaId)
  if (sessao.linhas.length === antes) return false
  await saveInventario(sessao)
  return true
}

export async function fecharInventario(id: string): Promise<void> {
  const sessao = await getInventario(id)
  if (!sessao) return
  sessao.status = 'fechado'
  sessao.dataFim = new Date().toISOString()
  await saveInventario(sessao)
  if (sessao.linhas.length === 0) return

  if (preferLocalOnly()) {
    enqueuePendingInventarioSync(id)
    return
  }

  try {
    await syncInventarioSessaoParaContagens(sessao, { force: true })
  } catch (e) {
    enqueuePendingInventarioSync(id)
    if (import.meta.env.DEV) console.warn('[fecharInventario] sync contagens_inventario', e)
  }
}

export async function reabrirInventario(id: string): Promise<InventarioSessao | null> {
  const sessao = await getInventario(id)
  if (!sessao) return null
  const lista = await listInventarios()
  if (inventarioAbertoComMesmoTitulo(lista, sessao.titulo, id)) return null
  sessao.status = 'aberto'
  sessao.dataFim = null
  await saveInventario(sessao)
  return sessao
}

export async function deleteInventario(id: string): Promise<boolean> {
  requireSupabase()
  const sessao = await getInventario(id)
  if (!sessao) return false
  if (await usarSupabaseSessoes()) {
    if (!preferLocalOnly()) {
      try {
        await deleteInventarioSessaoSupabase(id)
      } catch {
        /* mantém remoção local */
      }
    }
  } else {
    writeLegacyLocal(readLegacyLocal().filter((l) => l.id !== id))
  }
  removeCachedInventario(id)
  clearLinhasOverlay(id)
  return true
}

export async function atualizarInventarioMeta(
  id: string,
  patch: { titulo?: string; local?: string },
): Promise<InventarioSessao | null> {
  const sessao = await getInventario(id)
  if (!sessao) return null
  if (patch.titulo !== undefined) {
    const t = patch.titulo.trim()
    if (!t) return null
    const lista = await listInventarios()
    if (inventarioAbertoComMesmoTitulo(lista, t, id)) return null
    sessao.titulo = t
  }
  if (patch.local !== undefined) {
    const l = patch.local.trim()
    if (l) sessao.local = l
  }
  await saveInventario(sessao)
  return sessao
}

export async function atualizarInventarioPosicoes(
  id: string,
  patch: { posicoesNome?: string; posicoesCodigos?: string[] },
): Promise<InventarioSessao | null> {
  const sessao = await getInventario(id)
  if (!sessao) return null
  if (patch.posicoesNome !== undefined) {
    const n = patch.posicoesNome.trim()
    sessao.posicoesNome = n || undefined
  }
  if (patch.posicoesCodigos !== undefined) {
    const codigos = patch.posicoesCodigos.map((c) => c.trim().toUpperCase()).filter(Boolean)
    sessao.posicoesCodigos = codigos.length ? codigos : undefined
  }
  if (!sessao.catalogoProdutos) sessao.catalogoProdutos = 'ultrapao'
  await saveInventario(sessao)
  return sessao
}

export async function configurarInventarioListas(
  id: string,
  patch: {
    listaEnderecamentoId: string
    listaEnderecamentoNome: string
    listaProdutosId: string
    listaProdutosNome: string
  },
): Promise<InventarioSessao | null> {
  const sessao = await getInventario(id)
  if (!sessao) return null
  sessao.listaEnderecamentoId = patch.listaEnderecamentoId
  sessao.listaEnderecamentoNome = patch.listaEnderecamentoNome
  sessao.listaProdutosId = patch.listaProdutosId
  sessao.listaProdutosNome = patch.listaProdutosNome
  await saveInventario(sessao)
  return sessao
}

export function inventarioListasConfiguradas(sessao: InventarioSessao): boolean {
  return Boolean(sessao.listaEnderecamentoId && sessao.listaProdutosId)
}

export function posicoesPermitidas(sessao: InventarioSessao): Set<string> | null {
  const list = sessao.posicoesCodigos
  if (!list?.length) return null
  return new Set(list.map((c) => c.trim().toUpperCase()))
}

export function enderecoPermitidoNaSessao(sessao: InventarioSessao, codigo: string): boolean {
  const permitidos = posicoesPermitidas(sessao)
  if (!permitidos) return true
  return permitidos.has(codigo.trim().toUpperCase())
}

export type InventarioLinhasRecuperacaoResultado = {
  antes: number
  depois: number
  recuperadas: number
  fontes: {
    banco: number
    cache: number
    legacy: number
    overlay: number
  }
}

/** Busca linhas salvas neste aparelho (cache/overlay) e une com o banco. */
export async function recuperarLinhasInventarioDoAparelho(
  inventarioId: string,
): Promise<InventarioLinhasRecuperacaoResultado | null> {
  const sessao = await getInventario(inventarioId)
  if (!sessao) return null

  let fromDb: InventarioLinhaCaptura[] = []
  if (!preferLocalOnly() && (await usarSupabaseSessoes())) {
    try {
      const s = await fetchInventarioSessaoByIdSupabase(inventarioId)
      fromDb = s?.linhas ?? []
    } catch {
      /* ignore */
    }
  }

  const overlay = readLinhasOverlayMap()[inventarioId] ?? []
  const cached = readCachedInventario(inventarioId)?.linhas ?? []
  const legacy = readLegacyLocal().find((l) => l.id === inventarioId)?.linhas ?? []

  const fontes = {
    banco: fromDb.length,
    cache: cached.length,
    legacy: legacy.length,
    overlay: overlay.length,
  }

  const antes = sessao.linhas.length
  const linhas = mergeLinhasCapturaPorId(sessao.linhas, fromDb, overlay, cached, legacy)
  const depois = linhas.length

  if (depois > antes) {
    await saveInventario({ ...sessao, linhas })
  }

  return {
    antes,
    depois,
    recuperadas: Math.max(0, depois - antes),
    fontes,
  }
}

export { inventarioSyncHabilitado } from './inventarioSessaoSupabase'
