import { useEffect, useId, useState, type ReactNode } from 'react'

type PageInfoButtonProps = {
  children: ReactNode
  ariaLabel?: string
  /** Título no topo do painel (padrão: ariaLabel). */
  title?: string
}

export function PageInfoBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="page-info-block">
      {title ? <p className="page-info-block__title">{title}</p> : null}
      <div className="page-info-block__text">{children}</div>
    </div>
  )
}

export default function PageInfoButton({ children, ariaLabel = 'Ajuda', title }: PageInfoButtonProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const panelTitle = title ?? ariaLabel

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className="page-info-btn"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        i
      </button>
      {open ? (
        <div className="page-info-overlay" onClick={() => setOpen(false)}>
          <div
            className="page-info-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="page-info-panel__head">
              <h2 id={titleId} className="page-info-panel__title">
                {panelTitle}
              </h2>
              <button
                type="button"
                className="page-info-panel__close"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="page-info-panel__body">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  )
}
