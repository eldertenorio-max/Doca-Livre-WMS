export type AppTheme = 'dark' | 'light'

const APP_THEME_KEY = 'ui-theme'
const APP_THEME_USER_SET_KEY = 'ui-theme-user-set'

export function hasUserSetTheme(): boolean {
  try {
    return localStorage.getItem(APP_THEME_USER_SET_KEY) === '1'
  } catch {
    return false
  }
}

export function markUserSetTheme() {
  try {
    localStorage.setItem(APP_THEME_USER_SET_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function getStoredAppTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(APP_THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'light'
}

/** Dentro do WMS unificado (/app) a tela segue o tema claro da moldura. */
export function estaEmbutidoNoWms(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export function resolveAppTheme(sessionActive: boolean, authEnabled: boolean): AppTheme {
  if (estaEmbutidoNoWms()) return 'light'
  if (hasUserSetTheme()) return getStoredAppTheme()
  if (!authEnabled) return 'dark'
  if (sessionActive) return 'dark'
  return 'light'
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function storeAppTheme(theme: AppTheme) {
  try {
    localStorage.setItem(APP_THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}
