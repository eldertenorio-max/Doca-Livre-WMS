import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureSupabaseConfig } from '../lib/supabaseConfig'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  getStoredVoiceRegistry,
  storeVoiceRegistry,
  type VoiceRegistry,
} from '../lib/voiceProfile'
import {
  loadVoiceRegistryRemote,
  mergeVoiceRegistries,
  saveVoiceRegistryRemote,
  subscribeVoiceRegistryChanges,
  voiceRegistriesEqual,
} from '../lib/voiceRegistrySync'

const IGNORE_REMOTE_AFTER_SAVE_MS = 4000

export function useVoiceRegistry() {
  const [registry, setRegistryState] = useState<VoiceRegistry>(() => getStoredVoiceRegistry())
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const ignoreRemoteUntil = useRef(0)

  const applyRegistry = useCallback((next: VoiceRegistry) => {
    storeVoiceRegistry(next)
    setRegistryState(next)
  }, [])

  const persistRemote = useCallback(async (next: VoiceRegistry) => {
    if (!isSupabaseConfigured()) return
    savingRef.current = true
    ignoreRemoteUntil.current = Date.now() + IGNORE_REMOTE_AFTER_SAVE_MS
    try {
      await saveVoiceRegistryRemote(next)
      setSyncError(null)
    } catch (e) {
      setSyncError(
        e instanceof Error
          ? `Erro ao sincronizar vozes: ${e.message}`
          : 'Erro ao sincronizar vozes com a nuvem.',
      )
    } finally {
      savingRef.current = false
    }
  }, [])

  const setRegistry = useCallback(
    (next: VoiceRegistry | ((prev: VoiceRegistry) => VoiceRegistry)) => {
      setRegistryState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        storeVoiceRegistry(resolved)
        void persistRemote(resolved)
        return resolved
      })
    },
    [persistRemote],
  )

  const reloadFromRemote = useCallback(async () => {
    if (!isSupabaseConfigured()) return
    if (savingRef.current) return
    if (Date.now() < ignoreRemoteUntil.current) return

    try {
      const remote = await loadVoiceRegistryRemote()
      const local = getStoredVoiceRegistry()
      const merged = mergeVoiceRegistries(local, remote)
      if (!voiceRegistriesEqual(merged, local)) {
        applyRegistry(merged)
      }
      setSyncError(null)
    } catch (e) {
      setSyncError(
        e instanceof Error
          ? `Erro ao carregar vozes: ${e.message}`
          : 'Erro ao carregar vozes da nuvem.',
      )
    }
  }, [applyRegistry])

  useEffect(() => {
    let cancelled = false
    let unsubRealtime: (() => void) | null = null

    async function init() {
      await ensureSupabaseConfig()

      if (!isSupabaseConfigured()) {
        if (!cancelled) setLoading(false)
        return
      }

      unsubRealtime = subscribeVoiceRegistryChanges(() => {
        void reloadFromRemote()
      })

      try {
        const local = getStoredVoiceRegistry()
        const remote = await loadVoiceRegistryRemote()
        if (cancelled) return

        const merged = mergeVoiceRegistries(local, remote)
        applyRegistry(merged)

        if (!voiceRegistriesEqual(merged, remote)) {
          await saveVoiceRegistryRemote(merged)
        }
        setSyncError(null)
      } catch (e) {
        if (!cancelled) {
          setSyncError(
            e instanceof Error
              ? `Não foi possível sincronizar vozes: ${e.message}`
              : 'Não foi possível sincronizar vozes com a nuvem.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void init()

    return () => {
      cancelled = true
      unsubRealtime?.()
    }
  }, [applyRegistry, reloadFromRemote])

  return {
    registry,
    setRegistry,
    loading,
    syncError,
    refresh: reloadFromRemote,
  }
}
