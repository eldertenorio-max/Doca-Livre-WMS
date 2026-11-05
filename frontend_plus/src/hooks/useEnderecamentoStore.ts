import { useCallback, useEffect, useRef, useState } from 'react'
import { getRepository, getStorageMode, type EnderecamentoRepository } from '../lib/repository'
import {
  loadLocalPersistedData,
  loadLocalSyncBase,
  localRepository,
  clearLocalPersistedData,
  syncWriteLocalDraft,
  syncWriteLocalSyncBase,
} from '../lib/repository/localRepository'
import { ensureSupabaseConfig } from '../lib/supabaseConfig'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { subscribeEnderecamentoChanges } from '../lib/supabaseRealtime'
import { podeZerarBancoHomologacao, zerarBancoHomologacaoSupabase } from '../lib/homologZerarBanco'
import { normalizePersistedData, prepareLoadedDataWithRepair } from '../lib/persistence'
import {
  persistedRichness,
  recoverBestPersisted,
  resetRemotoDetectado,
  wouldWipePersistedStock,
} from '../lib/localBackupRecovery'
import { contarEnderecosPersistidos } from '../lib/movimentos'
import { mesclarEmitentesSugeridos, normalizarEmitente } from '../lib/emitentesRegistry'
import {
  consolidarRemocoesLocais,
  mergePersistedData,
  nfIdsRemovidosDesde,
  persistedEquals,
  pickPersisted,
  protegerNotasContraRegressao,
  protegerPersistedContraRegressao,
  remoteRegressedVersusLocal,
} from '../lib/syncMerge'
import type { AppState, PersistedData } from '../types'
import type { StorageMode } from '../lib/repository/types'

const emptyState: AppState = {
  notas: [],
  notasCanceladas: [],
  movimentos: [],
  emitentes: [],
  activeNfId: null,
  activeItemIndex: null,
}

const SAVE_DEBOUNCE_MS = 400
/** Supabase: salva no próximo frame (sem espera perceptível). */
const SAVE_DEBOUNCE_SUPABASE_MS = 0
/** Coalesce curto para agrupar o burst de eventos Realtime de um mesmo save. */
const REMOTE_RELOAD_DEBOUNCE_MS = 120
/** Ignora eco do próprio save no Realtime; curto para captar mudanças de outros quase na hora. */
const IGNORE_REMOTE_AFTER_SAVE_MS = 4000
/** Fallback caso o Realtime não esteja habilitado. */
const POLL_INTERVAL_MS = 1500
const PERSIST_RETRY_MS = 600
const PERSIST_AUTO_RETRY_MS = 2500
const PERSIST_AUTO_RETRY_MAX = 5
/** Tempo mínimo que o aviso "Salvando…" fica visível em ações importantes (para dar feedback claro e rápido). */
const SAVING_INDICATOR_MIN_MS = 450

function formatPersistErrorMessage(e: unknown, supabaseMode: boolean): string {
  if (!supabaseMode) {
    return e instanceof Error ? e.message : 'Erro ao salvar dados.'
  }
  const raw = e instanceof Error ? e.message : ''
  if (raw.includes('ultrafrio_movimentos_tipo_check')) {
    return (
      'Erro ao salvar movimentação na nuvem: o Supabase ainda não aceita o tipo "movimentacao". ' +
      'No SQL Editor, rode o arquivo supabase/sql/apply_pending_columns.sql (ou movimentos_tipo_movimentacao.sql) e tente de novo.'
    )
  }
  return raw
    ? `Erro ao salvar na nuvem: ${raw}`
    : 'Erro ao salvar na nuvem. Verifique a conexão com o Supabase.'
}
const PERSIST_MAX_ATTEMPTS = 3

function writeLocalCache(repo: EnderecamentoRepository, data: PersistedData): void {
  if (repo.mode === 'supabase') return
  syncWriteLocalDraft(data)
  syncWriteLocalSyncBase(data)
}

function pickRepository(): EnderecamentoRepository {
  return isSupabaseConfigured() ? getRepository() : localRepository
}

