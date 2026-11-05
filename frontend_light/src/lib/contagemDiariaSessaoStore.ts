import {
  contagemDiariaSyncHabilitado,
  deleteContagemDiariaSessaoSupabase,
  fetchContagemDiariaSessaoByIdSupabase,
  fetchContagemDiariaSessoesSupabase,
  fetchProximoNumeroContagemDiariaSupabase,
  resetContagemDiariaSchemaProbe,
  upsertContagemDiariaSessaoSupabase,
} from './contagemDiariaSessaoSupabase'
import { syncContagemDiariaSessaoParaContagens } from './contagemDiariaFinalizeSync'
import { isAppOnline } from './appConnectivity'
import {
  cacheSessao,
  cacheSessaoList,
  readCachedSessao,
  readCachedSessaoList,
  removeCachedSessao,
} from './contagemDiariaLocalCache'
import { enqueuePendingContagemDiariaSync } from './contagemDiariaOfflineSync'
import { mergeContagemDiariaComFontesLocais } from './contagemDiariaSessaoLocalMerge'

export type { ContagemDiariaSessao, ContagemDiariaLinhaCaptura } from './contagemDiariaSessaoTypes'
import type { ContagemDiariaLinhaCaptura, ContagemDiariaSessao } from './contagemDiariaSessaoTypes'
import { isTableMissingError } from './supabaseError'
import { isSupabaseTableAvailable, resetSupabaseTableProbe } from './supabaseTableProbe'

const LEGACY_STORAGE_KEY = 'contagem-diaria-sessoes-v1'
const LINHAS_OVERLAY_KEY = 'contagem-diaria-linhas-overlay-v1'
const TABELA_CD = 'contagem_diaria_sessoes'

let legacyMigrationPromise: Promise<void> | null = null

function readLegacyLocal(): ContagemDiariaSessao[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeLegacyContagem(item as Record<string, unknown>))
  } catch {
    return []
  }
}

