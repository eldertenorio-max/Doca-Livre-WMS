import type { NotaFiscal } from '../types'
import type { SidebarSectionId } from '../components/CollapsibleSidebarSection'
import type { ConsultaEstoqueFiltros } from './consultaEstoque'
import {
  isDestructiveVoiceCommand,
  parseVoiceCommand,
  type VoiceCommand,
} from './parseVoiceCommand'
import { interpretVoiceNaturally } from './voiceNaturalLanguage'
import { runWmsGeminiAgent } from './wmsGeminiAgent'

export type VoiceResolveOptions = {
  aiEnabled?: boolean
  geminiApiKey?: string
  notas?: NotaFiscal[]
}

const VALID_SECTIONS = new Set<SidebarSectionId>([
  'painel',
  'consulta',
  'entrada',
  'saida',
  'editar',
  'historico',
  'relatorio',
  'imprimir',
  'canceladas',
  'cadastroVoz',
  'financeiro',
  'agendamentosHub',
])

export function resolveVoiceCommandSync(text: string): VoiceCommand | null {
  if (isDestructiveVoiceCommand(text)) {
    return {
      type: 'blocked',
      message:
        'Comando bloqueado. Ações que apagam ou removem dados não são permitidas por voz.',
    }
  }

  const direct = parseVoiceCommand(text)
  if (direct && direct.type !== 'desconhecido') return direct

  const natural = interpretVoiceNaturally(text)
  if (natural) return natural

  return direct
}

function geminiKey(options: VoiceResolveOptions): string {
  return (
    options.geminiApiKey?.trim() ||
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ||
    ''
  )
}

/**
 * Com chave Gemini: agente com ferramentas (como o Meu Financeiro IA).
 * Sem chave: regras + linguagem natural local.
 */
export async function resolveVoiceCommandAsync(
  text: string,
  options: VoiceResolveOptions = {},
): Promise<VoiceCommand | null> {
  if (isDestructiveVoiceCommand(text)) {
    return {
      type: 'blocked',
      message:
        'Comando bloqueado. Ações que apagam ou removem dados não são permitidas por voz.',
    }
  }

  const aiEnabled = options.aiEnabled !== false
  const apiKey = geminiKey(options)

  if (aiEnabled && apiKey) {
    const agent = await runWmsGeminiAgent({
      text,
      apiKey,
      notas: options.notas ?? [],
    })
    if (agent?.command && agent.command.type !== 'assistente') return agent.command
  }

  return resolveVoiceCommandSync(text)
}

export async function resolveVoiceTurnAsync(
  text: string,
  options: VoiceResolveOptions = {},
): Promise<{ command: VoiceCommand | null; reply?: string; endSession?: boolean } | null> {
  const aiEnabled = options.aiEnabled !== false
  const apiKey = geminiKey(options)
  if (!aiEnabled || !apiKey) return null

  const agent = await runWmsGeminiAgent({
    text,
    apiKey,
    notas: options.notas ?? [],
  })
  if (!agent) return null
  return {
    command: agent.command,
    reply: agent.reply,
    endSession: agent.endSession,
  }
}

export { VALID_SECTIONS }
