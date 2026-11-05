/**
 * Agente Gemini com function calling — mesmo padrão do "Meu Financeiro IA":
 * conversa natural → ferramentas → confirmação falada + ação no WMS Plus.
 */
import type { SidebarSectionId } from '../components/CollapsibleSidebarSection'
import type { NotaFiscal } from '../types'
import type { VoiceCommand } from './parseVoiceCommand'
import { isDestructiveVoiceCommand } from './parseVoiceCommand'
import { buildWmsVoiceSnapshot, queryEstoqueSnapshot, type WmsVoiceSnapshot } from './wmsVoiceSnapshot'
import type { ConsultaEstoqueFiltros } from './consultaEstoque'

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
]
const MAX_TOOL_ITERS = 5
const HISTORY_LIMIT = 16

export type GeminiHistoryPart = {
  role: 'user' | 'model'
  parts: Array<{ text?: string; functionCall?: GeminiFnCall; functionResponse?: GeminiFnResp }>
}

type GeminiFnCall = { name: string; args?: Record<string, unknown> }
type GeminiFnResp = { name: string; response: { result: unknown } }

type ToolDecl = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const SECTION_ENUM = [
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
]

const SECTION_LABELS: Record<string, string> = {
  painel: 'Painel',
  consulta: 'Consulta estoque',
  entrada: 'Entrada',
  saida: 'Saída',
  editar: 'Movimentação',
  historico: 'Histórico',
  relatorio: 'Relatório',
  imprimir: 'Mapa',
  canceladas: 'NF cancelada',
  cadastroVoz: 'IA DOCA LIVRE',
  financeiro: 'Financeiro',
  agendamentosHub: 'Agendamentos',
}

const TOOLS: ToolDecl[] = [
  {
    name: 'open_section',
    description:
      'Abre uma tela/módulo do WMS Plus. Use para: painel, consulta estoque, entrada (recebimento XML), agendamentos do Hub, saída (expedição), movimentação/endereçamento, histórico, relatório, mapa, NF cancelada, comando de voz, financeiro.',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: SECTION_ENUM },
      },
      required: ['section'],
    },
  },
  {
    name: 'close_section',
    description: 'Fecha uma tela. section=all fecha todas; current fecha a aba aberta.',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'painel|consulta|...|all|current' },
      },
      required: ['section'],
    },
  },
  {
    name: 'consultar_estoque',
    description:
      'Busca itens no estoque por NF, código/descrição, remetente ou lote e destaca no mapa. Use para: pesquisar NF, onde está a nota, tem produto, consultar estoque. NÃO use buscar_nota_movimentacao para pesquisa.',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Código ou descrição do produto' },
        nfNumero: { type: 'string' },
        remetente: { type: 'string' },
        lote: { type: 'string' },
        origem: { type: 'string', enum: ['armazem', 'stage', 'ambos'] },
      },
    },
  },
  {
    name: 'buscar_nota_movimentacao',
    description:
      'Abre a movimentação/endereçamento e busca uma NF. Use SOMENTE se o usuário pedir movimentar, reposicionar, endereçar ou transferir paletes — não para pesquisar/consultar onde está a nota.',
    parameters: {
      type: 'object',
      properties: { numero: { type: 'string' } },
      required: ['numero'],
    },
  },
  {
    name: 'buscar_nota_saida',
    description: 'Abre a saída/expedição e busca a NF de origem pelo número.',
    parameters: {
      type: 'object',
      properties: { numero: { type: 'string' } },
      required: ['numero'],
    },
  },
  {
    name: 'limpar_consulta',
    description: 'Limpa os filtros da consulta de estoque.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'painel_periodo',
    description: 'Filtra o painel analítico. dias: 0=hoje, 7=últimos 7 dias, 30=último mês.',
    parameters: {
      type: 'object',
      properties: { dias: { type: 'number', enum: [0, 7, 30] } },
      required: ['dias'],
    },
  },
  {
    name: 'confirmar_movimentacao',
    description: 'Confirma a movimentação/endereçamento já preenchida na tela (não apaga dados).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'selecionar_endereco',
    description: 'Seleciona um endereço WMS (ex: C6-R1-C2-N3) como destino da movimentação.',
    parameters: {
      type: 'object',
      properties: { addressId: { type: 'string' } },
      required: ['addressId'],
    },
  },
  {
    name: 'sidebar_mode',
    description: 'Altera o menu lateral.',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['collapsed', 'open', 'fullscreen'] } },
      required: ['mode'],
    },
  },
  {
    name: 'toggle_theme',
    description: 'Muda o tema visual.',
    parameters: {
      type: 'object',
      properties: { theme: { type: 'string', enum: ['light', 'dark', 'auto'] } },
      required: ['theme'],
    },
  },
  {
    name: 'get_resumo_estoque',
    description:
      'Consulta o resumo atual do estoque (quantas NFs, emitentes, amostra de itens). Use ANTES de responder perguntas sobre a situação do armazém.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'encerrar_assistente',
    description: 'Encerra a sessão de voz quando o usuário se despede ou pede para parar.',
    parameters: { type: 'object', properties: {} },
  },
]

