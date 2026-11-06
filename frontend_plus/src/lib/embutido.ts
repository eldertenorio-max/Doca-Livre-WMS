/** True quando a tela roda dentro do WMS unificado (/app), que já tem cabeçalho e menu. */
export function estaEmbutidoNoWms(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
