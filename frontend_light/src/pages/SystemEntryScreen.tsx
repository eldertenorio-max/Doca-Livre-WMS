import { PortalBackButton } from '../components/PortalBackButton'
import { SystemProductMark } from '../components/SystemProductMark'
import type { SystemOption } from '../lib/systemPortal'
import './SystemEntryScreen.css'

type Props = {
  system: SystemOption
  onBack: () => void
  onEnter: () => void
}

export default function SystemEntryScreen({ system, onBack, onEnter }: Props) {
  const title = system.productName
    ? `Doca Livre ${system.productName} ${system.variant}`
    : `Doca Livre ${system.variant}`

  return (
    <div className="system-entry" role="main">
      <PortalBackButton onClick={onBack} />
      <div className="system-entry__inner">
        <div
          className={`system-entry__brand${system.logoOnly ? ' system-entry__brand--original' : ''}`}
        >
          <SystemProductMark
            variant={system.variant}
            productName={system.productName}
            logoSrc={system.logoSrc}
            logoOnly={system.logoOnly}
          />
        </div>
        <p className="system-entry__hint">Você será direcionado para o ambiente de produção.</p>
        <button type="button" className="system-entry__enter" onClick={onEnter}>
          Acessar {title}
        </button>
      </div>
    </div>
  )
}
