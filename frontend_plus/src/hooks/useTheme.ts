import { useCallback, useEffect, useState } from 'react'
import { applyTheme, getStoredTheme, storeTheme, type Theme } from '../lib/theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  const setThemeDirect = useCallback((next: Theme) => {
    setTheme(next)
  }, [])

  return { theme, toggleTheme, setTheme: setThemeDirect }
}
