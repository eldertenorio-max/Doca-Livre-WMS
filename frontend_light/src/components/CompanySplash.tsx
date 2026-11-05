import { useEffect, useRef, useState } from 'react'
import { LOGO_DOCA_LIVRE_SRC } from '../lib/brandAssets'
import { isHomologacao } from '../lib/appAmbiente'
import './OpeningSplash.css'
import './CompanySplash.css'

const MIN_INTRO_MS = 2200

type Props = {
  onComplete: () => void
  loading?: boolean
}

export default function CompanySplash({ onComplete, loading = false }: Props) {
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
    const t = window.setTimeout(onComplete, 650)
    return () => window.clearTimeout(t)
  }, [exiting, onComplete])

  return (
    <div className={`intro-splash company-splash ${exiting ? 'intro-splash--exit' : ''}`} aria-busy="true">
      <div className="intro-content company-splash__content">
        <div className="company-splash__brand">
          <img
            src={LOGO_DOCA_LIVRE_SRC}
            alt=""
            className="intro-logo company-splash__logo"
          />
          <p className="company-splash__title">Doca Livre Sistemas</p>
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
