import type { ReactNode } from 'react'
import PageInfoButton from './PageInfoButton'

export { PageInfoBlock } from './PageInfoButton'

type HeadingProps = {
  title: string
  info?: ReactNode
  infoTitle?: string
  className?: string
}

export function PagePanelHeading({ title, info, infoTitle, className }: HeadingProps) {
  return (
    <div className={`page-panel__heading${className ? ` ${className}` : ''}`}>
      <h1 className="page-panel__title">{title}</h1>
      {info ? (
        <PageInfoButton title={infoTitle ?? title} ariaLabel={`Ajuda: ${title}`}>
          {info}
        </PageInfoButton>
      ) : null}
    </div>
  )
}

export function PageSectionHeading({ title, info, infoTitle, className }: HeadingProps) {
  return (
    <div className={`page-panel__section-heading${className ? ` ${className}` : ''}`}>
      <h2 className="page-panel__section-title">{title}</h2>
      {info ? (
        <PageInfoButton title={infoTitle ?? title} ariaLabel={`Ajuda: ${title}`}>
          {info}
        </PageInfoButton>
      ) : null}
    </div>
  )
}
