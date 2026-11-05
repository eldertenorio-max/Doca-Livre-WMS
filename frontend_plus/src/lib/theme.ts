export type Theme = 'dark' | 'light'

export const THEME_KEY = 'ultrafrio-theme'

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark') return 'dark'
    return 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}
