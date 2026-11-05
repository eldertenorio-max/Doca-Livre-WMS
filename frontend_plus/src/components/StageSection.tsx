import { contarItensStage, STAGE_AREA_ID, STAGE_LABEL } from '../layout/stage'
import type { NotaFiscal } from '../types'

type Props = {
  notas: NotaFiscal[]
  highlighted?: boolean
  dropEnabled?: boolean
  onOpen: () => void
  onDrop?: () => void
}

export function StageSection({ notas, highlighted, dropEnabled, onOpen, onDrop }: Props) {
  const total = contarItensStage(notas)

  function handleClick() {
    if (dropEnabled && onDrop) {
      onDrop()
      return
    }
    onOpen()
  }

  return (
    <section
      className={`stage-section${highlighted ? ' stage-section--highlight' : ''}${dropEnabled ? ' stage-section--drop-target' : ''}`}
    >
      <div className="stage-section-head">
        <h2 className="camara-title">{STAGE_LABEL}</h2>
        <p className="muted stage-section-hint">
          {dropEnabled
            ? 'Clique aqui para mover os paletes marcados para o stage'
            : 'Área de separação · armazenamento ilimitado'}
        </p>
      </div>
      <button
        type="button"
        className="stage-area-cell"
        data-address-id={STAGE_AREA_ID}
        onClick={handleClick}
        aria-label={
          dropEnabled
            ? 'Mover paletes selecionados para o stage'
            : `Abrir stage com ${total} item(ns)`
        }
      >
        <span className="stage-area-label">STAGE</span>
        <span className="stage-area-count">
          {total} item{total === 1 ? '' : 's'}
        </span>
        <span className="stage-area-hint">
          {dropEnabled ? 'Solte aqui' : 'Clique para ver o conteúdo'}
        </span>
      </button>
    </section>
  )
}
