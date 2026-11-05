import { SystemProductMark } from '../components/SystemProductMark'
import { getSystemOptions, type SystemId } from '../lib/systemPortal'
import './SystemSelectorScreen.css'

type Props = {
  onSelect: (id: SystemId) => void
}

export default function SystemSelectorScreen({ onSelect }: Props) {
  const systems = getSystemOptions()

  return (
    <div className="system-selector" role="main">
      <div className="system-selector__inner">
        <header className="system-selector__header">
          <h1 className="system-selector__title">Escolha o sistema</h1>
          <p className="system-selector__subtitle">
            Selecione qual plataforma Doca Livre deseja acessar
          </p>
        </header>

        <div className="system-selector__grid">
          {systems.map((system) => (
            <button
              key={system.id}
              type="button"
              className={`system-selector__card${system.logoOnly ? ' system-selector__card--original' : ''}`}
              onClick={() => onSelect(system.id)}
            >
              <SystemProductMark
                variant={system.variant}
                productName={system.productName}
                logoSrc={system.logoSrc}
                logoOnly={system.logoOnly}
                compact
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
