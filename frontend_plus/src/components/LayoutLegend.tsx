import type { CSSProperties } from 'react'
import { portaCamaraUrl } from '../lib/portaCamaraAsset'
import type { AddressId } from '../types'

export type LayoutLegendProps = {
  allocateMode: boolean
  editMode?: boolean
  activeNfNumero: string | null
  editItemAtivo?: boolean
  editAddresses?: Set<AddressId>
  movimentacaoDistribuicao?: boolean
  consultaAddresses?: Set<AddressId>
  saidaAddresses?: Set<AddressId>
  saidaItemDestaqueAddresses?: Set<AddressId>
  saidaFlaggedAddresses?: Set<AddressId>
  className?: string
}

type LegendItem = { swatch: string; label: string; swatchStyle?: CSSProperties }

function buildLegendItems(props: LayoutLegendProps): LegendItem[] {
  const items: LegendItem[] = [
    { swatch: 'swatch--disp', label: 'Disponível' },
    { swatch: 'swatch--ocup', label: 'Ocupado' },
  ]

  const entradaAtiva = props.allocateMode && !props.editMode && !!props.activeNfNumero
  if (entradaAtiva) {
    items.push({ swatch: 'swatch--sel', label: 'Selecionando' })
    items.push({ swatch: 'swatch--confirm', label: 'Confirmado' })
  }

  const consultaAtiva =
    props.consultaAddresses != null && props.consultaAddresses.size > 0
  const movimentacaoAtiva =
    props.editItemAtivo || (props.editAddresses != null && props.editAddresses.size > 0)

  if (consultaAtiva) {
    items.push({ swatch: 'swatch--consulta', label: 'Consulta' })
  }
  if (props.movimentacaoDistribuicao) {
    items.push({ swatch: 'swatch--move-origem', label: 'Tirar (origem)' })
    items.push({ swatch: 'swatch--move-destino', label: 'Colocar (destino)' })
  } else if (movimentacaoAtiva) {
    items.push({ swatch: 'swatch--destaque', label: 'Item no mapa' })
  }

  if (props.saidaItemDestaqueAddresses != null && props.saidaItemDestaqueAddresses.size > 0) {
    items.push({ swatch: 'swatch--destaque', label: 'Onde retirar' })
  }
  if (props.saidaAddresses != null && props.saidaAddresses.size > 0) {
    items.push({ swatch: 'swatch--saida', label: 'NF na saída' })
  }
  if (props.saidaFlaggedAddresses != null && props.saidaFlaggedAddresses.size > 0) {
    items.push({ swatch: 'swatch--saida-flag', label: 'Item para retirar' })
  }

  items.push({
    swatch: 'swatch--porta',
    label: 'Porta',
    swatchStyle: {
      backgroundImage: `url("${portaCamaraUrl}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
  })
  items.push({ swatch: 'swatch--nv5', label: 'Sem nível 5' })

  return items
}

export function LayoutLegend({ className, ...props }: LayoutLegendProps) {
  const items = buildLegendItems(props)
  const classes = ['layout-legend', className].filter(Boolean).join(' ')

  return (
    <div className={classes} aria-label="Legenda do painel">
      {items.map((item) => (
        <span key={item.label}>
          <i className={`swatch ${item.swatch}`} style={item.swatchStyle} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  )
}
