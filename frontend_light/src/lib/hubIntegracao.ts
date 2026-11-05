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

export type HubPrevisao = {
  id: number
  status: HubAgendamentoStatus
  pronto_entrada: boolean
  wms_destino?: 'light' | 'plus' | 'pro'
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

export async function fetchHubPrevisoesLight(signal?: AbortSignal): Promise<HubPrevisao[]> {
  const res = await fetch(`${hubApiBase()}/api/public/wms/previsoes?wms=light`, {
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
  const dia = Number.isNaN(d.getTime()) ? data.slice(0, 10) : d.toLocaleDateString('pt-BR')
  return hora ? `${dia} ${hora}` : dia
}
