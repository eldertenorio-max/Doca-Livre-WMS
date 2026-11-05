/** Normaliza transcript de voz para comparação e parsing. */
export function normalizeVoiceText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[·.,;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const OK_ESTOQUE_WAKE_RE =
  /\b(?:o\s*k|ok|okay|oki|oque|o\s*que|oh|aw|au|a)\s+(?:do\s+|de\s+)?est(?:o|ó)?qu(?:e|i|ue|a)\b|\best(?:o|ó)?qu(?:e|i|ue|a)\s+(?:ok|okay|oki|oque|o\s*que)\b|\baqui\s+est(?:o|ó)?qu(?:e|i|ue|a)\b|\best(?:o|ó)?qu(?:e|i|ue|a)\s+aqui\b/

function fuzzyWakePhraseMatch(norm: string, wake: string): boolean {
  if (wake === 'ok estoque') {
    if (OK_ESTOQUE_WAKE_RE.test(norm)) return true
    if (/\b(o\s*k|ok|okay|oki|oque|o k)\s+est(o|ó)?que\b/.test(norm)) return true
    if (/\best(o|ó)?que\s+(ok|okay|oki|oque)\b/.test(norm)) return true
    if (/\baqui\s+est(o|ó)?que\b/.test(norm)) return true
    // STT às vezes transcreve "ok estoque" como "ok estou aqui"
    if (/\bok\s+estou(\s+aqui)?\b/.test(norm)) return true
  }
  return false
}

export function wakePhraseMatches(transcript: string, wakePhrase: string): boolean {
  const norm = normalizeVoiceText(transcript)
  const wake = normalizeVoiceText(wakePhrase)
  if (!wake) return false
  if (norm.includes(wake)) return true
  if (fuzzyWakePhraseMatch(norm, wake)) return true

  // Janela final: STT às vezes prefixa ruído ("então ok estoque")
  const words = norm.split(/\s+/).filter(Boolean)
  for (let len = Math.min(8, words.length); len >= 2; len--) {
    for (let start = Math.max(0, words.length - len - 6); start <= words.length - len; start++) {
      const chunk = words.slice(start, start + len).join(' ')
      if (chunk.includes(wake) || fuzzyWakePhraseMatch(chunk, wake)) return true
    }
  }

  return false
}

export function stripWakePhrase(transcript: string, wakePhrase: string): string {
  const norm = normalizeVoiceText(transcript)
  const wake = normalizeVoiceText(wakePhrase)
  if (!wake) return norm

  const idx = norm.indexOf(wake)
  if (idx >= 0) return norm.slice(idx + wake.length).trim()

  if (wake === 'ok estoque') {
    const m = norm.match(OK_ESTOQUE_WAKE_RE)
    if (m?.index != null) {
      return norm.slice(m.index + m[0].length).trim()
    }
    const estou = norm.match(/\bok\s+estou(?:\s+aqui)?\b/)
    if (estou?.index != null) {
      return norm.slice(estou.index + estou[0].length).trim()
    }
  }

  const words = norm.split(/\s+/).filter(Boolean)
  for (let len = Math.min(8, words.length); len >= 2; len--) {
    for (let start = 0; start <= words.length - len; start++) {
      const chunk = words.slice(start, start + len).join(' ')
      const isWake = chunk.includes(wake) || fuzzyWakePhraseMatch(chunk, wake)
      if (!isWake) continue
      let remainder = words.slice(start + len).join(' ').trim()
      if (chunk.includes(wake)) {
        const localIdx = chunk.indexOf(wake)
        if (localIdx >= 0) {
          remainder = `${chunk.slice(localIdx + wake.length).trim()} ${remainder}`.trim()
        }
      }
      return remainder
    }
  }

  return norm
}

/** Remove frase de ativação e preenchimentos antes de interpretar o comando. */
export function prepareVoiceCommandText(text: string, wakePhrase: string): string {
  let s = stripWakePhrase(text, wakePhrase)
  s = s.replace(/^(?:por favor|agora|entao|então|ai|ei|olha|veja)\s+/i, '')
  return s.trim()
}
