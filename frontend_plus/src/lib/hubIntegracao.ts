import { useCallback, useEffect, useState } from 'react'
import { isHomologacao } from './appAmbiente'

export type HubAgendamentoStatus =
  | 'rascunho'
  | 'na_fila'
  | 'processando'
  | 'em_analise'
  | 'agendado'
  | 'rejeitado'
  | 'erro'
  | 'cancelado'
  | 'reagendando'

export type HubWmsDestino = 'light' | 'plus' | 'pro'

export type HubPrevisao = {
  id: number
  status: HubAgendamentoStatus
  pronto_entrada: boolean
  wms_destino?: HubWmsDestino
  numero_pedido: string | null
  nota_fiscal: string | null
  cliente: string | null
  portal: string | null
  destino: string | null
  peso: number | null
  volumes: number | null
  placa: string | null
  motorista: string | null
  transportadora: string | null
  data_solicitada: string | null
  hora_solicitada: string | null
  data_confirmada: string | null
  hora_confirmada: string | null
  protocolo: string | null
  etapa_atual: string | null
  observacoes: string | null
}

const DEFAULT_HUB_API = 'https://dockhub-api.onrender.com'

export function hubApiBase(): string {
  const fromEnv = (import.meta.env.VITE_HUB_API_URL as string | undefined)?.trim()
  return (fromEnv || DEFAULT_HUB_API).replace(/\/$/, '')
}

export async function fetchHubPrevisoes(
  wms: HubWmsDestino = 'plus',
  signal?: AbortSignal,
): Promise<HubPrevisao[]> {
  const res = await fetch(`${hubApiBase()}/api/public/wms/previsoes?wms=${encodeURIComponent(wms)}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Hub de Integração indisponível (${res.status}).`)
  }
  const data = (await res.json()) as HubPrevisao[]
  return Array.isArray(data) ? data : []
}

export function labelHubStatus(status: HubAgendamentoStatus): string {
  switch (status) {
    case 'agendado':
      return 'Agendado'
    case 'na_fila':
      return 'Na fila'
    case 'processando':
      return 'Processando'
    case 'em_analise':
      return 'Em análise'
    case 'reagendando':
      return 'Reagendando'
    case 'rejeitado':
      return 'Rejeitado'
    case 'erro':
      return 'Erro'
    case 'cancelado':
      return 'Cancelado'
    default:
      return status
  }
}

export function formatHubDataHora(data: string | null, hora: string | null): string {
  if (!data && !hora) return '—'
  if (!data) return hora || '—'
  const d = new Date(data)
  const dia = Number.isNaN(d.getTime())
    ? data.slice(0, 10)
    : d.toLocaleDateString('pt-BR')
  return hora ? `${dia} ${hora}` : dia
}

export function useHubPrevisoes(enabled: boolean, wms: HubWmsDestino = 'plus') {
  const [items, setItems] = useState<HubPrevisao[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      setItems(await fetchHubPrevisoes(wms))
    } catch (err) {
      setItems([])
      const hint = isHomologacao()
        ? ' Confira VITE_HUB_API_URL no Render do Plus e CORS_ORIGINS no Hub.'
        : ''
      setError((err instanceof Error ? err.message : 'Falha ao ler o Hub.') + hint)
    } finally {
      setLoading(false)
    }
  }, [enabled, wms])

  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    setLoading(true)
    fetchHubPrevisoes(wms, ctrl.signal)
      .then(setItems)
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setItems([])
        setError(err instanceof Error ? err.message : 'Falha ao ler o Hub.')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    const timer = window.setInterval(() => {
      void fetchHubPrevisoes(wms).then(setItems).catch(() => undefined)
    }, 60000)
    return () => {
      ctrl.abort()
      window.clearInterval(timer)
    }
  }, [enabled, wms])

  return { items, loading, error, reload }
}
