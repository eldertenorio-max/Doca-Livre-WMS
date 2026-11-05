import { useEffect, useRef, useState } from 'react'
import {
  BRAND_FULL_TITLE,
  BRAND_PRODUCT_NAME,
  BRAND_PRODUCT_VARIANT,
  LOGO_DOCA_LIVRE_SRC,
} from '../lib/brandAssets'
import { isHomologacao } from '../lib/appAmbiente'
import './IntroSplash.css'

const MIN_INTRO_MS = 2200

type Props = {
  loading: boolean
  onFinish: () => void
}

export function IntroSplash({ loading, onFinish }: Props) {
  const [progress, setProgress] = useState(0)
  const [exiting, setExiting] = useState(false)
  const startRef = useRef(Date.now())
  const finishedRef = useRef(false)

  useEffect(() => {
    const tick = window.setInterval(() => {
      setProgress((prev) => {
        const elapsed = Date.now() - startRef.current
        const minDone = elapsed >= MIN_INTRO_MS

        if (!loading && minDone) {
          return Math.min(100, prev + 6)
        }
        if (loading) {
          return Math.min(88, prev + 1.2 + Math.random() * 2.5)
        }
        return Math.min(95, prev + 2)
      })
    }, 60)

    return () => window.clearInterval(tick)
  }, [loading])

  useEffect(() => {
    if (finishedRef.current) return
    const elapsed = Date.now() - startRef.current
    if (!loading && progress >= 100 && elapsed >= MIN_INTRO_MS) {
      finishedRef.current = true
      const pause = window.setTimeout(() => setExiting(true), 350)
      return () => window.clearTimeout(pause)
    }
  }, [loading, progress])

  useEffect(() => {
    if (!exiting) return
    const t = window.setTimeout(onFinish, 650)
    return () => window.clearTimeout(t)
  }, [exiting, onFinish])

  return (
    <div className={`intro-splash ${exiting ? 'intro-splash--exit' : ''}`} aria-busy="true">
      <div className="intro-glow" aria-hidden />
      <div className="intro-content">
        <div className="intro-brand" aria-label={BRAND_FULL_TITLE}>
          <img src={LOGO_DOCA_LIVRE_SRC} alt="" className="intro-logo" />
          <p className="intro-product-name" aria-hidden>
            <span className="intro-product-wms">{BRAND_PRODUCT_NAME}</span>
            <span className="intro-product-light">{BRAND_PRODUCT_VARIANT}</span>
          </p>
        </div>
        {isHomologacao() && <p className="intro-ambiente intro-ambiente--homolog">Homologação</p>}
        <div className="intro-progress-wrap">
          <div className="intro-progress-track">
            <div className="intro-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <span className="intro-progress-label">Carregando… {Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}
