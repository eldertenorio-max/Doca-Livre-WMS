import { useEffect, useMemo, useState } from 'react'
import { groupContadoresAtivosBySessao, type CapturaPresencaSessaoRow } from './capturaPresencaStatus'
import { PRESENCA_POLL_INTERVAL_MS } from './contagemDiariaPresenca'

export function useGerenciarCapturaPresenca(
  sessaoIds: string[],
  fetchBatch: (ids: string[]) => Promise<CapturaPresencaSessaoRow[]>,
  online: boolean,
): Map<string, string[]> {
  const idsKey = useMemo(() => [...new Set(sessaoIds.map((id) => id.trim()).filter(Boolean))].sort().join(','), [sessaoIds])
  const [map, setMap] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    if (!online || ids.length === 0) {
      setMap(new Map())
      return
    }
    let cancelled = false
    const load = async () => {
      const rows = await fetchBatch(ids)
      if (cancelled) return
      setMap(groupContadoresAtivosBySessao(rows))
    }
    void load()
    const timer = window.setInterval(() => void load(), PRESENCA_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [idsKey, online, fetchBatch])

  return map
}
