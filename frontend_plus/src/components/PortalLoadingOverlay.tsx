import './PortalLoadingOverlay.css'

type Props = {
  label?: string
}

/** Overlay central “Carregando” (hub → sistemas). */
export function PortalLoadingOverlay({ label = 'Carregando' }: Props) {
  return (
    <div className="portal-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="portal-loading__card">
        <p className="portal-loading__text">{label}</p>
        <div className="portal-loading__track" aria-hidden>
          <div className="portal-loading__bar" />
        </div>
      </div>
    </div>
  )
}
