import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { AppSidebar } from './components/AppSidebar'
import { AppTopBar } from './components/AppTopBar'
import { PwaInstallBanner } from './components/PwaInstallBanner'
import { AmbienteBanner } from './components/AmbienteBanner'
import { VoiceAssistantHUD } from './components/VoiceAssistantHUD'
import type { SidebarSectionId } from './components/CollapsibleSidebarSection'
import { DetailModal } from './components/DetailModal'
import { ManualNfModal, type ManualNfModalResult } from './components/ManualNfModal'
import CompanySplash from './components/CompanySplash'
import SystemSelectorScreen from './pages/SystemSelectorScreen'
import SystemEntryScreen from './pages/SystemEntryScreen'
import PortalLoginScreen from './pages/PortalLoginScreen'
import PortalConfigScreen from './pages/PortalConfigScreen'
import { PortalLoadingOverlay } from './components/PortalLoadingOverlay'
import { getSystemById, type SystemId } from './lib/systemPortal'
import {
  clearPortalConfigSeen,
  fetchPortalMe,
  hasPortalConfigSeen,
  isLocalSuperUser,
  markPortalConfigSeen,
} from './lib/portalConfigApi'
import {
  clearPortalSsoTokenFromUrl,
  readPortalSsoTokenFromLocation,
  verifyPortalSsoToken,
} from './lib/portalSso'
import {
  clearPortalEntryMarker,
  goToPublicPortal,
  hasPortalEntryMarker,
  markPortalEntry,
} from './lib/portalGate'
import {
  clearHubSession,
  issueSystemSsoUrl,
  loadHubSession,
} from './lib/portalApi'
import {
  canEditSection,
  canOpenSection,
  clearPlusModulosSession,
  guardMutations,
  loadPlusModulosSession,
  normalizePlusModulos,
  savePlusModulosSession,
  type PlusModulosMap,
} from './lib/portalModuleAccess'
import { LayoutPanel } from './components/LayoutPanel'
import { StageModal } from './components/StageModal'
import { EntradaDestinoModal } from './components/EntradaDestinoModal'
import { EscolhaEstoqueModal } from './components/EscolhaEstoqueModal'
import { PrintLayoutDocument } from './components/PrintLayoutDocument'
import { CAMARAS } from './layout/camaras'
import { listarItensStage, itemNoStage } from './layout/stage'
import { EntradaPendenteAlert } from './components/EntradaPendenteAlert'
import { MovimentacaoPendenteAlert } from './components/MovimentacaoPendenteAlert'
import { OcupadoAlert } from './components/OcupadoAlert'
import { PaletesLimiteAlert } from './components/PaletesLimiteAlert'
import { BuscaEncontradaToast } from './components/BuscaEncontradaToast'
import { useEnderecamentoStore } from './hooks/useEnderecamentoStore'
import { useFinanceiro } from './hooks/useFinanceiro'
import { useTheme } from './hooks/useTheme'
import { useSidebarMode } from './hooks/useSidebarMode'
import { useVoiceAssistant } from './hooks/useVoiceAssistant'
import { allItemsAllocated } from './lib/repository'
import { adicionarNotaManual } from './lib/manualNf'
import { desmembrarNfeItem, patchNfeItemQuantidade } from './lib/desmembrarItem'
import {
  parsePaletesInput,
  paletesLimiteItem,
  podeAdicionarEndereco,
} from './lib/paletes'
import { excluirItemNotaFiscal, sanitizarNotasEntrada } from './lib/excluirItemNf'
import {
  adicionarItemManualNotaFiscal,
  replicarItemNotaFiscal,
  validarItemManualInput,
  type ItemManualInput,
} from './lib/adicionarItemNf'
import { contarItensSemEndereco, nfEntradaIncompleta, proximoItemEntradaPendente } from './lib/entradaPendente'
import {
  clearEntradaDestinoPendente,
  loadEntradaDestinoPendente,
  saveEntradaDestinoPendente,
} from './lib/entradaDestinoSession'
import { mesclarEmitentesSugeridos } from './lib/emitentesRegistry'
import {
  aplicarSaidaPaletes,
  calcularSaidaPalete,
  distribuirCaixasSaidaEntrePaletes,
  enderecosALiberar,
  paletesDisponiveisItem,
  parseQuantidadeSaida,
  proximoItemSaidaPendente,
  sobraItem,
  type SaidaPaleteDraft,
} from './lib/saidaParcial'
import {
  buscarNfPorNumero,
  criarMovimentoMovimentacao,
  criarMovimentoSaida,
  enderecosAlterados,
  enderecosDaNf,
  nfTemEnderecosValidos,
  nfTemHistoricoEnderecos,
  removerNfDoEstoque,
  removerMovimentoEntradaAtivo,
  upsertMovimentoEntrada,
} from './lib/movimentos'
import {
  desvincularNotaCancelada,
  excluirNotaCancelada,
  notaFiscalToCancelada,
  syncVinculosNotas,
  vincularNotaCancelada,
} from './lib/nfCanceladas'
import { buscarEstoque, temFiltroConsulta, alternarDestaqueConsulta, resultadosEstaoDestacados, CONSULTA_FILTROS_VAZIOS, type ConsultaEstoqueFiltros, type ConsultaEstoqueResultado } from './lib/consultaEstoque'
import {
  avisoConsultaEncontrada,
  avisoNfEncontrada,
  primeiroEnderecoConsulta,
  primeiroEnderecoIds,
  primeiroEnderecoNf,
  type BuscaEncontradaAviso,
  type MapFocusTarget,
} from './lib/focarMapaBusca'
import {
  describeVoiceCommand,
  painelFiltrosPorDias,
  type VoiceCommand,
} from './lib/parseVoiceCommand'
import { resolveVoiceCommandAsync, resolveVoiceCommandSync, resolveVoiceTurnAsync } from './lib/voiceAiInterpret'
import { commandIsExecutable, enrichCommandReply } from './lib/voiceCommandReply'
import { prepareVoiceCommandText } from './lib/voiceNormalize'
import { resetWmsGeminiHistory } from './lib/wmsGeminiAgent'
import {
  createConversationState,
  processConversationTurn,
  VOICE_CONVERSATION_GREETING,
} from './lib/voiceConversation'
import { speakText, stopSpeaking } from './lib/voiceSpeech'
import { getStoredVoicePrefs, storeVoicePrefs, type VoicePrefs } from './lib/voicePrefs'
import {
  clearSaidaDestinoPendenteId,
  loadSaidaDestinoPendenteId,
  saveSaidaDestinoPendenteId,
} from './lib/saidaDestinoSession'
import { loadUiSession, saveUiSession } from './lib/uiSession'
import type { IaChatLine } from './components/IaDocaLivrePanel'
import { hasRegisteredVoices } from './lib/voiceProfile'
import {
  CONTA_SISTEMA_ID,
  getUsuarioAtivoId,
  listarUsuariosSessao,
  registrarAcessoUsuario,
  setUsuarioAtivoId,
  type ContaUsuario,
} from './lib/contaSessao'
import { useVoiceRegistry } from './hooks/useVoiceRegistry'
import { findNotaByNumero, mensagemNfCanceladaDuplicada, mensagemNfDuplicada, normNumero } from './lib/nfDuplicate'
import { repararNfDuplicadaDoXml, tentarRepararPersistido } from './lib/repararNfEstoque'
import { parseCanceladaXml } from './lib/parseCanceladaXml'
import { tituloApp } from './lib/appAmbiente'
import { parseNfeReferenciaChaves, parseNfeXml } from './lib/parseNfeXml'
import { parseEnderecoFalado, validarEnderecoDestinoVoz } from './lib/parseEnderecoFalado'
import { splitMovimentacaoVozTranscript } from './lib/movimentacaoVoz'
import {
  documentoSaidaFromNota,
  notasDisponiveisParaSaida,
  resolverReferenciasSaida,
  saidaXmlCorrespondeNf,
  sugerirOrigemSaida,
  origemEstoqueParaSaidaXml,
  vincularSaidaXmlOrigem,
} from './lib/saidaXml'
import {
  aplicarLocalizacaoItem,
  aplicarLocalizacaoNf,
  aplicarSaidaStage,
  adicionarPosicoesItemArmazem,
  itensStageDaNf,
  moverEnderecosParaStage,
  moverItemStageParaArmazem,
  nfTemEstoqueArmazem,
  nfTemEstoqueStage,
  snapshotSaidaStage,
} from './lib/stageEstoque'
import { itemMovimentavel, proximoItemMovimentavel } from './lib/movimentacaoItens'
import type { ModoMovimentacao } from './components/EditarPosicaoPanel'
import type { EntradaItemCampos } from './lib/entradaCampos'
import { quantidadeEstoqueItem } from './lib/nfeUnidades'
import { normalizarDataArmazenagemInput } from './lib/dataArmazenagem'
import type { SaidaItemDraft } from './lib/saidaParcial'
import type { AddressId, AddressOccupancy, AppState, JustificativaSaidaId, LocalizacaoEstoque, MotivoRemocaoEstoqueId, MovimentoRegistro, NotaFiscal, SaidaXmlDocumento } from './types'
import {
  defaultPainelFiltros,
  type PainelFiltros,
} from './lib/painelAnalytics'
import type { SaidaModoBusca, SaidaOrigemEstoque } from './components/SaidaPanel'
import './App.css'
import './doca-theme.css'

function buildOccupancyMap(notas: NotaFiscal[]): Map<AddressId, AddressOccupancy> {
  const map = new Map<AddressId, AddressOccupancy>()
  for (const nf of notas) {
    for (const item of nf.items) {
      for (const addr of item.allocatedAddresses) {
        map.set(addr, {
          nfId: nf.id,
          nfNumero: nf.numero,
          itemIndex: item.index,
          codigo: item.codigo,
          descricao: item.descricao,
          quantidade: item.quantidade,
          unidade: item.unidade,
        })
      }
    }
  }
  return map
}

function mensagemNfSemEstoqueVisivel(nf: NotaFiscal, movimentos: MovimentoRegistro[]): string {
  const tinhaEnderecosInvalidos = nf.items.some(
    (it) => it.allocatedAddresses.length > 0 && !nfTemEnderecosValidos({ ...nf, items: [it] }),
  )
  if (nfTemHistoricoEnderecos(nf, movimentos)) {
  return (
      `NF ${nf.numero} existe no sistema, mas os endereços sumiram do mapa. ` +
      'Recarregue a página (F5) ou suba o XML de novo na Entrada para restaurar.'
    )
  }
  if (tinhaEnderecosInvalidos) {
    return (
      `NF ${nf.numero} está cadastrada com posições inválidas no mapa. ` +
      'Suba o XML na aba Entrada para corrigir.'
    )
  }
  if (nf.items.length === 0) {
    return (
      `NF ${nf.numero} está cadastrada, mas sem itens. ` +
      'Suba o XML na aba Entrada — o sistema atualiza automaticamente.'
    )
  }
  return (
    `NF ${nf.numero} está cadastrada, mas sem posições no armazém. ` +
    'Suba o XML na Entrada para atualizar ou enderece no mapa.'
  )
}

const PAINEL_FILTROS_KEY = 'ultrafrio-painel-filtros'

