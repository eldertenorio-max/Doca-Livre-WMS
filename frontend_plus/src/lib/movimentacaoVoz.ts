import { normalizeVoiceText } from './voiceNormalize'

const CONFIRM_ONLY = /^(confirme|confirmar|confirmar movimentacao)$/

const CONFIRM_SUFFIX = /\s+(confirme|confirmar|confirmar movimentac(ao|ao))$/

/** Separa endereço falado e pedido de confirmação no mesmo comando. */
export function splitMovimentacaoVozTranscript(text: string): {
  addressText: string
  confirm: boolean
} {
  const norm = normalizeVoiceText(text).trim()
  if (!norm) return { addressText: '', confirm: false }
  if (CONFIRM_ONLY.test(norm)) return { addressText: '', confirm: true }
  if (CONFIRM_SUFFIX.test(norm)) {
    return {
      addressText: norm.replace(CONFIRM_SUFFIX, '').trim(),
      confirm: true,
    }
  }
  return { addressText: norm, confirm: false }
}

export function isConfirmarMovimentacaoVoice(text: string): boolean {
  const norm = normalizeVoiceText(text).trim()
  if (!norm) return false
  return CONFIRM_ONLY.test(norm) || /\bconfirmar movimentac/.test(norm)
}
