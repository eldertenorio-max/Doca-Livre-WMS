import type { VoiceCommand } from './parseVoiceCommand'
import { normalizeVoiceText } from './voiceNormalize'

export const VOICE_CONVERSATION_GREETING = 'Em que posso ajudar?'

export type ConversationPending =
  | { kind: 'buscar_nota' }
  | { kind: 'consultar'; campo?: 'nf' | 'item' | 'remetente' }

export type ConversationState = {
  pending: ConversationPending | null
}

export type ConversationTurnResult = {
  reply: string
  state: ConversationState
  command: VoiceCommand | null
  endSession: boolean
}

export function createConversationState(): ConversationState {
  return { pending: null }
}

function isExitPhrase(norm: string): boolean {
  if (/\b(fechar|ocultar|esconder|recolher)\b/.test(norm)) {
    return false
  }

  return (
    /\b(sair|encerrar|tchau|adeus|desligar)\b/.test(norm) ||
    /\b(encerrar|sair|desligar|parar)\s+(a\s+)?(conversa|assistente|voz)\b/.test(norm) ||
    /\b(nada mais|obrigad|valeu|pode parar|so isso|só isso)\b/.test(norm) ||
    /^(encerrar conversa|sair da conversa|cancelar conversa)$/.test(norm)
  )
}

function isHelpPhrase(norm: string): boolean {
  return (
    /\b(ajuda|help|o que voce faz|oque voce faz|quais comandos|menu|opcoes|opções)\b/.test(norm) ||
    /\bquais?\s+(sao\s+|são\s+)?(sua|suas)?\s*funcionalidades\b/.test(norm) ||
    /\bfuncionalidades\b/.test(norm)
  )
}

function isGreeting(norm: string): boolean {
  return /^(ola|olá|oi|oie|eai|eae|hey|hello|bom dia|boa tarde|boa noite)([!?. ]|$)/.test(norm)
}

function helpReply(): string {
  return [
    'Sou a IA Doca Livre. Posso conversar e executar o WMS Plus por você:',
    '',
    '• abrir painel, consulta, entrada, saída, movimentação',
    '• pesquisar NF no estoque, consultar item, financeiro, mapa e relatório',
    '',
    'Exemplos: “abre o painel”, “tem leite no estoque?”, “quero subir uma NF”, “pesquise a NF 20835”.',
  ].join('\n')
}

function followUpAfterCommand(label: string): string {
  return `Pronto! ${label}. Deseja mais alguma coisa?`
}

function commandLabel(cmd: VoiceCommand): string {
  switch (cmd.type) {
    case 'open_section':
      return cmd.section === 'entrada'
        ? 'Abri a Entrada. Envie o XML da NF ou use Cadastrar NF manual'
        : `Abri ${cmd.label}`
    case 'close_section':
      return cmd.section ? `Fechei ${cmd.label}` : 'Fechei as seções abertas'
    case 'close_current_section':
      return 'Fechei a aba atual'
    case 'buscar_nota':
      return `Buscando a nota ${cmd.numero}`
    case 'buscar_saida':
      return `Buscando a nota ${cmd.numero} para saída`
    case 'consultar': {
      const nf = cmd.filtros.nfNumero?.trim()
      const item = cmd.filtros.item?.trim()
      const rem = cmd.filtros.remetente?.trim()
      if (nf) return `Consultando a NF ${nf}`
      if (item) return `Consultando o item ${item}`
      if (rem) return `Consultando o remetente ${rem}`
      return 'Consultando o estoque'
    }
    case 'limpar_consulta':
      return 'Filtros da consulta limpos'
    case 'painel_periodo':
      return `Painel: ${cmd.label}`
    case 'confirmar_movimentacao':
      return 'Movimentação confirmada'
    case 'sidebar_mode':
    case 'toggle_theme':
      return cmd.label
    case 'endereco':
      return `Endereço ${cmd.addressId} selecionado`
    case 'assistente':
      return cmd.message
    case 'parar':
      return 'Encerrando'
    case 'blocked':
      return cmd.message
    case 'desconhecido':
      return `Não entendi "${cmd.raw}"`
  }
}

function tryPartialIntent(norm: string): ConversationPending | null {
  if (
    /\b(movimentac|movimentar|movimente|reposicion|editar|enderecar)/.test(norm) &&
    /\b(nota|nf)\b/.test(norm)
  ) {
    return { kind: 'buscar_nota' }
  }
  if (
    /\b(consultar|consulta|pesquisar|pesquise|procurar|buscar|onde|tem|existe|quanto)\b/.test(
      norm,
    ) ||
    /\bno estoque\b/.test(norm)
  ) {
    if (/\b(nota|nf)\b/.test(norm)) return { kind: 'consultar', campo: 'nf' }
    if (/\b(item|produto|codigo|código)\b/.test(norm)) return { kind: 'consultar', campo: 'item' }
    if (/\b(remetente|emitente|fornecedor)\b/.test(norm)) return { kind: 'consultar', campo: 'remetente' }
    return { kind: 'consultar' }
  }
  return null
}