function writeLegacyLocal(list: ContagemDiariaSessao[]): void {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function readLinhasOverlayMap(): Record<string, ContagemDiariaLinhaCaptura[]> {
  try {
    const raw = localStorage.getItem(LINHAS_OVERLAY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ContagemDiariaLinhaCaptura[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLinhasOverlay(sessaoId: string, linhas: ContagemDiariaLinhaCaptura[]): void {
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

function mergeLinhasOverlay(sessao: ContagemDiariaSessao): ContagemDiariaSessao {
  const legacy = readLegacyLocal().find((l) => l.id === sessao.id)
  return mergeContagemDiariaComFontesLocais(sessao, legacy ? [legacy] : undefined)
}

function sortContagens(list: ContagemDiariaSessao[]): ContagemDiariaSessao[] {
  return [...list].sort((a, b) => b.numero - a.numero)
}

function proximoNumeroLocal(): number {
  const legacy = readLegacyLocal()
  if (!legacy.length) return 1
  return Math.max(...legacy.map((l) => l.numero)) + 1
}

async function usarSupabaseSessoes(): Promise<boolean> {
  if (!contagemDiariaSyncHabilitado()) return false
  return isSupabaseTableAvailable(TABELA_CD)
}

export function resetContagemDiariaSupabaseProbe(): void {
  resetSupabaseTableProbe(TABELA_CD)
  resetContagemDiariaSchemaProbe()
}

export async function contagemDiariaUsaArmazenamentoLocal(): Promise<boolean> {
  return !(await usarSupabaseSessoes())
}

function normalizeLegacyContagem(raw: Record<string, unknown>): ContagemDiariaSessao {
  const createdAt = String(raw.createdAt ?? raw.dataInicio ?? new Date().toISOString())
  const dataContagemRaw = String(raw.dataContagem ?? '').slice(0, 10)
  const dataContagem = /^\d{4}-\d{2}-\d{2}$/.test(dataContagemRaw) ? dataContagemRaw : todayYmdLocal()
  const linhas = Array.isArray(raw.linhas) ? (raw.linhas as ContagemDiariaLinhaCaptura[]) : []
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    numero: typeof raw.numero === 'number' && Number.isFinite(raw.numero) ? raw.numero : 1,
    titulo: String(raw.titulo ?? 'Contagem diária'),
    local: String(raw.local ?? 'ULTRAPAO GUARULHOS DISTRI'),
    dataContagem,
    conferenteNome: raw.conferenteNome ? String(raw.conferenteNome) : undefined,
    listaProdutosId: raw.listaProdutosId ? String(raw.listaProdutosId) : undefined,
    listaProdutosNome: raw.listaProdutosNome ? String(raw.listaProdutosNome) : undefined,
    dataInicio: String(raw.dataInicio ?? createdAt),
    dataFim: raw.dataFim ? String(raw.dataFim) : null,
    status: raw.status === 'fechado' ? 'fechado' : 'aberto',
    iniciada: Boolean(raw.iniciada),
    linhas,
    createdAt,
    updatedAt: String(raw.updatedAt ?? createdAt),
  }
}

async function migrateLegacyContagensToSupabase(): Promise<void> {
  if (!(await usarSupabaseSessoes())) return
  const legacy = readLegacyLocal()
  if (!legacy.length) return
  for (const sessao of legacy) {
    await upsertContagemDiariaSessaoSupabase(sessao)
  }
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

async function ensureLegacyContagensMigrated(): Promise<void> {
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = migrateLegacyContagensToSupabase().catch((e) => {
      legacyMigrationPromise = null
      throw e
    })
  }
  await legacyMigrationPromise
}

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function requireSupabase(): void {
  if (!contagemDiariaSyncHabilitado()) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
  }
}

function wrapDbError(e: unknown, fallback: string): Error {
  if (isTableMissingError(e, 'contagem_diaria_sessoes')) {
    return new Error(
      'Tabela contagem_diaria_sessoes não existe no Supabase. No SQL Editor, execute supabase/sql/setup_inventario_listas_completo.sql (ou create_contagem_diaria_sessoes.sql).',
    )
  }
  return e instanceof Error ? e : new Error(fallback)
}

function preferLocalOnly(): boolean {
  return !isAppOnline()
}

function persistSessaoLocal(row: ContagemDiariaSessao): void {
  cacheSessao(row)
  const list = readLegacyLocal()
  const idx = list.findIndex((l) => l.id === row.id)
  if (idx >= 0) list[idx] = row
  else list.push(row)
  writeLegacyLocal(list)
  if (row.linhas.length > 0) writeLinhasOverlay(row.id, row.linhas)
}

async function persistSessao(row: ContagemDiariaSessao): Promise<void> {
  const next = withUpdatedAt(row)
  cacheSessao(next)

  if (preferLocalOnly()) {
    persistSessaoLocal(next)
    return
  }

  if (!(await usarSupabaseSessoes())) {
    persistSessaoLocal(next)
    return
  }

  try {
    const { linhasNoBanco } = await upsertContagemDiariaSessaoSupabase(next)
    if (linhasNoBanco) {
      clearLinhasOverlay(next.id)
    } else if (next.linhas.length > 0) {
      writeLinhasOverlay(next.id, next.linhas)
    }
  } catch {
    persistSessaoLocal(next)
  }
}

function withUpdatedAt(sessao: ContagemDiariaSessao): ContagemDiariaSessao {
  return { ...sessao, updatedAt: new Date().toISOString() }
}

export async function listContagensDiarias(): Promise<ContagemDiariaSessao[]> {
  requireSupabase()

  if (preferLocalOnly()) {
    const cached = readCachedSessaoList()
    if (cached.length) return sortContagens(cached.map(mergeLinhasOverlay))
    return sortContagens(readLegacyLocal())
  }

  if (!(await usarSupabaseSessoes())) {
    return sortContagens(readLegacyLocal())
  }
  try {
    await ensureLegacyContagensMigrated()
    const list = await fetchContagemDiariaSessoesSupabase()
    const merged = sortContagens(list.map(mergeLinhasOverlay))
    cacheSessaoList(merged)
    return merged
  } catch (e) {
    const cached = readCachedSessaoList()
    if (cached.length) return sortContagens(cached.map(mergeLinhasOverlay))
    const legacy = readLegacyLocal()
    if (legacy.length) {
      return sortContagens(legacy)
    }
    throw wrapDbError(e, 'Erro ao listar contagens.')
  }
}

export async function getContagemDiaria(id: string): Promise<ContagemDiariaSessao | null> {
  requireSupabase()

  if (preferLocalOnly()) {
    const cached = readCachedSessao(id) ?? readLegacyLocal().find((l) => l.id === id)
    return cached ? mergeLinhasOverlay(cached) : null
  }

  if (!(await usarSupabaseSessoes())) {
    return readLegacyLocal().find((l) => l.id === id) ?? null
  }
  try {
    await ensureLegacyContagensMigrated()
    const s = await fetchContagemDiariaSessaoByIdSupabase(id)
    if (s) {
      const merged = mergeLinhasOverlay(s)
      cacheSessao(merged)
      return merged
    }
    return readCachedSessao(id) ? mergeLinhasOverlay(readCachedSessao(id)!) : null
  } catch (e) {
    const cached = readCachedSessao(id) ?? readLegacyLocal().find((l) => l.id === id)
    if (cached) return mergeLinhasOverlay(cached)
    throw wrapDbError(e, 'Erro ao carregar contagem.')
  }
}

export async function criarContagemDiaria(opts?: {
  titulo?: string
  local?: string
  dataContagem?: string
  conferenteNome?: string
}): Promise<ContagemDiariaSessao> {
  requireSupabase()
  const numero =
    preferLocalOnly() || !(await usarSupabaseSessoes())
      ? proximoNumeroLocal()
      : await fetchProximoNumeroContagemDiariaSupabase()
  const now = new Date().toISOString()
  const dataContagem = opts?.dataContagem?.trim() || todayYmdLocal()
  const row: ContagemDiariaSessao = {
    id: crypto.randomUUID(),
    numero,
    titulo: opts?.titulo?.trim() || `Contagem diária #${numero}`,
    local: opts?.local?.trim() || 'ULTRAPAO GUARULHOS DISTRI',
    dataContagem,
    conferenteNome: opts?.conferenteNome?.trim() || undefined,
    dataInicio: now,
    dataFim: null,
    status: 'aberto',
    iniciada: false,
    linhas: [],
    createdAt: now,
    updatedAt: now,
  }
  if (await usarSupabaseSessoes()) {
    if (!preferLocalOnly()) {
      try {
        await upsertContagemDiariaSessaoSupabase(row)
      } catch {
        persistSessaoLocal(row)
      }
    } else {
      persistSessaoLocal(row)
    }
  } else {
    persistSessaoLocal(row)
  }
  cacheSessao(row)
  return row
}

export async function saveContagemDiaria(sessao: ContagemDiariaSessao): Promise<void> {
  requireSupabase()
  await persistSessao(sessao)
}

export async function marcarContagemIniciada(id: string): Promise<void> {
  const sessao = await getContagemDiaria(id)
  if (!sessao || sessao.iniciada) return
  sessao.iniciada = true
  await saveContagemDiaria(sessao)
}

export async function fecharContagemDiaria(id: string): Promise<void> {
  const sessao = await getContagemDiaria(id)
  if (!sessao) return
  sessao.status = 'fechado'
  sessao.dataFim = new Date().toISOString()
  await saveContagemDiaria(sessao)
  if (sessao.linhas.length === 0) return

  if (preferLocalOnly()) {
    enqueuePendingContagemDiariaSync(id)
    return
  }

  try {
    await syncContagemDiariaSessaoParaContagens(sessao, { force: true })
  } catch (e) {
    enqueuePendingContagemDiariaSync(id)
    if (import.meta.env.DEV) console.warn('[fecharContagemDiaria] sync contagens_estoque', e)
  }
}

export async function reabrirContagemDiaria(id: string): Promise<ContagemDiariaSessao | null> {
  const sessao = await getContagemDiaria(id)
  if (!sessao) return null
  sessao.status = 'aberto'
  sessao.dataFim = null
  await saveContagemDiaria(sessao)
  return sessao
}

export async function deleteContagemDiaria(id: string): Promise<boolean> {
  requireSupabase()
  const sessao = await getContagemDiaria(id)
  if (!sessao) return false
  if (await usarSupabaseSessoes()) {
    if (!preferLocalOnly()) {
      try {
        await deleteContagemDiariaSessaoSupabase(id)
      } catch {
        /* mantém cópia local removida abaixo */
      }
    }
    clearLinhasOverlay(id)
  } else {
    writeLegacyLocal(readLegacyLocal().filter((l) => l.id !== id))
  }
  removeCachedSessao(id)
  return true
}

export async function atualizarContagemDiariaMeta(
  id: string,
  patch: { titulo?: string; local?: string; dataContagem?: string },
): Promise<ContagemDiariaSessao | null> {
  const sessao = await getContagemDiaria(id)
  if (!sessao) return null
  if (patch.titulo !== undefined) {
    const t = patch.titulo.trim()
    if (t) sessao.titulo = t
  }
  if (patch.local !== undefined) {
    const l = patch.local.trim()
    if (l) sessao.local = l
  }
  if (patch.dataContagem !== undefined) {
    const d = patch.dataContagem.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) sessao.dataContagem = d
  }
  await saveContagemDiaria(sessao)
  return sessao
}

export function formatDataContagemBR(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(ymd)
  if (!m) return ymd
  return `${m[3]}/${m[2]}/${m[1]}`
}

export async function addLinhaContagemDiaria(
  contagemId: string,
  linha: Omit<ContagemDiariaLinhaCaptura, 'id' | 'createdAt'>,
): Promise<ContagemDiariaLinhaCaptura | null> {
  const sessao = await getContagemDiaria(contagemId)
  if (!sessao || sessao.status !== 'aberto') return null
  const row: ContagemDiariaLinhaCaptura = {
    ...linha,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  sessao.linhas = [...sessao.linhas, row]
  await saveContagemDiaria(sessao)
  return row
}

export async function updateLinhaContagemDiaria(
  contagemId: string,
  linhaId: string,
  linha: Omit<ContagemDiariaLinhaCaptura, 'id' | 'createdAt'>,
): Promise<ContagemDiariaLinhaCaptura | null> {
  const sessao = await getContagemDiaria(contagemId)
  if (!sessao || sessao.status !== 'aberto') return null
  const idx = sessao.linhas.findIndex((l) => l.id === linhaId)
  if (idx < 0) return null
  const prev = sessao.linhas[idx]!
  const row: ContagemDiariaLinhaCaptura = {
    ...linha,
    id: linhaId,
    createdAt: prev.createdAt,
  }
  const next = [...sessao.linhas]
  next[idx] = row
  sessao.linhas = next
  await saveContagemDiaria(sessao)
  return row
}

export async function deleteLinhaContagemDiaria(contagemId: string, linhaId: string): Promise<boolean> {
  const sessao = await getContagemDiaria(contagemId)
  if (!sessao || sessao.status !== 'aberto') return false
  const antes = sessao.linhas.length
  sessao.linhas = sessao.linhas.filter((l) => l.id !== linhaId)
  if (sessao.linhas.length === antes) return false
  await saveContagemDiaria(sessao)
  return true
}

export { contagemDiariaSyncHabilitado } from './contagemDiariaSessaoSupabase'
