import type { SidebarSectionId } from '../components/CollapsibleSidebarSection'
import { parseEnderecoFalado } from './parseEnderecoFalado'
import { isDestructiveVoiceCommand, type VoiceCommand } from './parseVoiceCommand'
import { normalizeVoiceText } from './voiceNormalize'

type SectionDef = {
  section: SidebarSectionId
  label: string
  terms: RegExp[]
}

const SECTIONS: SectionDef[] = [
  {
    section: 'painel',
    label: 'Painel',
    terms: [/\bpainel\b/, /\banalytics?\b/, /\banalitico\b/, /\bindicador/, /\bdashboard\b/, /\bgraficos?\b/],
  },
  {
    section: 'consulta',
    label: 'Consulta estoque',
    terms: [
      /\bconsulta\b/,
      /\bconsultar\b/,
      /\bconsulta estoque\b/,
      /\bbusca estoque\b/,
      /\bpesquisa estoque\b/,
    ],
  },
  {
    section: 'entrada',
    label: 'Entrada',
    terms: [
      /\bentrada\b/,
      /\brecebimento\b/,
      /\breceber nota\b/,
      /\breceber nf\b/,
      /\bsubir xml\b/,
      /\bsubir (uma |a )?(nf|nota|nfe)\b/,
      /\b(lancar|lançar|importar|cadastrar|carregar|anexar)\s+(uma |a |o )?(nf|nota|nfe|xml)\b/,
      /\bdar entrada\b/,
    ],
  },
  {
    section: 'saida',
    label: 'Saída',
    terms: [/\bsaida\b/, /\bexpedicao\b/, /\bexpedir\b/, /\bretirada\b/],
  },
  {
    section: 'editar',
    label: 'Movimentação',
    terms: [
      /\bmovimentac/,
      /\breposicion/,
      /\btransferir\b/,
      /\brealocar\b/,
      /\btrocar endereco\b/,
      /\benderecar\b/,
    ],
  },
  {
    section: 'historico',
    label: 'Histórico',
    terms: [/\bhistorico\b/, /\bmovimentos anteriores\b/],
  },
  {
    section: 'relatorio',
    label: 'Relatório',
    terms: [/\brelatorio\b/, /\brelatorio de estoque\b/],
  },
  {
    section: 'imprimir',
    label: 'Mapa',
    terms: [/\bmapa\b/, /\blayout\b/, /\bmapa do armazem\b/, /\bimprimir mapa\b/],
  },
  {
    section: 'canceladas',
    label: 'NF cancelada',
    terms: [/\bcancelad/, /\bnf cancelad/],
  },
  {
    section: 'cadastroVoz',
    label: 'IA DOCA LIVRE',
    terms: [/\bia doca\b/, /\bcomando de voz\b/, /\bchat da ia\b/, /\binteligencia artificial\b/],
  },
  {
    section: 'financeiro',
    label: 'Financeiro',
    terms: [/\bfinanceiro\b/, /\bfaturamento\b/, /\bcobranca\b/],
  },
  {
    section: 'agendamentosHub',
    label: 'Agendamentos',
    terms: [/\bagendamentos?\b/, /\bhub\b/, /\bprevisao de entrada\b/, /\bprevisão de entrada\b/],
  },
]

const FILLER_RE =
  /\b(por favor|me|minha|meu|quero|preciso|gostaria|poderia|podia|pode|voce|vc|tipo|entao|beleza|oi|ola|hum|hm|ne|ta|to|vamos|somente|agora|la|aqui|ali|la em|fala|diga|diz)\b/g

function stripFillers(norm: string): string {
  return norm.replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim()
}

function findSection(norm: string): SectionDef | null {
  for (const def of SECTIONS) {
    if (def.terms.some((t) => t.test(norm))) return def
  }
  return null
}

function extractDigits(norm: string): string {
  return norm.replace(/\D/g, '')
}

