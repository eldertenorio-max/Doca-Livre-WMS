export type VoicePrefs = {
  enabled: boolean
  wakePhrase: string
  calibrated: boolean
  /** Só aceita a voz individual cadastrada junto com a frase de ativação. */
  voiceLocked: boolean
  /** Após "ok estoque", conversa por voz perguntando o que fazer. */
  interactiveMode: boolean
  /** Interpreta linguagem natural (local + IA opcional). */
  aiInterpretation: boolean
  /** Chave Gemini opcional para interpretação avançada (Google AI Studio). */
  geminiApiKey: string
}

export const VOICE_PREFS_KEY = 'ultrafrio-voice-prefs'
export const DEFAULT_WAKE_PHRASE = 'ok estoque'

export function defaultVoicePrefs(): VoicePrefs {
  return {
    enabled: false,
    wakePhrase: DEFAULT_WAKE_PHRASE,
    calibrated: false,
    voiceLocked: false,
    interactiveMode: true,
    aiInterpretation: true,
    geminiApiKey: '',
  }
}

export function getStoredVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VoicePrefs>
      return {
        ...defaultVoicePrefs(),
        ...parsed,
        wakePhrase: (parsed.wakePhrase ?? DEFAULT_WAKE_PHRASE).trim() || DEFAULT_WAKE_PHRASE,
        aiInterpretation: parsed.aiInterpretation !== false,
        geminiApiKey: (parsed.geminiApiKey ?? '').trim(),
      }
    }
  } catch {
    /* ignore */
  }
  return defaultVoicePrefs()
}

export function storeVoicePrefs(prefs: VoicePrefs) {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}
