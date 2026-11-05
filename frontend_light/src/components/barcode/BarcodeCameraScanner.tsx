import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  onClose: () => void
  onScan: (value: string) => void
  title?: string
}

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar', 'itf']

export function IconScanBarcode({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 5V3h4v2H3zm14 0V3h4v2h-4zM3 19v-2h4v2H3zm14 0v-2h4v2h-4z"
        fill="currentColor"
      />
      <path
        d="M7 6h1v12H7V6zm2 0h2v12H9V6zm3 0h1v12h-1V6zm2 0h3v12h-3V6z"
        fill="currentColor"
      />
      <rect x="5" y="10" width="14" height="2" rx="1" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

export function IconClearField({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

export function IconCalendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

export default function BarcodeCameraScanner({ open, onClose, onScan, title }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  const [error, setError] = useState('')

  onScanRef.current = onScan
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) {
      setError('')
      return
    }

    let cancelled = false
    let stream: MediaStream | null = null
    let boundVideo: HTMLVideoElement | null = null
    let detector: { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } | null = null
    let intervalId: number | null = null

    const releaseMedia = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
      if (boundVideo) {
        try {
          boundVideo.pause()
          boundVideo.srcObject = null
        } catch {
          /* ignore */
        }
        boundVideo = null
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
        stream = null
      }
    }

    async function start() {
      try {
        setError('')
        const BarcodeDetectorCtor = (window as Window & { BarcodeDetector?: new (opts: { formats: string[] }) => typeof detector })
          .BarcodeDetector
        if (!BarcodeDetectorCtor) {
          setError(
            'Seu navegador não suporta leitura por câmera. Use Chrome no celular ou digite/bipe o código.',
          )
          return
        }

        detector = new BarcodeDetectorCtor({ formats: BARCODE_FORMATS })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (cancelled) {
          releaseMedia()
          return
        }

        const v = videoRef.current
        if (!v) {
          releaseMedia()
          return
        }

        boundVideo = v
        v.srcObject = stream
        await v.play()

        intervalId = window.setInterval(async () => {
          if (cancelled || !detector || !videoRef.current) return
          try {
            const barcodes = await detector.detect(videoRef.current)
            const rawValue = barcodes?.[0]?.rawValue?.trim()
            if (!rawValue) return
            onScanRef.current(rawValue)
            onCloseRef.current()
          } catch {
            /* ignora frame falho */
          }
        }, 400)
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Erro ao abrir câmera.'
          setError(msg || 'Erro ao abrir câmera.')
        }
        releaseMedia()
      }
    }

    void start()

    return () => {
      cancelled = true
      releaseMedia()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="barcode-camera-scanner" role="dialog" aria-modal="true" aria-label={title ?? 'Leitor de código de barras'}>
      <div className="barcode-camera-scanner__backdrop" onClick={onClose} />
      <div className="barcode-camera-scanner__panel">
        <h3 className="barcode-camera-scanner__title">{title ?? 'Ler código de barras'}</h3>
        <p className="barcode-camera-scanner__hint">Aponte a câmera para o código. A leitura é automática.</p>
        {error ? <p className="barcode-camera-scanner__error">{error}</p> : null}
        <video ref={videoRef} className="barcode-camera-scanner__video" playsInline muted />
        <button type="button" className="barcode-camera-scanner__close" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>,
    document.body,
  )
}