function extractNotaNumero(norm: string): string | null {
  const patterns = [
    /\b(?:nota|nf)\s*(?:numero|n[º°]?|de)?\s*([\d\s.-]+)/,
    /\b(?:buscar|achar|localizar|procurar|pesquisar|abrir|ver|onde)\s+(?:a\s+)?(?:nota|nf)\s+([\d\s.-]+)/,
    /\b(?:nota|nf)\s+([\d\s.-]{3,})/,
  ]
  for (const re of patterns) {
    const m = norm.match(re)
    if (!m?.[1]) continue
    const digits = m[1].replace(/\D/g, '')
    if (digits.length >= 3) return digits
  }
  if (/\b(?:nota|nf)\b/.test(norm)) {
    const digits = extractDigits(norm)
    if (digits.length >= 3 && digits.length <= 12) return digits
  }
  return null
}

function extractConsultQuery(norm: string, cleaned: string): string | null {
  const patterns = [
    /\b(?:consultar|consulta|pesquisar|procurar|buscar)\s+(?:o\s+)?(?:item\s+)?(.+)/,
    /\b(?:tem|existe|ha|há)\s+(?:algum|alguma|o|a)?\s*(.+?)\s+(?:no|em)\s+estoque/,
    /\b(?:quanto|quantos|quantas)\s+(?:tem|ha|há|de)\s+(?:o|a)?\s*(.+?)\s+(?:no|em)\s+estoque/,
    /\bestoque\s+(?:de|do|da)\s+(.+)/,
    /\b(?:tem|existe)\s+(.+?)\s+(?:no|em)\s+estoque/,
    /\b(?:tem|existe)\s+(.+)/,
  ]
  for (const re of patterns) {
    const m = cleaned.match(re) ?? norm.match(re)
    if (!m?.[1]) continue
    const q = m[1]
      .replace(/\b(por favor|no estoque|em estoque|aqui|agora)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (q.length > 1 && !/^(nota|nf|painel|entrada|saida|consulta|mapa|estoque)$/.test(q)) {
      return q
    }
  }
  return null
}

function extractRemetente(norm: string): string | null {
  const m = norm.match(
    /\b(?:consultar|consulta|pesquisar|procurar|buscar)\s+(?:o\s+)?(?:remetente|emitente|fornecedor)\s+(.+)/,
  )
  return m?.[1]?.trim() || null
}

/** Interpreta frases naturais em português sem exigir texto decorado. */
export function interpretVoiceNaturally(text: string): VoiceCommand | null {
  const norm = normalizeVoiceText(text)
  if (!norm || isDestructiveVoiceCommand(text)) return null

  const cleaned = stripFillers(norm)

  if (
    /\b(fechar|feche|fecha|ocultar|esconder|recolher)\s+(tudo|todas|as secoes|o menu|menu)\b/.test(
      norm,
    ) ||
    norm === 'fechar tudo'
  ) {
    return { type: 'close_section', section: null, label: 'Todas as seções' }
  }

  if (
    /^(fechar|feche|fecha|recolher)$/.test(norm) ||
    /\bfechar (esta |essa |a )?(aba|secao|janela|tela)\b/.test(norm) ||
    /\b(fecha|feche) (isso|essa|esta)\b/.test(norm)
  ) {
    return { type: 'close_current_section', label: 'Aba atual' }
  }

  const section = findSection(norm)
  const wantsClose =
    /\b(fechar|feche|fecha|ocultar|esconder|recolher|sair d[ao]|tirar)\b/.test(norm) ||
    /\b(fecha|feche) (o|a|essa|esta)\b/.test(norm)

  if (section && wantsClose) {
    return { type: 'close_section', section: section.section, label: section.label }
  }

  const nota = extractNotaNumero(norm)
  const wantsMovimentacao =
    /\b(movimentac|movimentar|movimente|reposicion|editar|enderecar|transferir|realocar)/.test(norm)
  const wantsSaida = /\b(saida|expedi|retirada)/.test(norm)
  if (
    nota &&
    (/\b(buscar|achar|localizar|procurar|pesquisar|pesquise|abrir|ver|onde|mostrar|consulta)\b/.test(
      norm,
    ) ||
      /\b(nota|nf)\b/.test(norm))
  ) {
    if (wantsSaida) return { type: 'buscar_saida', numero: nota }
    if (wantsMovimentacao) return { type: 'buscar_nota', numero: nota }
    return { type: 'consultar', filtros: { nfNumero: nota, origem: 'ambos' } }
  }

  const remetente = extractRemetente(norm)
  if (remetente) {
    return { type: 'consultar', filtros: { remetente, origem: 'ambos' } }
  }

  const consultQuery = extractConsultQuery(norm, cleaned)
  if (consultQuery) {
    const digits = consultQuery.replace(/\D/g, '')
    if (/^\d+$/.test(consultQuery.replace(/\s/g, '')) && digits.length >= 3) {
      return { type: 'consultar', filtros: { nfNumero: digits, origem: 'ambos' } }
    }
    return { type: 'consultar', filtros: { item: consultQuery, origem: 'ambos' } }
  }

  const wantsOpen =
    /\b(abrir|abre|mostrar|mostra|ver|ve|exibir|exiba|ir para|ir ao|ir na|ir no|acessar|entrar|levar|me leva|me mostra|quero ver|preciso ver|vai pra|vamos pra|onde fica|coloca|joga|passa)\b/.test(
      norm,
    ) || (section != null && !wantsClose)

  if (section && wantsOpen) {
    return { type: 'open_section', section: section.section, label: section.label }
  }

  if (/\b(ultimos|ultimo|ultima)\s+(7|sete)\s+dias\b/.test(norm) || /\bultima semana\b/.test(norm)) {
    return { type: 'painel_periodo', dias: 7, label: 'Últimos 7 dias' }
  }
  if (/\b(ultimos|ultimo|ultima)\s+(30|trinta)\s+dias\b/.test(norm) || /\bultimo mes\b/.test(norm)) {
    return { type: 'painel_periodo', dias: 30, label: 'Último mês' }
  }
  if (/\bhoje\b/.test(norm) && (/\bpainel\b/.test(norm) || /\banalytics?\b/.test(norm))) {
    return { type: 'painel_periodo', dias: 0, label: 'Hoje' }
  }

  if (
    /\b(limpar|zerar|apagar)\s+(consulta|filtros?|pesquisa|busca)\b/.test(norm) &&
    !/\b(nota|estoque|dados|tudo|sistema)\b/.test(norm)
  ) {
    return { type: 'limpar_consulta' }
  }

  if (/\b(alternar|trocar|mudar)\s+tema\b/.test(norm)) {
    return { type: 'toggle_theme', theme: 'auto', label: 'Alternar tema' }
  }
  if (/\b(tema|modo)\s+(escuro|dark)\b/.test(norm)) {
    return { type: 'toggle_theme', theme: 'dark', label: 'Tema escuro' }
  }
  if (/\b(tema|modo)\s+(claro|light)\b/.test(norm)) {
    return { type: 'toggle_theme', theme: 'light', label: 'Tema claro' }
  }

  if (/\b(voltar|ir)\s+(ao|para o)\s+mapa\b/.test(norm) || /\bmostrar mapa\b/.test(norm)) {
    return { type: 'sidebar_mode', mode: 'open', label: 'Voltar ao mapa' }
  }
  if (/\b(menu|sidebar|barra lateral)\s+(tela cheia|cheio|fullscreen)\b/.test(norm)) {
    return { type: 'sidebar_mode', mode: 'fullscreen', label: 'Menu tela cheia' }
  }
  if (/\b(menu|sidebar)\s+(aberto|lateral|expandido)\b/.test(norm) || norm === 'abrir menu') {
    return { type: 'sidebar_mode', mode: 'open', label: 'Menu aberto' }
  }
  if (/\b(menu|sidebar)\s+(recolhido|fechado|minimo|compacto)\b/.test(norm)) {
    return { type: 'sidebar_mode', mode: 'collapsed', label: 'Menu recolhido' }
  }

  if (
    /\b(confirme|confirmar|confirmado|pode confirmar|salvar movimentac|aplicar movimentac)\b/.test(
      norm,
    )
  ) {
    return { type: 'confirmar_movimentacao' }
  }

  if (/^(parar|pare|desligar|silencio|encerrar assistente)$/.test(norm)) {
    return { type: 'parar' }
  }

  const endereco = parseEnderecoFalado(norm)
  if (endereco) {
    return { type: 'endereco', addressId: endereco }
  }

  return null
}