function mergeLoadedWithLocalDraft(remote: PersistedData): {
  data: PersistedData
  recoveredFromLocal: boolean
} {
  const { data: best, recoveredFromLocal } = recoverBestPersisted(remote)
  const draft = loadLocalPersistedData()
  const draftEmpty = draft.notas.length === 0 && draft.movimentos.length === 0

  if (draftEmpty || persistedRichness(draft) === 0) {
    return { data: best, recoveredFromLocal }
  }

  const base = loadLocalSyncBase() ?? remote
  const merged = mergePersistedData(base, draft, remote)
  const protegido = protegerPersistedContraRegressao(draft, merged)
  const consolidado = consolidarRemocoesLocais(base, draft, protegido)
  const result = normalizePersistedData(consolidado)

  if (persistedRichness(result) >= persistedRichness(best)) {
    return { data: result, recoveredFromLocal }
  }
  return {
    data: best,
    recoveredFromLocal: recoveredFromLocal || persistedRichness(best) > persistedRichness(remote),
  }
}

function preserveUi(
  prev: AppState,
  data: PersistedData,
  options?: { trustRemote?: boolean },
): AppState {
  let notas = options?.trustRemote
    ? data.notas
    : protegerNotasContraRegressao(prev.notas, data.notas)
  let activeNfId = prev.activeNfId

  if (activeNfId) {
    const inMerged = notas.some((n) => n.id === activeNfId)
    const prevNf = prev.notas.find((n) => n.id === activeNfId)
    if (
      !inMerged &&
      prevNf &&
      (prevNf.status === 'concluida' ||
        prevNf.items.some((it) => it.allocatedAddresses.length > 0))
    ) {
      notas = [prevNf, ...notas.filter((n) => n.id !== activeNfId)]
    } else if (!inMerged) {
      if (prevNf?.status === 'em_andamento') {
        notas = [prevNf, ...notas.filter((n) => n.id !== activeNfId)]
      } else {
        activeNfId = null
      }
    }
  }

  const activeItemIndex = activeNfId ? prev.activeItemIndex : null
  return { ...data, notas, activeNfId, activeItemIndex }
}

function isDirtyComparedToBase(current: PersistedData, base: PersistedData | null): boolean {
  if (!base) return false
  return !persistedEquals(current, base)
}