async function resolvePending(
  text: string,
  pending: ConversationPending,
  resolveCommand: (text: string) => Promise<VoiceCommand | null>,
): Promise<ConversationTurnResult> {
  const norm = normalizeVoiceText(text)
  const state = createConversationState()

  if (pending.kind === 'buscar_nota') {
    const digits = norm.replace(/\D/g, '')
    if (digits.length >= 3) {
      const cmd: VoiceCommand = { type: 'buscar_nota', numero: digits }
      return {
        reply: followUpAfterCommand(commandLabel(cmd)),
        state,
        command: cmd,
        endSession: false,
      }
    }
    return {
      reply: 'Informe o número da nota fiscal, por favor.',
      state: { pending },
      command: null,
      endSession: false,
    }
  }

  if (pending.kind === 'consultar') {
    const cmd = await resolveCommand(text)
    if (cmd && cmd.type === 'consultar') {
      return {
        reply: followUpAfterCommand(commandLabel(cmd)),
        state,
        command: cmd,
        endSession: false,
      }
    }

    const digits = norm.replace(/\D/g, '')
    if ((pending.campo === 'nf' || digits.length >= 3) && digits.length >= 3) {
      const c: VoiceCommand = { type: 'consultar', filtros: { nfNumero: digits, origem: 'ambos' } }
      return {
        reply: followUpAfterCommand(commandLabel(c)),
        state,
        command: c,
        endSession: false,
      }
    }

    if (pending.campo === 'item' || (!pending.campo && norm.length > 2 && !/^\d+$/.test(norm))) {
      const c: VoiceCommand = { type: 'consultar', filtros: { item: text.trim() } }
      return {
        reply: followUpAfterCommand(commandLabel(c)),
        state,
        command: c,
        endSession: false,
      }
    }

    if (pending.campo === 'remetente') {
      const c: VoiceCommand = { type: 'consultar', filtros: { remetente: text.trim() } }
      return {
        reply: followUpAfterCommand(commandLabel(c)),
        state,
        command: c,
        endSession: false,
      }
    }

    return {
      reply: 'Diga o número da nota, o código do item ou o nome do remetente.',
      state: { pending },
      command: null,
      endSession: false,
    }
  }

  return {
    reply: helpReply(),
    state,
    command: null,
    endSession: false,
  }
}

export async function processConversationTurn(
  text: string,
  state: ConversationState,
  resolveCommand: (text: string) => Promise<VoiceCommand | null>,
): Promise<ConversationTurnResult> {
  const trimmed = text.trim()
  const norm = normalizeVoiceText(trimmed)

  if (!trimmed) {
    return {
      reply: 'Não ouvi nada. Pode repetir?',
      state,
      command: null,
      endSession: false,
    }
  }

  if (isExitPhrase(norm)) {
    return {
      reply: 'Até logo! Quando precisar, fale ok estoque.',
      state: createConversationState(),
      command: { type: 'parar' },
      endSession: true,
    }
  }

  if (isHelpPhrase(norm)) {
    return {
      reply: helpReply(),
      state: { pending: null },
      command: null,
      endSession: false,
    }
  }

  if (isGreeting(norm)) {
    return {
      reply: 'Oi. Sou a IA Doca Livre. Posso abrir telas, consultar estoque e executar tarefas do WMS. O que você precisa?',
      state: { pending: null },
      command: null,
      endSession: false,
    }
  }

  if (state.pending) {
    return resolvePending(trimmed, state.pending, resolveCommand)
  }

  const cmd = await resolveCommand(trimmed)

  if (cmd?.type === 'parar') {
    return {
      reply: 'Até logo! Quando precisar, fale ok estoque.',
      state: createConversationState(),
      command: cmd,
      endSession: true,
    }
  }

  if (cmd && cmd.type !== 'desconhecido' && cmd.type !== 'blocked') {
    return {
      reply: followUpAfterCommand(commandLabel(cmd)),
      state: createConversationState(),
      command: cmd,
      endSession: false,
    }
  }

  if (cmd?.type === 'blocked') {
    return {
      reply: cmd.message,
      state,
      command: null,
      endSession: false,
    }
  }

  const partial = tryPartialIntent(norm)
  if (partial?.kind === 'buscar_nota') {
    const digits = norm.replace(/\D/g, '')
    if (digits.length >= 3) {
      const c: VoiceCommand = { type: 'buscar_nota', numero: digits }
      return {
        reply: followUpAfterCommand(commandLabel(c)),
        state: createConversationState(),
        command: c,
        endSession: false,
      }
    }
    return {
      reply: 'Qual o número da nota fiscal?',
      state: { pending: partial },
      command: null,
      endSession: false,
    }
  }

  if (partial?.kind === 'consultar') {
    if (partial.campo === 'nf') {
      return {
        reply: 'Qual o número da nota?',
        state: { pending: partial },
        command: null,
        endSession: false,
      }
    }
    if (partial.campo === 'item') {
      return {
        reply: 'Qual o código ou descrição do item?',
        state: { pending: partial },
        command: null,
        endSession: false,
      }
    }
    if (partial.campo === 'remetente') {
      return {
        reply: 'Qual o nome do remetente ou emitente?',
        state: { pending: partial },
        command: null,
        endSession: false,
      }
    }
    return {
      reply: 'O que deseja consultar? Número da nota, item ou remetente?',
      state: { pending: partial },
      command: null,
      endSession: false,
    }
  }

  return {
    reply: `Não entendi “${trimmed}”. Posso abrir telas do WMS, consultar estoque e buscar notas. Diga, por exemplo: “abre o painel” ou “quais suas funcionalidades?”.`,
    state,
    command: null,
    endSession: false,
  }
}
