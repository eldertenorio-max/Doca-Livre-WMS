import { useEffect } from 'react'

let scrollLockCount = 0

/** Impede rolagem do painel e da sidebar enquanto um modal está aberto. */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return

    const root = document.documentElement
    scrollLockCount += 1
    root.classList.add('scroll-locked')

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0) {
        root.classList.remove('scroll-locked')
      }
    }
  }, [active])
}