function hasPendingLocalChanges(
  stateRef: AppState,
  lastPersisted: PersistedData | null,
  pendingSave: AppState | null,
  saveTimer: ReturnType<typeof setTimeout> | null,
): boolean {
  if (pendingSave || saveTimer) return true
  if (!lastPersisted) return false
  const localPick = pickPersisted(stateRef)
  if (nfIdsRemovidosDesde(lastPersisted, localPick).size > 0) return true
  return isDirtyComparedToBase(localPick, lastPersisted)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useEnderecamentoStore() {
  const repoRef = useRef<EnderecamentoRepository>(pickRepository())
  const [state, setState] = useState<AppState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingImportante, setSavingImportante] = useState(false)
  const savingImportanteCountRef = useRef(0)
  const savingIndicatorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingIndicatorShownAtRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [storageMode, setStorageMode] = useState<StorageMode>(getStorageMode())
  const skipSave = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ignoreRemoteUntil = useRef(0)
  const savingRef = useRef(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<AppState | null>(null)
  const persistChainRef = useRef<Promise<void>>(Promise.resolve())
  const lastPersistedRef = useRef<PersistedData | null>(null)
  const stateRef = useRef(state)
  const autoRetryCountRef = useRef(0)
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteReloadQueuedRef = useRef(false)
  const scheduleRemoteReloadRef = useRef<() => void>(() => {})
  const persistCoalesceRef = useRef<AppState | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const applyPersistedToState = useCallback((data: PersistedData, base: AppState) => {
    const next = preserveUi(base, data)
    if (persistedEquals(pickPersisted(base), data)) return base
    skipSave.current = true
    stateRef.current = next
    setState(next)
    setTimeout(() => {
      skipSave.current = false
    }, 250)
    return next
  }, [])

  const persistInner = useCallback(async (next: AppState) => {
    const repo = repoRef.current
    savingRef.current = true
    setSaving(true)

    const runLocalSave = async () => {
      if (repo.mode !== 'supabase') {
        const dataToSave = pickPersisted(next)
        await repo.saveData({
          notas: dataToSave.notas,
          movimentos: dataToSave.movimentos,
          notasCanceladas: dataToSave.notasCanceladas,
        })
        repo.saveUiPrefs({
          activeNfId: next.activeNfId,
          activeItemIndex: next.activeItemIndex,
        })
        writeLocalCache(repo, dataToSave)
        lastPersistedRef.current = dataToSave
        pendingSaveRef.current = null
        return dataToSave
      }

      let dataToSave = pickPersisted(next)
      const previousSnapshot = lastPersistedRef.current
      let saidaOuRemocaoIntencional = false

      if (lastPersistedRef.current) {
        const localPick = pickPersisted(next)
        const base = lastPersistedRef.current
        const reduziuEnderecos =
          contarEnderecosPersistidos(localPick) < contarEnderecosPersistidos(base)
        const removeuNotas = nfIdsRemovidosDesde(base, localPick).size > 0
        saidaOuRemocaoIntencional = reduziuEnderecos || removeuNotas
        if (saidaOuRemocaoIntencional) {
          // Saída / cancelamento de entrada — grava exatamente o estado local (sem merge anti-regressão).
          dataToSave = localPick
        } else {
          dataToSave = mergePersistedData(base, localPick, base)
          dataToSave = protegerPersistedContraRegressao(localPick, dataToSave)
          dataToSave = consolidarRemocoesLocais(base, localPick, dataToSave)
        }
      }

      // Não reparar endereços ao gravar — evita restaurar posições recém-liberadas.
      dataToSave = normalizePersistedData(dataToSave, { reparar: false })

      if (
        lastPersistedRef.current &&
        !saidaOuRemocaoIntencional &&
        wouldWipePersistedStock(lastPersistedRef.current, dataToSave)
      ) {
        throw new Error(
          'Operação bloqueada: tentativa de apagar todo o estoque. Recarregue a página (F5) para recuperar do backup local.',
        )
      }

      const remoteRaw = await repo.loadData()
      const remoteNorm = normalizePersistedData(
        prepareLoadedDataWithRepair(remoteRaw).data,
      )
      if (
        resetRemotoDetectado(
          remoteNorm,
          pickPersisted(next),
          lastPersistedRef.current ?? pickPersisted(next),
        )
      ) {
        clearLocalPersistedData()
        lastPersistedRef.current = remoteNorm
        applyPersistedToState(remoteNorm, next)
        setError(
          'O banco foi resetado. Estoque local descartado — feche outras abas e use Ctrl+Shift+R.',
        )
        return remoteNorm
      }

      await repo.saveData(
        {
          notas: dataToSave.notas,
          movimentos: dataToSave.movimentos,
          notasCanceladas: dataToSave.notasCanceladas,
        },
        {
          previous: previousSnapshot
            ? {
                notas: previousSnapshot.notas,
                movimentos: previousSnapshot.movimentos,
                notasCanceladas: previousSnapshot.notasCanceladas,
              }
            : null,
        },
      )
      repo.saveUiPrefs({
        activeNfId: next.activeNfId,
        activeItemIndex: next.activeItemIndex,
      })
      writeLocalCache(repo, dataToSave)

      if (!persistedEquals(dataToSave, pickPersisted(next))) {
        const localPick = pickPersisted(next)
        const removidas = lastPersistedRef.current
          ? nfIdsRemovidosDesde(lastPersistedRef.current, localPick)
          : new Set<string>()
        const restaurariaRemovidas =
          removidas.size > 0 && dataToSave.notas.some((n) => removidas.has(n.id))
        if (
          !restaurariaRemovidas &&
          contarEnderecosPersistidos(dataToSave) <= contarEnderecosPersistidos(localPick)
        ) {
          applyPersistedToState(dataToSave, next)
        }
      }

      return dataToSave
    }

    try {
      let lastError: unknown = null
      for (let attempt = 0; attempt < PERSIST_MAX_ATTEMPTS; attempt++) {
        try {
          const dataToSave = await runLocalSave()
          lastPersistedRef.current = dataToSave
          pendingSaveRef.current = null
          ignoreRemoteUntil.current = Date.now() + IGNORE_REMOTE_AFTER_SAVE_MS
          window.setTimeout(() => {
            if (remoteReloadQueuedRef.current) {
              remoteReloadQueuedRef.current = false
              scheduleRemoteReloadRef.current()
            }
          }, IGNORE_REMOTE_AFTER_SAVE_MS + 100)
          autoRetryCountRef.current = 0
          if (autoRetryTimerRef.current) {
            clearTimeout(autoRetryTimerRef.current)
            autoRetryTimerRef.current = null
          }
          setError(null)
          lastError = null
          break
        } catch (e) {
          lastError = e
          if (attempt < PERSIST_MAX_ATTEMPTS - 1) {
            await sleep(PERSIST_RETRY_MS * (attempt + 1))
          }
        }
      }

      if (lastError) {
        throw lastError
      }
    } catch (e) {
      setError(formatPersistErrorMessage(e, repo.mode === 'supabase'))
      if (
        repo.mode === 'supabase' &&
        autoRetryCountRef.current < PERSIST_AUTO_RETRY_MAX &&
        hasPendingLocalChanges(stateRef.current, lastPersistedRef.current, null, null) &&
        !autoRetryTimerRef.current
      ) {
        autoRetryCountRef.current += 1
        autoRetryTimerRef.current = setTimeout(() => {
          autoRetryTimerRef.current = null
          if (
            skipSave.current ||
            savingRef.current ||
            !hasPendingLocalChanges(stateRef.current, lastPersistedRef.current, null, null)
          ) {
            return
          }
          const job = persistChainRef.current
            .catch(() => {})
            .then(() => persistInner(stateRef.current))
          persistChainRef.current = job.catch(() => {})
        }, PERSIST_AUTO_RETRY_MS)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
      if (remoteReloadQueuedRef.current) {
        remoteReloadQueuedRef.current = false
        scheduleRemoteReloadRef.current()
      }
    }
  }, [applyPersistedToState])

  const persist = useCallback(
    (next: AppState): Promise<void> => {
      persistCoalesceRef.current = next
      const job = persistChainRef.current
        .catch(() => {})
        .then(async () => {
          while (persistCoalesceRef.current) {
            const batch = persistCoalesceRef.current
            persistCoalesceRef.current = null
            await persistInner(batch)
          }
        })
      persistChainRef.current = job.catch(() => {})
      return job
    },
    [persistInner],
  )

  const saveNow = useCallback(
    async (next: AppState, opts?: { indicar?: boolean }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      pendingSaveRef.current = null
      const indicar = opts?.indicar ?? true
      if (indicar) {
        // Ações importantes: mostra o aviso na hora.
        if (savingIndicatorHideTimerRef.current) {
          clearTimeout(savingIndicatorHideTimerRef.current)
          savingIndicatorHideTimerRef.current = null
        }
        if (savingImportanteCountRef.current === 0) {
          savingIndicatorShownAtRef.current = Date.now()
        }
        savingImportanteCountRef.current += 1
        setSavingImportante(true)
      }
      try {
        await persist(next)
      } finally {
        if (indicar) {
          savingImportanteCountRef.current = Math.max(0, savingImportanteCountRef.current - 1)
          if (savingImportanteCountRef.current === 0) {
            // Garante um tempo mínimo visível para o feedback ser perceptível, mas some rápido.
            const restante = SAVING_INDICATOR_MIN_MS - (Date.now() - savingIndicatorShownAtRef.current)
            if (restante > 0) {
              savingIndicatorHideTimerRef.current = setTimeout(() => {
                savingIndicatorHideTimerRef.current = null
                if (savingImportanteCountRef.current === 0) setSavingImportante(false)
              }, restante)
            } else {
              setSavingImportante(false)
            }
          }
        }
      }
    },
    [persist],
  )

  const requestRemoteReload = useCallback(() => {
    if (savingRef.current || Date.now() < ignoreRemoteUntil.current) {
      remoteReloadQueuedRef.current = true
      return
    }
    scheduleRemoteReloadRef.current()
  }, [])

  const reloadFromRemote = useCallback(async () => {
    if (repoRef.current.mode !== 'supabase') return
    if (savingRef.current) {
      remoteReloadQueuedRef.current = true
      return
    }
    if (Date.now() < ignoreRemoteUntil.current) {
      remoteReloadQueuedRef.current = true
      return
    }
    skipSave.current = true
    try {
      const remote = await repoRef.current.loadData()
      const { data, dadosReparados, enderecosRecuperados, enderecosRemovidos } =
        prepareLoadedDataWithRepair(remote)
      const remoteMergedNormalized = normalizePersistedData(data)
      const base = lastPersistedRef.current
      const localNow = pickPersisted(stateRef.current)

      if (resetRemotoDetectado(remoteMergedNormalized, localNow, base)) {
        lastPersistedRef.current = remoteMergedNormalized
        setState((prev) => {
          const next = preserveUi(prev, remoteMergedNormalized, { trustRemote: true })
          if (persistedEquals(pickPersisted(prev), pickPersisted(next))) return prev
          return next
        })
        writeLocalCache(repoRef.current, remoteMergedNormalized)
        setError(
          'O banco foi resetado. Estoque local descartado — feche outras abas e use Ctrl+Shift+R se ainda aparecer dados antigos.',
        )
        return
      }

      if (
        hasPendingLocalChanges(
          stateRef.current,
          lastPersistedRef.current,
          pendingSaveRef.current,
          saveTimer.current,
        )
      ) {
        return
      }

      const trustRemote =
        base !== null &&
        persistedEquals(localNow, base) &&
        !remoteRegressedVersusLocal(localNow, remoteMergedNormalized)

      if (
        base !== null &&
        persistedEquals(localNow, base) &&
        remoteRegressedVersusLocal(localNow, remoteMergedNormalized)
      ) {
        return
      }

      if (
        trustRemote &&
        contarEnderecosPersistidos(remoteMergedNormalized) !==
          contarEnderecosPersistidos(localNow)
      ) {
        return
      }

      setState((prev) => {
        const local = pickPersisted(prev)
        const merged = trustRemote
          ? remoteMergedNormalized
          : base
            ? mergePersistedData(base, local, remoteMergedNormalized)
            : remoteMergedNormalized
        const protegido = trustRemote
          ? merged
          : protegerPersistedContraRegressao(local, merged)
        const consolidado = consolidarRemocoesLocais(base, local, protegido)
        const normalized = normalizePersistedData(consolidado)
        lastPersistedRef.current = normalized
        const next = preserveUi(prev, normalized, { trustRemote })
        if (persistedEquals(pickPersisted(prev), pickPersisted(next))) return prev
        return next
      })
      setError(null)

      const merged = lastPersistedRef.current
      if (merged) {
        writeLocalCache(repoRef.current, merged)
      }
      const precisaSalvarReparo =
        (dadosReparados && (enderecosRecuperados > 0 || enderecosRemovidos > 0)) ||
        (merged &&
          !persistedEquals(merged, remoteMergedNormalized) &&
          !wouldWipePersistedStock(data, merged))

      if (precisaSalvarReparo && merged) {
        skipSave.current = true
        try {
          const reparado = normalizePersistedData(merged)
          await repoRef.current.saveData({
            notas: reparado.notas,
            movimentos: reparado.movimentos,
            notasCanceladas: reparado.notasCanceladas,
          })
          lastPersistedRef.current = reparado
          ignoreRemoteUntil.current = Date.now() + IGNORE_REMOTE_AFTER_SAVE_MS
        } catch (e) {
          setError(
            e instanceof Error
              ? `Dados recuperados do histórico, mas falhou ao salvar na nuvem: ${e.message}`
              : 'Dados recuperados do histórico, mas falhou ao salvar na nuvem.',
          )
        }
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `Erro ao sincronizar: ${e.message}`
          : 'Erro ao sincronizar com a nuvem.',
      )
    } finally {
      setTimeout(() => {
        skipSave.current = false
      }, 200)
    }
  }, [])

  const scheduleRemoteReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      void reloadFromRemote()
    }, REMOTE_RELOAD_DEBOUNCE_MS)
  }, [reloadFromRemote])

  useEffect(() => {
    scheduleRemoteReloadRef.current = scheduleRemoteReload
  }, [scheduleRemoteReload])

  useEffect(() => {
    let cancelled = false

    async function load() {
      await ensureSupabaseConfig()

      if (isSupabaseConfigured()) {
        clearLocalPersistedData()
      }

      const repo = pickRepository()
      repoRef.current = repo
      setStorageMode(repo.mode)

      try {
        const remoteRaw = await repo.loadData()
        const { data: remotePrepared, dadosReparados } = prepareLoadedDataWithRepair(remoteRaw)
        const mergedLoad =
          repo.mode === 'supabase'
            ? { data: remotePrepared, recoveredFromLocal: false }
            : mergeLoadedWithLocalDraft(remotePrepared)
        let data = normalizePersistedData(mergedLoad.data)

        if (repo.mode !== 'supabase' && wouldWipePersistedStock(remotePrepared, data)) {
          data = normalizePersistedData(remotePrepared)
        }

        const ui = repo.loadUiPrefs()

        if (!cancelled) {
          lastPersistedRef.current = data
          writeLocalCache(repo, data)
          setState({ ...data, ...ui })

          if (mergedLoad.recoveredFromLocal && persistedRichness(data) > 0) {
            setError(
              'Estoque recuperado do backup local do navegador. Sincronizando com a nuvem…',
            )
          } else if (persistedRichness(data) === 0 && persistedRichness(remotePrepared) === 0) {
            setError(null)
          } else {
            setError(null)
          }

          const podeSalvarNaNuvem =
            repo.mode === 'supabase' &&
            persistedRichness(data) > 0 &&
            !wouldWipePersistedStock(remotePrepared, data) &&
            (dadosReparados ||
              mergedLoad.recoveredFromLocal ||
              !persistedEquals(data, remotePrepared))

          if (podeSalvarNaNuvem) {
            skipSave.current = true
            try {
              await repo.saveData({
                notas: data.notas,
                movimentos: data.movimentos,
                notasCanceladas: data.notasCanceladas,
              })
              lastPersistedRef.current = data
              writeLocalCache(repo, data)
              ignoreRemoteUntil.current = Date.now() + IGNORE_REMOTE_AFTER_SAVE_MS
              if (mergedLoad.recoveredFromLocal) {
                setError('Estoque restaurado e salvo na nuvem com sucesso.')
              } else {
                setError(null)
              }
            } catch (e) {
              setError(
                e instanceof Error
                  ? `Alterações locais recuperadas, mas falhou ao sincronizar na nuvem: ${e.message}`
                  : 'Alterações locais recuperadas, mas falhou ao sincronizar na nuvem.',
              )
            } finally {
              skipSave.current = false
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          if (repo.mode === 'supabase') {
            setError(
              e instanceof Error
                ? `Não foi possível carregar da nuvem: ${e.message}`
                : 'Não foi possível carregar da nuvem. Confira o Supabase.',
            )
          } else {
            setError(e instanceof Error ? e.message : 'Erro ao carregar dados.')
          }
        }
      } finally {
        if (!cancelled) {
          skipSave.current = false
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading || storageMode !== 'supabase' || !isSupabaseConfigured()) return

    const unsubscribe = subscribeEnderecamentoChanges(() => {
      requestRemoteReload()
    })
    const poll = window.setInterval(() => requestRemoteReload(), POLL_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') requestRemoteReload()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      unsubscribe()
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [loading, requestRemoteReload, storageMode])

  useEffect(() => {
    if (skipSave.current || loading) return

    const persisted = pickPersisted(state)
    if (storageMode !== 'supabase') {
      syncWriteLocalDraft(persisted)
    }

    if (lastPersistedRef.current && persistedEquals(persisted, lastPersistedRef.current)) {
      return
    }

    pendingSaveRef.current = state
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const debounceMs = storageMode === 'supabase' ? SAVE_DEBOUNCE_SUPABASE_MS : SAVE_DEBOUNCE_MS
    saveTimer.current = setTimeout(() => {
      const pending = pendingSaveRef.current ?? stateRef.current
      pendingSaveRef.current = null
      void persist(pending)
    }, debounceMs)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [state, loading, persist, storageMode])

  useEffect(() => {
    const flushPendingSave = () => {
      if (skipSave.current || savingRef.current) return
      const pending = pendingSaveRef.current ?? stateRef.current
      if (storageMode !== 'supabase') {
        syncWriteLocalDraft(pickPersisted(pending))
      }
      repoRef.current.saveUiPrefs({
        activeNfId: pending.activeNfId,
        activeItemIndex: pending.activeItemIndex,
      })
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      pendingSaveRef.current = null
      void persist(pending)
    }

    window.addEventListener('pagehide', flushPendingSave)
    window.addEventListener('beforeunload', flushPendingSave)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingSave()
    })

    return () => {
      window.removeEventListener('pagehide', flushPendingSave)
      window.removeEventListener('beforeunload', flushPendingSave)
    }
  }, [persist])

  const updateState = useCallback((updater: AppState | ((prev: AppState) => AppState)) => {
    if (typeof updater === 'function') {
      setState((prev) => {
        const next = updater(prev)
        stateRef.current = next
        return next
      })
    } else {
      stateRef.current = updater
      setState(updater)
    }
  }, [])

  const registrarEmitente = useCallback(async (nome: string) => {
    const n = normalizarEmitente(nome)
    if (!n) return

    try {
      await repoRef.current.registrarEmitente(nome)
    } catch {
      /* mantém sugestão local se a nuvem falhar momentaneamente */
    }

    setState((prev) => ({
      ...prev,
      emitentes: mesclarEmitentesSugeridos([n], prev.emitentes),
    }))
  }, [])

  const aplicarBackupRecuperado = useCallback(
    async (best: PersistedData, origem: string): Promise<boolean> => {
      if (persistedRichness(best) === 0) {
        setError('Arquivo de backup vazio — nada para restaurar.')
        return false
      }

      const normalized = normalizePersistedData(prepareLoadedDataWithRepair(best).data)
      const ui = repoRef.current.loadUiPrefs()
      const nextState: AppState = { ...normalized, ...ui }

      skipSave.current = true
      setState(nextState)
      lastPersistedRef.current = pickPersisted(nextState)
      writeLocalCache(repoRef.current, pickPersisted(nextState))
      skipSave.current = false

      try {
        await saveNow(nextState)
        setError(
          `${origem}: ${nextState.notas.length} NF(s), ${contarEnderecosPersistidos(pickPersisted(nextState))} posição(ões) restauradas e salvas na nuvem.`,
        )
        return true
      } catch (e) {
        setError(
          e instanceof Error
            ? `${origem}, mas falhou ao salvar na nuvem: ${e.message}`
            : `${origem}, mas falhou ao salvar na nuvem.`,
        )
        return false
      }
    },
    [saveNow],
  )

  const recuperarDoNavegador = useCallback(async (): Promise<boolean> => {
    const empty: PersistedData = {
      notas: [],
      movimentos: [],
      notasCanceladas: [],
      emitentes: [],
    }
    const { data: best, recoveredFromLocal } = recoverBestPersisted(empty)
    if (!recoveredFromLocal || persistedRichness(best) === 0) {
      setError(
        'Nenhum backup encontrado neste navegador. Restaure pelo Supabase (Database → Backups) ou importe um arquivo .json de backup.',
      )
      return false
    }
    return aplicarBackupRecuperado(best, 'Estoque recuperado do navegador')
  }, [aplicarBackupRecuperado])

  const importarBackupArquivo = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const raw = await file.text()
        const parsed = JSON.parse(raw) as Partial<PersistedData>
        const backup: PersistedData = {
          notas: parsed.notas ?? [],
          movimentos: parsed.movimentos ?? [],
          notasCanceladas: parsed.notasCanceladas ?? [],
          emitentes: parsed.emitentes ?? [],
        }
        return aplicarBackupRecuperado(backup, 'Backup importado')
      } catch (e) {
        setError(
          e instanceof Error
            ? `Arquivo de backup inválido: ${e.message}`
            : 'Arquivo de backup inválido.',
        )
        return false
      }
    },
    [aplicarBackupRecuperado],
  )

  const zerarBancoHomologacao = useCallback(async () => {
    if (!podeZerarBancoHomologacao()) {
      throw new Error('Zerar banco só está disponível em homologação.')
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    pendingSaveRef.current = null
    savingRef.current = true
    setSaving(true)
    skipSave.current = true
    try {
      if (repoRef.current.mode === 'supabase') {
        await zerarBancoHomologacaoSupabase()
      } else {
        await repoRef.current.saveData({
          notas: [],
          movimentos: [],
          notasCanceladas: [],
        })
      }
      clearLocalPersistedData()
      const vazio: AppState = { ...emptyState }
      lastPersistedRef.current = pickPersisted(vazio)
      stateRef.current = vazio
      setState(vazio)
      ignoreRemoteUntil.current = Date.now() + 60_000
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao zerar banco de homologação.'
      setError(msg)
      throw e
    } finally {
      savingRef.current = false
      setSaving(false)
      skipSave.current = false
    }
  }, [])

  return {
    state,
    setState: updateState,
    saveNow,
    registrarEmitente,
    recuperarDoNavegador,
    importarBackupArquivo,
    zerarBancoHomologacao,
    loading,
    saving,
    savingImportante,
    error,
    clearError: () => setError(null),
  }
}
