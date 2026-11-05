import { useCallback, useEffect, useRef, useState } from 'react'
import type { SidebarMode } from '../lib/sidebarMode'

/** Tempo antes de recolher ao sair com o mouse (somente no modo recolhido). */
const CLOSE_DELAY_MS = 450

export function useSidebarExpand(sidebarMode: SidebarMode) {
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pinnedOpen = sidebarMode === 'open' || sidebarMode === 'fullscreen'
  const expanded = pinnedOpen || hoverExpanded

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const collapse = useCallback(() => {
    clearCloseTimer()
    setHoverExpanded(false)
  }, [clearCloseTimer])

  const expand = useCallback(() => {
    if (pinnedOpen) return
    clearCloseTimer()
    setHoverExpanded(true)
  }, [clearCloseTimer, pinnedOpen])

  useEffect(() => {
    if (pinnedOpen) {
      clearCloseTimer()
      setHoverExpanded(false)
    }
  }, [pinnedOpen, clearCloseTimer])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  const onMouseEnter = useCallback(() => {
    expand()
  }, [expand])

  const onMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      if (pinnedOpen || !hoverExpanded) return
      const related = e.relatedTarget as Node | null
      if (related && sidebarRef.current?.contains(related)) return

      clearCloseTimer()
      closeTimer.current = setTimeout(() => {
        collapse()
        closeTimer.current = null
      }, CLOSE_DELAY_MS)
    },
    [pinnedOpen, hoverExpanded, clearCloseTimer, collapse],
  )

  return { expanded, sidebarRef, onMouseEnter, onMouseLeave }
}