function buildSystemPrompt(snap: WmsVoiceSnapshot): string {
  return `Você é a IA Doca Livre, assistente do WMS Plus. Conversa em português do Brasil, clara e útil — como um chat, não como um menu de voz.

MISSÃO: responder perguntas e executar o sistema — abrir telas, consultar estoque, buscar NF, movimentar, saída, relatório, mapa, financeiro.

REGRAS:
1. Cumprimente e explique suas funções quando pedirem “oi”, “o que você faz” ou “funcionalidades”. Não responda só “em que posso ajudar?”.
2. Sempre que o usuário quiser FAZER algo no sistema, chame a ferramenta correspondente. Não descreva o clique se puder executar.
3. Para perguntas sobre estoque ("tem X?", "onde está a NF?", "pesquise a NF", "quantas notas?"), use consultar_estoque (e get_resumo_estoque se precisar de panorama). Nunca responda que está buscando sem chamar a ferramenta.
4. NUNCA apague, exclua, zere ou remova dados. Se pedirem isso, recuse.
5. Se faltar um dado essencial (número da NF, item), PERGUNTE em uma frase curta — não invente.
6. Confirme em 1–3 frases o que fez e, se consultou estoque, cite NF, item e endereço.
7. Módulos: Painel, Consulta, Entrada (XML), Saída, Movimentação, Histórico, Relatório, Mapa, NF cancelada, IA DOCA LIVRE, Financeiro.
8. "pesquisar/buscar/consultar/onde está a NF" → consultar_estoque. Só use buscar_nota_movimentacao se pedirem movimentar/reposicionar/endereçar.
9. Se pedirem subir, lançar, cadastrar ou importar NF/XML, abra a tela de Entrada (section=entrada) e diga para enviar o XML ou usar cadastro manual. Não diga que não entendeu.

SITUAÇÃO ATUAL DO ESTOQUE (pode estar levemente desatualizada — use ferramentas para dados exatos):
- NFs ativas: ${snap.notasAtivas} (em andamento: ${snap.emAndamento}, concluídas: ${snap.concluidas})
- Emitentes: ${snap.emitentes.join(', ') || 'nenhum'}
- Amostra:
${snap.amostra.slice(0, 12).map((l) => `  ${l}`).join('\n') || '  (estoque vazio)'}

Data de hoje: ${new Date().toLocaleDateString('pt-BR')}`
}

let history: GeminiHistoryPart[] = []

