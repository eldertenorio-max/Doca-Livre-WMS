export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function pickPortugueseVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang.startsWith('pt-BR')) ??
    voices.find((v) => v.lang.startsWith('pt')) ??
    null
  )
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}

function waitSpeechIdle(maxMs = 4000): Promise<void> {
  if (!isSpeechSynthesisSupported()) return Promise.resolve()

  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      const synth = window.speechSynthesis
      if (!synth.speaking && !synth.pending) {
        resolve()
        return
      }
      if (Date.now() - start >= maxMs) {
        resolve()
        return
      }
      window.setTimeout(tick, 60)
    }
    tick()
  })
}

export function speakText(text: string): Promise<void> {
  if (!text.trim() || !isSpeechSynthesisSupported()) return Promise.resolve()

  stopSpeaking()

  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'pt-BR'
    utter.rate = 1
    utter.pitch = 1

    const voice = pickPortugueseVoice()
    if (voice) utter.voice = voice

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      void waitSpeechIdle().then(() => resolve())
    }

    utter.onend = () => {
      window.setTimeout(finish, 180)
    }
    utter.onerror = finish

    window.speechSynthesis.speak(utter)

    // Alguns navegadores demoram a carregar vozes
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        const v = pickPortugueseVoice()
        if (v) utter.voice = v
      }
    }

    // Fallback se onend não disparar (comum no Chrome/Windows)
    window.setTimeout(finish, Math.min(20000, Math.max(2500, text.length * 90)))
  })
}
