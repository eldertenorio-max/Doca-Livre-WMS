import { useCallback, useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const LEGACY_DISMISS_KEY = 'ultrafrio-pwa-install-dismissed'
const DISMISS_SESSION_KEY = 'ultrafrio-pwa-install-dismissed-session'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return mq || iosStandalone
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOSDevice = /iphone|ipad|ipod/i.test(ua)
  // iPadOS 13+ se apresenta como Mac com touch.
  const iPadOs = /Macintosh/.test(ua) && 'ontouchend' in document
  return iOSDevice || iPadOs
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /safari/i.test(ua) && !/chrome|crios|fxios|edgios/i.test(ua)
}

function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /android/i.test(ua) && /chrome/i.test(ua) && !/edga|opr|samsungbrowser|firefox/i.test(ua)
}

function isDesktopChrome(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return !/android|iphone|ipad|ipod/i.test(ua) && /chrome/i.test(ua) && !/edg|opr|firefox/i.test(ua)
}

export type PwaInstallState = {
  /** Pode disparar o prompt nativo do Chrome/Android. */
  canInstall: boolean
  /** iOS/Safari não tem prompt nativo — mostrar instruções manuais. */
  isIosSafari: boolean
  /** Chrome/Android pode reinstalar pelo prompt nativo ou pelo menu do navegador. */
  isAndroidChrome: boolean
  /** Chrome no computador pode reinstalar pelo prompt nativo, barra de endereço ou menu. */
  isDesktopChrome: boolean
  /** App já instalado / rodando em modo standalone. */
  installed: boolean
  /** Usuário dispensou o banner nesta sessão/dispositivo. */
  dismissed: boolean
  promptInstall: () => Promise<void>
  dismiss: () => void
}

export function usePwaInstall(): PwaInstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isStandalone())
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_SESSION_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_DISMISS_KEY)
    } catch {
      /* ignore */
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setDismissed(false)
      try {
        sessionStorage.removeItem(DISMISS_SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    const mq = window.matchMedia('(display-mode: standalone)')
    const onDisplayChange = () => setInstalled(isStandalone())
    mq.addEventListener('change', onDisplayChange)
    window.addEventListener('focus', onDisplayChange)
    document.addEventListener('visibilitychange', onDisplayChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener('change', onDisplayChange)
      window.removeEventListener('focus', onDisplayChange)
      document.removeEventListener('visibilitychange', onDisplayChange)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
    setDeferred(null)
  }, [deferred])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  return {
    canInstall: deferred != null && !installed,
    isIosSafari: isIos() && isSafari() && !installed,
    isAndroidChrome: isAndroidChrome() && !installed,
    isDesktopChrome: isDesktopChrome() && !installed,
    installed,
    dismissed,
    promptInstall,
    dismiss,
  }
}