export function resetWmsGeminiHistory() {
  history = []
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

function executeTool(
  name: string,
  args: Record<string, unknown>,
  notas: NotaFiscal[],
): { result: unknown; command: VoiceCommand | null } {
  switch (name) {
    case 'open_section': {
      const section = String(args.section || '') as SidebarSectionId
      const label = SECTION_LABELS[section]
      if (!label) return { result: { ok: false, erro: 'seção inválida' }, command: null }
      return {
        result: { ok: true, section, label },
        command: { type: 'open_section', section, label },
      }
    }
    case 'close_section': {
      const section = String(args.section || 'current')
      if (section === 'all') {
        return {
          result: { ok: true },
          command: { type: 'close_section', section: null, label: 'Todas as seções' },
        }
      }
      if (section === 'current') {
        return {
          result: { ok: true },
          command: { type: 'close_current_section', label: 'Aba atual' },
        }
      }
      const label = SECTION_LABELS[section]
      if (!label) return { result: { ok: false }, command: null }
      return {
        result: { ok: true },
        command: { type: 'close_section', section: section as SidebarSectionId, label },
      }
    }
    case 'consultar_estoque': {
      const filtros: Partial<ConsultaEstoqueFiltros> = {}
      if (args.item) filtros.item = String(args.item)
      if (args.nfNumero) filtros.nfNumero = digits(args.nfNumero)
      if (args.remetente) filtros.remetente = String(args.remetente)
      if (args.lote) filtros.lote = String(args.lote)
      if (args.origem === 'armazem' || args.origem === 'stage' || args.origem === 'ambos') {
        filtros.origem = args.origem
      } else {
        filtros.origem = 'ambos'
      }
      const q = queryEstoqueSnapshot(notas, filtros)
      return {
        result: { ok: true, encontrados: q.count, linhas: q.linhas, filtros },
        command: { type: 'consultar', filtros },
      }
    }
    case 'buscar_nota_movimentacao': {
      const numero = digits(args.numero)
      if (numero.length < 3) return { result: { ok: false, erro: 'número curto' }, command: null }
      return { result: { ok: true, numero }, command: { type: 'buscar_nota', numero } }
    }
    case 'buscar_nota_saida': {
      const numero = digits(args.numero)
      if (numero.length < 3) return { result: { ok: false, erro: 'número curto' }, command: null }
      return { result: { ok: true, numero }, command: { type: 'buscar_saida', numero } }
    }
    case 'limpar_consulta':
      return { result: { ok: true }, command: { type: 'limpar_consulta' } }
    case 'painel_periodo': {
      const dias = Number(args.dias)
      if (![0, 7, 30].includes(dias)) return { result: { ok: false }, command: null }
      const label = dias === 0 ? 'Hoje' : dias === 7 ? 'Últimos 7 dias' : 'Último mês'
      return { result: { ok: true }, command: { type: 'painel_periodo', dias, label } }
    }
    case 'confirmar_movimentacao':
      return { result: { ok: true }, command: { type: 'confirmar_movimentacao' } }
    case 'selecionar_endereco': {
      const addressId = String(args.addressId || '').toUpperCase().trim()
      if (!addressId) return { result: { ok: false }, command: null }
      return { result: { ok: true }, command: { type: 'endereco', addressId } }
    }
    case 'sidebar_mode': {
      const mode = String(args.mode) as 'collapsed' | 'open' | 'fullscreen'
      const labels = { collapsed: 'Menu recolhido', open: 'Menu aberto', fullscreen: 'Menu tela cheia' }
      if (!labels[mode]) return { result: { ok: false }, command: null }
      return { result: { ok: true }, command: { type: 'sidebar_mode', mode, label: labels[mode] } }
    }
    case 'toggle_theme': {
      const theme = (String(args.theme || 'auto') as 'light' | 'dark' | 'auto')
      const label =
        theme === 'dark' ? 'Tema escuro' : theme === 'light' ? 'Tema claro' : 'Alternar tema'
      return { result: { ok: true }, command: { type: 'toggle_theme', theme, label } }
    }
    case 'get_resumo_estoque':
      return { result: buildWmsVoiceSnapshot(notas), command: null }
    case 'encerrar_assistente':
      return { result: { ok: true }, command: { type: 'parar' } }
    default:
      return { result: { ok: false, erro: `ferramenta desconhecida: ${name}` }, command: null }
  }
}

async function generateContent(
  apiKey: string,
  model: string,
  system: string,
  contents: GeminiHistoryPart[],
): Promise<{
  text: string
  functionCalls: GeminiFnCall[]
  modelParts: GeminiHistoryPart['parts']
} | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    candidates?: {
      content?: {
        parts?: Array<{
          text?: string
          functionCall?: { name?: string; args?: Record<string, unknown> }
        }>
      }
    }[]
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const functionCalls: GeminiFnCall[] = []
  let text = ''
  for (const p of parts) {
    if (p.text) text += p.text
    if (p.functionCall?.name) {
      functionCalls.push({ name: p.functionCall.name, args: p.functionCall.args || {} })
    }
  }
  return {
    text: text.trim(),
    functionCalls,
    modelParts: parts.map((p) => {
      if (p.functionCall?.name) {
        return { functionCall: { name: p.functionCall.name, args: p.functionCall.args || {} } }
      }
      return { text: p.text || '' }
    }),
  }
}

export type WmsGeminiAgentResult = {
  reply: string
  command: VoiceCommand | null
  endSession: boolean
}

export async function runWmsGeminiAgent(input: {
  text: string
  apiKey: string
  notas: NotaFiscal[]
}): Promise<WmsGeminiAgentResult | null> {
  const { text, apiKey, notas } = input
  if (!apiKey.trim() || !text.trim()) return null
  if (isDestructiveVoiceCommand(text)) {
    return {
      reply: 'Não posso apagar nem remover dados por voz. Peça outra ação do WMS.',
      command: null,
      endSession: false,
    }
  }

  const snap = buildWmsVoiceSnapshot(notas)
  const system = buildSystemPrompt(snap)
  history.push({ role: 'user', parts: [{ text }] })
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT)

  let lastCommand: VoiceCommand | null = null
  let finalText = ''

  for (const model of GEMINI_MODELS) {
    let contents = [...history]
    let used = false
    for (let i = 0; i < MAX_TOOL_ITERS; i++) {
      const gen = await generateContent(apiKey, model, system, contents)
      if (!gen) break
      used = true
      contents.push({ role: 'model', parts: gen.modelParts })
      if (gen.text) finalText = gen.text

      if (gen.functionCalls.length === 0) break

      const toolParts: GeminiHistoryPart['parts'] = []
      for (const call of gen.functionCalls) {
        const { result, command } = executeTool(call.name, call.args || {}, notas)
        if (command) lastCommand = command
        toolParts.push({
          functionResponse: { name: call.name, response: { result } },
        })
      }
      contents.push({ role: 'user', parts: toolParts })
    }
    if (used) {
      history = contents.slice(-HISTORY_LIMIT)
      break
    }
  }

  if (!finalText && !lastCommand) return null

  const endSession = lastCommand?.type === 'parar'
  if (endSession) history = []

  return {
    reply:
      finalText ||
      (lastCommand
        ? 'Pronto, já executei no sistema.'
        : 'Não entendi. Pode repetir o que deseja no WMS?'),
    command: lastCommand,
    endSession,
  }
}
