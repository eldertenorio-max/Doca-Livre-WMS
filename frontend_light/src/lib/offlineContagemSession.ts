export const OFFLINE_CONTAGEM_STORAGE_KEY = 'contagem-offline-session-v1'
export const OFFLINE_INVENTARIO_STORAGE_KEY = 'inventario-offline-session-v1'

export type OfflineSessionMode = 'contagem' | 'inventario'

export type OfflineChecklistItem = {
  /** Chave estável na sessão */
  key: string
  codigo_interno: string
  descricao: string
  /** Texto do usuário; vazio = pendente */
  quantidade_contada: string
  /**
   * Contagem diária: quantidade alterada localmente nesta sessão.
   * Enquanto true, o merge com banco não sobrescreve a linha.
   */
  quantidade_local_dirty?: boolean
  /** Foto anexada pelo usuário (base64). */
  foto_base64?: string
  /** Campo UP do formulário (texto para edição; vazio = sem valor). */
  up_quantidade?: string
  lote?: string
  observacao?: string
  /** YYYY-MM-DD ou vazio */
  data_fabricacao?: string
  data_validade?: string
  unidade_medida?: string | null
  ean?: string | null
  dun?: string | null
  /** No inventário: 1ª, 2ª e 3ª linha do mesmo produto (três contagens). */
  inventario_repeticao?: 1 | 2 | 3
  /**
   * Modo planilha em branco: grupo da aba (1–8) sem depender do mapa de códigos do armazém.
   * Quando preenchido, o item entra na aba correspondente mesmo com código vazio.
   */
  /**
   * Contagem diária: nome do conferente da última linha em `contagens_estoque` para este código no dia
   * (entre todos os conferentes; preenchido ao carregar/atualizar do banco).
   */
  contagem_banco_ultimo_conferente_nome?: string
  /** 1–8: aba (CAMARA/RUA — ver INVENTARIO_ARMAZEM_ABA_TITULOS no frontend). */
  armazem_grupo?: number
  /**
   * Modo planilha em branco: ordem fixa da linha na aba (0…N), para POS/NIVEL não mudarem ao digitar o código.
   */
  planilha_ordem_na_aba?: number
}

/**
 * `planilha` = legado (equivale a planilha-1).
 * `planilha-1` / `planilha-2` = inventário em branco na ordem CAMARA/RUA, cada um com rodada própria no banco.
 */
export type ChecklistListMode = 'todos' | 'armazem' | 'planilha' | 'planilha-1' | 'planilha-2'

export function normalizeChecklistListMode(m: ChecklistListMode | undefined | null): ChecklistListMode {
  if (m === 'planilha') return 'planilha-1'
  return m ?? 'todos'
}

export function isPlanilhaListMode(m: ChecklistListMode | undefined | null): boolean {
  const n = normalizeChecklistListMode(m)
  return n === 'planilha-1' || n === 'planilha-2'
}

/** Rodada gravada em `inventario_numero_contagem` conforme o tipo de lista planilha escolhido. */
export function inventarioRodadaFromListMode(m: ChecklistListMode | undefined | null): 1 | 2 | 3 | 4 {
  if (normalizeChecklistListMode(m) === 'planilha-2') return 2
  return 1
}

export function isListModeArmazem(m: ChecklistListMode | undefined | null): boolean {
  return m === 'armazem' || isPlanilhaListMode(m)
}

export type OfflineSession = {
  sessionId: string
  data_contagem_ymd: string
  conferente_id: string
  status: 'aberta' | 'finalizada'
  /** Início real da sessão: momento em que o usuário clica em "Carregar lista". */
  started_at_iso?: string
  /** Fim real da sessão: momento da finalização (preenchido no fechamento). */
  ended_at_iso?: string
  /** Como a lista foi carregada (ordem do cadastro vs ordem dividida por contagem). */
  listMode?: ChecklistListMode
  items: OfflineChecklistItem[]
  updatedAt: string
  /** Fluxo que criou a sessão (persistência em chave separada). */
  context?: OfflineSessionMode
  /**
   * Inventário: rodada da contagem (1ª–4ª), igual em todas as abas CAMARA/RUA.
   * Gravado em `contagens_estoque.inventario_numero_contagem` ao finalizar.
   */
  inventario_numero_contagem?: 1 | 2 | 3 | 4
  /**
   * Contagem diária: UUID reutilizado em `finalizacao_sessao_id` nas linhas de rascunho no Supabase
   * (sincronização em tempo real); removidas ao finalizar.
   */
  contagem_diaria_rascunho_sessao_id?: string
  /** Posição na UI (aba, página, RUA/POS) para retomar ao trocar de tela no painel. */
  ui?: OfflineSessionUiState
}

