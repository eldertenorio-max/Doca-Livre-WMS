import type { AppState, PersistedData } from '../../types'
import { emitentesFromPersisted } from '../emitentesRegistry'
import { shouldSkipLocalWrite } from '../localBackupRecovery'
import { loadUiSession, saveUiSession } from '../uiSession'
import type { EnderecamentoRepository } from './types'

const DATA_KEY = 'ultrafrio-enderecamento-v3'
const LEGACY_KEY = 'ultrafrio-enderecamento-v2'
const SYNC_BASE_KEY = 'ultrafrio-sync-base-v1'
export const UI_KEY = 'ultrafrio-ui-prefs-v1'

function loadBundle(): PersistedData {
  try {
    const raw = localStorage.getItem(DATA_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? localStorage.getItem('ultrafrio-enderecamento-v1')
    if (!raw) return { notas: [], movimentos: [], notasCanceladas: [], emitentes: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedData & AppState>
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
    return { notas: [], movimentos: [], notasCanceladas: [], emitentes: [] }
  }
}

export function loadLocalPersistedData(): PersistedData {
  return loadBundle()
}

/** Grava rascunho local de forma síncrona — protege contra F5 antes do Supabase concluir. */
export function syncWriteLocalDraft(data: Omit<PersistedData, 'emitentes'>): void {
  try {
    const current = loadRawKeyOnly(DATA_KEY)
    const next = {
      ...data,
      emitentes: emitentesFromPersisted({
        notas: data.notas,
        notasCanceladas: data.notasCanceladas,
      }),
    }
    if (shouldSkipLocalWrite(current, next)) return
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function loadRawKeyOnly(key: string): PersistedData | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedData>
    const base = {
      notas: parsed.notas ?? [],
      movimentos: parsed.movimentos ?? [],
      notasCanceladas: parsed.notasCanceladas ?? [],
    }
    return { ...base, emitentes: emitentesFromPersisted(base) }
  } catch {
    return null
  }
}

export function loadLocalSyncBase(): PersistedData | null {
  try {
    const raw = localStorage.getItem(SYNC_BASE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedData>
    return {
      notas: parsed.notas ?? [],
      movimentos: parsed.movimentos ?? [],
      notasCanceladas: parsed.notasCanceladas ?? [],
      emitentes: emitentesFromPersisted({
        notas: parsed.notas ?? [],
        notasCanceladas: parsed.notasCanceladas ?? [],
      }),
    }
  } catch {
    return null
  }
}

export function syncWriteLocalSyncBase(data: Omit<PersistedData, 'emitentes'>): void {
  try {
    const current = loadRawKeyOnly(SYNC_BASE_KEY)
    const next = {
      ...data,
      emitentes: emitentesFromPersisted({
        notas: data.notas,
        notasCanceladas: data.notasCanceladas,
      }),
    }
    if (shouldSkipLocalWrite(current, next)) return
    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export function clearLocalPersistedData(): void {
  localStorage.removeItem(DATA_KEY)
  localStorage.removeItem(LEGACY_KEY)
  localStorage.removeItem('ultrafrio-enderecamento-v1')
  localStorage.removeItem(SYNC_BASE_KEY)
  localStorage.removeItem(UI_KEY)
}

function loadUiFromLegacy(): Pick<AppState, 'activeNfId' | 'activeItemIndex'> {
  const session = loadUiSession()
  if (session.activeNfId != null || session.activeItemIndex != null) {
    return { activeNfId: session.activeNfId, activeItemIndex: session.activeItemIndex }
  }
  const raw = localStorage.getItem(UI_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as Pick<AppState, 'activeNfId' | 'activeItemIndex'>
    } catch {
      /* ignore */
    }
  }
  return { activeNfId: null, activeItemIndex: null }
}

export const localRepository: EnderecamentoRepository = {
  mode: 'local',

  async loadData() {
    return loadBundle()
  },

  async saveData(data) {
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
  },

  async registrarEmitente() {
    /* modo local: emitentes derivados das notas em loadData */
  },

  loadUiPrefs() {
    return loadUiFromLegacy()
  },

  saveUiPrefs(prefs) {
    localStorage.setItem(UI_KEY, JSON.stringify(prefs))
    saveUiSession({
      activeNfId: prefs.activeNfId,
      activeItemIndex: prefs.activeItemIndex,
    })
  },
}
