/** Sons sintéticos leves para a vinheta (sem arquivos externos). */
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.04) {
  const ac = getCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(gain, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration)
  osc.connect(g)
  g.connect(ac.destination)
  osc.start()
  osc.stop(ac.currentTime + duration)
}

export function splashSoundCheck() {
  tone(880, 0.12, 'sine', 0.05)
  window.setTimeout(() => tone(1320, 0.08, 'sine', 0.035), 60)
}

export function splashSoundWhoosh() {
  const ac = getCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(180, ac.currentTime)
  osc.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.35)
  g.gain.setValueAtTime(0.02, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35)
  osc.connect(g)
  g.connect(ac.destination)
  osc.start()
  osc.stop(ac.currentTime + 0.35)
}

export function splashSoundConfirm() {
  tone(523, 0.1, 'triangle', 0.045)
  window.setTimeout(() => tone(784, 0.15, 'triangle', 0.04), 90)
}