function loadPainelFiltros(): PainelFiltros {
  try {
    const raw = localStorage.getItem(PAINEL_FILTROS_KEY)
    if (raw) return { ...defaultPainelFiltros(), ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaultPainelFiltros()
}

function savePainelFiltros(filtros: PainelFiltros) {
  try {
    localStorage.setItem(PAINEL_FILTROS_KEY, JSON.stringify(filtros))
  } catch {
    /* ignore */
  }
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function App() {
  const {
    state,
    setState,
    saveNow,
    registrarEmitente,
    loading,
    savingImportante,
    error,
    clearError,
    zerarBancoHomologacao,
  } = useEnderecamentoStore()
  const financeiro = useFinanceiro(state.notas)
  const { theme, toggleTheme, setTheme } = useTheme()
  const { sidebarMode, setSidebarMode } = useSidebarMode()
  const initialQuerySecao = (() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('secao')?.trim() || ''
      const valid: SidebarSectionId[] = [
        'entrada',
        'saida',
        'editar',
        'consulta',
        'historico',
        'relatorio',
        'painel',
        'canceladas',
        'imprimir',
        'cadastroVoz',
        'financeiro',
        'agendamentosHub',
      ]
      return valid.includes(raw as SidebarSectionId) ? (raw as SidebarSectionId) : null
    } catch {
      return null
    }
  })()
  const initialIsConfigRoute = (() => {
    try {
      const p = new URLSearchParams(window.location.search)
      return p.get('secao') === 'config' || p.get('config') === '1'
    } catch {
      return false
    }
  })()
  const [openSection, setOpenSection] = useState<SidebarSectionId | null>(
    () => initialQuerySecao ?? loadUiSession().openSection,
  )
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(() => getStoredVoicePrefs())
  const {
    registry: voiceRegistry,
    setRegistry: setVoiceRegistry,
    syncError: voiceSyncError,
    refresh: refreshVoiceRegistry,
  } = useVoiceRegistry()
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null)
  const [contaUsuarios, setContaUsuarios] = useState<ContaUsuario[]>(() => listarUsuariosSessao())
  const [contaUsuarioAtivoId, setContaUsuarioAtivoId] = useState(() => getUsuarioAtivoId())
  const [conversationLines, setConversationLines] = useState<
    { role: 'user' | 'assistant'; text: string }[]
  >([])
  const [iaMessages, setIaMessages] = useState<IaChatLine[]>([])
  const [iaSending, setIaSending] = useState(false)
  const conversationStateRef = useRef(createConversationState())
  const openSectionRef = useRef<SidebarSectionId | null>(null)
  const initialSsoToken = typeof window !== 'undefined' ? readPortalSsoTokenFromLocation() : null
  const initialHub = typeof window !== 'undefined' ? loadHubSession() : null
  const enteredViaSso = Boolean(initialSsoToken)
  const forceSystemsHub = false
  const [portalUsuario, setPortalUsuario] = useState(() => initialHub?.usuario || 'Operador')
  const [isSuperUser, setIsSuperUser] = useState(() => {
    const w =
      typeof window !== 'undefined'
        ? (window as unknown as { __WMS_UNIFIED__?: { isSuperuser?: boolean } }).__WMS_UNIFIED__
        : undefined
    return Boolean(w?.isSuperuser) || isLocalSuperUser(initialHub?.usuario || '')
  })
  const [showPortalConfig, setShowPortalConfig] = useState(() => initialIsConfigRoute)
  const [allowedSystemIds, setAllowedSystemIds] = useState<SystemId[] | null>(null)
  const [plusModulos, setPlusModulos] = useState<PlusModulosMap>(() => {
    const cached = loadPlusModulosSession()
    return cached === undefined ? null : cached
  })
  const [viewOnlyToast, setViewOnlyToast] = useState<string | null>(null)
  const [companyIntroDone, setCompanyIntroDone] = useState(true)
  const [hubReady, setHubReady] = useState(true)
  const [selectedSystemId, setSelectedSystemId] = useState<SystemId | null>(() =>
    initialIsConfigRoute ? null : 'plus',
  )
  const [ssoBootstrapping, setSsoBootstrapping] = useState(() => enteredViaSso)
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [hubErro, setHubErro] = useState<string | null>(null)
  const [hubBusy, setHubBusy] = useState(false)
  const [hubBusyLabel, setHubBusyLabel] = useState<string | null>(null)
  const [pendingSelection, setPendingSelection] = useState<Set<AddressId>>(new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [detailAddress, setDetailAddress] = useState<AddressId | null>(null)

  const [nfBuscaSaidaId, setNfBuscaSaidaId] = useState<string | null>(null)
  const [saidaItemIndex, setSaidaItemIndex] = useState<number | null>(null)
  const [saidaModoPalete, setSaidaModoPalete] = useState(false)
  const [saidaQtdPaletesInput, setSaidaQtdPaletesInput] = useState('')
  const [saidaQtdPaletesAlvo, setSaidaQtdPaletesAlvo] = useState<number | null>(null)
  const [saidaPaletesSelecionados, setSaidaPaletesSelecionados] = useState<Set<AddressId>>(new Set())
  const [saidaPaletesNaFila, setSaidaPaletesNaFila] = useState<AddressId[]>([])
  const [saidaSelecaoConcluida, setSaidaSelecaoConcluida] = useState(false)
  const [saidaPaleteAtivo, setSaidaPaleteAtivo] = useState<AddressId | null>(null)
  const [saidaCaixasPalete, setSaidaCaixasPalete] = useState('')
  const [saidaPaletesConfirmados, setSaidaPaletesConfirmados] = useState<SaidaPaleteDraft[]>([])
  const [saidaSelecaoErro, setSaidaSelecaoErro] = useState<string | null>(null)
  const [saidaModoBusca, setSaidaModoBusca] = useState<SaidaModoBusca>('numero')
  const [saidaXmlDoc, setSaidaXmlDoc] = useState<SaidaXmlDocumento | null>(null)
  const [saidaRefChaves, setSaidaRefChaves] = useState<string[]>([])
  const [saidaOrigemSelecionadaId, setSaidaOrigemSelecionadaId] = useState('')
  const [saidaUploadXmlErro, setSaidaUploadXmlErro] = useState<string | null>(null)
  const [buscaErro, setBuscaErro] = useState<string | null>(null)
  const [nfEditarId, setNfEditarId] = useState<string | null>(null)
  const [editItemIndex, setEditItemIndex] = useState<number | null>(null)
  const [editPendingSelection, setEditPendingSelection] = useState<Set<AddressId>>(new Set())
  const [editMoveOrigens, setEditMoveOrigens] = useState<Set<AddressId>>(new Set())
  const [editMoveDestinos, setEditMoveDestinos] = useState<Set<AddressId>>(new Set())
  const [editSalvando, setEditSalvando] = useState(false)
  const [editModoMovimentacao, setEditModoMovimentacao] = useState<ModoMovimentacao>('reposicionar')
  const editMarcandoStage = editModoMovimentacao === 'enviar-stage'
  const editTirandoDoStage = editModoMovimentacao === 'tirar-stage'
  const [vozOrigemAddress, setVozOrigemAddress] = useState<AddressId | null>(null)
  const [vozErro, setVozErro] = useState<string | null>(null)
  const [buscaEditarErro, setBuscaEditarErro] = useState<string | null>(null)
  const [consultaResultados, setConsultaResultados] = useState<ConsultaEstoqueResultado[]>([])
  const [consultaErro, setConsultaErro] = useState<string | null>(null)
  const [consultaFiltros, setConsultaFiltros] = useState<ConsultaEstoqueFiltros>(CONSULTA_FILTROS_VAZIOS)
  const [consultaFiltrosTick, setConsultaFiltrosTick] = useState(0)
  const [consultaNfAdicionarId, setConsultaNfAdicionarId] = useState<string | null>(null)
  const [consultaNfAdicionarErro, setConsultaNfAdicionarErro] = useState<string | null>(null)
  const [consultaItemAdicionadoMsg, setConsultaItemAdicionadoMsg] = useState<string | null>(null)
  const [consultaItemManualErro, setConsultaItemManualErro] = useState<string | null>(null)
  const [consultaAguardandoEndereco, setConsultaAguardandoEndereco] = useState(false)
  const [uploadCanceladaError, setUploadCanceladaError] = useState<string | null>(null)
  const [canceladaPendenteId, setCanceladaPendenteId] = useState<string | null>(null)
  const [printCamaras, setPrintCamaras] = useState<number[]>(() => CAMARAS.map((c) => c.id))
  const [printWithOccupancy, setPrintWithOccupancy] = useState(false)
  const [printOrientacao, setPrintOrientacao] = useState<'landscape' | 'portrait'>('landscape')
  const [ocupadoAlert, setOcupadoAlert] = useState<{
    addressId: AddressId
    occ: AddressOccupancy
  } | null>(null)
  const [paletesLimiteAlert, setPaletesLimiteAlert] = useState<
    'sem_paletes' | 'maximo' | 'incompleto' | 'posicoes_adicionar' | null
  >(null)
  const [entradaPendenteAlert, setEntradaPendenteAlert] = useState<{
    nfNumero: string
    itensPendentes: number
    onConfirmLeave?: () => void
  } | null>(null)
  const [movimentacaoPendenteAlert, setMovimentacaoPendenteAlert] = useState<{
    nfNumero: string
    onConfirmLeave: () => void
  } | null>(null)
  const entradaPendenteDismissedRef = useRef<string | null>(null)
  const editOriginalAddressesRef = useRef<Set<AddressId>>(new Set())
  const editMoveOrigensRef = useRef<Set<AddressId>>(new Set())
  const editMoveDestinosRef = useRef<Set<AddressId>>(new Set())
  const [manualNfModalOpen, setManualNfModalOpen] = useState(false)
  const [manualNfError, setManualNfError] = useState<string | null>(null)
  const [manualNfNumeroInicial, setManualNfNumeroInicial] = useState('')
  const hubEntradaPendenteRef = useRef<{ id: number; nfNumero: string | null } | null>(null)
  const [selectedEntradaIds, setSelectedEntradaIds] = useState<string[]>([])
  const lastEntradaClickRef = useRef<string | null>(null)
  const stateRef = useRef(state)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [entradaDestinoPendente, setEntradaDestinoPendente] = useState<{
    imported: NotaFiscal[]
    movimentos: MovimentoRegistro[]
  } | null>(null)
  const [editStagePending, setEditStagePending] = useState<Set<AddressId>>(new Set())
  const [editAdicionarPosicoesAlvo, setEditAdicionarPosicoesAlvo] = useState<number | null>(null)
  const [editNovasPosicoes, setEditNovasPosicoes] = useState<Set<AddressId>>(new Set())
  const [saidaOrigemEstoque, setSaidaOrigemEstoque] = useState<SaidaOrigemEstoque>('armazem')
  const [saidaDestinoPendente, setSaidaDestinoPendente] = useState<NotaFiscal | null>(null)
  const [saidaStageItemIndex, setSaidaStageItemIndex] = useState<number | null>(null)
  const [saidaStageQtdInput, setSaidaStageQtdInput] = useState('')
  const [saidaStageConfirmados, setSaidaStageConfirmados] = useState<SaidaItemDraft[]>([])
  const [saidaDataInput, setSaidaDataInput] = useState(todayInputValue)
  const [painelFiltros, setPainelFiltros] = useState<PainelFiltros>(() => loadPainelFiltros())
  const [mapFocusAddressId, setMapFocusAddressId] = useState<AddressId | null>(null)
  const [mapFocusStage, setMapFocusStage] = useState(false)
  const [mapFocusScrollToken, setMapFocusScrollToken] = useState(0)
  const [mapPulseAddressId, setMapPulseAddressId] = useState<AddressId | null>(null)
  const [buscaEncontrada, setBuscaEncontrada] = useState<BuscaEncontradaAviso | null>(null)
  const [zerandoBancoHomolog, setZerandoBancoHomolog] = useState(false)

  const handleZerarBancoHomolog = useCallback(async () => {
    setZerandoBancoHomolog(true)
    try {
      await zerarBancoHomologacao()
      window.location.reload()
    } catch {
      /* erro exibido na barra */
    } finally {
      setZerandoBancoHomolog(false)
    }
  }, [zerarBancoHomologacao])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    document.title = tituloApp()
  }, [])

  const reparoInicialFeitoRef = useRef(false)
  useEffect(() => {
    if (loading || reparoInicialFeitoRef.current) return
    reparoInicialFeitoRef.current = true
    const atual = stateRef.current
    const { data, reparado } = tentarRepararPersistido({
      notas: atual.notas,
      movimentos: atual.movimentos,
      notasCanceladas: atual.notasCanceladas,
      emitentes: atual.emitentes,
    })
    if (!reparado) return
    void saveNow({ ...atual, ...data }, { indicar: false })
  }, [loading, saveNow])

  useEffect(() => {
    openSectionRef.current = openSection
  }, [openSection])

  useEffect(() => {
    if (loading) return
    saveUiSession({
      openSection,
      activeNfId: state.activeNfId,
      activeItemIndex: state.activeItemIndex,
      nfEditarId,
      nfBuscaSaidaId,
      saidaOrigemEstoque: nfBuscaSaidaId ? saidaOrigemEstoque : null,
      consultaNfAdicionarId,
      consultaAguardandoEndereco,
      canceladaPendenteId,
    })
  }, [
    loading,
    openSection,
    state.activeNfId,
    state.activeItemIndex,
    nfEditarId,
    nfBuscaSaidaId,
    saidaOrigemEstoque,
    consultaNfAdicionarId,
    consultaAguardandoEndereco,
    canceladaPendenteId,
  ])

  const abasRestauradasRef = useRef(false)
  useEffect(() => {
    if (loading || abasRestauradasRef.current) return
    abasRestauradasRef.current = true

    if (initialQuerySecao === 'painel') {
      setSidebarMode('fullscreen')
    } else if (initialQuerySecao != null) {
      setSidebarMode('open')
    }

    const pendingEntrada = loadEntradaDestinoPendente()
    if (pendingEntrada && (initialQuerySecao == null || initialQuerySecao === 'entrada')) {
      setEntradaDestinoPendente(pendingEntrada)
      setOpenSection('entrada')
      return
    }

    const ui = loadUiSession()
    if (ui.nfEditarId && stateRef.current.notas.some((n) => n.id === ui.nfEditarId)) {
      setNfEditarId(ui.nfEditarId)
    }
    if (ui.nfBuscaSaidaId && stateRef.current.notas.some((n) => n.id === ui.nfBuscaSaidaId)) {
      setNfBuscaSaidaId(ui.nfBuscaSaidaId)
      if (ui.saidaOrigemEstoque) setSaidaOrigemEstoque(ui.saidaOrigemEstoque)
    }
    if (
      ui.consultaNfAdicionarId &&
      stateRef.current.notas.some((n) => n.id === ui.consultaNfAdicionarId)
    ) {
      setConsultaNfAdicionarId(ui.consultaNfAdicionarId)
    }
    if (ui.consultaAguardandoEndereco) setConsultaAguardandoEndereco(true)
    if (
      ui.canceladaPendenteId &&
      stateRef.current.notasCanceladas.some((c) => c.id === ui.canceladaPendenteId)
    ) {
      setCanceladaPendenteId(ui.canceladaPendenteId)
    }

    const saidaPendenteId = loadSaidaDestinoPendenteId()
    if (saidaPendenteId) {
      const nf = stateRef.current.notas.find((n) => n.id === saidaPendenteId)
      if (nf && nfTemEstoqueArmazem(nf) && nfTemEstoqueStage(nf)) {
        setSaidaDestinoPendente(nf)
        setOpenSection('saida')
      } else {
        clearSaidaDestinoPendenteId()
      }
    }
  }, [loading])

  useEffect(() => {
    editMoveOrigensRef.current = editMoveOrigens
  }, [editMoveOrigens])

  useEffect(() => {
    editMoveDestinosRef.current = editMoveDestinos
  }, [editMoveDestinos])

  useEffect(() => {
    storeVoicePrefs(voicePrefs)
  }, [voicePrefs])

  const focarMapaDestaque = useCallback(
    (target: MapFocusTarget | null) => {
      if (!target) return
      if (sidebarMode === 'fullscreen') setSidebarMode('open')

      setMapFocusScrollToken((t) => t + 1)
      if (target.type === 'address') {
        setMapFocusAddressId(target.addressId)
        setMapFocusStage(false)
        setMapPulseAddressId(target.addressId)
      } else {
        setMapFocusAddressId(null)
        setMapFocusStage(true)
        setMapPulseAddressId(null)
      }
    },
    [sidebarMode, setSidebarMode],
  )

  const focarMapaBuscaEncontrado = useCallback(
    (target: MapFocusTarget | null, aviso: BuscaEncontradaAviso) => {
      focarMapaDestaque(target)
      setBuscaEncontrada(aviso)
    },
    [focarMapaDestaque],
  )

  useEffect(() => {
    if (!buscaEncontrada) return
    const t = setTimeout(() => setBuscaEncontrada(null), 6000)
    return () => clearTimeout(t)
  }, [buscaEncontrada])

  useEffect(() => {
    if (!mapPulseAddressId && !mapFocusStage) return
    const t = setTimeout(() => {
      setMapPulseAddressId(null)
      setMapFocusStage(false)
      setMapFocusAddressId(null)
    }, 3500)
    return () => clearTimeout(t)
  }, [mapPulseAddressId, mapFocusStage, mapFocusScrollToken])

  const mapaDestaquesAtivos =
    openSection === 'entrada' ||
    openSection === 'editar' ||
    openSection === 'saida' ||
    openSection === 'consulta'

  useEffect(() => {
    if (mapaDestaquesAtivos) return
    setMapFocusAddressId(null)
    setMapPulseAddressId(null)
    setMapFocusStage(false)
  }, [mapaDestaquesAtivos])

  const emAndamentoIds = useMemo(
    () => state.notas.filter((n) => n.status === 'em_andamento').map((n) => n.id),
    [state.notas],
  )

  useEffect(() => {
    const valid = new Set(emAndamentoIds)
    setSelectedEntradaIds((prev) => {
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [emAndamentoIds])

  const occupancy = useMemo(() => buildOccupancyMap(state.notas), [state.notas])
  const [printJobId, setPrintJobId] = useState(0)

  const schedulePrint = useCallback(
    (withOccupancy: boolean, orientacao: 'landscape' | 'portrait') => {
      setPrintWithOccupancy(withOccupancy)
      setPrintOrientacao(orientacao)
      setPrintJobId((n) => n + 1)
    },
    [],
  )

  useEffect(() => {
    if (printJobId === 0) return
    const styleId = 'print-page-style'
    let el = document.getElementById(styleId) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = styleId
      document.head.appendChild(el)
    }
    el.textContent = `@page { size: A4 ${printOrientacao}; margin: 5mm; }`
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print()
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [printJobId, printOrientacao, printWithOccupancy])

  const activeNf = state.notas.find((n) => n.id === state.activeNfId) ?? null

  const trySairEntradaIncompleta = useCallback(
    (action: () => void) => {
      if (
        !nfEntradaIncompleta(activeNf) ||
        entradaPendenteDismissedRef.current === activeNf!.id
      ) {
        action()
        return
      }
      setEntradaPendenteAlert({
        nfNumero: activeNf!.numero,
        itensPendentes: contarItensSemEndereco(activeNf!),
        onConfirmLeave: () => {
          entradaPendenteDismissedRef.current = activeNf!.id
          setEntradaPendenteAlert(null)
          action()
        },
      })
    },
    [activeNf],
  )
  const nfBuscaSaida = nfBuscaSaidaId
    ? state.notas.find((n) => n.id === nfBuscaSaidaId) ?? null
    : null
  const notasOrigemSaida = useMemo(() => notasDisponiveisParaSaida(state.notas), [state.notas])
  const saidaVinculo = useMemo(() => {
    if (!nfBuscaSaida || !saidaXmlDoc) return null
    return vincularSaidaXmlOrigem(nfBuscaSaida, saidaXmlDoc, saidaOrigemEstoque)
  }, [nfBuscaSaida, saidaXmlDoc, saidaOrigemEstoque])
  const saidaItensExibicao = useMemo(() => {
    if (!nfBuscaSaida) return []
    if (saidaOrigemEstoque === 'stage') {
      return nfBuscaSaida.items.filter((it) => it.localizacao === 'stage')
    }
    if (saidaVinculo) return saidaVinculo.itensExibicao
    return nfBuscaSaida.items.filter((it) => it.allocatedAddresses.length > 0)
  }, [nfBuscaSaida, saidaVinculo, saidaOrigemEstoque])
  const saidaLimitesPorItem = saidaVinculo?.limitesPorItem
  const saidaVinculoAvisos = saidaVinculo?.avisos ?? []

  useEffect(() => {
    if (!nfBuscaSaida || !saidaXmlDoc || !saidaVinculo) return
    if (saidaVinculo.itensExibicao.length > 0) return
    const alt = origemEstoqueParaSaidaXml(nfBuscaSaida, saidaXmlDoc)
    if (alt && alt !== saidaOrigemEstoque) setSaidaOrigemEstoque(alt)
  }, [nfBuscaSaida, saidaXmlDoc, saidaVinculo, saidaOrigemEstoque])

  const saidaReferencias = useMemo(
    () => resolverReferenciasSaida(state.notas, saidaRefChaves),
    [state.notas, saidaRefChaves],
  )
  const nfEditar = nfEditarId ? state.notas.find((n) => n.id === nfEditarId) ?? null : null

  const activeEntradaItem = useMemo(() => {
    if (!activeNf || activeNf.status !== 'em_andamento' || state.activeItemIndex == null) return null
    return activeNf.items.find((it) => it.index === state.activeItemIndex) ?? null
  }, [activeNf, state.activeItemIndex])

  const allocateMode =
    activeEntradaItem != null && activeEntradaItem.localizacao !== 'stage'

  const nfEmEdicao = nfEditar != null
  const editMode = nfEmEdicao && editItemIndex != null

  const mapaEmOperacaoAtiva =
    editAdicionarPosicoesAlvo != null ||
    allocateMode ||
    consultaAguardandoEndereco ||
    saidaModoPalete ||
    editMode ||
    (nfEmEdicao &&
      (editMarcandoStage ||
        editTirandoDoStage ||
        editMoveOrigens.size > 0 ||
        editMoveDestinos.size > 0 ||
        editStagePending.size > 0))

  const displayOccupancy = useMemo(() => {
    const map = new Map(occupancy)
    if (editMode && nfEditar) {
      for (const addr of editStagePending) map.delete(addr)
      if (!editMarcandoStage) {
        for (const addr of editMoveOrigens) {
          const occ = map.get(addr)
          if (!occ || occ.nfId === nfEditar.id) map.delete(addr)
        }
      }
      return map
    }
    if (allocateMode && activeNf && state.activeItemIndex != null) {
      for (const addr of pendingSelection) map.delete(addr)
    }
    return map
  }, [
    occupancy,
    editMode,
    editMarcandoStage,
    editStagePending,
    editMoveOrigens,
    allocateMode,
    activeNf,
    nfEditar,
    state.activeItemIndex,
    pendingSelection,
  ])

  const saidaAddresses = useMemo(() => {
    return new Set<AddressId>()
  }, [])

  const saidaItemDestaqueAddresses = useMemo(() => {
    if (!nfBuscaSaida || saidaItemIndex == null) return new Set<AddressId>()
    const item = nfBuscaSaida.items.find((it) => it.index === saidaItemIndex)
    if (!item || item.allocatedAddresses.length === 0) return new Set<AddressId>()
    return new Set(item.allocatedAddresses)
  }, [nfBuscaSaida, saidaItemIndex])

  const saidaFlaggedAddresses = useMemo(() => {
    const flagged = new Set<AddressId>()
    if (!saidaSelecaoConcluida) {
      for (const a of saidaPaletesSelecionados) flagged.add(a)
    }
    return flagged
  }, [saidaSelecaoConcluida, saidaPaletesSelecionados])

  const editNfAddresses = useMemo(() => {
    if (!nfEditar) return new Set<AddressId>()
    return new Set(enderecosDaNf(nfEditar))
  }, [nfEditar])

  /** Endereços da NF ou do item selecionado — destaque verde no mapa da movimentação. */
  const editMapAddresses = useMemo(() => {
    if (!nfEditar) return undefined
    if (editItemIndex != null) {
      const item = nfEditar.items.find((it) => it.index === editItemIndex)
      if (!item || item.allocatedAddresses.length === 0) return undefined
      return new Set(item.allocatedAddresses)
    }
    if (editNfAddresses.size === 0) return undefined
    return editNfAddresses
  }, [nfEditar, editItemIndex, editNfAddresses])

  const consultaAddresses = useMemo(
    () => new Set(consultaResultados.filter((r) => !r.isStage).map((r) => r.addressId)),
    [consultaResultados],
  )

  const consultaStageHighlighted = useMemo(
    () => consultaResultados.some((r) => r.isStage),
    [consultaResultados],
  )

  const consultaNfAdicionar = consultaNfAdicionarId
    ? state.notas.find((n) => n.id === consultaNfAdicionarId) ?? null
    : null

  const saidaPendingSelection = !saidaModoPalete
    ? pendingSelection
    : !saidaSelecaoConcluida
      ? saidaPaletesSelecionados
      : saidaPaletesNaFila.length > 0
        ? new Set(saidaPaletesNaFila)
        : saidaPaleteAtivo
          ? new Set([saidaPaleteAtivo])
          : pendingSelection

  const panelPendingSelection = !mapaDestaquesAtivos
    ? new Set<AddressId>()
    : editAdicionarPosicoesAlvo != null
      ? editNovasPosicoes
      : editMode
        ? editPendingSelection
        : saidaPendingSelection
  const sectionReadOnly = openSection != null && !canEditSection(plusModulos, openSection)

  const panelAllocateMode =
    !sectionReadOnly &&
    ((openSection === 'entrada' && allocateMode) ||
      (openSection === 'editar' && (editMode || nfEmEdicao)) ||
      (openSection === 'saida' &&
        saidaModoPalete &&
        (saidaQtdPaletesAlvo != null || saidaSelecaoConcluida)) ||
      (openSection === 'consulta' && consultaAguardandoEndereco))
  const panelActiveNfNumero = nfEmEdicao ? nfEditar?.numero ?? null : activeNf?.numero ?? null

  const activeAllocateItem = allocateMode ? activeEntradaItem : null

  const paletesTotal =
    activeAllocateItem?.paletes != null && activeAllocateItem.paletes > 0
      ? activeAllocateItem.paletes
      : null
  const paletesRestantesCount =
    editAdicionarPosicoesAlvo != null
      ? Math.max(0, editAdicionarPosicoesAlvo - editNovasPosicoes.size)
      : paletesTotal != null
        ? Math.max(0, paletesTotal - pendingSelection.size)
        : null

  const panelPaletesTotal =
    editAdicionarPosicoesAlvo ?? paletesTotal

  const editEnderecosOcupados = useMemo(() => {
    const ocupados = new Set(occupancy.keys())
    for (const addr of editPendingSelection) ocupados.delete(addr)
    return ocupados
  }, [occupancy, editPendingSelection])

  const movimentosHistorico = useMemo(
    () => [...state.movimentos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.movimentos],
  )

  const canceladasAtivas = useMemo(
    () => state.notasCanceladas.filter((c) => !c.excluido),
    [state.notasCanceladas],
  )

  const emitentesSugeridos = useMemo(
    () =>
      mesclarEmitentesSugeridos(
        state.emitentes,
        state.notas.map((n) => n.emitente),
        state.notasCanceladas.map((c) => c.emitente),
      ),
    [state.emitentes, state.notas, state.notasCanceladas, manualNfModalOpen],
  )

  const syncPendingFromItem = useCallback((nf: NotaFiscal, itemIndex: number) => {
    const item = nf.items.find((it) => it.index === itemIndex)
    if (!item || item.localizacao === 'stage') {
      setPendingSelection(new Set())
      return
    }
    setPendingSelection(new Set(item.allocatedAddresses))
  }, [])

  function aplicarVinculoHub(nf: NotaFiscal): NotaFiscal {
    const pendente = hubEntradaPendenteRef.current
    if (!pendente) return nf
    if (pendente.nfNumero && normNumero(pendente.nfNumero) !== normNumero(nf.numero)) return nf
    return { ...nf, hubAgendamentoId: pendente.id }
  }

  async function handleUpload(files: File[]) {
    setUploadError(null)
    clearError()
    if (files.length === 0) return

    const imported: NotaFiscal[] = []
    const skipped: string[] = []
    const errors: string[] = []
    const acumulado = [...state.notas]
    let movimentos = state.movimentos
    let reparos: string[] = []

    for (const file of files) {
      try {
        const text = await file.text()
        const nf = parseNfeXml(text)
        const dup = mensagemNfDuplicada(nf, acumulado, state.notasCanceladas, movimentos)
        if (dup) {
          const resultado = repararNfDuplicadaDoXml(
            {
              notas: acumulado,
              movimentos,
              notasCanceladas: state.notasCanceladas,
              emitentes: state.emitentes,
            },
            nf,
          )
          if (resultado) {
            const nota = resultado.nota
            const nextState = {
              ...stateRef.current,
              ...resultado.data,
              ...(nota.status === 'em_andamento'
                ? { activeNfId: nota.id, activeItemIndex: nota.items[0]?.index ?? 0 }
                : {}),
            }
            stateRef.current = nextState
            setState(nextState)
            movimentos = resultado.data.movimentos
            acumulado.splice(0, acumulado.length, ...resultado.data.notas)
            await saveNow(nextState)
            reparos.push(resultado.mensagem)
            continue
          }
          skipped.push(`NF ${nf.numero} (${file.name}): ${dup}`)
          continue
        }
        imported.push(aplicarVinculoHub(nf))
        acumulado.unshift(nf)
        movimentos = upsertMovimentoEntrada(movimentos, nf)
        registrarEmitente(nf.emitente)
        financeiro.registrarClienteFromNf(nf)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao ler XML.'
        errors.push(`${file.name}: ${msg}`)
      }
    }

    if (imported.length > 0) {
      const askDestino = () => {
        const pending = { imported, movimentos }
        saveEntradaDestinoPendente(pending)
        setEntradaDestinoPendente(pending)
      }

      const switchingAway =
        nfEntradaIncompleta(activeNf) && activeNf && imported[0].id !== activeNf.id
      if (switchingAway) {
        trySairEntradaIncompleta(askDestino)
      } else {
        askDestino()
      }
    }

    const feedback: string[] = []
    if (imported.length > 0) {
      feedback.push(
        imported.length === 1
          ? `NF ${imported[0].numero} importada.`
          : `${imported.length} NFs importadas.`,
      )
    }
    if (reparos.length > 0) {
      feedback.push(reparos.join(' · '))
    }
    if (skipped.length > 0) {
      feedback.push(`Ignoradas (${skipped.length}): ${skipped.join(' · ')}`)
    }
    if (errors.length > 0) {
      feedback.push(`Erros (${errors.length}): ${errors.join(' · ')}`)
    }

    if (imported.length === 0 && feedback.length > 0) {
      setUploadError(feedback.join(' '))
    } else if (skipped.length > 0 || errors.length > 0) {
      setUploadError(feedback.join(' '))
    }
  }

  async function handleEntradaDestinoConfirm(localizacao: LocalizacaoEstoque) {
    if (!entradaDestinoPendente) return
    const { imported } = entradaDestinoPendente
    const snapshot = stateRef.current
    const nfsComDestino = imported.map((nf) =>
      aplicarVinculoHub(aplicarLocalizacaoNf(nf, localizacao)),
    )
    let movimentos = snapshot.movimentos
    for (const nf of nfsComDestino) {
      movimentos = upsertMovimentoEntrada(movimentos, nf)
    }
    const nextState = {
      ...snapshot,
      notas: [...nfsComDestino, ...snapshot.notas.filter((n) => !nfsComDestino.some((nf) => nf.id === n.id))],
      movimentos,
      activeNfId: nfsComDestino[0].id,
      activeItemIndex: nfsComDestino[0].items[0]?.index ?? 0,
    }
    stateRef.current = nextState
    setState(nextState)
    setPendingSelection(new Set())
    setSelectedEntradaIds(nfsComDestino.map((nf) => nf.id))
    lastEntradaClickRef.current = nfsComDestino[0].id
    setEntradaDestinoPendente(null)
    clearEntradaDestinoPendente()
    setOpenSection('entrada')
    for (const nf of nfsComDestino) {
      financeiro.registrarClienteFromNf(nf)
    }
    hubEntradaPendenteRef.current = null
    await saveNow(nextState)
  }

  function handleEntradaDestinoCancel() {
    setEntradaDestinoPendente(null)
    clearEntradaDestinoPendente()
  }

  async function handleUploadCancelada(file: File) {
    setUploadCanceladaError(null)
    clearError()
    try {
      const text = await file.text()
      const parsed = parseCanceladaXml(text, stateRef.current.notas)
      const dup = mensagemNfCanceladaDuplicada(parsed, stateRef.current.notasCanceladas)
      if (dup) {
        setUploadCanceladaError(dup)
        return
      }
      const cancelada = notaFiscalToCancelada(parsed)
      const snapshot = stateRef.current
      const nextState = {
        ...snapshot,
        notasCanceladas: [cancelada, ...snapshot.notasCanceladas],
      }
      setState(nextState)
      registrarEmitente(cancelada.emitente)
      setCanceladaPendenteId(cancelada.id)
      await saveNow(nextState)
    } catch (e) {
      setUploadCanceladaError(e instanceof Error ? e.message : 'Erro ao ler XML.')
    }
  }

  function handleVincularCancelada(canceladaId: string, novaNfId: string) {
    const snapshot = stateRef.current
    const nextState = {
      ...snapshot,
      ...syncVinculosNotas(vincularNotaCancelada(snapshot, canceladaId, novaNfId)),
    }
    setState(nextState)
    if (canceladaId === canceladaPendenteId) setCanceladaPendenteId(null)
    void saveNow(nextState)
  }

  function handleDesvincularCancelada(canceladaId: string) {
    const snapshot = stateRef.current
    const nextState = {
      ...snapshot,
      ...syncVinculosNotas(desvincularNotaCancelada(snapshot, canceladaId)),
    }
    setState(nextState)
    void saveNow(nextState)
  }

  async function handleExcluirCancelada(canceladaId: string) {
    const snapshot = stateRef.current
    const nextSlice = syncVinculosNotas(excluirNotaCancelada(snapshot, canceladaId))
    const nextState = { ...snapshot, ...nextSlice }
    setState(nextState)
    if (canceladaId === canceladaPendenteId) setCanceladaPendenteId(null)
    await saveNow(nextState)
  }

  function handleCancelarCancelada(canceladaId: string) {
    handleExcluirCancelada(canceladaId)
  }

  function handleSelectNf(id: string, event?: MouseEvent) {
    const nf = state.notas.find((n) => n.id === id)
    if (!nf || nf.status !== 'em_andamento') return

    const multi = event?.ctrlKey || event?.metaKey
    const range = event?.shiftKey
    let nextSelected: string[]

    if (range && lastEntradaClickRef.current && emAndamentoIds.includes(lastEntradaClickRef.current)) {
      const a = emAndamentoIds.indexOf(lastEntradaClickRef.current)
      const b = emAndamentoIds.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        const slice = emAndamentoIds.slice(lo, hi + 1)
        nextSelected = multi ? [...new Set([...selectedEntradaIds, ...slice])] : slice
      } else {
        nextSelected = multi ? toggleEntradaSelection(selectedEntradaIds, id) : [id]
      }
    } else if (multi) {
      nextSelected = toggleEntradaSelection(selectedEntradaIds, id)
    } else {
      nextSelected = [id]
    }

    let nextActiveId: string | null
    if (nextSelected.length === 0) {
      nextActiveId = null
    } else if (!multi && !range) {
      nextActiveId = id
    } else if (nextSelected.includes(id)) {
      nextActiveId = id
    } else if (state.activeNfId && nextSelected.includes(state.activeNfId)) {
      nextActiveId = state.activeNfId
    } else {
      nextActiveId = nextSelected[nextSelected.length - 1] ?? null
    }

    const nextNf = nextActiveId ? state.notas.find((n) => n.id === nextActiveId) ?? null : null
    const switchingNf = nextActiveId !== state.activeNfId
    const nextItemIndex =
      !nextActiveId ? null : switchingNf ? (nextNf?.items[0]?.index ?? null) : state.activeItemIndex
    const leavingIncomplete =
      switchingNf && nfEntradaIncompleta(activeNf) && activeNf != null

    const applySelection = () => {
      if (nextActiveId === entradaPendenteDismissedRef.current) {
        entradaPendenteDismissedRef.current = null
      }

      lastEntradaClickRef.current = id
      setSelectedEntradaIds(nextSelected)
      setState((s) => ({
        ...s,
        activeNfId: nextActiveId,
        activeItemIndex: nextItemIndex,
      }))

      if (nextNf && nextItemIndex != null) syncPendingFromItem(nextNf, nextItemIndex)
      else setPendingSelection(new Set())

      setDetailAddress(null)
    }

    if (leavingIncomplete) {
      trySairEntradaIncompleta(applySelection)
      return
    }

    applySelection()
  }

  function handleSelectItem(index: number) {
    if (!activeNf) return
    setState((s) => ({ ...s, activeItemIndex: index }))
    syncPendingFromItem(activeNf, index)
  }

  function handleCellClick(addressId: AddressId, canInteract: boolean) {
    const occ = occupancy.get(addressId)
    if (occ && !mapaEmOperacaoAtiva) {
      setDetailAddress(addressId)
      return
    }

    const saidaPending =
      saidaModoPalete &&
      (saidaPaletesSelecionados.has(addressId) ||
        (saidaSelecaoConcluida && saidaPaletesNaFila.includes(addressId)))
    const stagePending = editStagePending.has(addressId)
    const editPending = editPendingSelection.has(addressId)
    const entradaPending = pendingSelection.has(addressId)
    const movOrigemOuDestino =
      editMoveOrigens.has(addressId) || editMoveDestinos.has(addressId)
    handleCellPaint(
      addressId,
      saidaPending ||
        editPending ||
        stagePending ||
        entradaPending ||
        movOrigemOuDestino
        ? 'remove'
        : 'add',
      canInteract,
    )
  }

  function handleCellPaint(addressId: AddressId, mode: 'add' | 'remove', canInteract: boolean) {
    if (openSection != null && !canEditSection(plusModulos, openSection) && canInteract) {
      setViewOnlyToast('Modo visualização — alterações bloqueadas nesta aba.')
      return
    }
    const occ = occupancy.get(addressId)
    if (!canInteract) {
      if (occ && !mapaEmOperacaoAtiva) {
        setDetailAddress(addressId)
      }
      return
    }

    if (nfEditar) {
      if (
        editAdicionarPosicoesAlvo != null &&
        editItemIndex != null &&
        !editMarcandoStage
      ) {
        if (occ) {
          setOcupadoAlert({ addressId, occ })
          return
        }

        setEditNovasPosicoes((prev) => {
          const next = new Set(prev)
          if (mode === 'add') {
            if (next.has(addressId)) return prev
            if (next.size >= editAdicionarPosicoesAlvo) {
              setPaletesLimiteAlert('posicoes_adicionar')
              return prev
            }
            next.add(addressId)
          } else {
            next.delete(addressId)
          }
          return next
        })
        return
      }

      if (editMode && editItemIndex != null) {
        const item = nfEditar.items.find((it) => it.index === editItemIndex)
        if (item && itemNoStage(item)) {
          if (occ) {
            const mesmoItem = occ.nfId === nfEditar.id && occ.itemIndex === editItemIndex
            if (!mesmoItem) {
              setOcupadoAlert({ addressId, occ })
              return
            }
          }

          setEditPendingSelection((prev) => {
            const next = new Set(prev)
            if (mode === 'add') {
              if (next.has(addressId)) return prev
              next.add(addressId)
            } else {
              next.delete(addressId)
            }
            return next
          })
          return
        }
      }

      if (editMarcandoStage) {
        if (editItemIndex == null) {
          if (occ?.nfId === nfEditar.id && mode === 'add') {
            const idx = occ.itemIndex
            const item = nfEditar.items.find((it) => it.index === idx)
            if (item && !itemNoStage(item) && item.allocatedAddresses.length > 0) {
              editOriginalAddressesRef.current = new Set(item.allocatedAddresses)
              setEditItemIndex(idx)
              setEditPendingSelection(new Set())
              setEditMoveOrigens(new Set())
              setEditMoveDestinos(new Set())
              setEditStagePending(new Set([addressId]))
            }
          }
          return
        }

        if (occ) {
          const mesmoItem = occ.nfId === nfEditar.id && occ.itemIndex === editItemIndex
          if (!mesmoItem) {
            setOcupadoAlert({ addressId, occ })
            return
          }

          if (mode === 'add') {
            setEditStagePending((prev) => {
              if (prev.has(addressId)) return prev
              const next = new Set(prev)
              next.add(addressId)
              return next
            })
            setEditMoveOrigens(new Set())
            setEditMoveDestinos(new Set())
          } else {
            setEditStagePending((prev) => {
              const next = new Set(prev)
              next.delete(addressId)
              return next
            })
          }
        }
        return
      }

      const itemReposicionar =
        editItemIndex != null
          ? nfEditar.items.find((it) => it.index === editItemIndex)
          : null
      const reposicionarAtivo =
        !editMarcandoStage &&
        (!itemReposicionar || !itemNoStage(itemReposicionar))

      if (reposicionarAtivo) {
        if (occ) {
          if (occ.nfId !== nfEditar.id) {
            setOcupadoAlert({ addressId, occ })
            return
          }

          const itemFromOcc = nfEditar.items.find((it) => it.index === occ.itemIndex)
          if (!itemFromOcc || itemNoStage(itemFromOcc)) return

          if (editItemIndex != null && editItemIndex !== occ.itemIndex) {
            setOcupadoAlert({ addressId, occ })
            return
          }

          if (editItemIndex == null) {
            editOriginalAddressesRef.current = new Set(itemFromOcc.allocatedAddresses)
            setEditItemIndex(occ.itemIndex)
          }

          setEditMoveOrigens((prevOrigens) => {
            const nextOrigens = new Set(prevOrigens)
            if (mode === 'add') nextOrigens.add(addressId)
            else nextOrigens.delete(addressId)

            let nextDestinos = editMoveDestinosRef.current
            if (nextDestinos.size > nextOrigens.size) {
              nextDestinos = new Set([...nextDestinos].slice(0, nextOrigens.size))
              editMoveDestinosRef.current = nextDestinos
              setEditMoveDestinos(nextDestinos)
            }

            editMoveOrigensRef.current = nextOrigens
            return nextOrigens
          })
          return
        }

        if (editMoveOrigensRef.current.size === 0) return
        if (occupancy.has(addressId) && !editMoveOrigensRef.current.has(addressId)) return

        setEditMoveDestinos((prev) => {
          const next = new Set(prev)
          const origensSize = editMoveOrigensRef.current.size
          if (mode === 'add') {
            if (next.has(addressId)) return prev
            if (next.size >= origensSize) {
              setVozErro(
                origensSize === 0
                  ? 'Marque primeiro os endereços ocupados (origens) no mapa.'
                  : `Você já marcou ${origensSize} destino(s). Desmarque uma origem para mover menos paletes, ou marque mais origens antes de adicionar destinos.`,
              )
              return prev
            }
            next.add(addressId)
          } else {
            next.delete(addressId)
          }
          editMoveDestinosRef.current = next
          return next
        })
        return
      }

      return
    }

    if (saidaModoPalete && nfBuscaSaida) {
      const enderecosNf = new Set(enderecosDaNf(nfBuscaSaida))
      if (!enderecosNf.has(addressId)) return
      if (saidaPaletesConfirmados.some((p) => p.addressId === addressId)) return

      const itemAtivo =
        saidaItemIndex != null
          ? nfBuscaSaida.items.find((it) => it.index === saidaItemIndex)
          : null
      if (!itemAtivo?.allocatedAddresses.includes(addressId)) return

      if (!saidaSelecaoConcluida) {
        setSaidaPaletesSelecionados((prev) => {
          const next = new Set(prev)
          if (mode === 'add') {
            if (next.has(addressId)) return prev
            if (saidaQtdPaletesAlvo != null && next.size >= saidaQtdPaletesAlvo) {
              setSaidaSelecaoErro(`Selecione no máximo ${saidaQtdPaletesAlvo} palete(s).`)
              return prev
            }
            next.add(addressId)
          } else {
            next.delete(addressId)
          }
          return next
        })
        setSaidaSelecaoErro(null)
        return
      }

      if (!saidaPaletesNaFila.includes(addressId)) return

      if (mode === 'add') {
        setSaidaPaleteAtivo(addressId)
        setSaidaCaixasPalete('')
      } else if (saidaPaleteAtivo === addressId) {
        setSaidaPaleteAtivo(null)
        setSaidaCaixasPalete('')
      }
      setSaidaSelecaoErro(null)
      return
    }

    if (allocateMode && state.activeItemIndex != null) {
      const snapshot = stateRef.current
      const nfAloc = snapshot.notas.find((n) => n.id === snapshot.activeNfId)
      if (!nfAloc) return

      if (occ) {
        const mesmoItem =
          occ.nfId === nfAloc.id && occ.itemIndex === snapshot.activeItemIndex
        if (!mesmoItem) {
          setOcupadoAlert({ addressId, occ })
          return
        }
      }

      const currentItemIndex = snapshot.activeItemIndex
      const item = nfAloc.items.find((it) => it.index === currentItemIndex)
      const limitePaletes = paletesLimiteItem(item)

      setPendingSelection((prev) => {
        const next = new Set(prev)
        if (mode === 'add') {
          if (next.has(addressId)) return prev
          if (limitePaletes <= 0) {
            setPaletesLimiteAlert('sem_paletes')
            return prev
          }
          if (!podeAdicionarEndereco(limitePaletes, next.size)) {
            setPaletesLimiteAlert('maximo')
            return prev
          }
          next.add(addressId)
        } else {
          next.delete(addressId)
        }
        return next
      })
      return
    }

    if (occ) {
      if (allocateMode || editMode || saidaModoPalete) {
        setOcupadoAlert({ addressId, occ })
        return
      }
      setDetailAddress(addressId)
    }
  }

  async function handleConfirmItem() {
    const snapshot = stateRef.current
    if (!snapshot.activeNfId || snapshot.activeItemIndex == null) return
    const nf = snapshot.notas.find((n) => n.id === snapshot.activeNfId)
    if (!nf) return
    const currentItemIndex = snapshot.activeItemIndex
    const item = nf.items.find((it) => it.index === currentItemIndex)
    if (!item) return

    if (item.localizacao === 'stage') {
      await confirmEntradaItemStage(nf.id, currentItemIndex)
      return
    }

    const addresses = [...pendingSelection]
    const limitePaletes = paletesLimiteItem(item)
    if (limitePaletes > 0 && addresses.length < limitePaletes) {
      setPaletesLimiteAlert('incompleto')
      return
    }

    const notas = snapshot.notas.map((nfRow) => {
      if (nfRow.id !== nf.id) {
        return {
          ...nfRow,
          items: nfRow.items.map((it) => ({
            ...it,
            allocatedAddresses: it.allocatedAddresses.filter((a) => !addresses.includes(a)),
          })),
        }
      }
      return {
        ...nfRow,
        items: nfRow.items.map((it) => {
          if (it.index !== currentItemIndex) {
            return {
              ...it,
              allocatedAddresses: it.allocatedAddresses.filter((a) => !addresses.includes(a)),
            }
          }
          return { ...it, allocatedAddresses: addresses }
        }),
      }
    })
    let updatedNf = notas.find((n) => n.id === nf.id)!
    await applyEntradaItemConfirmado(updatedNf, currentItemIndex, nf.numero)
  }

  async function confirmEntradaItemStage(nfId: string, currentItemIndex: number) {
    const snapshot = stateRef.current
    const nfAtual = snapshot.notas.find((n) => n.id === nfId)
    if (!nfAtual) return
    const item = nfAtual.items.find((it) => it.index === currentItemIndex)
    if (!item || item.localizacao !== 'stage') return

    const notas = snapshot.notas.map((nf) => {
      if (nf.id !== nfId) return nf
      return {
        ...nf,
        items: nf.items.map((it) =>
          it.index === currentItemIndex ? aplicarLocalizacaoItem(it, 'stage') : it,
        ),
      }
    })
    const updatedNf = notas.find((n) => n.id === nfId)!
    await applyEntradaItemConfirmado(updatedNf, currentItemIndex, nfAtual.numero)
  }

  async function applyEntradaItemConfirmado(
    updatedNfInput: NotaFiscal,
    currentItemIndex: number,
    nfNumero: string,
  ) {
    let updatedNf = updatedNfInput
    if (allItemsAllocated(updatedNf)) {
      updatedNf = { ...updatedNf, status: 'concluida' as const }
    }
    const notasFinais = stateRef.current.notas.map((n) =>
      n.id === updatedNf.id ? updatedNf : n,
    )
    const nextItem = proximoItemEntradaPendente(updatedNf, currentItemIndex)
    const nextActiveIndex = consultaAguardandoEndereco ? null : nextItem?.index ?? null
    const nextState = {
      ...stateRef.current,
      notas: notasFinais,
      movimentos: upsertMovimentoEntrada(stateRef.current.movimentos, updatedNf),
      activeItemIndex: nextActiveIndex,
      activeNfId:
        consultaAguardandoEndereco && updatedNf.status === 'concluida'
          ? null
          : stateRef.current.activeNfId,
    }
    setState(nextState)
    if (nextActiveIndex != null) {
      syncPendingFromItem(updatedNf, nextActiveIndex)
    } else {
      setPendingSelection(new Set())
    }
    if (consultaAguardandoEndereco) {
      setConsultaAguardandoEndereco(false)
      setConsultaItemAdicionadoMsg(`Posições confirmadas na NF ${nfNumero}.`)
    }
    if (updatedNf.status === 'concluida') {
      setSelectedEntradaIds((prev) => prev.filter((id) => id !== updatedNf.id))
    }
    await saveNow(nextState)
  }

  function handleUpdateItemCampos(itemIndex: number, patch: EntradaItemCampos) {
    if (!stateRef.current.activeNfId) return
    setState((s) => {
      const next = {
        ...s,
        notas: s.notas.map((nf) => {
          if (nf.id !== s.activeNfId) return nf
          return {
            ...nf,
            items: nf.items.map((it) => (it.index === itemIndex ? { ...it, ...patch } : it)),
          }
        }),
      }
      queueMicrotask(() => {
        void saveNow(next, { indicar: false })
      })
      return next
    })
  }

  function handleUpdateNfDataArmazenagem(nfId: string, dataArmazenagem: string) {
    const norm = normalizarDataArmazenagemInput(dataArmazenagem)
    if (!norm) return
    setState((s) => {
      const next = {
        ...s,
        notas: s.notas.map((nf) => (nf.id === nfId ? { ...nf, dataArmazenagem: norm } : nf)),
      }
      stateRef.current = next
      queueMicrotask(() => {
        void saveNow(next, { indicar: false })
      })
      return next
    })
  }

  function handleUpdateItemQuantidade(itemIndex: number, quantidade: string) {
    if (!stateRef.current.activeNfId) return
    setState((s) => {
      const next = {
        ...s,
        notas: s.notas.map((nf) => {
          if (nf.id !== s.activeNfId) return nf
          return {
            ...nf,
            items: nf.items.map((it) =>
              it.index === itemIndex ? patchNfeItemQuantidade(it, quantidade) : it,
            ),
          }
        }),
      }
      queueMicrotask(() => {
        void saveNow(next, { indicar: false })
      })
      return next
    })
  }

  function handleUpdateItemPaletes(itemIndex: number, value: string) {
    if (!state.activeNfId) return

    setState((s) => {
      const nf = s.notas.find((n) => n.id === s.activeNfId)
      const item = nf?.items.find((it) => it.index === itemIndex)
      if (!nf || !item) return s

      const trimmed = value.trim()
      let paletes: number | undefined
      if (trimmed === '') {
        paletes = undefined
      } else {
        const parsed = parsePaletesInput(value)
        if (parsed == null || parsed <= 0) return s
        paletes = parsed
      }

      let allocatedAddresses = item.allocatedAddresses
      if (
        s.activeItemIndex === itemIndex &&
        paletes != null &&
        paletes > 0 &&
        allocatedAddresses.length > paletes
      ) {
        allocatedAddresses = allocatedAddresses.slice(0, paletes)
      }

      if (s.activeItemIndex === itemIndex) {
        queueMicrotask(() => {
          setPendingSelection((prev) => {
            if (paletes != null && paletes > 0 && prev.size > paletes) {
              return new Set([...prev].slice(0, paletes))
            }
            return prev
          })
        })
      }

      const next: typeof s = {
        ...s,
        notas: s.notas.map((n) => {
          if (n.id !== s.activeNfId) return n
          return {
            ...n,
            items: n.items.map((it) =>
              it.index === itemIndex ? { ...it, paletes, allocatedAddresses } : it,
            ),
          }
        }),
      }

      queueMicrotask(() => {
        void saveNow(next, { indicar: false })
      })

      return next
    })
  }

  async function handleUpdateItemLocalizacao(itemIndex: number, localizacao: LocalizacaoEstoque) {
    const snapshot = stateRef.current
    if (!snapshot.activeNfId) return
    if (snapshot.activeItemIndex === itemIndex && localizacao === 'stage') {
      setPendingSelection(new Set())
    }
    const nextState = {
      ...snapshot,
      notas: snapshot.notas.map((nf) => {
        if (nf.id !== snapshot.activeNfId) return nf
        return {
          ...nf,
          items: nf.items.map((it) =>
            it.index === itemIndex ? aplicarLocalizacaoItem(it, localizacao) : it,
          ),
        }
      }),
    }
    setState(nextState)
    await saveNow(nextState)
  }

  async function handleDesmembrarItem(itemIndex: number) {
    if (!activeNf || activeNf.status !== 'em_andamento') return
    const result = desmembrarNfeItem(activeNf, itemIndex)
    if (!result) return

    const snapshot = stateRef.current
    const notas = snapshot.notas.map((nf) =>
      nf.id !== activeNf.id ? nf : { ...nf, items: result.items },
    )
    const updatedNf = notas.find((n) => n.id === activeNf.id)!
    const nextState = {
      ...snapshot,
      notas,
      activeItemIndex: result.newItemIndex,
    }
    setState(nextState)
    syncPendingFromItem(updatedNf, result.newItemIndex)
    await saveNow(nextState)
  }

  async function handleFinishEntrada() {
    if (!activeNf || activeNf.status !== 'em_andamento') return
    if (!allItemsAllocated(activeNf)) {
      setEntradaPendenteAlert({
        nfNumero: activeNf.numero,
        itensPendentes: contarItensSemEndereco(activeNf),
      })
      return
    }
    const snapshot = stateRef.current
    const notas = snapshot.notas.map((n) =>
      n.id === activeNf.id ? { ...n, status: 'concluida' as const } : n,
    )
    const updatedNf = notas.find((n) => n.id === activeNf.id)!
    const nextState = {
      ...snapshot,
      notas,
      movimentos: upsertMovimentoEntrada(snapshot.movimentos, updatedNf),
      activeItemIndex: null,
    }
    setState(nextState)
    setPendingSelection(new Set())
    await saveNow(nextState)
  }

  async function handleDeixarEntradaPendente() {
    if (!activeNf || activeNf.status !== 'em_andamento') return

    entradaPendenteDismissedRef.current = activeNf.id
    setPendingSelection(new Set())
    const nextState = {
      ...stateRef.current,
      activeNfId: null,
      activeItemIndex: null,
    }
    setState(nextState)
    await saveNow(nextState)
  }

  async function handleManualNfConfirm(result: ManualNfModalResult) {
    setManualNfError(null)

    const applyManual = async () => {
      const snapshot = stateRef.current
      let nextState = snapshot

      if (result.kind === 'existing') {
        if (!snapshot.notas.some((n) => n.id === result.nfId)) {
          setManualNfError('Nota fiscal não encontrada.')
          return
        }
        nextState = {
          ...snapshot,
          activeNfId: result.nfId,
          activeItemIndex: result.itemIndex,
        }
      } else {
        const added = adicionarNotaManual(snapshot, result.input)
        if ('error' in added) {
          setManualNfError(added.error)
          return
        }
        registrarEmitente(result.input.emitente ?? '')
        const nfVinculada = aplicarVinculoHub(added.nf)
        const notas =
          nfVinculada.hubAgendamentoId != null
            ? added.notas.map((n) => (n.id === added.nf.id ? nfVinculada : n))
            : added.notas
        nextState = {
          ...snapshot,
          notas,
          movimentos: added.movimentos,
          activeNfId: added.nf.id,
          activeItemIndex: 0,
        }
        hubEntradaPendenteRef.current = null
      }

      setState(nextState)
      setPendingSelection(new Set())
      setSelectedEntradaIds((prev) => {
        const exists = prev.includes(result.kind === 'existing' ? result.nfId : nextState.activeNfId!)
        if (result.kind === 'existing') {
          return exists ? prev : [...prev, result.nfId]
        }
        return nextState.activeNfId ? [nextState.activeNfId] : prev
      })
      if (nextState.activeNfId) lastEntradaClickRef.current = nextState.activeNfId
      await saveNow(nextState)
      setManualNfModalOpen(false)
      setManualNfError(null)
    }

    const leavingIncomplete =
      nfEntradaIncompleta(activeNf) &&
      (result.kind === 'new' ||
        (result.kind === 'existing' && result.nfId !== activeNf!.id))

    if (leavingIncomplete) {
      setManualNfModalOpen(false)
      trySairEntradaIncompleta(() => void applyManual())
      return
    }

    await applyManual()
  }

  function toggleEntradaSelection(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
  }

  async function handleCancelarEntrada(nfId: string) {
    const snapshot = stateRef.current
    const base = removerNfDoEstoque(
      {
        notas: snapshot.notas,
        movimentos: snapshot.movimentos,
        notasCanceladas: snapshot.notasCanceladas,
        emitentes: snapshot.emitentes,
      },
      nfId,
    )

    const wasActive = snapshot.activeNfId === nfId
    const nextNf = wasActive
      ? base.notas.find((n) => n.status === 'em_andamento') ?? null
      : base.notas.find((n) => n.id === snapshot.activeNfId) ?? null

    const nextState = {
      ...snapshot,
      notas: base.notas,
      movimentos: base.movimentos,
      notasCanceladas: base.notasCanceladas,
      activeNfId:
        snapshot.activeNfId === nfId ? (nextNf?.id ?? null) : snapshot.activeNfId,
      activeItemIndex: wasActive ? nextNf?.items[0]?.index ?? null : snapshot.activeItemIndex,
    }
    setState(nextState)
    setPendingSelection(new Set())
    setSelectedEntradaIds((prev) => {
      const next = prev.filter((nid) => nid !== nfId)
      if (next.length > 0) return next
      return nextNf ? [nextNf.id] : []
    })
    setUploadError(null)
    await saveNow(nextState)
  }

  async function handleLimparSelecao() {
    if (!activeNf || state.activeItemIndex == null) return
    const currentItemIndex = state.activeItemIndex
    setPendingSelection(new Set())
    const snapshot = stateRef.current
    const notas = snapshot.notas.map((nf) => {
      if (nf.id !== activeNf.id) return nf
      return {
        ...nf,
        items: nf.items.map((it) =>
          it.index === currentItemIndex ? { ...it, allocatedAddresses: [] } : it,
        ),
      }
    })
    const updatedNf = notas.find((n) => n.id === activeNf.id)!
    const nextState = {
      ...snapshot,
      notas,
      movimentos: upsertMovimentoEntrada(snapshot.movimentos, updatedNf),
    }
    setState(nextState)
    await saveNow(nextState)
  }

  function limparEstadoSaida() {
    setSaidaItemIndex(null)
    setSaidaModoPalete(false)
    setSaidaQtdPaletesInput('')
    setSaidaQtdPaletesAlvo(null)
    setSaidaPaletesSelecionados(new Set())
    setSaidaPaletesNaFila([])
    setSaidaSelecaoConcluida(false)
    setSaidaPaleteAtivo(null)
    setSaidaCaixasPalete('')
    setSaidaPaletesConfirmados([])
    setSaidaSelecaoErro(null)
    setSaidaStageItemIndex(null)
    setSaidaStageQtdInput('')
    setSaidaStageConfirmados([])
    setSaidaDataInput(todayInputValue())
  }

  function aplicarBuscaSaida(nf: NotaFiscal, origem: SaidaOrigemEstoque) {
    setSaidaOrigemEstoque(origem)
    setNfBuscaSaidaId(nf.id)
    limparEstadoSaida()
    setMapFocusAddressId(null)
    setMapPulseAddressId(null)
    setMapFocusStage(false)
    setBuscaEncontrada(avisoNfEncontrada(nf, 'saida'))
  }

  function resolverDestinoSaida(nf: NotaFiscal): boolean {
    const temArmazem = nfTemEstoqueArmazem(nf)
    const temStage = nfTemEstoqueStage(nf)

    if (saidaXmlDoc) {
      const vArm = vincularSaidaXmlOrigem(nf, saidaXmlDoc, 'armazem')
      const vStage = vincularSaidaXmlOrigem(nf, saidaXmlDoc, 'stage')
      const okArm = vArm.itensExibicao.length > 0
      const okStage = vStage.itensExibicao.length > 0

      if (!okArm && !okStage) {
        setBuscaErro(
          vArm.avisos[0] ??
            vStage.avisos[0] ??
            mensagemNfSemEstoqueVisivel(nf, state.movimentos),
        )
        setNfBuscaSaidaId(null)
        limparEstadoSaida()
        return false
      }

      if (okArm && okStage && temArmazem && temStage) {
        saveSaidaDestinoPendenteId(nf.id)
        setSaidaDestinoPendente(nf)
        return false
      }

      if (okStage && (!okArm || !temArmazem)) {
        aplicarBuscaSaida(nf, 'stage')
        return true
      }

      aplicarBuscaSaida(nf, 'armazem')
      return true
    }

    if (temArmazem && temStage) {
      saveSaidaDestinoPendenteId(nf.id)
      setSaidaDestinoPendente(nf)
      return false
    }
    if (temStage && !temArmazem) {
      aplicarBuscaSaida(nf, 'stage')
      return true
    }
    if (temArmazem) {
      aplicarBuscaSaida(nf, 'armazem')
      return true
    }
    setBuscaErro(mensagemNfSemEstoqueVisivel(nf, state.movimentos))
    setNfBuscaSaidaId(null)
    limparEstadoSaida()
    return false
  }

  function handleModoBuscaSaidaChange(modo: SaidaModoBusca) {
    setSaidaModoBusca(modo)
    setBuscaErro(null)
    setSaidaUploadXmlErro(null)
    if (modo === 'numero') {
      setSaidaXmlDoc(null)
      setSaidaRefChaves([])
      setSaidaOrigemSelecionadaId('')
      setNfBuscaSaidaId(null)
      limparEstadoSaida()
    }
  }

  async function handleUploadSaidaXml(file: File) {
    setSaidaUploadXmlErro(null)
    setBuscaErro(null)
    limparEstadoSaida()
    try {
      const text = await file.text()
      const refs = parseNfeReferenciaChaves(text)
      const parsed = parseNfeXml(text)
      const doc = documentoSaidaFromNota(parsed)
      setSaidaXmlDoc(doc)
      setSaidaModoBusca('xml')
      setSaidaRefChaves(refs)
      setSaidaOrigemSelecionadaId('')
      setNfBuscaSaidaId(null)

      const referencias = resolverReferenciasSaida(state.notas, refs)
      const comEstoque = referencias.filter((r) => r.nf)

      // Uma única NF referenciada com estoque: já vincula e segue o fluxo
      // (aceita estoque físico ou stage).
      if (comEstoque.length === 1) {
        const nf = comEstoque[0].nf!
        if (saidaXmlCorrespondeNf(nf, doc)) {
          setSaidaOrigemSelecionadaId(nf.id)
          resolverDestinoSaida(nf)
        }
        return
      }

      // Sem referências no XML: mantém sugestão automática por código (fallback).
      if (refs.length === 0) {
        const sugerida = sugerirOrigemSaida(state.notas, doc, refs)
        if (sugerida) {
          setSaidaOrigemSelecionadaId(sugerida.id)
          resolverDestinoSaida(sugerida)
        }
      }
      // Múltiplas referências com estoque: lista aparece para o usuário escolher.
    } catch (e) {
      setSaidaUploadXmlErro(e instanceof Error ? e.message : 'Erro ao ler XML.')
      setSaidaXmlDoc(null)
      setSaidaRefChaves([])
      setNfBuscaSaidaId(null)
    }
  }

  function handleSelecionarReferenciaSaida(nfId: string) {
    setBuscaErro(null)
    if (!saidaXmlDoc) return
    const nf = state.notas.find((n) => n.id === nfId)
    if (!nf) {
      setBuscaErro('NF de origem não encontrada no estoque.')
      return
    }
    if (!saidaXmlCorrespondeNf(nf, saidaXmlDoc)) {
      setBuscaErro(`Nenhum item do XML encontrado com estoque na NF ${nf.numero}.`)
      return
    }
    setSaidaOrigemSelecionadaId(nf.id)
    resolverDestinoSaida(nf)
  }

  function handleVincularOrigemSaida() {
    setBuscaErro(null)
    if (!saidaXmlDoc) return
    const nf = state.notas.find((n) => n.id === saidaOrigemSelecionadaId)
    if (!nf) {
      setBuscaErro('Selecione a NF de origem.')
      return
    }
    if (!saidaXmlCorrespondeNf(nf, saidaXmlDoc)) {
      setBuscaErro('Nenhum item do XML encontrado com estoque na NF selecionada.')
      setNfBuscaSaidaId(null)
      return
    }
    setNfBuscaSaidaId(nf.id)
    resolverDestinoSaida(nf)
  }

  function handleBuscarSaida(numero: string) {
    setSaidaModoBusca('numero')
    setSaidaXmlDoc(null)
    setSaidaOrigemSelecionadaId('')
    setSaidaUploadXmlErro(null)
    setBuscaErro(null)
    setSaidaSelecaoErro(null)
    const nf = buscarNfPorNumero(stateRef.current.notas, numero)
    if (!nf) {
      setBuscaErro('NF não encontrada.')
      setNfBuscaSaidaId(null)
      limparEstadoSaida()
      return
    }
    resolverDestinoSaida(nf)
  }

  function resetSelecaoPaletesSaida() {
    setSaidaQtdPaletesInput('')
    setSaidaQtdPaletesAlvo(null)
    setSaidaPaletesSelecionados(new Set())
    setSaidaPaletesNaFila([])
    setSaidaSelecaoConcluida(false)
    setSaidaPaleteAtivo(null)
    setSaidaCaixasPalete('')
    setSaidaModoPalete(false)
    setSaidaSelecaoErro(null)
  }

  function handleSelectItemSaida(index: number) {
    if (!nfBuscaSaida) return
    const item = nfBuscaSaida.items.find((it) => it.index === index)
    if (!item || item.allocatedAddresses.length === 0) return

    if (saidaItemIndex === index) {
      if (saidaModoPalete) return
      resetSelecaoPaletesSaida()
      setSaidaItemIndex(null)
      return
    }

    const qtdEstoque = quantidadeEstoqueItem(item)
    const semSaldo = qtdEstoque <= 1e-9
    if (!semSaldo && paletesDisponiveisItem(item, saidaPaletesConfirmados) <= 0) return

    resetSelecaoPaletesSaida()
    setSaidaItemIndex(index)
    focarMapaDestaque(primeiroEnderecoIds(item.allocatedAddresses))
  }

  function handleIniciarSelecaoSaida() {
    if (!nfBuscaSaida || saidaItemIndex == null) {
      setSaidaSelecaoErro('Selecione um item na tabela.')
      return
    }
    const item = nfBuscaSaida.items.find((it) => it.index === saidaItemIndex)
    if (!item) return

    const disponivel = paletesDisponiveisItem(item, saidaPaletesConfirmados)
    const confirmadosNoItem = saidaPaletesConfirmados.filter((p) => p.itemIndex === item.index).length
    const semSaldoRestante = sobraItem(item, saidaPaletesConfirmados, saidaLimitesPorItem) <= 1e-9
    const qtdSolicitada =
      semSaldoRestante && !saidaQtdPaletesInput.trim()
        ? confirmadosNoItem + disponivel
        : parsePaletesInput(saidaQtdPaletesInput)
    if (qtdSolicitada == null || qtdSolicitada <= 0) {
      setSaidaSelecaoErro('Informe uma quantidade válida de paletes.')
      return
    }
    const qtd = confirmadosNoItem > 0 ? qtdSolicitada - confirmadosNoItem : qtdSolicitada
    if (qtd <= 0) {
      setSaidaSelecaoErro(
        `Você já confirmou ${confirmadosNoItem} palete(s). Informe um total maior para selecionar mais.`,
      )
      return
    }
    if (qtd > disponivel) {
      const totalDisponivel = confirmadosNoItem + disponivel
      setSaidaSelecaoErro(
        confirmadosNoItem > 0
          ? `Máximo de ${totalDisponivel} palete(s) no total neste item (${disponivel} restante(s)).`
          : `Máximo de ${disponivel} palete(s) disponível(is) neste item.`,
      )
      return
    }
    if (semSaldoRestante && !saidaQtdPaletesInput.trim()) {
      setSaidaQtdPaletesInput(String(confirmadosNoItem + disponivel))
    }
    setSaidaQtdPaletesAlvo(qtd)
    setSaidaModoPalete(true)
    setSaidaPaletesSelecionados(new Set())
    setSaidaPaletesNaFila([])
    setSaidaSelecaoConcluida(false)
    setSaidaPaleteAtivo(null)
    setSaidaCaixasPalete('')
    setSaidaSelecaoErro(null)
  }

  function handleConfirmarSelecaoPaletes() {
    if (saidaQtdPaletesAlvo == null) return
    if (saidaPaletesSelecionados.size !== saidaQtdPaletesAlvo) {
      setSaidaSelecaoErro(`Selecione exatamente ${saidaQtdPaletesAlvo} palete(s) no painel.`)
      return
    }
    const fila = [...saidaPaletesSelecionados]
    setSaidaPaletesNaFila(fila)
    setSaidaSelecaoConcluida(true)
    setSaidaPaleteAtivo(fila[0] ?? null)
    const item = nfBuscaSaida?.items.find((it) => it.index === saidaItemIndex)
    setSaidaCaixasPalete(
      item && sobraItem(item, saidaPaletesConfirmados, saidaLimitesPorItem) <= 1e-9 ? '0' : '',
    )
    setSaidaSelecaoErro(null)
  }

  function handleQtdPaletesChange(value: string) {
    setSaidaQtdPaletesInput(value)
    setSaidaSelecaoErro(null)
  }

  function handleCaixasPaleteChange(value: string) {
    setSaidaCaixasPalete(value)
    setSaidaSelecaoErro(null)
  }

  function handleConfirmarPaleteSaida() {
    if (!nfBuscaSaida || !saidaPaleteAtivo) return
    const item = nfBuscaSaida.items.find((it) => it.allocatedAddresses.includes(saidaPaleteAtivo))
    if (!item) return

    const caixas = parseQuantidadeSaida(saidaCaixasPalete)
    const semSaldo = sobraItem(item, saidaPaletesConfirmados, saidaLimitesPorItem) <= 1e-9
    if (caixas == null || caixas < 0) {
      setSaidaSelecaoErro('Informe uma quantidade válida de caixas.')
      return
    }
    if (caixas <= 0 && !semSaldo) {
      setSaidaSelecaoErro('Informe uma quantidade válida de caixas.')
      return
    }

    const enderecosParaConfirmar = (
      saidaPaletesNaFila.length > 0 ? saidaPaletesNaFila : [saidaPaleteAtivo]
    ).filter(
      (addressId) =>
        item.allocatedAddresses.includes(addressId) &&
        !saidaPaletesConfirmados.some((p) => p.addressId === addressId),
    )
    if (enderecosParaConfirmar.length === 0) return

    const baseConfirmados = saidaPaletesConfirmados.filter(
      (p) => !enderecosParaConfirmar.includes(p.addressId),
    )
    const novos: SaidaPaleteDraft[] = []
    const caixasPorEndereco = semSaldo
      ? enderecosParaConfirmar.map(() => 0)
      : distribuirCaixasSaidaEntrePaletes(caixas, enderecosParaConfirmar.length)

    for (let i = 0; i < enderecosParaConfirmar.length; i++) {
      const addressId = enderecosParaConfirmar[i]
      const confirmadosAteAqui = [...baseConfirmados, ...novos]
      const caixasDoPalete = caixasPorEndereco[i] ?? 0
      const calc = calcularSaidaPalete(
        nfBuscaSaida,
        item,
        addressId,
        caixasDoPalete,
        confirmadosAteAqui,
        saidaLimitesPorItem,
      )
      if (!calc) {
        setSaidaSelecaoErro('Quantidade de caixas excede o disponível neste item.')
        return
      }

      novos.push({
        addressId,
        itemIndex: item.index,
        quantidadeCaixas: caixasDoPalete,
      })
    }

    const totalDistribuido = novos.reduce((s, p) => s + p.quantidadeCaixas, 0)
    if (!semSaldo && Math.abs(totalDistribuido - caixas) > 1e-6) {
      setSaidaSelecaoErro('Quantidade de caixas excede o disponível neste item.')
      return
    }

    setSaidaPaletesConfirmados((prev) => {
      const next = [...prev.filter((p) => !novos.some((n) => n.addressId === p.addressId)), ...novos]
      const restantes = saidaPaletesNaFila.filter(
        (a) => !next.some((p) => p.addressId === a),
      )
      if (restantes.length > 0) {
        const semSaldoAposConfirmar = sobraItem(item, next, saidaLimitesPorItem) <= 1e-9
        setSaidaPaleteAtivo(restantes[0])
        setSaidaCaixasPalete(semSaldoAposConfirmar ? '0' : '')
      } else {
        setSaidaPaleteAtivo(null)
        setSaidaSelecaoConcluida(false)
        setSaidaPaletesSelecionados(new Set())
        setSaidaPaletesNaFila([])
        setSaidaQtdPaletesAlvo(null)
        setSaidaModoPalete(false)
        setSaidaQtdPaletesInput('')
        setSaidaCaixasPalete('')
        const itemAtual = nfBuscaSaida.items.find((it) => it.index === saidaItemIndex)
        const itemCompleto =
          itemAtual &&
          paletesDisponiveisItem(itemAtual, next) <= 0 &&
          sobraItem(itemAtual, next, saidaLimitesPorItem) <= 1e-9
        if (itemCompleto && saidaItemIndex != null) {
          const proximo = proximoItemSaidaPendente(
            saidaItensExibicao,
            saidaItemIndex,
            next,
            saidaLimitesPorItem,
          )
          setSaidaItemIndex(proximo?.index ?? null)
          if (proximo) {
            focarMapaDestaque(primeiroEnderecoIds(proximo.allocatedAddresses))
          }
        }
      }
      return next
    })
    setSaidaSelecaoErro(null)
  }

  function handleRemoverPaleteSaida(addressId: AddressId) {
    setSaidaPaletesConfirmados((prev) => prev.filter((p) => p.addressId !== addressId))
    if (saidaPaleteAtivo === addressId) {
      setSaidaPaleteAtivo(null)
      setSaidaCaixasPalete('')
    }
    setSaidaSelecaoErro(null)
  }

  async function handleFinalizarSaida(
    justificativaSaida: JustificativaSaidaId,
    dataSaida: string,
  ) {
    if (!nfBuscaSaida || saidaPaletesConfirmados.length === 0) return
    const dataSaidaNorm = dataSaida.trim()
    if (!dataSaidaNorm) {
      setSaidaSelecaoErro('Informe a data da saída.')
      return
    }

    const liberar = enderecosALiberar(nfBuscaSaida, saidaPaletesConfirmados, saidaLimitesPorItem)
    const saidaOpts = {
      dataSaida: dataSaidaNorm,
      ...(saidaXmlDoc
        ? {
            nfSaida: {
              numero: saidaXmlDoc.numero,
              serie: saidaXmlDoc.serie,
              chave: saidaXmlDoc.chave,
              emitente: saidaXmlDoc.emitente,
              dataEmissao: saidaXmlDoc.dataEmissao,
            },
            limitesPorItem: saidaLimitesPorItem,
          }
        : {}),
    }
    const mov = criarMovimentoSaida(
      nfBuscaSaida,
      liberar,
      justificativaSaida,
      undefined,
      saidaPaletesConfirmados,
      saidaOpts,
    )
    const snapshot = stateRef.current
    const nextState = {
      ...snapshot,
      notas: snapshot.notas.map((n) =>
        n.id === nfBuscaSaida.id
          ? aplicarSaidaPaletes(n, saidaPaletesConfirmados, saidaLimitesPorItem)
          : n,
      ),
      movimentos: [mov, ...snapshot.movimentos],
    }
    setState(nextState)
    await saveNow(nextState)
    finalizarSaidaResetUI(nextState, nfBuscaSaida.id)
  }

  /** Após finalizar uma saída, volta para a lista de NFs referenciadas se ainda houver pendências. */
  function finalizarSaidaResetUI(
    nextState: AppState,
    nfFinalizadaId?: string,
    options?: { limparXml?: boolean },
  ) {
    setNfBuscaSaidaId(null)
    setSaidaOrigemSelecionadaId('')
    setSaidaUploadXmlErro(null)
    limparEstadoSaida()

    const aindaTemReferencias =
      saidaRefChaves.length > 0 &&
      resolverReferenciasSaida(nextState.notas, saidaRefChaves).some(
        (r) => r.nf && r.nf.id !== nfFinalizadaId,
      )

    if (options?.limparXml || !aindaTemReferencias) {
      setSaidaXmlDoc(null)
      setSaidaRefChaves([])
    }
  }

  function handleSelectItemStage(index: number) {
    if (!nfBuscaSaida) return
    const item = nfBuscaSaida.items.find((it) => it.index === index)
    if (!item || item.localizacao !== 'stage') return
    if (saidaStageConfirmados.some((s) => s.itemIndex === index)) return
    setSaidaStageItemIndex(index)
    setSaidaStageQtdInput(String(quantidadeEstoqueItem(item)))
    setSaidaSelecaoErro(null)
  }

  function handleStageQtdChange(value: string) {
    setSaidaStageQtdInput(value)
    setSaidaSelecaoErro(null)
  }

  function handleConfirmarItemStage() {
    if (!nfBuscaSaida || saidaStageItemIndex == null) return
    const item = nfBuscaSaida.items.find((it) => it.index === saidaStageItemIndex)
    if (!item) return
    const qtd = parseQuantidadeSaida(saidaStageQtdInput)
    if (qtd == null || qtd <= 0) {
      setSaidaSelecaoErro('Informe uma quantidade válida.')
      return
    }
    const max = quantidadeEstoqueItem(item)
    if (qtd > max) {
      setSaidaSelecaoErro(`Quantidade máxima: ${max}.`)
      return
    }
    setSaidaStageConfirmados((prev) => [
      ...prev.filter((s) => s.itemIndex !== saidaStageItemIndex),
      { itemIndex: saidaStageItemIndex, quantidadeSaida: qtd },
    ])
    setSaidaStageItemIndex(null)
    setSaidaStageQtdInput('')
    setSaidaSelecaoErro(null)
  }

  function handleRemoverItemStage(itemIndex: number) {
    setSaidaStageConfirmados((prev) => prev.filter((s) => s.itemIndex !== itemIndex))
    if (saidaStageItemIndex === itemIndex) {
      setSaidaStageItemIndex(null)
      setSaidaStageQtdInput('')
    }
    setSaidaSelecaoErro(null)
  }

  async function handleFinalizarSaidaStage(
    justificativaSaida: JustificativaSaidaId,
    dataSaida: string,
  ) {
    if (!nfBuscaSaida || saidaStageConfirmados.length === 0) return
    const dataSaidaNorm = dataSaida.trim()
    if (!dataSaidaNorm) {
      setSaidaSelecaoErro('Informe a data da saída.')
      return
    }

    const movBase = criarMovimentoSaida(
      nfBuscaSaida,
      [],
      justificativaSaida,
      saidaStageConfirmados,
      undefined,
      {
        dataSaida: dataSaidaNorm,
        ...(saidaXmlDoc
          ? {
              nfSaida: {
                numero: saidaXmlDoc.numero,
                serie: saidaXmlDoc.serie,
                chave: saidaXmlDoc.chave,
                emitente: saidaXmlDoc.emitente,
                dataEmissao: saidaXmlDoc.dataEmissao,
              },
            }
          : {}),
      },
    )
    const mov = {
      ...movBase,
      itens: snapshotSaidaStage(nfBuscaSaida, saidaStageConfirmados),
    }
    const snapshot = stateRef.current
    const nextState = {
      ...snapshot,
      notas: snapshot.notas.map((n) =>
        n.id === nfBuscaSaida.id ? aplicarSaidaStage(n, saidaStageConfirmados) : n,
      ),
      movimentos: [mov, ...snapshot.movimentos],
    }
    setState(nextState)
    await saveNow(nextState)
    finalizarSaidaResetUI(nextState, nfBuscaSaida.id)
  }

  function handleCancelarSaida() {
    setBuscaErro(null)
    finalizarSaidaResetUI(state, undefined, { limparXml: true })
  }

  function limparEstadoMapaEditar() {
    setEditItemIndex(null)
    setEditPendingSelection(new Set())
    setEditStagePending(new Set())
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    editMoveOrigensRef.current = new Set()
    editMoveDestinosRef.current = new Set()
    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
    setEditModoMovimentacao('reposicionar')
    setVozOrigemAddress(null)
    setVozErro(null)
    editOriginalAddressesRef.current = new Set()
  }

  function handleEditModoMovimentacao(modo: ModoMovimentacao) {
    if (modo === editModoMovimentacao) return

    setEditModoMovimentacao(modo)
    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    setEditStagePending(new Set())
    setVozOrigemAddress(null)
    setVozErro(null)

    if (modo !== 'tirar-stage' || !nfEditar) return

    const stageItems = itensStageDaNf(nfEditar)
    if (stageItems.length === 1) {
      handleSelectItemEditar(stageItems[0].index)
      return
    }

    const atual =
      editItemIndex != null ? nfEditar.items.find((it) => it.index === editItemIndex) : null
    if (atual && !itemNoStage(atual)) {
      setEditItemIndex(null)
      setEditPendingSelection(new Set())
      editOriginalAddressesRef.current = new Set()
    }
  }

  function iniciarEdicaoNf(nf: NotaFiscal) {
    setNfEditarId(nf.id)
    limparEstadoMapaEditar()
    const primeiro = proximoItemMovimentavel(nf, null)
    if (primeiro) {
      aplicarSelecaoItemEditar(nf, primeiro.index)
    }
  }

  function handleBuscarEditar(numero: string) {
    setBuscaEditarErro(null)
    const snapshot = stateRef.current
    const nf = buscarNfPorNumero(snapshot.notas, numero)
    if (!nf) {
      setBuscaEditarErro('NF não encontrada.')
      setNfEditarId(null)
      limparEstadoMapaEditar()
      return
    }
    const temArmazem = nfTemEstoqueArmazem(nf)
    const temStage = nfTemEstoqueStage(nf)
    if (!temArmazem && !temStage) {
      setBuscaEditarErro(mensagemNfSemEstoqueVisivel(nf, snapshot.movimentos))
      setNfEditarId(null)
      limparEstadoMapaEditar()
      return
    }
    iniciarEdicaoNf(nf)
    focarMapaBuscaEncontrado(primeiroEnderecoNf(nf), avisoNfEncontrada(nf, 'movimentacao'))
  }

  function limparDraftMovimentacaoMapa() {
    setEditPendingSelection(new Set())
    setEditStagePending(new Set())
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    editMoveOrigensRef.current = new Set()
    editMoveDestinosRef.current = new Set()
    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
    setVozOrigemAddress(null)
    setVozErro(null)
  }

  function aplicarSelecaoItemEditar(nf: NotaFiscal, index: number) {
    const item = nf.items.find((it) => it.index === index)
    if (!item) return

    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
    setEditStagePending(new Set())

    if (itemNoStage(item)) {
      editOriginalAddressesRef.current = new Set()
      setEditItemIndex(index)
      setEditPendingSelection(new Set())
      setEditMoveOrigens(new Set())
      setEditMoveDestinos(new Set())
      editMoveOrigensRef.current = new Set()
      editMoveDestinosRef.current = new Set()
      setVozOrigemAddress(null)
      setVozErro(null)
      setEditModoMovimentacao('tirar-stage')
      setDetailAddress(null)
      focarMapaDestaque({ type: 'stage' })
      return
    }

    if (item.allocatedAddresses.length === 0) return

    const original = new Set(item.allocatedAddresses)
    editOriginalAddressesRef.current = original
    setEditItemIndex(index)
    setEditPendingSelection(new Set())
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    editMoveOrigensRef.current = new Set()
    editMoveDestinosRef.current = new Set()
    setVozOrigemAddress(null)
    setVozErro(null)
    if (editModoMovimentacao !== 'enviar-stage') {
      setEditModoMovimentacao('reposicionar')
    }
    setDetailAddress(null)
    focarMapaDestaque(primeiroEnderecoIds(item.allocatedAddresses))
  }

  function avancarParaProximoItemEditar(nf: NotaFiscal, afterIndex: number) {
    const next = proximoItemMovimentavel(nf, afterIndex)
    if (next) {
      aplicarSelecaoItemEditar(nf, next.index)
      return
    }
    setEditItemIndex(null)
    limparDraftMovimentacaoMapa()
    editOriginalAddressesRef.current = new Set()
  }

  function handleSelectItemEditar(index: number) {
    if (!nfEditar) return
    if (editItemIndex === index && editAdicionarPosicoesAlvo == null) return

    const item = nfEditar.items.find((it) => it.index === index)
    if (!item || !itemMovimentavel(item)) return

    const trocar = () => aplicarSelecaoItemEditar(nfEditar, index)

    const temDraft =
      editMoveOrigens.size > 0 ||
      editMoveDestinos.size > 0 ||
      editPendingSelection.size > 0 ||
      editStagePending.size > 0 ||
      editNovasPosicoes.size > 0 ||
      editAdicionarPosicoesAlvo != null

    if (editItemIndex != null && editItemIndex !== index && temDraft) {
      setMovimentacaoPendenteAlert({
        nfNumero: nfEditar.numero,
        onConfirmLeave: () => {
          limparDraftMovimentacaoMapa()
          setMovimentacaoPendenteAlert(null)
          trocar()
        },
      })
      return
    }

    trocar()
  }

  function handleSelectVozOrigem(addressId: AddressId, index: number) {
    if (!nfEditar) return
    const item = nfEditar.items.find((it) => it.index === index)
    if (!item || itemNoStage(item)) return
    setVozErro(null)
    if (editItemIndex !== index) {
      handleSelectItemEditar(index)
      setVozOrigemAddress(addressId)
      return
    }
    setVozOrigemAddress(addressId)
  }

  function handleVozDestino(transcript: string): boolean {
    if (!transcript.trim()) return false
    setVozErro(null)

    const { addressText, confirm } = splitMovimentacaoVozTranscript(transcript)

    if (addressText) {
      if (!vozOrigemAddress || !nfEditar || editItemIndex == null || editMarcandoStage) return false

      const destId = parseEnderecoFalado(addressText)
      if (!destId) {
        setVozErro(
          `Não entendi "${addressText.trim()}". Fale devagar: "câmara 6 rua 1 coluna 2 nível 3".`,
        )
        return false
      }

      const item = nfEditar.items.find((it) => it.index === editItemIndex)
      if (!item?.allocatedAddresses.includes(vozOrigemAddress)) {
        setVozErro('Endereço de origem inválido para este item.')
        return false
      }

      const validationError = validarEnderecoDestinoVoz(
        destId,
        occupancy,
        editMoveOrigens,
        editMoveDestinos,
        vozOrigemAddress,
      )
      if (validationError) {
        setVozErro(validationError)
        return false
      }

      const origem = vozOrigemAddress
      const nextOrigens = new Set(editMoveOrigensRef.current)
      nextOrigens.add(origem)
      const nextDestinos = new Set(editMoveDestinosRef.current)
      nextDestinos.add(destId)
      editMoveOrigensRef.current = nextOrigens
      editMoveDestinosRef.current = nextDestinos
      setEditMoveOrigens(nextOrigens)
      setEditMoveDestinos(nextDestinos)
      setVozOrigemAddress(null)

      if (!confirm) {
        return nextOrigens.size > 0 && nextOrigens.size === nextDestinos.size
      }
    } else if (!confirm) {
      return false
    }

    if (confirm) {
      if (
        editMoveOrigensRef.current.size === 0 ||
        editMoveOrigensRef.current.size !== editMoveDestinosRef.current.size
      ) {
        setVozErro('Distribuição incompleta. Fale o destino antes de confirmar.')
        return false
      }
      void handleSalvarEditar()
      return false
    }

    return false
  }

  function handleAdicionarEnderecoDestino(addressId: AddressId) {
    if (!nfEditar || editItemIndex == null) return
    setEditPendingSelection((prev) => {
      const next = new Set(prev)
      next.add(addressId)
      return next
    })
  }

  async function handleAplicarStageDrop() {
    if (!nfEditar || editItemIndex == null || editStagePending.size === 0) return
    const currentItemIndex = editItemIndex
    const addresses = [...editStagePending]
    const snapshot = stateRef.current
    const notas = snapshot.notas.map((nf) =>
      nf.id === nfEditar.id ? moverEnderecosParaStage(nf, currentItemIndex, addresses) : nf,
    )
    const updatedNf = notas.find((n) => n.id === nfEditar.id)!
    const nextState = {
      ...snapshot,
      notas,
      movimentos: [
        criarMovimentoMovimentacao(updatedNf, currentItemIndex, addresses),
        ...snapshot.movimentos,
      ],
    }
    setState(nextState)
    await saveNow(nextState)
    setEditStagePending(new Set())
    setEditModoMovimentacao('reposicionar')

    const updatedItem = updatedNf.items.find((it) => it.index === currentItemIndex)
    if (
      updatedItem &&
      !itemNoStage(updatedItem) &&
      updatedItem.allocatedAddresses.length > 0
    ) {
      editOriginalAddressesRef.current = new Set(updatedItem.allocatedAddresses)
      setEditMoveOrigens(new Set())
      setEditMoveDestinos(new Set())
      editMoveOrigensRef.current = new Set()
      editMoveDestinosRef.current = new Set()
    } else {
      avancarParaProximoItemEditar(updatedNf, currentItemIndex)
    }
  }

  async function handleSalvarEditar(): Promise<boolean> {
    if (editSalvando) return false
    const nfAtual = nfEditarId
      ? stateRef.current.notas.find((n) => n.id === nfEditarId) ?? null
      : null
    if (!nfAtual) {
      setVozErro('Nota fiscal não encontrada. Busque a NF novamente.')
      return false
    }

    if (editItemIndex != null) {
      const stageItem = nfAtual.items.find((it) => it.index === editItemIndex)
      if (stageItem && itemNoStage(stageItem)) {
        if (editPendingSelection.size === 0) {
          setVozErro('Marque ao menos um endereço de destino no armazém físico.')
          return false
        }
        const addresses = [...editPendingSelection]
        const currentItemIndex = editItemIndex
        const snapshot = stateRef.current
        const notas = snapshot.notas.map((nf) =>
          nf.id === nfAtual.id
            ? moverItemStageParaArmazem(nf, currentItemIndex, addresses)
            : nf,
        )
        const updatedNf = notas.find((n) => n.id === nfAtual.id)!
        const nextState = {
          ...snapshot,
          notas,
          movimentos: [
            criarMovimentoMovimentacao(updatedNf, currentItemIndex, addresses),
            ...snapshot.movimentos,
          ],
        }
        setEditSalvando(true)
        setEditPendingSelection(new Set())
        editOriginalAddressesRef.current = new Set(addresses)
        setState(nextState)
        setVozErro(null)
        try {
          await saveNow(nextState)
        } finally {
          setEditSalvando(false)
        }
        avancarParaProximoItemEditar(updatedNf, currentItemIndex)
        return true
      }
    }

    const origensSet =
      editMoveOrigens.size >= editMoveOrigensRef.current.size
        ? editMoveOrigens
        : editMoveOrigensRef.current
    const destinosSet =
      editMoveDestinos.size >= editMoveDestinosRef.current.size
        ? editMoveDestinos
        : editMoveDestinosRef.current

    if (origensSet.size === 0 || origensSet.size !== destinosSet.size) {
      setVozErro('Distribuição incompleta. Marque origens e destinos no mapa antes de confirmar.')
      return false
    }

    const origens = [...origensSet]
    const destinos = [...destinosSet]
    const occMap = buildOccupancyMap(stateRef.current.notas)
    const origOcc = occMap.get(origens[0]!)
    if (!origOcc || origOcc.nfId !== nfAtual.id) {
      setVozErro('Endereço de origem inválido ou não pertence a esta NF.')
      return false
    }

    const currentItemIndex = origOcc.itemIndex
    const item = nfAtual.items.find((it) => it.index === currentItemIndex)
    if (!item || itemNoStage(item)) {
      setVozErro('Item inválido para reposicionamento no armazém.')
      return false
    }

    for (const orig of origens) {
      const o = occMap.get(orig)
      if (!o || o.nfId !== nfAtual.id || o.itemIndex !== currentItemIndex) {
        setVozErro('Um ou mais endereços de origem são inválidos para este item.')
        return false
      }
    }

    if (new Set(destinos).size !== destinos.length) {
      setVozErro('Cada palete precisa de um destino diferente.')
      return false
    }
    for (const dest of destinos) {
      if (origens.includes(dest)) {
        setVozErro('Origem e destino não podem ser o mesmo endereço.')
        return false
      }
      if (occMap.has(dest) && !origensSet.has(dest)) {
        setVozErro('Um ou mais endereços de destino já estão ocupados.')
        return false
      }
    }

    const moveMap = new Map(origens.map((orig, i) => [orig, destinos[i] as AddressId]))
    const addresses = item.allocatedAddresses.map((addr) => moveMap.get(addr) ?? addr)

    const original = editOriginalAddressesRef.current
    if (!enderecosAlterados(original, addresses)) {
      setVozErro('Nenhuma alteração de endereço para salvar.')
      return false
    }

    const removedFromItem = item.allocatedAddresses.filter((a) => !addresses.includes(a))
    const snapshot = stateRef.current

    const notas = snapshot.notas.map((nf) => ({
      ...nf,
      items: nf.items.map((it) => {
        if (nf.id === nfAtual.id && it.index === currentItemIndex) {
          const paletesAtualizados =
            addresses.length > 0
              ? Math.max(it.paletes ?? 0, addresses.length)
              : it.paletes
          return { ...it, allocatedAddresses: addresses, paletes: paletesAtualizados }
        }
        return {
          ...it,
          allocatedAddresses: it.allocatedAddresses.filter(
            (a) => !addresses.includes(a) && !removedFromItem.includes(a),
          ),
        }
      }),
    }))
    const updatedNf = notas.find((n) => n.id === nfAtual.id)!
    const nextState = {
      ...snapshot,
      notas,
      movimentos: [
        criarMovimentoMovimentacao(updatedNf, currentItemIndex, addresses),
        ...snapshot.movimentos,
      ],
    }

    setEditSalvando(true)
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    editMoveOrigensRef.current = new Set()
    editMoveDestinosRef.current = new Set()
    setVozOrigemAddress(null)
    setVozErro(null)
    editOriginalAddressesRef.current = new Set(addresses)
    setState(nextState)
    try {
      await saveNow(nextState)
    } finally {
      setEditSalvando(false)
    }
    avancarParaProximoItemEditar(updatedNf, currentItemIndex)
    return true
  }

  function handleIniciarAdicionarPosicoes(itemIndex: number, quantidade: number) {
    if (!nfEditar || !(quantidade > 0)) return
    const item = nfEditar.items.find((it) => it.index === itemIndex)
    if (!item || itemNoStage(item) || item.allocatedAddresses.length === 0) return

    setEditItemIndex(itemIndex)
    setEditModoMovimentacao('reposicionar')
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    setEditPendingSelection(new Set())
    setEditStagePending(new Set())
    setVozOrigemAddress(null)
    setVozErro(null)
    editOriginalAddressesRef.current = new Set(item.allocatedAddresses)
    setEditAdicionarPosicoesAlvo(quantidade)
    setEditNovasPosicoes(new Set())
    setDetailAddress(null)
    focarMapaDestaque(primeiroEnderecoIds(item.allocatedAddresses))
  }

  function handleCancelarAdicionarPosicoes() {
    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
  }

  async function handleConfirmarAdicionarPosicoes() {
    if (editSalvando || !nfEditar || editItemIndex == null || editAdicionarPosicoesAlvo == null) {
      return
    }
    if (editNovasPosicoes.size !== editAdicionarPosicoesAlvo) return

    const item = nfEditar.items.find((it) => it.index === editItemIndex)
    if (!item || itemNoStage(item)) return

    const snapshot = stateRef.current
    const novos = [...editNovasPosicoes]
    const notas = snapshot.notas.map((nf) =>
      nf.id === nfEditar.id ? adicionarPosicoesItemArmazem(nf, editItemIndex, novos) : nf,
    )
    const updatedNf = notas.find((n) => n.id === nfEditar.id)!
    const updatedItem = updatedNf.items.find((it) => it.index === editItemIndex)!
    const nextState = {
      ...snapshot,
      notas,
      movimentos: [
        criarMovimentoMovimentacao(updatedNf, editItemIndex, updatedItem.allocatedAddresses),
        ...snapshot.movimentos,
      ],
    }

    setEditSalvando(true)
    setEditAdicionarPosicoesAlvo(null)
    setEditNovasPosicoes(new Set())
    editOriginalAddressesRef.current = new Set(updatedItem.allocatedAddresses)
    setEditMoveOrigens(new Set())
    setEditMoveDestinos(new Set())
    setState(nextState)
    try {
      await saveNow(nextState)
    } finally {
      setEditSalvando(false)
    }
  }

  function handleCancelarEditar() {
    setNfEditarId(null)
    limparEstadoMapaEditar()
    setBuscaEditarErro(null)
  }

  function handleBuscarConsulta(filtros: ConsultaEstoqueFiltros) {
    setConsultaErro(null)
    setConsultaFiltros(filtros)
    setConsultaFiltrosTick((n) => n + 1)
    if (!temFiltroConsulta(filtros)) {
      setConsultaResultados([])
      setConsultaErro('Informe ao menos um filtro para pesquisar.')
      return
    }
    const snapshot = stateRef.current
    const resultados = buscarEstoque(snapshot.notas, filtros)
    setConsultaResultados(resultados)
    if (resultados.length > 0) {
      setConsultaErro(null)
      focarMapaBuscaEncontrado(
        primeiroEnderecoConsulta(resultados),
        avisoConsultaEncontrada(resultados),
      )
      return
    }
    const nfQ = filtros.nfNumero.trim()
    if (nfQ) {
      const nf = buscarNfPorNumero(snapshot.notas, nfQ)
      if (nf) {
        setConsultaErro(mensagemNfSemEstoqueVisivel(nf, snapshot.movimentos))
        return
      }
    }
    setConsultaErro('Nenhum resultado encontrado com os filtros informados.')
  }

  function handleLimparConsulta() {
    setConsultaResultados([])
    setConsultaErro(null)
    setConsultaFiltros(CONSULTA_FILTROS_VAZIOS)
    setConsultaFiltrosTick((n) => n + 1)
  }

  function handleAlternarDestaqueInventario(resultados: ConsultaEstoqueResultado[]) {
    setConsultaErro(null)
    const removendo = resultadosEstaoDestacados(resultados, consultaResultados)
    setConsultaResultados((prev) => alternarDestaqueConsulta(prev, resultados))
    if (!removendo) {
      focarMapaDestaque(primeiroEnderecoConsulta(resultados))
    }
  }

  function handleBuscarNfAdicionar(numero: string) {
    setConsultaItemAdicionadoMsg(null)
    setConsultaNfAdicionarErro(null)
    setConsultaItemManualErro(null)
    if (!numero) {
      setConsultaNfAdicionarErro('Informe o número da NF.')
      setConsultaNfAdicionarId(null)
      return
    }
    const nf = findNotaByNumero(state.notas, numero)
    if (!nf) {
      setConsultaNfAdicionarErro('NF não encontrada. Suba o XML na aba Entrada primeiro.')
      setConsultaNfAdicionarId(null)
      return
    }
    setConsultaNfAdicionarId(nf.id)
  }

  function handleLimparNfAdicionar() {
    setConsultaNfAdicionarId(null)
    setConsultaNfAdicionarErro(null)
    setConsultaItemAdicionadoMsg(null)
    setConsultaItemManualErro(null)
    setConsultaAguardandoEndereco(false)
    setPendingSelection(new Set())
  }

  function handleCancelarEnderecoConsulta() {
    setConsultaAguardandoEndereco(false)
    setPendingSelection(new Set())
    setConsultaItemAdicionadoMsg(null)
  }

  async function aplicarItemConsultaNaNf(
    nfId: string,
    nota: NotaFiscal,
    newItemIndex: number,
  ) {
    const snapshot = stateRef.current
    const notas = snapshot.notas.map((n) => (n.id === nfId ? nota : n))
    const nextState = {
      ...snapshot,
      notas,
      movimentos: upsertMovimentoEntrada(snapshot.movimentos, nota),
      activeNfId: nfId,
      activeItemIndex: newItemIndex,
    }
    setState(nextState)
    setPendingSelection(new Set())
    setSelectedEntradaIds((prev) => (prev.includes(nfId) ? prev : [...prev, nfId]))
    lastEntradaClickRef.current = nfId
    setConsultaAguardandoEndereco(true)
    setConsultaItemAdicionadoMsg(null)
    setConsultaItemManualErro(null)
    await saveNow(nextState)
  }

  async function handleReplicarItemConsulta(itemIndex: number, paletes: number) {
    const nf = state.notas.find((n) => n.id === consultaNfAdicionarId)
    if (!nf) return

    const result = replicarItemNotaFiscal(nf, itemIndex, paletes)
    if (!result) {
      setConsultaItemManualErro('Informe uma quantidade válida de paletes.')
      return
    }

    await aplicarItemConsultaNaNf(nf.id, result.nota, result.newItemIndex)
  }

  async function handleAdicionarItemManualConsulta(input: ItemManualInput) {
    const nf = state.notas.find((n) => n.id === consultaNfAdicionarId)
    if (!nf) return

    const erro = validarItemManualInput(input)
    if (erro) {
      setConsultaItemManualErro(erro)
      return
    }

    const result = adicionarItemManualNotaFiscal(nf, input)
    if (!result) {
      setConsultaItemManualErro('Não foi possível adicionar o item.')
      return
    }

    await aplicarItemConsultaNaNf(nf.id, result.nota, result.newItemIndex)
  }

  async function handleExcluirItemConsulta(itemIndex: number) {
    const nf = state.notas.find((n) => n.id === consultaNfAdicionarId)
    if (!nf) return

    const result = excluirItemNotaFiscal(nf, itemIndex)
    if (!result) {
      setConsultaItemManualErro(
        'Não é possível excluir este item. O último item com endereços precisa permanecer na NF.',
      )
      return
    }

    const snapshot = stateRef.current
    let notas: NotaFiscal[]
    let movimentos = snapshot.movimentos
    let activeNfId = snapshot.activeNfId
    let activeItemIndex = snapshot.activeItemIndex
    let consultaNfId = consultaNfAdicionarId
    let mensagem: string

    if (result.acao === 'remover_nf') {
      notas = snapshot.notas.filter((n) => n.id !== nf.id)
      movimentos = removerMovimentoEntradaAtivo(movimentos, nf.id)
      if (activeNfId === nf.id) {
        activeNfId = null
        activeItemIndex = null
      }
      consultaNfId = null
      mensagem = `NF ${nf.numero} removida das entradas em andamento.`
    } else {
      const nota = result.nota
      notas = snapshot.notas.map((n) => (n.id === nf.id ? nota : n))
      movimentos = upsertMovimentoEntrada(movimentos, nota)

      if (nota.status === 'concluida') {
        if (activeNfId === nf.id) {
          activeNfId = null
          activeItemIndex = null
        }
        mensagem = `Item removido. NF ${nf.numero} voltou para concluída.`
      } else {
        if (activeNfId === nf.id && activeItemIndex === itemIndex) {
          activeItemIndex = null
        }
        mensagem = `Item removido da NF ${nf.numero}.`
      }
    }

    notas = sanitizarNotasEntrada(notas)

    const nextState = {
      ...snapshot,
      notas,
      movimentos,
      activeNfId,
      activeItemIndex,
    }
    setState(nextState)
    setConsultaNfAdicionarId(consultaNfId)
    setSelectedEntradaIds((prev) => prev.filter((id) => id !== nf.id))
    if (activeNfId !== snapshot.activeNfId || activeItemIndex !== snapshot.activeItemIndex) {
      setPendingSelection(new Set())
    }
    setConsultaResultados((prev) =>
      prev.filter((r) => !(r.nfId === nf.id && r.itemIndex === itemIndex)),
    )
    setConsultaItemAdicionadoMsg(mensagem)
    setConsultaItemManualErro(null)
    setConsultaAguardandoEndereco(false)
    await saveNow(nextState)
  }

  async function handleRemoverDoEstoque(nfId: string, motivo: MotivoRemocaoEstoqueId) {
    const snapshot = stateRef.current
    const base = removerNfDoEstoque(
      {
        notas: snapshot.notas,
        movimentos: snapshot.movimentos,
        notasCanceladas: snapshot.notasCanceladas,
        emitentes: snapshot.emitentes,
      },
      nfId,
      { motivoRemocaoEstoque: motivo },
    )

    const nextState = {
      ...snapshot,
      notas: base.notas,
      movimentos: base.movimentos,
      notasCanceladas: base.notasCanceladas,
    }

    if (nfEditarId === nfId) {
      setNfEditarId(null)
      setEditItemIndex(null)
      setEditPendingSelection(new Set())
      setEditMoveOrigens(new Set())
      setEditMoveDestinos(new Set())
      setEditStagePending(new Set())
      setEditNovasPosicoes(new Set())
      setEditAdicionarPosicoesAlvo(null)
      setBuscaEditarErro(null)
    }
    if (nfBuscaSaidaId === nfId) {
      setNfBuscaSaidaId(null)
      limparEstadoSaida()
    }
    if (snapshot.activeNfId === nfId) {
      setPendingSelection(new Set())
    }
    setDetailAddress(null)

    setState(nextState)
    setEditSalvando(true)
    try {
      await saveNow(nextState)
    } finally {
      setEditSalvando(false)
    }
  }

  function handlePainelFiltrosChange(patch: Partial<PainelFiltros>) {
    setPainelFiltros((prev) => {
      const next = { ...prev, ...patch }
      savePainelFiltros(next)
      return next
    })
  }

  const temMovimentacaoEmAndamento = useCallback(() => {
    if (!nfEditarId) return false
    return (
      editMoveOrigens.size > 0 ||
      editMoveDestinos.size > 0 ||
      editPendingSelection.size > 0 ||
      editStagePending.size > 0 ||
      editNovasPosicoes.size > 0 ||
      editAdicionarPosicoesAlvo != null
    )
  }, [
    nfEditarId,
    editMoveOrigens,
    editMoveDestinos,
    editPendingSelection,
    editStagePending,
    editNovasPosicoes,
    editAdicionarPosicoesAlvo,
  ])

  const trySairMovimentacaoIncompleta = useCallback(
    (action: () => void) => {
      if (!temMovimentacaoEmAndamento() || !nfEditar) {
        action()
        return
      }
      setMovimentacaoPendenteAlert({
        nfNumero: nfEditar.numero,
        onConfirmLeave: () => {
          limparEstadoMapaEditar()
          setMovimentacaoPendenteAlert(null)
          action()
        },
      })
    },
    [temMovimentacaoEmAndamento, nfEditar],
  )

  const handleOpenSection = useCallback(
    (id: SidebarSectionId | null) => {
      if (id != null && !canOpenSection(plusModulos, id)) {
        setViewOnlyToast('Sem acesso a esta aba.')
        return
      }
      const apply = () => {
        if (id === 'painel') {
          setSidebarMode('fullscreen')
        } else if (id != null && sidebarMode === 'fullscreen') {
          setSidebarMode('open')
        }
        setOpenSection(id)
        try {
          const url = new URL(window.location.href)
          if (id) url.searchParams.set('secao', id)
          else url.searchParams.delete('secao')
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        } catch {
          /* ignore */
        }
      }
      if (openSectionRef.current === 'entrada' && id !== 'entrada') {
        trySairEntradaIncompleta(apply)
      } else if (openSectionRef.current === 'editar' && id !== 'editar') {
        trySairMovimentacaoIncompleta(apply)
      } else {
        apply()
      }
    },
    [
      trySairEntradaIncompleta,
      trySairMovimentacaoIncompleta,
      setSidebarMode,
      sidebarMode,
      plusModulos,
    ],
  )

  // WMS unificado (/app): o menu da moldura troca a seção mudando ?secao= e disparando popstate.
  const handleOpenSectionRef = useRef(handleOpenSection)
  handleOpenSectionRef.current = handleOpenSection
  useEffect(() => {
    const secoes: SidebarSectionId[] = [
      'entrada', 'saida', 'editar', 'consulta', 'historico', 'relatorio', 'painel',
      'canceladas', 'imprimir', 'cadastroVoz', 'financeiro', 'agendamentosHub',
    ]
    const onPopState = () => {
      const raw = new URLSearchParams(window.location.search).get('secao')?.trim() || ''
      if (secoes.includes(raw as SidebarSectionId) && raw !== openSectionRef.current) {
        handleOpenSectionRef.current(raw as SidebarSectionId)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleVoicePrefsChange = useCallback((patch: Partial<VoicePrefs>) => {
    setVoicePrefs((prev) => {
      const next = { ...prev, ...patch }
      if (patch.enabled === true && next.voiceLocked && !hasRegisteredVoices(voiceRegistry)) {
        setVoiceFeedback('Cadastre pelo menos uma voz individual antes de ativar.')
        return prev
      }
      if (patch.enabled === false) {
        stopSpeaking()
        setConversationLines([])
        setVoiceFeedback('Voz desativada.')
      }
      return next
    })
  }, [voiceRegistry])

  const executeVoiceCommand = useCallback(
    (cmd: VoiceCommand, opts?: { stayOnIa?: boolean }) => {
      if (cmd.type === 'parar') {
        setVoiceFeedback('Assistente desarmado.')
        return
      }

      if (cmd.type === 'blocked') {
        setVoiceFeedback(cmd.message)
        return
      }

      const msg = describeVoiceCommand(cmd)
      if (cmd.type !== 'desconhecido' && cmd.type !== 'assistente') {
        setVoiceFeedback(msg)
      }

      const stayOnIa = Boolean(opts?.stayOnIa)

      switch (cmd.type) {
        case 'open_section':
          handleOpenSection(cmd.section)
          break
        case 'close_section': {
          const current = openSectionRef.current
          if (cmd.section === null) {
            if (current === 'painel') setSidebarMode('open')
            handleOpenSection(null)
            break
          }
          if (current !== cmd.section) {
            setVoiceFeedback(`${cmd.label} não está aberta.`)
            break
          }
          if (cmd.section === 'painel') setSidebarMode('open')
          handleOpenSection(null)
          break
        }
        case 'close_current_section': {
          const current = openSectionRef.current
          if (!current) {
            setVoiceFeedback('Nenhuma aba aberta.')
            break
          }
          if (current === 'painel') setSidebarMode('open')
          handleOpenSection(null)
          break
        }
        case 'buscar_nota':
          if (!stayOnIa) handleOpenSection('editar')
          handleBuscarEditar(cmd.numero)
          break
        case 'buscar_saida':
          if (!stayOnIa) handleOpenSection('saida')
          handleBuscarSaida(cmd.numero)
          break
        case 'consultar': {
          if (!stayOnIa) handleOpenSection('consulta')
          const filtros: ConsultaEstoqueFiltros = {
            ...CONSULTA_FILTROS_VAZIOS,
            origem: 'ambos',
            ...cmd.filtros,
          }
          handleBuscarConsulta(filtros)
          break
        }
        case 'limpar_consulta':
          if (!stayOnIa) handleOpenSection('consulta')
          handleLimparConsulta()
          break
        case 'painel_periodo':
          handleOpenSection('painel')
          handlePainelFiltrosChange(painelFiltrosPorDias(cmd.dias))
          break
        case 'confirmar_movimentacao':
          handleOpenSection('editar')
          if (
            editMoveOrigensRef.current.size === 0 ||
            editMoveOrigensRef.current.size !== editMoveDestinosRef.current.size
          ) {
            setVoiceFeedback('Distribuição incompleta. Complete os destinos antes de confirmar.')
            break
          }
          void handleSalvarEditar()
          break
        case 'sidebar_mode':
          setSidebarMode(cmd.mode)
          break
        case 'toggle_theme':
          if (cmd.theme === 'auto') {
            toggleTheme()
          } else {
            setTheme(cmd.theme)
          }
          break
        case 'endereco':
          handleOpenSection('editar')
          if (vozOrigemAddress) {
            handleVozDestino(cmd.addressId)
          } else {
            setVoiceFeedback(
              'Abra a movimentação, selecione a origem na lista e repita o endereço de destino.',
            )
          }
          break
        case 'assistente':
          setVoiceFeedback(cmd.message)
          break
        case 'desconhecido':
          setVoiceFeedback('Em que posso ajudar?')
          break
      }
    },
    [
      handleOpenSection,
      setSidebarMode,
      setTheme,
      toggleTheme,
      vozOrigemAddress,
    ],
  )

  const resolveVoiceCommand = useCallback(
    async (text: string): Promise<VoiceCommand | null> => {
      return resolveVoiceCommandAsync(text, {
        aiEnabled: voicePrefs.aiInterpretation,
        geminiApiKey: voicePrefs.geminiApiKey,
        notas: state.notas,
      })
    },
    [voicePrefs.aiInterpretation, voicePrefs.geminiApiKey, state.notas],
  )

  const handleVoiceCommandText = useCallback(
    (text: string) => {
      const cleaned = prepareVoiceCommandText(text, voicePrefs.wakePhrase)
      void resolveVoiceCommand(cleaned || text).then((cmd) => {
        if (!cmd) {
          setVoiceFeedback('Comando vazio ou não reconhecido. Fale naturalmente, ex.: "quero ver o painel".')
          return
        }
        executeVoiceCommand(cmd)
      })
    },
    [executeVoiceCommand, resolveVoiceCommand, voicePrefs.wakePhrase],
  )

  const handleConversationStart = useCallback(async () => {
    conversationStateRef.current = createConversationState()
    resetWmsGeminiHistory()
    setConversationLines([{ role: 'assistant', text: VOICE_CONVERSATION_GREETING }])
    setVoiceFeedback(VOICE_CONVERSATION_GREETING)
    await speakText(VOICE_CONVERSATION_GREETING)
  }, [])

  const handleVoiceRecognized = useCallback((profile: { id: string; name: string }) => {
    setContaUsuarios(
      registrarAcessoUsuario({
        id: `voz-${profile.id}`,
        nome: profile.name,
      }),
    )
    setContaUsuarioAtivoId(getUsuarioAtivoId())
  }, [])

  const handleSelectContaUsuario = useCallback((id: string) => {
    setUsuarioAtivoId(id)
    setContaUsuarioAtivoId(id)
    setContaUsuarios(listarUsuariosSessao())
  }, [])

  const handleOpenContaSection = useCallback(
    (section: SidebarSectionId, focus?: 'conta' | 'comandos') => {
      setSidebarMode('open')
      handleOpenSection(section)
      window.setTimeout(() => {
        const selector =
          focus === 'conta'
            ? '.sidebar-section--cadastroVoz .cadastro-voz-individual'
            : '.sidebar-section--cadastroVoz'
        document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 280)
    },
    [handleOpenSection, setSidebarMode],
  )

  useEffect(() => {
    setContaUsuarios(
      registrarAcessoUsuario({ id: CONTA_SISTEMA_ID, nome: 'Doca Livre', tornarAtivo: false }),
    )
  }, [])

  const handleIaChatSend = useCallback(
    async (text: string) => {
      const prepared = text.trim()
      if (!prepared || iaSending) return

      const userId = `u-${Date.now()}`
      const pendingId = `p-${Date.now()}`
      setIaMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: prepared },
        { id: pendingId, role: 'assistant', content: '', pending: true },
      ])
      setIaSending(true)
      handleOpenSection('cadastroVoz')

      try {
        const localTurn = await processConversationTurn(
          prepared,
          conversationStateRef.current,
          async (t) => resolveVoiceCommandSync(t),
        )
        const geminiTurn = await resolveVoiceTurnAsync(prepared, {
          aiEnabled: true,
          geminiApiKey: voicePrefs.geminiApiKey,
          notas: stateRef.current.notas,
        })
        const geminiCmd = commandIsExecutable(geminiTurn?.command) ? geminiTurn.command : null
        const localCmd = commandIsExecutable(localTurn.command) ? localTurn.command : null
        const command = geminiCmd ?? localCmd
        const baseReply = geminiCmd
          ? geminiTurn?.reply || localTurn.reply
          : localCmd
            ? localTurn.reply
            : geminiTurn?.reply || localTurn.reply
        const reply = enrichCommandReply(command, stateRef.current.notas, baseReply)
        conversationStateRef.current = command ? createConversationState() : localTurn.state

        setIaMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId ? { ...m, content: reply, pending: false } : m,
          ),
        )
        setVoiceFeedback(reply)
        if (commandIsExecutable(command)) {
          executeVoiceCommand(command, { stayOnIa: command.type === 'consultar' })
        }
      } catch {
        setIaMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: 'Não consegui falar com a IA agora. Tente de novo.', pending: false }
              : m,
          ),
        )
      } finally {
        setIaSending(false)
      }
    },
    [
      iaSending,
      voicePrefs.geminiApiKey,
      state.notas,
      resolveVoiceCommand,
      executeVoiceCommand,
      handleOpenSection,
    ],
  )

  const handleConversationUtterance = useCallback(
    async (text: string): Promise<boolean> => {
      const prepared = prepareVoiceCommandText(text, voicePrefs.wakePhrase)
      if (!prepared) {
        return true
      }

      const geminiTurn = await resolveVoiceTurnAsync(prepared, {
        aiEnabled: voicePrefs.aiInterpretation,
        geminiApiKey: voicePrefs.geminiApiKey,
        notas: stateRef.current.notas,
      })

      const localTurn = await processConversationTurn(
        prepared,
        conversationStateRef.current,
        async (t) => resolveVoiceCommandSync(t),
      )
      const geminiCmd = commandIsExecutable(geminiTurn?.command) ? geminiTurn.command : null
      const localCmd = commandIsExecutable(localTurn.command) ? localTurn.command : null
      const command = geminiCmd ?? localCmd
      const result = {
        reply: enrichCommandReply(
          command,
          stateRef.current.notas,
          geminiCmd
            ? geminiTurn?.reply || localTurn.reply
            : localCmd
              ? localTurn.reply
              : geminiTurn?.reply || localTurn.reply,
        ),
        state: command ? createConversationState() : localTurn.state,
        command,
        endSession: Boolean(geminiTurn?.endSession) || localTurn.endSession,
      }
      conversationStateRef.current = result.state

      setConversationLines((prev) => [
        ...prev,
        { role: 'user', text: prepared },
        { role: 'assistant', text: result.reply },
      ])
      setVoiceFeedback(result.reply)
      await speakText(result.reply)

      if (commandIsExecutable(result.command)) {
        executeVoiceCommand(result.command)
      }

      if (result.endSession) {
        setConversationLines([])
        resetWmsGeminiHistory()
      }

      return !result.endSession
    },
    [
      executeVoiceCommand,
      resolveVoiceCommand,
      voicePrefs.wakePhrase,
      voicePrefs.aiInterpretation,
      voicePrefs.geminiApiKey,
      state.notas,
    ],
  )

  const voiceAssistant = useVoiceAssistant({
    enabled: voicePrefs.enabled,
    wakePhrase: voicePrefs.wakePhrase,
    voiceProfiles: voiceRegistry.profiles,
    requireVoiceMatch: voicePrefs.voiceLocked,
    interactive: voicePrefs.interactiveMode,
    onCommandText: handleVoiceCommandText,
    onConversationStart: handleConversationStart,
    onConversationUtterance: handleConversationUtterance,
    onError: (message) => setVoiceFeedback(message),
    onVoiceRecognized: handleVoiceRecognized,
  })

  useEffect(() => {
    if (!voiceFeedback) return
    const t = setTimeout(() => setVoiceFeedback(null), 5000)
    return () => clearTimeout(t)
  }, [voiceFeedback])

  const stageItens = useMemo(() => listarItensStage(state.notas), [state.notas])

  const detailOcc = detailAddress ? occupancy.get(detailAddress) : null
  const detailNota = detailOcc ? state.notas.find((n) => n.id === detailOcc.nfId) : null

  // Plus: mantém “Carregando” até o store do app ficar pronto (mín. ~0,5s).
  useEffect(() => {
    if (!hubBusy || selectedSystemId !== 'plus') return
    const started = Date.now()
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      const wait = Math.max(0, 500 - (Date.now() - started))
      window.setTimeout(() => {
        if (cancelled) return
        setHubBusy(false)
        setHubBusyLabel(null)
      }, wait)
    }
    if (!loading) {
      finish()
      return
    }
    const id = window.setInterval(() => {
      if (!loading) {
        window.clearInterval(id)
        finish()
      }
    }, 80)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [hubBusy, selectedSystemId, loading])

  function handleSystemSelect(id: SystemId) {
    void (async () => {
      setHubErro(null)
      setHubBusyLabel('Carregando')
      setHubBusy(true)
      if (id === 'plus') {
        markPortalEntry()
        setHubReady(true)
        setSelectedSystemId('plus')
        return
      }
      if (id !== 'light' && id !== 'pro') {
        setHubBusy(false)
        setHubBusyLabel(null)
        setHubErro('Sistema inválido.')
        return
      }
      const hub = loadHubSession()
      if (!hub?.hubToken) {
        setHubBusy(false)
        setHubBusyLabel(null)
        setHubErro('Sessão do portal expirada. Clique em Sair e faça login de novo.')
        return
      }
      const result = await issueSystemSsoUrl(id, hub.hubToken)
      if (!result.ok) {
        setHubBusy(false)
        setHubBusyLabel(null)
        setHubErro(result.erro || `Não foi possível abrir o WMS ${id === 'light' ? 'Light' : 'Pro'}.`)
        return
      }
      // Garante que Light/Pro não caiam de volta no domínio do Plus.
      const expectedHost =
        id === 'light'
          ? 'doca-livre-wms-light'
          : 'doca-livre-wms-pro'
      try {
        const host = new URL(result.url).hostname.toLowerCase()
        if (!host.includes(expectedHost) && !host.includes(id)) {
          setHubBusy(false)
          setHubBusyLabel(null)
          setHubErro(
            `URL SSO inesperada para ${id}: ${host}. Verifique SYSTEM_URL_${id.toUpperCase()} no Pro.`,
          )
          return
        }
      } catch {
        /* segue com o redirect */
      }
      // Mantém "Carregando" até a navegação sair desta página.
      window.location.assign(result.url)
    })()
  }

  function handleBackToSystemSelector() {
    clearPortalEntryMarker()
    const w =
      typeof window !== 'undefined'
        ? (window as unknown as { __WMS_UNIFIED__?: { hubHref?: string } }).__WMS_UNIFIED__
        : undefined
    window.location.assign(w?.hubHref || '/entrada')
  }

  function applyPortalPermissoes(
    permissoes:
      | Record<
          string,
          { pode_acessar?: boolean; modulos?: string[] | Record<string, string> | null }
        >
      | null
      | undefined,
    opts?: { isSuperuser?: boolean },
  ) {
    if (!permissoes) {
      setAllowedSystemIds(null)
      if (opts?.isSuperuser) {
        setPlusModulos(null)
        savePlusModulosSession(null)
      }
      return
    }
    const ids = (['light', 'plus', 'pro'] as const).filter(
      (s) => permissoes[s]?.pode_acessar !== false,
    )
    setAllowedSystemIds([...ids])
    // Super user: acesso total (editar) em todas as telas do Plus.
    const map = opts?.isSuperuser
      ? null
      : normalizePlusModulos(permissoes.plus?.modulos ?? null)
    setPlusModulos(map)
    savePlusModulosSession(map)
  }

  function refreshPortalMe(opts?: { openConfigIfSuper?: boolean; usuarioHint?: string }) {
    void fetchPortalMe().then((me) => {
      if (!me.ok) {
        const hint = opts?.usuarioHint || portalUsuario
        if (opts?.openConfigIfSuper && isLocalSuperUser(hint)) {
          setIsSuperUser(true)
          setShowPortalConfig(true)
        }
        return
      }
      const superU = Boolean(me.is_superuser) || isLocalSuperUser(me.usuario)
      setIsSuperUser(superU)
      setPortalUsuario(me.usuario || opts?.usuarioHint || portalUsuario)
      applyPortalPermissoes(me.permissoes, { isSuperuser: superU })
      if (opts?.openConfigIfSuper && superU) {
        setShowPortalConfig(true)
      }
    })
  }

  function handlePortalSair() {
    clearHubSession()
    clearPortalEntryMarker()
    clearPortalConfigSeen()
    clearPlusModulosSession()
    setPortalUsuario('')
    setHubReady(false)
    setSelectedSystemId(null)
    setShowPortalConfig(false)
    setIsSuperUser(false)
    setAllowedSystemIds(null)
    setPlusModulos(null)
    goToPublicPortal(true)
  }

  /** Na página dos sistemas: volta ao login do portal (mantém fluxo intro → login → hub). */
  function handleVoltarDoHub() {
    clearPortalEntryMarker()
    setSelectedSystemId(null)
    setHubReady(false)
    setShowPortalConfig(false)
    setHubErro(null)
    setCompanyIntroDone(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('hub')
      url.searchParams.delete('sistemas')
      url.searchParams.delete('sso_erro')
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}` || '/')
    } catch {
      /* ignore */
    }
  }

  // Sessão já aberta (reload): confirma Super Usuário na API e abre Configuração se ainda não viu.
  useEffect(() => {
    if (!hubReady || selectedSystemId || forceSystemsHub) return
    if (hasPortalConfigSeen()) {
      refreshPortalMe()
      return
    }
    refreshPortalMe({ openConfigIfSuper: true, usuarioHint: portalUsuario })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no boot do hub
  }, [])

  // Dentro do Plus: recarrega mapa de módulos (Visualizar / Editar / Sem acesso).
  useEffect(() => {
    if (selectedSystemId !== 'plus') return
    refreshPortalMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSystemId])

  // Fecha aba aberta se permissão deixar de permitir.
  useEffect(() => {
    if (openSection && !canOpenSection(plusModulos, openSection)) {
      setOpenSection(null)
    }
  }, [plusModulos, openSection])

  useEffect(() => {
    if (!viewOnlyToast) return
    const t = window.setTimeout(() => setViewOnlyToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [viewOnlyToast])

  const notifyViewOnly = useCallback(() => {
    setViewOnlyToast('Modo visualização — só é possível consultar. Alterações bloqueadas.')
  }, [])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      let dirty = false
      if (params.get('sair') === '1') {
        clearHubSession()
        clearPortalEntryMarker()
        setPortalUsuario('')
        setHubReady(false)
        setSelectedSystemId(null)
        params.delete('sair')
        dirty = true
      }
      if (params.get('hub') === '1' || params.get('sistemas') === '1') {
        clearPortalEntryMarker()
        const hub = loadHubSession()
        if (hub?.usuario) {
          setPortalUsuario(hub.usuario)
          setIsSuperUser(isLocalSuperUser(hub.usuario))
        }
        setSelectedSystemId(null)
        // Voltar dos sistemas: vai direto ao hub (não reabre Configuração).
        markPortalConfigSeen()
        setShowPortalConfig(false)
        setHubReady(Boolean(hub?.hubToken))
        setCompanyIntroDone(true)
        if (hub?.hubToken) refreshPortalMe()
        params.delete('hub')
        params.delete('sistemas')
        dirty = true
      }
      if (params.has('sso_erro')) {
        const raw = params.get('sso_erro') || ''
        if (raw) setHubErro(decodeURIComponent(raw))
        // Erro de SSO: garante hub dos 3 sistemas se houver sessão.
        clearPortalEntryMarker()
        const hub = loadHubSession()
        if (hub?.usuario) {
          setPortalUsuario(hub.usuario)
          setSelectedSystemId(null)
          setHubReady(true)
          setCompanyIntroDone(true)
        }
        params.delete('sso_erro')
        dirty = true
      }
      if (!dirty) return
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState({}, document.title, next || '/')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const token = readPortalSsoTokenFromLocation()
    if (!token) return
    let alive = true
    setSsoBootstrapping(true)
    setSsoError(null)
    void verifyPortalSsoToken(token).then((result) => {
      if (!alive) return
      clearPortalSsoTokenFromUrl()
      if (!result.ok) {
        clearPortalEntryMarker()
        setSsoError(result.erro)
        setSsoBootstrapping(false)
        setSelectedSystemId(null)
        return
      }
      const usuario = result.usuario.trim()
      const id = `sso:${usuario.toLowerCase()}`
      markPortalEntry()
      setPortalUsuario(usuario)
      setContaUsuarios(
        registrarAcessoUsuario({
          id,
          nome: usuario,
          tornarAtivo: true,
        }),
      )
      setContaUsuarioAtivoId(id)
      setSelectedSystemId('plus')
      setSsoBootstrapping(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Intro de marca → login do portal → hub dos 3 sistemas.
  if (!companyIntroDone) {
    return <CompanySplash onComplete={() => setCompanyIntroDone(true)} />
  }

  if (!hubReady && !selectedSystemId && !ssoBootstrapping) {
    return (
      <PortalLoginScreen
        onSuccess={(result) => {
          const usuario = result.usuario
          clearPortalConfigSeen()
          setPortalUsuario(usuario)
          setHubReady(true)
          setSelectedSystemId(null)
          const superU = Boolean(result.isSuperuser) || isLocalSuperUser(usuario)
          setIsSuperUser(superU)
          applyPortalPermissoes(result.permissoes, { isSuperuser: superU })
          // Super Usuário: Configuração (Hierarquia / Permissões) antes do hub.
          setShowPortalConfig(superU)
          refreshPortalMe({ openConfigIfSuper: true, usuarioHint: usuario })
        }}
      />
    )
  }

  if (ssoBootstrapping) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        Entrando pelo portal Doca Livre…
      </div>
    )
  }

  if (ssoError) {
    return (
      <div style={{ padding: 32, maxWidth: 480, margin: '48px auto' }}>
        <h2 style={{ marginTop: 0 }}>SSO não concluído</h2>
        <p>{ssoError}</p>
        <button
          type="button"
          onClick={() => {
            setSsoError(null)
            setHubReady(false)
            setSelectedSystemId(null)
            clearPortalEntryMarker()
          }}
        >
          Ir ao login
        </button>
      </div>
    )
  }

  if (showPortalConfig) {
    return (
      <PortalConfigScreen
        usuario={portalUsuario}
        onSair={() => {
          const w =
            typeof window !== 'undefined'
              ? (window as unknown as { __WMS_UNIFIED__?: { logoutHref?: string } }).__WMS_UNIFIED__
              : undefined
          window.location.assign(w?.logoutHref || '/login?sair=1')
        }}
        onContinuar={() => {
          markPortalConfigSeen()
          const w =
            typeof window !== 'undefined'
              ? (window as unknown as { __WMS_UNIFIED__?: { hubHref?: string } }).__WMS_UNIFIED__
              : undefined
          window.location.assign(w?.hubHref || '/entrada')
        }}
      />
    )
  }

  if (hubReady && !selectedSystemId) {
    return (
      <PortalConfigScreen
        usuario={portalUsuario}
        onSair={handlePortalSair}
        onContinuar={() => {
          window.location.assign('/entrada')
        }}
      />
    )
  }

  const selectedSystem = getSystemById(selectedSystemId!)
  if (selectedSystem?.url) {
    return (
      <SystemEntryScreen
        system={selectedSystem}
        onBack={handleBackToSystemSelector}
        onEnter={() => window.location.assign(selectedSystem.url!)}
      />
    )
  }

  // Entrada no Plus: tela cheia “Carregando” até o painel ficar pronto.
  if (selectedSystemId === 'plus' && hubBusy) {
    return <PortalLoadingOverlay label={hubBusyLabel || 'Carregando'} />
  }

  return (
    <div
      className={`app-shell${sidebarMode === 'fullscreen' ? ' app-shell--menu-fullscreen' : ''}`}
    >
      <PwaInstallBanner />
      <AmbienteBanner />
      {savingImportante && (
        <div className="salvando-overlay" role="status" aria-live="polite">
          <div className="salvando-overlay-card">
            <span className="salvando-overlay-spinner" aria-hidden />
            <span className="salvando-overlay-texto">Salvando…</span>
          </div>
        </div>
      )}
      <AppTopBar
        sidebarMode={sidebarMode}
        onSidebarModeChange={setSidebarMode}
        theme={theme}
        onToggleTheme={toggleTheme}
        persistError={error}
        onBackToSystems={handleBackToSystemSelector}
        mapLegend={{
          allocateMode: panelAllocateMode,
          editMode: editMode || (nfEditar != null && !editMarcandoStage),
          activeNfNumero: panelActiveNfNumero,
          editItemAtivo: editMode,
          editAddresses: editMapAddresses,
          consultaAddresses: consultaAddresses.size > 0 ? consultaAddresses : undefined,
          saidaAddresses:
            nfEditar ? undefined : saidaAddresses.size > 0 ? saidaAddresses : undefined,
          saidaItemDestaqueAddresses:
            nfEditar || saidaItemDestaqueAddresses.size === 0
              ? undefined
              : saidaItemDestaqueAddresses,
          saidaFlaggedAddresses: editMode ? undefined : saidaFlaggedAddresses,
          movimentacaoDistribuicao:
            nfEditar != null &&
            (editMoveOrigens.size > 0 || editMoveDestinos.size > 0),
        }}
        contaUsuarios={contaUsuarios}
        contaUsuarioAtivoId={contaUsuarioAtivoId}
        onSelectContaUsuario={handleSelectContaUsuario}
        onOpenContaSection={handleOpenContaSection}
        onZerarBancoHomolog={handleZerarBancoHomolog}
        zerandoBancoHomolog={zerandoBancoHomolog}
      />
      <div className="app-workspace">
      {viewOnlyToast ? (
        <div className="portal-view-only-toast" role="status">
          {viewOnlyToast}
        </div>
      ) : null}
      <AppSidebar
        sidebarMode={sidebarMode}
        onSidebarModeChange={setSidebarMode}
        openSection={openSection}
        onOpenSectionChange={handleOpenSection}
        plusModulos={plusModulos}
        onBeforeLeaveEntrada={trySairEntradaIncompleta}
        entrada={guardMutations(
          {
          notas: state.notas,
          activeNfId: state.activeNfId,
          selectedNfIds: selectedEntradaIds,
          activeItemIndex: state.activeItemIndex,
          pendingCount: pendingSelection.size,
          paletesRestantes: paletesRestantesCount,
          onUpload: handleUpload,
          onSelectNf: handleSelectNf,
          onSelectItem: handleSelectItem,
          onUpdateNfDataArmazenagem: handleUpdateNfDataArmazenagem,
          onUpdateItemCampos: handleUpdateItemCampos,
          onUpdateItemQuantidade: handleUpdateItemQuantidade,
          onUpdateItemPaletes: handleUpdateItemPaletes,
          onUpdateItemLocalizacao: handleUpdateItemLocalizacao,
          onDesmembrarItem: handleDesmembrarItem,
          onConfirmItem: handleConfirmItem,
          onFinishEntrada: handleFinishEntrada,
          onDeixarPendente: handleDeixarEntradaPendente,
          onCancelarEntrada: handleCancelarEntrada,
          onLimparSelecao: handleLimparSelecao,
          onCadastrarManual: () => {
            trySairEntradaIncompleta(() => {
              setManualNfError(null)
              setManualNfNumeroInicial('')
              setManualNfModalOpen(true)
            })
          },
          uploadError,
        },
          sectionReadOnly && openSection === 'entrada',
          [
            'onUpload',
            'onUpdateNfDataArmazenagem',
            'onUpdateItemCampos',
            'onUpdateItemQuantidade',
            'onUpdateItemPaletes',
            'onUpdateItemLocalizacao',
            'onDesmembrarItem',
            'onConfirmItem',
            'onFinishEntrada',
            'onDeixarPendente',
            'onCancelarEntrada',
            'onLimparSelecao',
            'onCadastrarManual',
          ],
          notifyViewOnly,
        )}
        agendamentosHub={guardMutations(
          {
          notas: state.notas,
          onDarEntradaXml: (prev, files) => {
            hubEntradaPendenteRef.current = { id: prev.id, nfNumero: prev.nota_fiscal }
            void handleUpload(files)
          },
          onDarEntradaManual: (prev) => {
            const existente = prev.nota_fiscal ? findNotaByNumero(state.notas, prev.nota_fiscal) : undefined
            if (existente) {
              handleSelectNf(existente.id)
              return
            }
            hubEntradaPendenteRef.current = { id: prev.id, nfNumero: prev.nota_fiscal }
            setManualNfError(null)
            setManualNfNumeroInicial(prev.nota_fiscal ?? '')
            setManualNfModalOpen(true)
          },
          onAbrirNf: (id) => handleSelectNf(id),
        },
          sectionReadOnly && openSection === 'agendamentosHub',
          ['onDarEntradaXml', 'onDarEntradaManual'],
          notifyViewOnly,
        )}
        saida={guardMutations(
          {
          origemEstoque: saidaOrigemEstoque,
          modoBusca: saidaModoBusca,
          onModoBuscaChange: handleModoBuscaSaidaChange,
          nfBusca: nfBuscaSaida,
          saidaXml: saidaXmlDoc,
          referencias: saidaReferencias,
          onSelecionarReferencia: handleSelecionarReferenciaSaida,
          notasOrigem: notasOrigemSaida,
          origemSelecionadaId: saidaOrigemSelecionadaId,
          onOrigemSelecionadaChange: setSaidaOrigemSelecionadaId,
          onVincularOrigem: handleVincularOrigemSaida,
          onUploadXml: handleUploadSaidaXml,
          itensSaida: saidaItensExibicao,
          limitesPorItem: saidaLimitesPorItem,
          vinculoAvisos: saidaVinculoAvisos,
          itemIndex: saidaItemIndex,
          modoPalete: saidaModoPalete,
          qtdPaletesInput: saidaQtdPaletesInput,
          qtdPaletesAlvo: saidaQtdPaletesAlvo,
          paletesSelecionados: [...saidaPaletesSelecionados],
          selecaoConcluida: saidaSelecaoConcluida,
          paleteAtivo: saidaPaleteAtivo,
          caixasPalete: saidaCaixasPalete,
          paletesConfirmados: saidaPaletesConfirmados,
          onBuscar: handleBuscarSaida,
          onSelectItem: handleSelectItemSaida,
          onQtdPaletesChange: handleQtdPaletesChange,
          onIniciarSelecao: handleIniciarSelecaoSaida,
          onConfirmarSelecaoPaletes: handleConfirmarSelecaoPaletes,
          onCaixasPaleteChange: handleCaixasPaleteChange,
          onConfirmarPalete: handleConfirmarPaleteSaida,
          onRemoverPalete: handleRemoverPaleteSaida,
          onFinalizarSaida: handleFinalizarSaida,
          onCancelarSaida: handleCancelarSaida,
          dataSaidaInput: saidaDataInput,
          onDataSaidaChange: setSaidaDataInput,
          stageItemIndex: saidaStageItemIndex,
          stageQtdInput: saidaStageQtdInput,
          stageConfirmados: saidaStageConfirmados,
          onSelectItemStage: handleSelectItemStage,
          onStageQtdChange: handleStageQtdChange,
          onConfirmarItemStage: handleConfirmarItemStage,
          onRemoverItemStage: handleRemoverItemStage,
          onFinalizarSaidaStage: handleFinalizarSaidaStage,
          buscaErro,
          uploadXmlErro: saidaUploadXmlErro,
          selecaoErro: saidaSelecaoErro,
        },
          sectionReadOnly && openSection === 'saida',
          [
            'onVincularOrigem',
            'onUploadXml',
            'onIniciarSelecao',
            'onConfirmarSelecaoPaletes',
            'onConfirmarPalete',
            'onRemoverPalete',
            'onFinalizarSaida',
            'onCancelarSaida',
            'onConfirmarItemStage',
            'onRemoverItemStage',
            'onFinalizarSaidaStage',
            'onQtdPaletesChange',
            'onCaixasPaleteChange',
            'onStageQtdChange',
            'onDataSaidaChange',
          ],
          notifyViewOnly,
        )}
        historico={{
          movimentos: movimentosHistorico,
          canceladas: state.notasCanceladas,
          notas: state.notas,
        }}
        relatorio={{
          notas: state.notas,
        }}
        painel={{
          filtros: painelFiltros,
          movimentos: movimentosHistorico,
          notas: state.notas,
          onFiltrosChange: handlePainelFiltrosChange,
        }}
        canceladas={guardMutations(
          {
          canceladas: canceladasAtivas,
          notas: state.notas,
          onUpload: handleUploadCancelada,
          onVincular: handleVincularCancelada,
          onDesvincular: handleDesvincularCancelada,
          onExcluir: handleExcluirCancelada,
          onCancelarCancelada: handleCancelarCancelada,
          canceladaPendenteId,
          uploadError: uploadCanceladaError,
        },
          sectionReadOnly && openSection === 'canceladas',
          ['onUpload', 'onVincular', 'onDesvincular', 'onExcluir', 'onCancelarCancelada'],
          notifyViewOnly,
        )}
        editar={guardMutations(
          {
          nfBusca: nfEditar,
          itemIndex: editItemIndex,
          pendingCount: editPendingSelection.size,
          stagePendingCount: editStagePending.size,
          moveOrigensCount: editMoveOrigens.size,
          moveDestinosCount: editMoveDestinos.size,
          salvando: editSalvando,
          marcandoStage: editMarcandoStage,
          modoMovimentacao: editModoMovimentacao,
          onModoMovimentacaoChange: handleEditModoMovimentacao,
          vozOrigemAddress,
          vozErro,
          onSelectVozOrigem: handleSelectVozOrigem,
          onVozDestino: handleVozDestino,
          onVozErro: setVozErro,
          onLimparVozErro: () => setVozErro(null),
          onPrepareLocalSpeech: voiceAssistant.suspendForLocalSpeech,
          onReleaseLocalSpeech: voiceAssistant.resumeAfterLocalSpeech,
          enderecosOcupados: editEnderecosOcupados,
          enderecosSelecionados: editPendingSelection,
          onBuscar: handleBuscarEditar,
          onSelectItem: handleSelectItemEditar,
          onAdicionarEnderecoDestino: handleAdicionarEnderecoDestino,
          onSalvar: handleSalvarEditar,
          onRemoverDoEstoque: handleRemoverDoEstoque,
          onCancelarEditar: handleCancelarEditar,
          adicionarPosicoesAlvo: editAdicionarPosicoesAlvo,
          adicionarPosicoesSelecionadas: editNovasPosicoes.size,
          onIniciarAdicionarPosicoes: handleIniciarAdicionarPosicoes,
          onConfirmarAdicionarPosicoes: handleConfirmarAdicionarPosicoes,
          onCancelarAdicionarPosicoes: handleCancelarAdicionarPosicoes,
          buscaErro: buscaEditarErro,
        },
          sectionReadOnly && openSection === 'editar',
          [
            'onModoMovimentacaoChange',
            'onSelectVozOrigem',
            'onVozDestino',
            'onAdicionarEnderecoDestino',
            'onSalvar',
            'onRemoverDoEstoque',
            'onCancelarEditar',
            'onIniciarAdicionarPosicoes',
            'onConfirmarAdicionarPosicoes',
            'onCancelarAdicionarPosicoes',
          ],
          notifyViewOnly,
        )}
        consulta={guardMutations(
          {
          notas: state.notas,
          emitentesSugeridos,
          resultados: consultaResultados,
          buscaErro: consultaErro,
          onBuscar: handleBuscarConsulta,
          onLimpar: handleLimparConsulta,
          onAlternarDestaqueInventario: handleAlternarDestaqueInventario,
          resultadosDestacados: consultaResultados,
          nfAdicionar: consultaNfAdicionar,
          nfAdicionarErro: consultaNfAdicionarErro,
          itemAdicionadoMsg: consultaItemAdicionadoMsg,
          itemManualErro: consultaItemManualErro,
          aguardandoEndereco: consultaAguardandoEndereco,
          paletesTotal: consultaAguardandoEndereco ? paletesTotal : null,
          enderecosSelecionados: consultaAguardandoEndereco ? pendingSelection.size : 0,
          onBuscarNfAdicionar: handleBuscarNfAdicionar,
          onReplicarItem: handleReplicarItemConsulta,
          onExcluirItem: handleExcluirItemConsulta,
          onAdicionarItemManual: handleAdicionarItemManualConsulta,
          onConfirmarEnderecos: handleConfirmItem,
          onCancelarEnderecos: handleCancelarEnderecoConsulta,
          onLimparNfAdicionar: handleLimparNfAdicionar,
          filtrosAplicados: consultaFiltros,
          filtrosAplicadosTick: consultaFiltrosTick,
        },
          sectionReadOnly && openSection === 'consulta',
          [
            'onReplicarItem',
            'onExcluirItem',
            'onAdicionarItemManual',
            'onConfirmarEnderecos',
            'onCancelarEnderecos',
            'onBuscarNfAdicionar',
            'onLimparNfAdicionar',
          ],
          notifyViewOnly,
        )}
        imprimir={guardMutations(
          {
          selectedCamaras: printCamaras,
          onToggleCamara: (id) =>
            setPrintCamaras((prev) =>
              prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id].sort((a, b) => a - b),
            ),
          onSelectAll: () => setPrintCamaras(CAMARAS.map((c) => c.id)),
          onClearAll: () => setPrintCamaras([]),
          onPrint: schedulePrint,
        },
          sectionReadOnly && openSection === 'imprimir',
          ['onPrint'],
          notifyViewOnly,
        )}
        cadastroVoz={guardMutations(
          {
          messages: iaMessages,
          sending: iaSending,
          onSend: handleIaChatSend,
        },
          sectionReadOnly && openSection === 'cadastroVoz',
          ['onSend'],
          notifyViewOnly,
        )}
        financeiro={guardMutations(
          {
          data: financeiro.data,
          notas: state.notas,
          movimentos: movimentosHistorico,
          loading: financeiro.loading,
          saving: financeiro.saving,
          error: financeiro.error,
          onUpdate: financeiro.updateData,
          onSaveNow: financeiro.saveNow,
          onUpdateNotaDataArmazenagem: handleUpdateNfDataArmazenagem,
        },
          sectionReadOnly && openSection === 'financeiro',
          ['onUpdate', 'onSaveNow', 'onUpdateNotaDataArmazenagem'],
          notifyViewOnly,
        )}
      />

      <main className="main-panel">
        {buscaEncontrada && (
          <BuscaEncontradaToast aviso={buscaEncontrada} onClose={() => setBuscaEncontrada(null)} />
        )}
        <LayoutPanel
          occupancy={displayOccupancy}
          pendingSelection={panelPendingSelection}
          activeNfNumero={panelActiveNfNumero}
          activeNfId={
            mapaDestaquesAtivos ? (nfEditar?.id ?? activeNf?.id ?? null) : null
          }
          allocateMode={panelAllocateMode}
          editMode={
            openSection === 'editar' && (editMode || (nfEditar != null && !editMarcandoStage))
          }
          editItemAtivo={openSection === 'editar' && editMode}
          editMoveOrigens={openSection === 'editar' && nfEditar ? editMoveOrigens : undefined}
          editMoveDestinos={openSection === 'editar' && nfEditar ? editMoveDestinos : undefined}
          editMarcandoStage={openSection === 'editar' && nfEditar ? editMarcandoStage : false}
          editItemIndex={openSection === 'editar' && nfEditar ? editItemIndex : null}
          editItemNoStage={(() => {
            if (nfEditar == null || editItemIndex == null) return false
            const it = nfEditar.items.find((i) => i.index === editItemIndex)
            return it != null && itemNoStage(it)
          })()}
          editAdicionandoPosicoes={editAdicionarPosicoesAlvo != null}
          editAddresses={openSection === 'editar' ? editMapAddresses : undefined}
          consultaAddresses={
            openSection === 'consulta' && consultaAddresses.size > 0
              ? consultaAddresses
              : undefined
          }
          notas={state.notas}
          movimentos={state.movimentos}
          stageHighlighted={
            (openSection === 'consulta' && consultaStageHighlighted) || mapFocusStage
          }
          onStageOpen={() => setStageModalOpen(true)}
          saidaAddresses={
            openSection === 'saida' && !nfEditar && saidaAddresses.size > 0
              ? saidaAddresses
              : undefined
          }
          saidaItemDestaqueAddresses={
            openSection === 'saida' && !nfEditar && saidaItemDestaqueAddresses.size > 0
              ? saidaItemDestaqueAddresses
              : undefined
          }
          saidaFlaggedAddresses={
            openSection === 'saida' && !editMode ? saidaFlaggedAddresses : undefined
          }
          paintMode={
            mapaDestaquesAtivos &&
            (editAdicionarPosicoesAlvo != null ||
              (editMode && editMarcandoStage) ||
              (editMode && !editMarcandoStage) ||
              allocateMode ||
              consultaAguardandoEndereco ||
              (saidaModoPalete && (saidaQtdPaletesAlvo != null || saidaSelecaoConcluida)))
          }
          onCellClick={handleCellClick}
          onCellPaint={handleCellPaint}
          paletesRestantes={paletesRestantesCount}
          paletesTotal={panelPaletesTotal}
          saidaMode={saidaModoPalete}
          editStagePending={editStagePending}
          stageDropEnabled={editStagePending.size > 0}
          onStageDrop={() => void handleAplicarStageDrop()}
          focusAddressId={
            mapaDestaquesAtivos ? (vozOrigemAddress ?? mapFocusAddressId) : null
          }
          focusStage={mapaDestaquesAtivos && !vozOrigemAddress && mapFocusStage}
          focusScrollToken={mapaDestaquesAtivos ? mapFocusScrollToken : 0}
          pulseAddressId={mapaDestaquesAtivos ? mapPulseAddressId : null}
        />
      </main>
      </div>

      <VoiceAssistantHUD
        phase={voiceAssistant.phase}
        liveText={voiceAssistant.liveText}
        lastHint={voiceAssistant.lastHint}
        feedback={voiceFeedback}
        conversationLines={conversationLines}
        interactiveMode={voicePrefs.interactiveMode}
        wakePhrase={voicePrefs.wakePhrase}
        onCancel={() => {
          stopSpeaking()
          setConversationLines([])
          voiceAssistant.cancelArmed()
          setVoiceFeedback(null)
        }}
      />

      <PrintLayoutDocument
        camaraIds={printCamaras}
        occupancy={printWithOccupancy ? occupancy : undefined}
      />

      {entradaPendenteAlert && (
        <EntradaPendenteAlert
          nfNumero={entradaPendenteAlert.nfNumero}
          itensPendentes={entradaPendenteAlert.itensPendentes}
          onClose={() => setEntradaPendenteAlert(null)}
          onConfirmLeave={entradaPendenteAlert.onConfirmLeave}
        />
      )}

      {movimentacaoPendenteAlert && (
        <MovimentacaoPendenteAlert
          nfNumero={movimentacaoPendenteAlert.nfNumero}
          onClose={() => setMovimentacaoPendenteAlert(null)}
          onConfirmLeave={movimentacaoPendenteAlert.onConfirmLeave}
        />
      )}

      {paletesLimiteAlert && (
        <PaletesLimiteAlert
          kind={paletesLimiteAlert}
          onClose={() => setPaletesLimiteAlert(null)}
        />
      )}

      {ocupadoAlert && (
        <OcupadoAlert
          addressId={ocupadoAlert.addressId}
          occupancy={ocupadoAlert.occ}
          onClose={() => setOcupadoAlert(null)}
        />
      )}

      {manualNfModalOpen && (
        <ManualNfModal
          notas={state.notas}
          emitentesSugeridos={emitentesSugeridos}
          serverError={manualNfError}
          startInCreateMode
          initialNumero={manualNfNumeroInicial}
          onConfirm={handleManualNfConfirm}
          onClose={() => {
            setManualNfModalOpen(false)
            setManualNfError(null)
            setManualNfNumeroInicial('')
            hubEntradaPendenteRef.current = null
          }}
        />
      )}

      {detailAddress && detailOcc && detailNota && (
        <DetailModal
          addressId={detailAddress}
          nota={detailNota}
          onClose={() => setDetailAddress(null)}
        />
      )}

      {entradaDestinoPendente && (
        <EntradaDestinoModal
          nfNumeros={entradaDestinoPendente.imported.map((nf) => nf.numero)}
          onConfirm={(destino) => void handleEntradaDestinoConfirm(destino)}
          onCancel={handleEntradaDestinoCancel}
        />
      )}

      {saidaDestinoPendente && (
        <EscolhaEstoqueModal
          title="Origem da saída"
          pergunta={`A NF ${saidaDestinoPendente.numero} possui estoque no armazém e no stage. De onde deseja dar saída?`}
          opcoes={[
            {
              id: 'armazem',
              label: 'Saída normal (armazém)',
              descricao: 'Retirar paletes endereçados',
            },
            {
              id: 'stage',
              label: 'Saída do stage',
              descricao: 'Retirar itens em separação',
            },
          ]}
          onConfirm={(opcao) => {
            const nf = saidaDestinoPendente
            clearSaidaDestinoPendenteId()
            setSaidaDestinoPendente(null)
            aplicarBuscaSaida(nf, opcao === 'stage' ? 'stage' : 'armazem')
          }}
          onCancel={() => {
            clearSaidaDestinoPendenteId()
            setSaidaDestinoPendente(null)
          }}
        />
      )}

      {stageModalOpen && (
        <StageModal itens={stageItens} onClose={() => setStageModalOpen(false)} />
      )}
    </div>
  )
}
