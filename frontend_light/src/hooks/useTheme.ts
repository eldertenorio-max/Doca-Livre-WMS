import { useCallback, useEffect, useState } from 'react'
import {
  applyTheme,
  hasUserSetTheme,
  markUserSetTheme,
  resolveAppTheme,
  storeAppTheme,
  type AppTheme,
} from '../lib/appTheme'

export type Theme = AppTheme

type Options = {
  authEnabled: boolean
  sessionActive: boolean
}

export function useTheme({ authEnabled, sessionActive }: Options) {
  const [theme, setTheme] = useState<Theme>(() => resolveAppTheme(sessionActive, authEnabled))

  useEffect(() => {
    applyTheme(theme)
    storeAppTheme(theme)
  }, [theme])

  useEffect(() => {
    if (hasUserSetTheme()) return
    setTheme(resolveAppTheme(sessionActive, authEnabled))
  }, [sessionActive, authEnabled])

  const toggleTheme = useCallback(() => {
    markUserSetTheme()
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  const setThemeDirect = useCallback((next: Theme) => {
    markUserSetTheme()
    setTheme(next)
  }, [])

  return { theme, toggleTheme, setTheme: setThemeDirect }
}
