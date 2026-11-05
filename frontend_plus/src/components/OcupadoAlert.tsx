import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { formatAddressLabel } from '../layout/camaras'
import type { AddressId, AddressOccupancy } from '../types'

type Props = {
  addressId: AddressId
  occupancy: AddressOccupancy
  onClose: () => void
}

export function OcupadoAlert({ addressId, occupancy, onClose }: Props) {
  useBodyScrollLock(true)

  return (
    <div className="alert-backdrop" onClick={onClose} role="presentation">
      <div
        className="alert-box"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ocupado-title"
      >
        <h2 id="ocupado-title">Posição ocupada</h2>
        <p className="alert-address">{formatAddressLabel(addressId)}</p>
        <p>
          Este endereço já está em uso pela <strong>NF {occupancy.nfNumero}</strong>
          {occupancy.codigo ? ` · item ${occupancy.codigo}` : ''}.
        </p>
        <p className="muted">Escolha outro quadrado disponível no painel.</p>
        <button type="button" className="btn primary full" onClick={onClose}>
          Entendi
        </button>
      </div>
    </div>
  )
}
