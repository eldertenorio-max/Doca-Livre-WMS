/** Detecta conectividade útil para sync com Supabase. */
export function isAppOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

export function subscribeAppConnectivity(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const sync = () => onChange(isAppOnline())
  window.addEventListener('online', sync)
  window.addEventListener('offline', sync)
  return () => {
    window.removeEventListener('online', sync)
    window.removeEventListener('offline', sync)
  }
}
