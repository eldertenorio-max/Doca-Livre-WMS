const SIDEBAR_OPEN_KEY = 'wms-light-sidebar-open'

export function getStoredSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
  } catch {
    /* ignore */
  }
  return true
}

export function storeSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}
