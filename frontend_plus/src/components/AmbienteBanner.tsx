import { isHomologacao } from '../lib/appAmbiente'

export function AmbienteBanner() {
  if (!isHomologacao()) return null

  return (
    <div className="ambiente-banner ambiente-banner--homolog" role="status" aria-live="polite">
      <strong>Homologação</strong>
      <span>Ambiente de validação — use para testar antes de publicar no WMS oficial.</span>
    </div>
  )
}
