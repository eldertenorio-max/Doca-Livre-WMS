import './PortalBackButton.css'

type Props = {
  onClick: () => void
  label?: string
}

export function PortalBackButton({ onClick, label = 'Sistemas' }: Props) {
  return (
    <button type="button" className="portal-back-btn" onClick={onClick}>
      <span className="portal-back-btn__icon" aria-hidden>
        ←
      </span>
      {label}
    </button>
  )
}
