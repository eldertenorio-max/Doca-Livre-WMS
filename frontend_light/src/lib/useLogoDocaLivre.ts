import { useSyncExternalStore } from 'react'

type Tema = 'light' | 'dark'

function lerTema(): Tema {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

function assinarTema(aviso: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(aviso)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  return () => obs.disconnect()
}

/** Tema atual do <html>, atualizado quando o usuário troca o tema. */
export function useTemaAtual(): Tema {
  return useSyncExternalStore(assinarTema, lerTema, () => 'light')
}

/** Converte a cor calculada pelo navegador em [r, g, b, alfa] (0–255, alfa 0–1). */
function lerCor(cor: string): [number, number, number, number] | null {
  const srgb = cor.match(/^color\(srgb\s+([^)]+)\)/)
  if (srgb) {
    const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(parseFloat)
    return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]
  }
  const rgb = cor.match(/^rgba?\(([^)]+)\)/)
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  return null
}

/**
 * true se o fundo atrás do elemento é escuro, false se é claro,
 * null se nenhum ancestral tem cor de fundo sólida.
 */
export function fundoEhEscuro(el: Element | null): boolean | null {
  let atual = el?.parentElement ?? null
  while (atual) {
    const cor = lerCor(getComputedStyle(atual).backgroundColor)
    if (cor && cor[3] >= 0.5) {
      const [r, g, b] = cor
      return 0.299 * r + 0.587 * g + 0.114 * b < 140
    }
    atual = atual.parentElement
  }
  return null
}
