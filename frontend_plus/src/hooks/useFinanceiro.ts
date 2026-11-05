import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotaFiscal } from '../types'
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sincronizarClientesFromNotas } from '../lib/financeiro/clientes'
import { getFinanceiroRepository } from '../lib/financeiro/repository'
import type { FinanceiroSaveOptions } from '../lib/financeiro/repository/types'
import type { FinanceiroData } from '../lib/financeiro/types'
import { financeiroVazio } from '../lib/financeiro/types'

const FIN_TABLES = [
  'ultrafrio_fin_tabelas',
  'ultrafrio_fin_clientes',
  'ultrafrio_fin_contratos',
] as const

const IGNORE_LOAD_AFTER_SAVE_MS = 2500

export function useFinanceiro(notas: NotaFiscal[]) {
  const [data, setData] = useState<FinanceiroData>(financeiroVazio)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef(data)
  const notasRef = useRef(notas)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistChain = useRef<Promise<void>>(Promise.resolve())
  const savingRef = useRef(false)
  const ignoreLoadUntil = useRef(0)

  dataRef.current = data
  notasRef.current = notas

  const persist = useCallback(async (next: FinanceiroData, opts?: FinanceiroSaveOptions) => {
    savingRef.current = true
    persistChain.current = persistChain.current.then(async () => {
      setSaving(true)
      try {
        await getFinanceiroRepository().save(next, opts)
        dataRef.current = next
        setData(next)
        ignoreLoadUntil.current = Date.now() + IGNORE_LOAD_AFTER_SAVE_MS
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar financeiro.')
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    })
    await persistChain.current
  }, [])

  const loadFromRemote = useCallback(async () => {
    if (savingRef.current || Date.now() < ignoreLoadUntil.current) return
    try {
      setError(null)
      const repo = getFinanceiroRepository()
      const loaded = await repo.load()
      if (savingRef.current || Date.now() < ignoreLoadUntil.current) return

      const synced = sincronizarClientesFromNotas(loaded, notasRef.current)
      dataRef.current = synced
      setData(synced)

      if (synced.clientes.length > loaded.clientes.length) {
        await persist(synced)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar financeiro.')
    } finally {
      setLoading(false)
    }
  }, [persist])

  useEffect(() => {
    void loadFromRemote()
  }, [loadFromRemote])

  /** Novos clientes a partir das NFs — sem recarregar tabelas/contratos da nuvem. */
  useEffect(() => {
    if (loading) return
    setData((prev) => {
      const synced = sincronizarClientesFromNotas(prev, notas)
      if (synced.clientes.length === prev.clientes.length) return prev
      dataRef.current = synced
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void persist(synced), 300)
      return synced
    })
  }, [notas, loading, persist])

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const sb = getSupabase()
    let channel = sb.channel('ultrafrio-fin-sync')
    for (const table of FIN_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        void loadFromRemote()
      })
    }
    channel.subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [loadFromRemote])

  const updateData = useCallback(
    (updater: (prev: FinanceiroData) => FinanceiroData) => {
      setData((prev) => {
        const next = updater(prev)
        dataRef.current = next
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => void persist(next), 300)
        return next
      })
    },
    [persist],
  )

  const saveNow = useCallback(
    async (snapshot?: FinanceiroData, opts?: FinanceiroSaveOptions) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const next = snapshot ?? dataRef.current
      dataRef.current = next
      setData(next)
      await persist(next, { permitirListaVazia: true, ...opts })
    },
    [persist],
  )

  const registrarClienteFromNf = useCallback(
    (nf: NotaFiscal) => {
      updateData((prev) => {
        const synced = sincronizarClientesFromNotas(prev, [nf])
        return synced.clientes.length > prev.clientes.length ? synced : prev
      })
    },
    [updateData],
  )

  return {
    data,
    loading,
    saving,
    error,
    updateData,
    saveNow,
    registrarClienteFromNf,
    reload: loadFromRemote,
  }
}
