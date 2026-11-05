import { emitentesFromPersisted } from './emitentesRegistry'
import { contarEnderecosPersistidos } from './movimentos'
import { persistedEquals } from './syncMerge'
import type { PersistedData } from '../types'

const DATA_KEY = 'ultrafrio-enderecamento-v3'
const LEGACY_KEY = 'ultrafrio-enderecamento-v2'
const SYNC_BASE_KEY = 'ultrafrio-sync-base-v1'
const LEGACY_V1_KEY = 'ultrafrio-enderecamento-v1'

const BACKUP_KEYS = [DATA_KEY, SYNC_BASE_KEY, LEGACY_KEY, LEGACY_V1_KEY]

/** Quanto maior, mais completo o snapshot (endereços pesam mais). */
export function persistedRichness(data: PersistedData): number {
  const enderecos = contarEnderecosPersistidos(data)
  const movimentosAtivos = data.movimentos.filter((m) => !m.excluido).length
  return enderecos * 10_000 + data.notas.length * 500 + movimentosAtivos * 10
}

function parsePersistedRaw(raw: string): PersistedData | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedData>
    const base = {
      notas: parsed.notas ?? [],
      movimentos: parsed.movimentos ?? [],
      notasCanceladas: parsed.notasCanceladas ?? [],
    }
    return {
      ...base,
      emitentes: emitentesFromPersisted(base),
    }
  } catch {
    return null
  }
}

function loadRawKey(key: string): PersistedData | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (!raw) return null
  return parsePersistedRaw(raw)
}

/** Lê cada chave de backup do navegador separadamente (sem encadeamento). */
export function loadAllLocalBackupCandidates(): PersistedData[] {
  const seen = new Set<string>()
  const out: PersistedData[] = []

  for (const key of BACKUP_KEYS) {
    const data = loadRawKey(key)
    if (!data || persistedRichness(data) === 0) continue
    const sig = JSON.stringify({
      notas: data.notas.length,
      end: contarEnderecosPersistidos(data),
      mov: data.movimentos.length,
    })
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(data)
  }

  return out
}

export function pickBestPersistedCandidate(candidates: PersistedData[]): PersistedData | null {
  let best: PersistedData | null = null
  let bestScore = -1
  for (const c of candidates) {
    const score = persistedRichness(c)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/** Escolhe o melhor entre nuvem e todos os backups locais do navegador. */
export function recoverBestPersisted(remote: PersistedData): {
  data: PersistedData
  recoveredFromLocal: boolean
} {
  const candidates = [remote, ...loadAllLocalBackupCandidates()]
  const best = pickBestPersistedCandidate(candidates) ?? remote
  const recoveredFromLocal =
    persistedRichness(best) > persistedRichness(remote) && persistedRichness(best) > 0
  return { data: best, recoveredFromLocal }
}

/** Nuvem sem NFs nem movimentos ativos (reset administrativo). */
export function nuvemSemEstoque(data: PersistedData): boolean {
  return data.notas.length === 0 && !data.movimentos.some((m) => !m.excluido)
}

/**
 * Reset detectado no reload: nuvem ficou vazia enquanto a aba ainda tinha o último snapshot persistido.
 * Não bloqueia cadastro novo após reset (local diferente da base ou base ainda vazia).
 */
export function resetRemotoDetectado(
  remote: PersistedData,
  local: PersistedData,
  base: PersistedData | null,
): boolean {
  if (!nuvemSemEstoque(remote)) return false
  if (contarEnderecosPersistidos(local) === 0 && local.notas.length === 0) return false
  if (!base || persistedRichness(base) === 0) return false
  return persistedEquals(local, base)
}

/** Impede gravar estado vazio por cima de estoque existente (exceto saída legítima). */
export function wouldWipePersistedStock(prev: PersistedData, next: PersistedData): boolean {
  const prevEnd = contarEnderecosPersistidos(prev)
  const nextEnd = contarEnderecosPersistidos(next)
  if (prevEnd === 0) return false
  if (nextEnd > 0) return false

  const countSaidas = (d: PersistedData) =>
    d.movimentos.filter((m) => m.tipo === 'saida' && !m.excluido).length
  if (countSaidas(next) > countSaidas(prev)) return false

  return next.notas.length <= prev.notas.length
}

/** Não sobrescreve backup local com snapshot mais pobre. */
export function shouldSkipLocalWrite(current: PersistedData | null, next: PersistedData): boolean {
  if (!current) return false
  return (
    persistedRichness(next) < persistedRichness(current) &&
    persistedRichness(current) > 0 &&
    wouldWipePersistedStock(current, next)
  )
}
