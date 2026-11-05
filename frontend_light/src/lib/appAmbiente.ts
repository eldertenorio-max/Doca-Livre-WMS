export type AppAmbienteDeploy = 'homolog' | 'producao'

const HOSTS_HOMOLOG = ['doca-livre-wms-light-homolog.onrender.com']
const HOSTS_PRODUCAO = ['doca-livre-wms-light.onrender.com', 'wms.docalivre.com.br']

function normalizarAmbiente(value: string | undefined): AppAmbienteDeploy | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  if (v === 'homolog' || v === 'homologacao' || v === 'staging') return 'homolog'
  if (v === 'producao' || v === 'production' || v === 'prod') return 'producao'
  return null
}

export function getAmbienteDeploy(): AppAmbienteDeploy | null {
  const fromEnv = normalizarAmbiente(import.meta.env.VITE_APP_AMBIENTE)
  if (fromEnv) return fromEnv

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (HOSTS_HOMOLOG.some((h) => host === h || host.endsWith(`.${h}`))) {
      return 'homolog'
    }
    if (HOSTS_PRODUCAO.some((h) => host === h || host.endsWith(`.${h}`))) {
      return 'producao'
    }
  }

  return null
}

export function isHomologacao(): boolean {
  return getAmbienteDeploy() === 'homolog'
}

export function tituloApp(): string {
  return isHomologacao() ? 'Doca Livre WMS Light — Homologação' : 'Doca Livre WMS Light'
}
