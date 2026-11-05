import {
  BRAND_FULL_TITLE,
  BRAND_PRODUCT_NAME,
  BRAND_PRODUCT_VARIANT,
  LOGO_DOCA_LIVRE_SRC,
} from '../lib/brandAssets'
import './BrandMark.css'

type Props = {
  className?: string
  logoClassName?: string
}

export function BrandMark({ className = '', logoClassName = '' }: Props) {
  return (
    <div className={`brand-mark ${className}`.trim()} aria-label={BRAND_FULL_TITLE}>
      <img src={LOGO_DOCA_LIVRE_SRC} alt="" className={`brand-mark__logo ${logoClassName}`.trim()} />
      <p className="brand-mark__name" aria-hidden>
        <span className="brand-mark__wms">{BRAND_PRODUCT_NAME}</span>
        <span className="brand-mark__variant">{BRAND_PRODUCT_VARIANT}</span>
      </p>
    </div>
  )
}
