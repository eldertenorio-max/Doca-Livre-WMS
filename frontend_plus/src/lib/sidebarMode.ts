export type SidebarMode = 'collapsed' | 'open' | 'fullscreen'

export const SIDEBAR_MODE_KEY = 'ultrafrio-sidebar-mode'

export function getStoredSidebarMode(): SidebarMode {
  try {
    const stored = localStorage.getItem(SIDEBAR_MODE_KEY)
    if (stored === 'collapsed' || stored === 'open' || stored === 'fullscreen') return stored
    if (stored === 'fixed') return 'open'
    if (stored === 'free') return 'collapsed'
  } catch {
    /* ignore */
  }
  return 'open'
}

export function storeSidebarMode(mode: SidebarMode) {
  try {
    localStorage.setItem(SIDEBAR_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}
