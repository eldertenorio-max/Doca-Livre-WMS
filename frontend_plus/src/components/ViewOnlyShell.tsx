import type { ReactNode } from 'react'

type Props = {
  active: boolean
  children: ReactNode
}

/** Banner + bloqueio visual de ações (CSS) quando a tela está em modo Visualizar. */
export function ViewOnlyShell({ active, children }: Props) {
  if (!active) return <>{children}</>
  return (
    <div className="portal-view-only">
      <p className="portal-view-only__banner" role="status">
        Modo visualização — só é possível abrir e consultar. Alterações bloqueadas.
      </p>
      <div className="portal-view-only__body">{children}</div>
    </div>
  )
}