export type OfflineSessionUiAbaState = {
  planilhaTabelaPage?: number
  inventarioPlanilhaRua?: string
  inventarioPlanilhaPos?: number
  inventarioPlanilhaNivel?: number
  inventarioPlanilhaRepeticao?: 1 | 2 | 3
}

export type OfflineSessionUiState = {
  checklistPage?: number
  planilhaTabelaPage?: number
  inventarioPlanilhaRua?: string
  inventarioPlanilhaPos?: number
  inventarioPlanilhaNivel?: number
  inventarioPlanilhaRepeticao?: 1 | 2 | 3
  checklistShowAll?: boolean
  /** Posição na planilha por aba/grupo (1–8) — retoma RUA/POS ao voltar na CAMARA. */
  porGrupo?: Record<string, OfflineSessionUiAbaState>
}

export function grupoUiKey(grupo: number): string {
  return String(Math.floor(grupo))
}

/** Linha com alteração local ainda não finalizada — não sobrescrever no merge com o banco. */
export function itemTemTrabalhoLocal(
  item: OfflineChecklistItem,
  opts?: { planilha?: boolean },
): boolean {
  if (item.quantidade_local_dirty) return true
  if (opts?.planilha) {
    /** Só trava merge quando o produto já foi identificado localmente. */
    if (String(item.codigo_interno ?? '').trim() !== '') return true
    return false
  }
  if (String(item.quantidade_contada ?? '').trim() !== '') return true
  return false
}


export function stableItemKey(codigo: string, descricao: string, index: number) {
  return `${index}:${codigo.trim().toLowerCase()}:${descricao.trim().toLowerCase()}`
}

function storageKey(mode: OfflineSessionMode) {
  return mode === 'inventario' ? OFFLINE_INVENTARIO_STORAGE_KEY : OFFLINE_CONTAGEM_STORAGE_KEY
}

export function loadOfflineSession(mode: OfflineSessionMode = 'contagem'): OfflineSession | null {
  try {
    const raw = localStorage.getItem(storageKey(mode))
    if (!raw) return null
    const s = JSON.parse(raw) as OfflineSession
    if (!s || !Array.isArray(s.items)) return null
    if (s.status !== 'aberta' && s.status !== 'finalizada') return null
    return s
  } catch {
    return null
  }
}

export function saveOfflineSession(s: OfflineSession, mode: OfflineSessionMode = 'contagem') {
  const stored = loadOfflineSession(mode)
  const mesmaSessao =
    stored != null && stored.sessionId === s.sessionId && stored.status === s.status
  let ui = s.ui
  if (mesmaSessao && (stored?.ui || s.ui)) {
    const porGrupo = {
      ...(stored?.ui?.porGrupo ?? {}),
      ...(s.ui?.porGrupo ?? {}),
    }
    ui = {
      ...(stored?.ui ?? {}),
      ...(s.ui ?? {}),
      ...(Object.keys(porGrupo).length > 0 ? { porGrupo } : {}),
    }
  }
  const next = {
    ...s,
    updatedAt: new Date().toISOString(),
    context: mode,
    ...(ui !== undefined ? { ui } : {}),
  }
  localStorage.setItem(storageKey(mode), JSON.stringify(next))
}

export function clearOfflineSession(mode: OfflineSessionMode = 'contagem') {
  localStorage.removeItem(storageKey(mode))
}

export function countPendingItems(items: OfflineChecklistItem[]) {
  return items.filter((i) => String(i.quantidade_contada ?? '').trim() === '').length
}
