import type { Theme } from '../lib/theme'

type Props = {
  theme: Theme
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: Props) {
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      title={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      aria-label={isLight ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
    >
      <span className="theme-toggle-icon" aria-hidden>
        {isLight ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  )
}
