export type AppAmbienteDeploy = 'homolog' | 'producao'

function normalizarAmbiente(value: string | undefined): AppAmbienteDeploy | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  if (v === 'homolog' || v === 'homologacao' || v === 'staging') return 'homolog'
  if (v === 'producao' || v === 'production' || v === 'prod') return 'producao'
  return null
}

/** Homologação ou produção: quem informa é o WMS PRO ao abrir a tela (window.__WMS_UNIFIED__.ambiente). */
export function getAmbienteDeploy(): AppAmbienteDeploy | null {
  const fromEnv = normalizarAmbiente(import.meta.env.VITE_APP_AMBIENTE)
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __WMS_UNIFIED__?: { ambiente?: string } }
    return normalizarAmbiente(w.__WMS_UNIFIED__?.ambiente)
  }
  return null
}

export function isHomologacao(): boolean {
  return getAmbienteDeploy() === 'homolog'
}

export function tituloApp(): string {
  return isHomologacao() ? 'WMS DOCA LIVRE PRO — Homologação' : 'WMS DOCA LIVRE PRO'
}
