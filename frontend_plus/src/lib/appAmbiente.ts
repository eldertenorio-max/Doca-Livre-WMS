export type AppAmbienteDeploy = 'homolog' | 'producao'

const HOSTS_HOMOLOG = ['ultrafrio.onrender.com', 'ultrafrio-homologacao.onrender.com']
const HOSTS_PRODUCAO = ['wms.docalivre.com.br']

function normalizarAmbiente(value: string | undefined): AppAmbienteDeploy | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  if (v === 'homolog' || v === 'homologacao' || v === 'staging') return 'homolog'
  if (v === 'producao' || v === 'production' || v === 'prod') return 'producao'
  return null
}

/** Homologação ou produção — null em dev local sem variável definida. */
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

export function isProducao(): boolean {
  return getAmbienteDeploy() === 'producao'
}

export function labelAmbiente(): string | null {
  return isHomologacao() ? 'Homologação' : null
}

export function tituloApp(): string {
  return isHomologacao() ? 'Doca Livre Sistemas — Homologação' : 'Doca Livre Sistemas'
}
