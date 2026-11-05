import { useCallback, useEffect, useState } from 'react'
import { getStoredSidebarMode, storeSidebarMode, type SidebarMode } from '../lib/sidebarMode'

export function useSidebarMode() {
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>(() => getStoredSidebarMode())

  useEffect(() => {
    storeSidebarMode(sidebarMode)
  }, [sidebarMode])

  const setSidebarMode = useCallback((mode: SidebarMode) => {
    setSidebarModeState(mode)
  }, [])

  return {
    sidebarMode,
    setSidebarMode,
  }
}
