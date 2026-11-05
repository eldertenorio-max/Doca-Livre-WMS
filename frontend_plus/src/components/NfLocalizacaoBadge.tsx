import { badgeLocalizacaoNf, type LocalizacaoBadge } from '../lib/localizacaoLabels'
import type { NotaFiscal } from '../types'

type Props = {
  nf: NotaFiscal
}

export function NfLocalizacaoBadge({ nf }: Props) {
  const badge = badgeLocalizacaoNf(nf)
  if (!badge) return null
  return (
    <span className={`nf-localizacao-badge nf-localizacao-badge--${badgeClass(badge)}`}>
      {badge}
    </span>
  )
}

function badgeClass(badge: LocalizacaoBadge): string {
  if (badge === 'Físico') return 'fisico'
  if (badge === 'Stage') return 'stage'
  return 'misto'
}
