import { LOGO_DOCA_LIVRE_SRC } from '../lib/brandAssets'
import './BrandMark.css'

type Props = {
  variant: string
  productName?: string
  logoSrc?: string
  logoOnly?: boolean
  className?: string
  compact?: boolean
}

export function SystemProductMark({
  variant,
  productName = 'WMS',
  logoSrc,
  logoOnly = false,
  className = '',
  compact = false,
}: Props) {
  const title = productName ? `${productName} ${variant}` : variant
  const src = logoSrc ?? LOGO_DOCA_LIVRE_SRC

  return (
    <div
      className={`brand-mark brand-mark--system ${logoOnly ? 'brand-mark--logo-only' : ''} ${compact ? 'brand-mark--compact' : ''} ${className}`.trim()}
      aria-label={`Doca Livre ${title}`}
    >
      <img src={src} alt="" className="brand-mark__logo" />
      {!logoOnly && (
        <p className="brand-mark__name" aria-hidden>
          {productName ? <span className="brand-mark__wms">{productName}</span> : null}
          <span className="brand-mark__variant">{variant}</span>
        </p>
      )}
    </div>
  )
}
