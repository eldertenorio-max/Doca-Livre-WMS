import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isAppOnline, subscribeAppConnectivity } from '../lib/appConnectivity'
import { usernameFromSession } from '../lib/authUser'
import {
  buildProductLookupMaps,
  buscarProdutoUnicoLocal,
  filtrarSugestoesProduto,
} from '../lib/buscaProdutoInventario'
import {
  fetchInventarioCapturaPresenca,
  nomesContadoresAtivos,
  PRESENCA_PING_INTERVAL_MS,
  PRESENCA_POLL_INTERVAL_MS,
  upsertInventarioCapturaPresenca,
  type InventarioCapturaPresencaRow,
} from '../lib/inventarioCapturaPresenca'
import { camaraFromEnderecoCodigo, findEnderecoByCodigo, formatEnderecoCodigoInput, normalizeEnderecoCodigo, buildCodigoEndereco } from '../lib/enderecamentoStore'
import {
  camarasDosEnderecos,
  enderecosParaCaptura,
  niveisDosEnderecos,
  partesFormDoCodigo,
  posicoesDosEnderecos,
  ruasDosEnderecos,
} from '../lib/enderecamentoCascata'
import {
  findEnderecoNaLista,
  getEnderecoLista,
  type EnderecoLista,
} from '../lib/enderecamentoListaSupabase'
import {
  fetchProductOptionByCodigoFromDb,
  fetchProductOptionByDescricaoFromDb,
} from '../lib/fetchProductOptionByCodigo'
import {
  addLinhaInventario,
  deleteLinhaInventario,
  enderecoPermitidoNaSessao,
  getInventario,
  updateLinhaInventario,
  type InventarioLinhaCaptura,
  type InventarioSessao,
} from '../lib/inventarioSessaoStore'
import {
  getProdutoLista,
  produtoListaParaProductOptions,
} from '../lib/produtoListaSupabase'
import { mapRowToProductOption, TABELA_PRODUTOS, type ProductOption } from '../lib/productOptionMapper'
import {
  loadEnderecoListCache,
  loadProductListCache,
  loadProductOptionsCache,
  saveEnderecoListCache,
  saveProductListCache,
  saveProductOptionsCache,
} from '../lib/offlineCatalogCache'
import {
  countPendingInventarioSync,
  flushPendingInventarioSync,
} from '../lib/inventarioOfflineSync'
import {
  PRODUTO_LISTA_ATUALIZADA_EVENT,
  setSessaoProdutoListaContext,
} from '../lib/sessaoProdutoListaContext'
import { supabase } from '../lib/supabaseClient'
import BarcodeCameraScanner, { IconClearField, IconScanBarcode, IconCalendar } from '../components/barcode/BarcodeCameraScanner'
import CapturaLinhasMobile from '../components/inventario/CapturaLinhasMobile'
import { linhaCapturaParaMobile } from '../lib/capturaLinhaMobile'
import {
  chaveEnderecoCaptura,
  classeLinhaCapturaEndereco,
  confirmarSalvarEnderecoRepetido,
  enderecosDuplicadosNasLinhas,
  linhasComMesmoEndereco,
} from '../lib/capturaEnderecoDuplicado'
import {
  clampDataFabricacaoYmd,
  isFabricacaoAposHoje,
  isVencimentoAntesFabricacao,
  maxDataFabricacaoHoje,
} from '../lib/contagemDatasValidacao'

type Props = {
  inventarioId: string
  onVoltar: () => void
  session?: Session | null
}

const SUGESTOES_MAX = 15
const LINHAS_PAGE_SIZE = 15

function formatDateBR(d: Date) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatDateTimeBR(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

function formatYmdBR(isoYmd: string) {
  if (!isoYmd?.trim()) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoYmd.slice(0, 10))
  if (!m) return isoYmd
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatHora(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDataLinha(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function abrirDatePicker(inputId: string) {
  const el = document.getElementById(inputId) as HTMLInputElement | null
  el?.focus()
  try {
    el?.showPicker?.()
  } catch {
    /* showPicker indisponível */
  }
}

function linhaCamaraLabel(linha: InventarioLinhaCaptura): string {
  if (linha.camara != null && Number.isFinite(linha.camara)) return String(linha.camara)
  const parsed = camaraFromEnderecoCodigo(linha.endereco)
  return parsed != null ? String(parsed) : '—'
}

function IconSave() {
  return (
    <svg className="inventario-captura__btn-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
    </svg>
  )
}

export default function InventarioCaptura({ inventarioId, onVoltar, session }: Props) {
  const [sessao, setSessao] = useState<InventarioSessao | null>(null)
  const [sessaoLoading, setSessaoLoading] = useState(true)
  const [listaEndereco, setListaEndereco] = useState<EnderecoLista | null>(null)
  const [produtos, setProdutos] = useState<ProductOption[]>([])
  const [produtosCarregando, setProdutosCarregando] = useState(false)
  const [endCamara, setEndCamara] = useState('')
  const [endRua, setEndRua] = useState('')
  const [endPosicao, setEndPosicao] = useState('')
  const [endNivel, setEndNivel] = useState('')
  const [enderecoCodigoInput, setEnderecoCodigoInput] = useState('')
  const [codigoBarras, setCodigoBarras] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [unidade, setUnidade] = useState('')
  const [up, setUp] = useState('')
  const [lote, setLote] = useState('')
  const [fabricacao, setFabricacao] = useState('')
  const [validade, setValidade] = useState('')
  const [produtoLabel, setProdutoLabel] = useState('')
  const [codigoInterno, setCodigoInterno] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [sugestoesOpen, setSugestoesOpen] = useState(false)
  const [sugestaoIdx, setSugestaoIdx] = useState(0)
  const [presencaRows, setPresencaRows] = useState<InventarioCapturaPresencaRow[]>([])
  const [editandoLinhaId, setEditandoLinhaId] = useState<string | null>(null)
  const [linhasPage, setLinhasPage] = useState(1)
  const [barcodeCameraOpen, setBarcodeCameraOpen] = useState(false)
  const [barcodeCameraAlvo, setBarcodeCameraAlvo] = useState<'endereco' | 'produto'>('produto')
  const [online, setOnline] = useState(() => isAppOnline())
  const [pendingSync, setPendingSync] = useState(() => countPendingInventarioSync())

  const camaraRef = useRef<HTMLSelectElement>(null)
  const enderecoCodigoRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const comboRef = useRef<HTMLDivElement>(null)
  const resolverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const usuarioLogado = usernameFromSession(session)

  const contadoresOnline = useMemo(
    () => nomesContadoresAtivos(presencaRows, usuarioLogado),
    [presencaRows, usuarioLogado],
  )

  const productMaps = useMemo(() => buildProductLookupMaps(produtos), [produtos])

  const sugestoes = useMemo(
    () => filtrarSugestoesProduto(codigoBarras, produtos, productMaps, SUGESTOES_MAX),
    [codigoBarras, produtos, productMaps],
  )

  const linhasSalvas = useMemo(
    () => [...(sessao?.linhas ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sessao?.linhas],
  )

  const enderecosRepetidos = useMemo(() => enderecosDuplicadosNasLinhas(linhasSalvas), [linhasSalvas])

  const totalLinhasPages = Math.max(1, Math.ceil(linhasSalvas.length / LINHAS_PAGE_SIZE))
  const linhasPageSafe = Math.min(linhasPage, totalLinhasPages)

  const linhasPaginadas = useMemo(() => {
    const start = (linhasPageSafe - 1) * LINHAS_PAGE_SIZE
    return linhasSalvas.slice(start, start + LINHAS_PAGE_SIZE)
  }, [linhasSalvas, linhasPageSafe])

  const linhasRangeFrom =
    linhasSalvas.length === 0 ? 0 : (linhasPageSafe - 1) * LINHAS_PAGE_SIZE + 1
  const linhasRangeTo =
    linhasSalvas.length === 0 ? 0 : Math.min(linhasPageSafe * LINHAS_PAGE_SIZE, linhasSalvas.length)

  const linhasMobile = useMemo(
    () =>
      linhasPaginadas.map((linha, idx) =>
        linhaCapturaParaMobile(
          linha,
          linhasSalvas.length - ((linhasPageSafe - 1) * LINHAS_PAGE_SIZE + idx),
          editandoLinhaId === linha.id,
          enderecosRepetidos.has(chaveEnderecoCaptura(linha.endereco)),
        ),
      ),
    [linhasPaginadas, linhasSalvas.length, linhasPageSafe, editandoLinhaId, enderecosRepetidos],
  )

  useEffect(() => {
    setLinhasPage((p) => Math.min(p, Math.max(1, Math.ceil(linhasSalvas.length / LINHAS_PAGE_SIZE))))
  }, [linhasSalvas.length])

  const posicoesInventario = useMemo(() => {
    const list = sessao?.posicoesCodigos ?? []
    return [...list].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [sessao?.posicoesCodigos])

  const enderecosCaptura = useMemo(
    () => enderecosParaCaptura(listaEndereco, sessao),
    [listaEndereco, sessao],
  )

  const endereco = useMemo(() => {
    if (!endCamara || !endRua || !endPosicao || !endNivel) return ''
    const cam = Number(endCamara)
    const pos = Number(endPosicao)
    const niv = Number(endNivel)
    if (!Number.isFinite(cam) || !Number.isFinite(pos) || !Number.isFinite(niv)) return ''
    return buildCodigoEndereco(cam, endRua, pos, niv)
  }, [endCamara, endRua, endPosicao, endNivel])

  const camarasOpcoes = useMemo(() => camarasDosEnderecos(enderecosCaptura), [enderecosCaptura])

  const ruasOpcoes = useMemo(() => {
    const cam = Number(endCamara)
    if (!Number.isFinite(cam)) return []
    return ruasDosEnderecos(enderecosCaptura, cam)
  }, [enderecosCaptura, endCamara])

  const posicoesOpcoes = useMemo(() => {
    const cam = Number(endCamara)
    if (!Number.isFinite(cam) || !endRua) return []
    return posicoesDosEnderecos(enderecosCaptura, cam, endRua)
  }, [enderecosCaptura, endCamara, endRua])

  const niveisOpcoes = useMemo(() => {
    const cam = Number(endCamara)
    const pos = Number(endPosicao)
    if (!Number.isFinite(cam) || !endRua || !Number.isFinite(pos)) return []
    return niveisDosEnderecos(enderecosCaptura, cam, endRua, pos)
  }, [enderecosCaptura, endCamara, endRua, endPosicao])

  const loadProdutos = useCallback(async (listaProdutosId?: string | null) => {
    setProdutosCarregando(true)
    try {
      if (!isAppOnline()) {
        if (listaProdutosId) {
          const cachedList = loadProductListCache(listaProdutosId)
          if (cachedList.length) {
            setProdutos(cachedList as ProductOption[])
            return
          }
        }
        const cached = loadProductOptionsCache()
        if (cached.length) {
          setProdutos(cached as ProductOption[])
          return
        }
        setErr('Sem internet e catálogo offline vazio. Conecte-se antes de entrar na câmara fria e abra o inventário novamente.')
        return
      }
      if (listaProdutosId) {
        const lista = await getProdutoLista(listaProdutosId)
        if (lista) {
          const list = produtoListaParaProductOptions(lista)
          setProdutos(list)
          saveProductListCache(
            listaProdutosId,
            list.map((p) => ({
              id: p.id,
              codigo: p.codigo,
              descricao: p.descricao,
              unidade_medida: p.unidade_medida,
              data_fabricacao: p.data_fabricacao,
              data_validade: p.data_validade,
              ean: p.ean,
              dun: p.dun,
            })),
          )
          return
        }
      }
      const { data } = await supabase.from(TABELA_PRODUTOS).select('*').order('codigo_interno').limit(5000)
      const list = (data ?? [])
        .map((r) => mapRowToProductOption(r as Record<string, unknown>))
        .filter(Boolean) as ProductOption[]
      setProdutos(list)
      if (list.length) {
        saveProductOptionsCache(
          list.map((p) => ({
            id: p.id,
            codigo: p.codigo,
            descricao: p.descricao,
            unidade_medida: p.unidade_medida,
            data_fabricacao: p.data_fabricacao,
            data_validade: p.data_validade,
            ean: p.ean,
            dun: p.dun,
          })),
        )
      }
    } finally {
      setProdutosCarregando(false)
    }
  }, [])

  useEffect(() => {
    return subscribeAppConnectivity((next) => {
      setOnline(next)
      setPendingSync(countPendingInventarioSync())
      if (next) {
        void flushPendingInventarioSync().then(() => setPendingSync(countPendingInventarioSync()))
      }
    })
  }, [])

  useEffect(() => {
    if (sessao?.listaProdutosId) {
      void loadProdutos(sessao.listaProdutosId)
    } else if (!sessaoLoading) {
      void loadProdutos(null)
    }
  }, [sessao?.listaProdutosId, sessaoLoading, loadProdutos])

  useEffect(() => {
    if (!sessao) return
    setSessaoProdutoListaContext({
      tipo: 'inventario',
      sessaoId: inventarioId,
      listaProdutosId: sessao.listaProdutosId ?? null,
      listaProdutosNome: sessao.listaProdutosNome,
    })
  }, [sessao, inventarioId])

  useEffect(() => {
    const listaId = sessao?.listaProdutosId
    if (!listaId) return

    const recarregar = () => {
      void loadProdutos(listaId)
    }

    const onListaAtualizada = (ev: Event) => {
      const detail = (ev as CustomEvent<{ listaIds?: string[] }>).detail
      if (!detail?.listaIds?.includes(listaId)) return
      recarregar()
      setMsg('Lista de produtos atualizada.')
    }

    const onVisibilidade = () => {
      if (document.visibilityState === 'visible') recarregar()
    }

    window.addEventListener(PRODUTO_LISTA_ATUALIZADA_EVENT, onListaAtualizada)
    document.addEventListener('visibilitychange', onVisibilidade)
    return () => {
      window.removeEventListener(PRODUTO_LISTA_ATUALIZADA_EVENT, onListaAtualizada)
      document.removeEventListener('visibilitychange', onVisibilidade)
    }
  }, [sessao?.listaProdutosId, loadProdutos])

  useEffect(() => {
    let alive = true
    setSessaoLoading(true)
    void (async () => {
      try {
        const inv = await getInventario(inventarioId)
        if (alive) setSessao(inv)
      } catch {
        if (alive) setSessao(null)
      } finally {
        if (alive) setSessaoLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [inventarioId])

  /** Atualiza linhas de outros dispositivos sem apagar as locais. */
  useEffect(() => {
    if (!online || !inventarioId || sessao?.status !== 'aberto') return
    const reload = () => {
      void getInventario(inventarioId).then((inv) => {
        if (inv) setSessao(inv)
      })
    }
    const id = window.setInterval(reload, 12_000)
    return () => window.clearInterval(id)
  }, [online, inventarioId, sessao?.status])

  useEffect(() => {
    let alive = true
    const listaId = sessao?.listaEnderecamentoId
    if (!listaId) {
      setListaEndereco(null)
      return
    }
    void (async () => {
      try {
        if (!isAppOnline()) {
          const cached = loadEnderecoListCache(listaId)
          if (alive) {
            setListaEndereco(
              cached
                ? {
                    id: cached.id,
                    nome: cached.nome,
                    enderecos: cached.enderecos,
                    createdAt: '',
                    updatedAt: '',
                  }
                : null,
            )
          }
          return
        }
        const lista = await getEnderecoLista(listaId)
        if (lista) {
          saveEnderecoListCache({
            id: lista.id,
            nome: lista.nome,
            enderecos: lista.enderecos,
          })
        }
        if (alive) setListaEndereco(lista)
      } catch {
        const cached = loadEnderecoListCache(listaId)
        if (alive) {
          setListaEndereco(
            cached
              ? {
                  id: cached.id,
                  nome: cached.nome,
                  enderecos: cached.enderecos,
                  createdAt: '',
                  updatedAt: '',
                }
              : null,
          )
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [sessao?.listaEnderecamentoId])

  useEffect(() => {
    if (!inventarioId || sessao?.status === 'fechado' || !online) return
    const nome = usuarioLogado.trim()
    if (!nome || nome === 'usuário') return

    const ping = () => void upsertInventarioCapturaPresenca(inventarioId, nome)
    void ping()
    const id = window.setInterval(ping, PRESENCA_PING_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [inventarioId, sessao?.status, online, usuarioLogado])

  useEffect(() => {
    if (!inventarioId || !online) return
    let cancelled = false
    const load = async () => {
      const rows = await fetchInventarioCapturaPresenca(inventarioId)
      if (!cancelled) setPresencaRows(rows)
    }
    void load()
    const id = window.setInterval(() => void load(), PRESENCA_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [inventarioId, online])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setSugestoesOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function aplicarProduto(p: ProductOption, textoBusca?: string) {
    setCodigoInterno(p.codigo)
    setProdutoLabel(p.descricao)
    setUnidade(p.unidade_medida ?? '')
    if (textoBusca !== undefined) setCodigoBarras(textoBusca)
    setErr('')
    setSugestoesOpen(false)
  }

  async function resolverProduto(scanned: string) {
    const q = scanned.trim()
    if (!q) {
      setProdutoLabel('')
      setCodigoInterno('')
      setUnidade('')
      return
    }

    let hit = buscarProdutoUnicoLocal(q, produtos, productMaps)
    if (!hit && isAppOnline()) {
      hit = await fetchProductOptionByCodigoFromDb(q)
    }
    if (!hit && isAppOnline() && q.length >= 2) {
      hit = await fetchProductOptionByDescricaoFromDb(q)
    }

    if (hit) {
      aplicarProduto(hit, q)
      if (!produtos.some((p) => p.codigo === hit!.codigo)) {
        setProdutos((prev) => [...prev, hit!].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR')))
      }
    } else {
      setCodigoInterno('')
      setProdutoLabel('Produto não encontrado — cadastre em Produtos')
      setUnidade('')
    }
  }

  function aplicarPartesEndereco(
    partes: {
      camara: string
      rua: string
      posicao: string
      nivel: string
    },
    codigoExibido?: string,
  ) {
    setEndCamara(partes.camara)
    setEndRua(partes.rua)
    setEndPosicao(partes.posicao)
    setEndNivel(partes.nivel)
    if (codigoExibido !== undefined) {
      setEnderecoCodigoInput(codigoExibido)
      return
    }
    if (partes.camara && partes.rua && partes.posicao && partes.nivel) {
      setEnderecoCodigoInput(
        buildCodigoEndereco(
          Number(partes.camara),
          partes.rua,
          Number(partes.posicao),
          Number(partes.nivel),
        ),
      )
    } else if (!partes.camara && !partes.rua && !partes.posicao && !partes.nivel) {
      setEnderecoCodigoInput('')
    }
  }

  function confirmarEnderecoCompleto(cod: string) {
    const normalized = normalizeEnderecoCodigo(cod.trim())
    if (!normalized) return
    if (sessao && !enderecoPermitidoNaSessao(sessao, normalized)) {
      setErr('Endereço fora das posições deste inventário.')
      setMsg('')
      return
    }
    const found = listaEndereco
      ? findEnderecoNaLista(listaEndereco, normalized)
      : findEnderecoByCodigo(normalized)
    if (found) {
      setMsg(
        `Endereço ${normalized} — Câm. ${found.camara ?? '—'} · Rua ${found.rua || '—'} · Pos. ${found.posicao ?? '—'} · Nív. ${found.nivel ?? '—'}`,
      )
    } else {
      setMsg(`Endereço ${normalized} (não cadastrado na lista)`)
    }
    setErr('')
    barcodeRef.current?.focus()
  }

  function aplicarEnderecoLido(codRaw: string) {
    const formatted = formatEnderecoCodigoInput(codRaw.trim())
    const partes = partesFormDoCodigo(formatted)
    aplicarPartesEndereco(partes, formatted)
    if (partes.camara && partes.rua && partes.posicao && partes.nivel) {
      const cod = buildCodigoEndereco(
        Number(partes.camara),
        partes.rua,
        Number(partes.posicao),
        Number(partes.nivel),
      )
      confirmarEnderecoCompleto(cod)
    }
  }

  function handleEnderecoCodigoChange(value: string) {
    setEnderecoCodigoInput(formatEnderecoCodigoInput(value))
    setErr('')
    setMsg('')
  }

  function commitEnderecoCodigoInput() {
    const raw = enderecoCodigoInput.trim()
    if (!raw) return
    aplicarEnderecoLido(raw)
    barcodeRef.current?.focus()
  }

  function handleCamaraChange(value: string) {
    setEndCamara(value)
    setEndRua('')
    setEndPosicao('')
    setEndNivel('')
    setEnderecoCodigoInput('')
    setErr('')
    setMsg('')
  }

  function handleRuaChange(value: string) {
    setEndRua(value)
    setEndPosicao('')
    setEndNivel('')
    setEnderecoCodigoInput('')
    setErr('')
    setMsg('')
  }

  function handlePosicaoChange(value: string) {
    setEndPosicao(value)
    setEndNivel('')
    setEnderecoCodigoInput('')
    setErr('')
    setMsg('')
  }

  function handleNivelChange(value: string) {
    setEndNivel(value)
    if (!value || !endCamara || !endRua || !endPosicao) {
      setEnderecoCodigoInput('')
      return
    }
    const cod = buildCodigoEndereco(Number(endCamara), endRua, Number(endPosicao), Number(value))
    setEnderecoCodigoInput(cod)
    confirmarEnderecoCompleto(cod)
  }

  function limparCampoEndereco() {
    aplicarPartesEndereco({ camara: '', rua: '', posicao: '', nivel: '' }, '')
    setMsg('')
    setErr('')
    enderecoCodigoRef.current?.focus()
  }

  function limparCampoProduto() {
    if (resolverTimerRef.current) clearTimeout(resolverTimerRef.current)
    setCodigoBarras('')
    setCodigoInterno('')
    setProdutoLabel('')
    setUnidade('')
    setSugestoesOpen(false)
    setErr('')
    barcodeRef.current?.focus()
  }

  function abrirCameraBarcode(alvo: 'endereco' | 'produto') {
    setBarcodeCameraAlvo(alvo)
    setBarcodeCameraOpen(true)
  }

  function handleBarcodeCameraScan(raw: string) {
    const value = raw.trim()
    if (!value) return
    if (barcodeCameraAlvo === 'endereco') {
      aplicarEnderecoLido(formatEnderecoCodigoInput(value))
      return
    }
    handleBuscaChange(value)
    void resolverProduto(value).then(() => {
      ;(document.getElementById('inv-quantidade') as HTMLInputElement | null)?.focus()
    })
  }

  function handleBuscaChange(v: string) {
    setCodigoBarras(v)
    setSugestoesOpen(true)
    setSugestaoIdx(0)
    if (resolverTimerRef.current) clearTimeout(resolverTimerRef.current)
    resolverTimerRef.current = setTimeout(() => {
      void resolverProduto(v)
    }, 280)
  }

  function selecionarSugestao(p: ProductOption) {
    aplicarProduto(p, p.ean?.trim() || p.codigo)
    ;(document.getElementById('inv-quantidade') as HTMLInputElement | null)?.focus()
  }

  function limparFormulario() {
    aplicarPartesEndereco({ camara: '', rua: '', posicao: '', nivel: '' })
    setCodigoBarras('')
    setQuantidade('')
    setUnidade('')
    setUp('')
    setLote('')
    setFabricacao('')
    setValidade('')
    setProdutoLabel('')
    setCodigoInterno('')
    setErr('')
    setSugestoesOpen(false)
    setEditandoLinhaId(null)
    camaraRef.current?.focus()
  }

  function resolverCamaraEndereco(end: string): number | null {
    const found = listaEndereco ? findEnderecoNaLista(listaEndereco, end) : findEnderecoByCodigo(end)
    if (found?.camara != null) return found.camara
    return camaraFromEnderecoCodigo(end)
  }

  function iniciarEdicaoLinha(linha: InventarioLinhaCaptura) {
    if (!sessao || sessao.status !== 'aberto') return
    setEditandoLinhaId(linha.id)
    const codEnd = normalizeEnderecoCodigo(linha.endereco)
    aplicarPartesEndereco(partesFormDoCodigo(codEnd), codEnd)
    setCodigoBarras(linha.codigoBarras)
    setQuantidade(String(linha.quantidade))
    setUnidade(linha.unidade)
    setUp(linha.up)
    setLote(linha.lote)
    setFabricacao(clampDataFabricacaoYmd(linha.fabricacao ?? ''))
    setValidade(linha.validade)
    setProdutoLabel(linha.descricao)
    setCodigoInterno(linha.codigoInterno)
    setErr('')
    setMsg('Editando linha — altere os campos e salve.')
    camaraRef.current?.focus()
  }

  async function excluirLinha(linha: InventarioLinhaCaptura) {
    if (!sessao || sessao.status !== 'aberto') return
    if (!confirm(`Excluir a linha do endereço ${linha.endereco} (${linha.descricao})?`)) return
    try {
      const ok = await deleteLinhaInventario(sessao.id, linha.id)
      if (!ok) {
        setErr('Não foi possível excluir a linha.')
        return
      }
      if (editandoLinhaId === linha.id) limparFormulario()
      const atualizado = await getInventario(inventarioId)
      setSessao(atualizado)
      setMsg('Linha excluída.')
      setErr('')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erro ao excluir linha.')
    }
  }

  async function handleSalvar() {
    if (!sessao) return
    if (sessao.status !== 'aberto') {
      setErr('Inventário fechado — somente leitura.')
      return
    }
    const end = normalizeEnderecoCodigo(endereco.trim())
    const bar = codigoBarras.trim()
    const q = Number(String(quantidade).replace(',', '.'))
    const upStr = up.trim()
    if (!end) {
      setErr('Selecione câmara, rua, posição e nível.')
      return
    }
    if (!enderecoPermitidoNaSessao(sessao, end)) {
      setErr('Endereço fora das posições selecionadas para este inventário.')
      return
    }
    if (!bar || !codigoInterno) {
      setErr('Informe EAN, código do produto ou descrição válida.')
      return
    }
    if (!Number.isFinite(q) || q < 0) {
      setErr('Quantidade inválida.')
      return
    }
    if (upStr !== '') {
      const upNum = Number(upStr.replace(',', '.'))
      if (!Number.isFinite(upNum) || upNum < 0) {
        setErr('UP inválido.')
        return
      }
    }
    const fab = fabricacao.trim()
    const val = validade.trim()
    if (fab && isFabricacaoAposHoje(fab)) {
      setErr('Data de fabricação não pode ser maior que hoje.')
      return
    }
    if (fab && val && isVencimentoAntesFabricacao(fab, val)) {
      setErr('Data de validade não pode ser menor que a data de fabricação.')
      return
    }
    const jaNoEndereco = linhasComMesmoEndereco(sessao.linhas, end, editandoLinhaId)
    if (jaNoEndereco.length > 0) {
      if (!confirmarSalvarEnderecoRepetido(end, jaNoEndereco.length)) {
        setErr('Informe outro endereço (câmara, rua, posição e nível).')
        setMsg('')
        enderecoCodigoRef.current?.focus()
        return
      }
    }
    try {
      const qtdAntes = sessao.linhas.length
      const payload = {
        endereco: end,
        codigoBarras: bar,
        codigoInterno,
        descricao: produtoLabel,
        quantidade: q,
        unidade: unidade.trim(),
        up: upStr,
        lote: lote.trim(),
        fabricacao: fabricacao.trim(),
        validade: validade.trim(),
        camara: resolverCamaraEndereco(end),
        conferenteNome: usuarioLogado.trim() || undefined,
      }
      if (editandoLinhaId) {
        await updateLinhaInventario(sessao.id, editandoLinhaId, payload)
      } else {
        await addLinhaInventario(sessao.id, payload)
      }
      const atualizado = await getInventario(inventarioId)
      if (!atualizado) {
        setErr('Inventário não encontrado após salvar.')
        return
      }
      if (!editandoLinhaId && atualizado.linhas.length <= qtdAntes) {
        setErr(
          'A linha não foi gravada corretamente. Verifique a conexão ou recarregue a página — as linhas anteriores foram preservadas no aparelho.',
        )
        setMsg('')
        setSessao(atualizado)
        return
      }
      setSessao(atualizado)
      setMsg(
        editandoLinhaId
          ? 'Linha atualizada.'
          : `Linha salva (${atualizado.linhas.length} no total)`,
      )
      setErr('')
      setLinhasPage(1)
      limparFormulario()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar linha.')
    }
  }

  if (sessaoLoading) {
    return (
      <div className="page-panel">
        <p>Carregando inventário…</p>
      </div>
    )
  }

  if (!sessao) {
    return (
      <div className="page-panel">
        <p>Inventário não encontrado.</p>
        <button type="button" onClick={onVoltar}>
          Voltar
        </button>
      </div>
    )
  }

  const readonly = sessao.status !== 'aberto'
  const hoje = formatDateBR(new Date())

  const posicoesLabel = sessao.posicoesNome?.trim()
    ? sessao.posicoesNome
    : posicoesInventario.length > 0
      ? `${posicoesInventario.length} posição(ões)`
      : 'Qualquer endereço'

  const enderecoLabel = sessao.listaEnderecamentoNome ?? listaEndereco?.nome
  const produtosLabel = produtosCarregando
    ? 'Carregando…'
    : sessao.listaProdutosNome
      ? `${sessao.listaProdutosNome} (${produtos.length})`
      : `${produtos.length} produto(s)`

  return (
    <div className="inventario-captura-wrap">
      <div className="inventario-captura inventario-captura--v2">
        <header className="inv-cap__top">
          <button type="button" className="inv-cap__back" onClick={onVoltar} aria-label="Voltar">
            ←
          </button>
          <div className="inv-cap__top-main">
            <h1 className="inv-cap__title">{sessao.titulo}</h1>
            <div className="inv-cap__badges">
              <span className={`inv-cap__badge ${online ? 'inv-cap__badge--online' : 'inv-cap__badge--offline'}`}>
                {online ? 'Online' : 'Offline — salvando no aparelho'}
              </span>
              {pendingSync > 0 ? (
                <span className="inv-cap__badge inv-cap__badge--readonly" title="Inventários finalizados offline aguardando envio">
                  {pendingSync} p/ sincronizar
                </span>
              ) : null}
              {readonly ? <span className="inv-cap__badge inv-cap__badge--readonly">Finalizado</span> : null}
              <span className="inv-cap__badge">{sessao.linhas.length} linha(s)</span>
            </div>
          </div>
        </header>

        <div className="inv-cap__chips" aria-label="Informações do inventário">
          <span className="inv-cap__chip" title="Local">
            <span className="inv-cap__chip-label">Local</span>
            {sessao.local}
          </span>
          <span className="inv-cap__chip" title="Data">
            <span className="inv-cap__chip-label">Data</span>
            {hoje}
          </span>
          <span className="inv-cap__chip inv-cap__chip--wide" title={contadoresOnline}>
            <span className="inv-cap__chip-label">Conferentes</span>
            {contadoresOnline}
          </span>
          <span className="inv-cap__chip" title="Posições">
            <span className="inv-cap__chip-label">Posições</span>
            {posicoesLabel}
          </span>
          {enderecoLabel ? (
            <span className="inv-cap__chip" title="Endereçamento">
              <span className="inv-cap__chip-label">Endereços</span>
              {enderecoLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="inv-cap__chip inv-cap__chip--action inv-cap__chip--produtos"
            title="Atualizar lista de produtos"
            disabled={produtosCarregando}
            onClick={() => void loadProdutos(sessao.listaProdutosId ?? null)}
          >
            <span className="inv-cap__chip-label">Produtos</span>
            {produtosCarregando ? 'Atualizando…' : produtosLabel}
            {!produtosCarregando ? <span className="inv-cap__chip-refresh" aria-hidden> ↻</span> : null}
          </button>
        </div>

        {readonly ? (
          <div className="inventario-captura__alert inventario-captura__alert--readonly">
            Inventário finalizado — somente visualização. Reabra na lista para alterar.
          </div>
        ) : null}
        {err ? <div className="inventario-captura__alert inventario-captura__alert--err">{err}</div> : null}
        {msg ? <div className="inventario-captura__alert inventario-captura__alert--ok">{msg}</div> : null}

        <div className="inv-cap__body">
          <div className="inv-cap__form-panel">
            <div className="inv-cap__form-compact">
              <div className="inv-cap__form-line inv-cap__form-line--primary">
                <section className="inv-cap__section inv-cap__section--endereco">
                  <h2 className="inv-cap__section-title inv-cap__section-title--stack">
                    <span className="inv-cap__step">1</span> Endereço
                  </h2>
                  <div className="inventario-captura__field inventario-captura__field--full inv-cap__field inv-cap__cell inv-cap__cell--endereco">
                <div className="inv-cap__endereco-row">
                <div className="inv-cap__endereco-codigo-field">
                  <label htmlFor="inv-end-codigo">Código endereço</label>
                  <div className="inventario-captura__input-row">
                    <input
                      id="inv-end-codigo"
                      ref={enderecoCodigoRef}
                      value={enderecoCodigoInput}
                      onChange={(e) => handleEnderecoCodigoChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEnderecoCodigoInput()
                        }
                      }}
                      onBlur={() => {
                        if (enderecoCodigoInput.trim()) commitEnderecoCodigoInput()
                      }}
                      disabled={readonly}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="Bipar ou digitar — ex.: 21-A-03-2"
                    />
                    <button
                      type="button"
                      className="inventario-captura__action-btn inventario-captura__action-btn--limpar"
                      disabled={readonly || (!enderecoCodigoInput.trim() && !endereco)}
                      aria-label="Limpar endereço"
                      title="Limpar"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={limparCampoEndereco}
                    >
                      <span className="inventario-captura__btn-text">Limpar</span>
                      <IconClearField className="inventario-captura__btn-icon" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="inventario-captura__action-btn inventario-captura__action-btn--icon-only inventario-captura__action-btn--scan"
                      disabled={readonly}
                      aria-label="Ler código de endereço pela câmera"
                      title="Ler endereço"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => abrirCameraBarcode('endereco')}
                    >
                      <IconScanBarcode className="inventario-captura__btn-icon" />
                    </button>
                  </div>
                </div>
                <div className="inv-cap__endereco-grid">
                  <div className="inv-cap__endereco-item">
                    <label htmlFor="inv-end-camara">Câmara</label>
                    <select
                      id="inv-end-camara"
                      ref={camaraRef}
                      value={endCamara}
                      onChange={(e) => handleCamaraChange(e.target.value)}
                      disabled={readonly || camarasOpcoes.length === 0}
                    >
                      <option value="">—</option>
                      {camarasOpcoes.map((c) => (
                        <option key={c} value={String(c)}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="inv-cap__endereco-item">
                    <label htmlFor="inv-end-rua">Rua</label>
                    <select
                      id="inv-end-rua"
                      value={endRua}
                      onChange={(e) => handleRuaChange(e.target.value)}
                      disabled={readonly || !endCamara || ruasOpcoes.length === 0}
                    >
                      <option value="">—</option>
                      {ruasOpcoes.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="inv-cap__endereco-item">
                    <label htmlFor="inv-end-posicao">Posição</label>
                    <select
                      id="inv-end-posicao"
                      value={endPosicao}
                      onChange={(e) => handlePosicaoChange(e.target.value)}
                      disabled={readonly || !endRua || posicoesOpcoes.length === 0}
                    >
                      <option value="">—</option>
                      {posicoesOpcoes.map((p) => (
                        <option key={p} value={String(p)}>
                          {String(p).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="inv-cap__endereco-item">
                    <label htmlFor="inv-end-nivel">Nível</label>
                    <select
                      id="inv-end-nivel"
                      value={endNivel}
                      onChange={(e) => handleNivelChange(e.target.value)}
                      disabled={readonly || !endPosicao || niveisOpcoes.length === 0}
                    >
                      <option value="">—</option>
                      {niveisOpcoes.map((n) => (
                        <option key={n} value={String(n)}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                </div>
                  </div>
                </section>

                <section className="inv-cap__section inv-cap__section--produto">
                  <h2 className="inv-cap__section-title inv-cap__section-title--stack">
                    <span className="inv-cap__step">2</span> Produto
                  </h2>
                  <div
                    className="inventario-captura__field inventario-captura__field--full inv-cap__field inv-cap__cell inv-cap__cell--busca"
                    ref={comboRef}
                  >
                <label htmlFor="inv-barcode">Código / barras / descrição</label>
                <div className="inventario-captura__input-row">
                  <input
                    id="inv-barcode"
                    ref={barcodeRef}
                    value={codigoBarras}
                    onChange={(e) => handleBuscaChange(e.target.value)}
                    onFocus={() => setSugestoesOpen(true)}
                    onKeyDown={(e) => {
                      if (sugestoesOpen && sugestoes.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setSugestaoIdx((i) => Math.min(i + 1, sugestoes.length - 1))
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setSugestaoIdx((i) => Math.max(i - 1, 0))
                          return
                        }
                        if (e.key === 'Enter' && sugestaoIdx >= 0 && sugestoes[sugestaoIdx]) {
                          e.preventDefault()
                          selecionarSugestao(sugestoes[sugestaoIdx])
                          return
                        }
                        if (e.key === 'Escape') {
                          setSugestoesOpen(false)
                          return
                        }
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void resolverProduto(codigoBarras).then(() => {
                          ;(document.getElementById('inv-quantidade') as HTMLInputElement | null)?.focus()
                        })
                      }
                    }}
                    disabled={readonly}
                    autoComplete="off"
                    placeholder="Código de barras, EAN ou descrição"
                    aria-autocomplete="list"
                    aria-expanded={sugestoesOpen}
                    aria-controls="inv-produto-sugestoes"
                  />
                  <button
                    type="button"
                    className="inventario-captura__action-btn inventario-captura__action-btn--limpar"
                    disabled={readonly || (!codigoBarras.trim() && !codigoInterno.trim() && !produtoLabel.trim())}
                    aria-label="Limpar produto"
                    title="Limpar"
                    onClick={limparCampoProduto}
                  >
                    <span className="inventario-captura__btn-text">Limpar</span>
                    <IconClearField className="inventario-captura__btn-icon" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="inventario-captura__action-btn inventario-captura__action-btn--icon-only inventario-captura__action-btn--scan"
                    disabled={readonly}
                    aria-label="Ler código de barras pela câmera"
                    title="Ler código de barras"
                    onClick={() => abrirCameraBarcode('produto')}
                  >
                    <IconScanBarcode className="inventario-captura__btn-icon" />
                  </button>
                </div>
                {sugestoesOpen && !readonly ? (
                  <ul id="inv-produto-sugestoes" className="inventario-captura__sugestoes" role="listbox">
                    {sugestoes.length === 0 ? (
                      <li className="inventario-captura__sugestao inventario-captura__sugestao--empty">
                        {produtosCarregando ? 'Carregando…' : 'Nenhum produto encontrado'}
                      </li>
                    ) : (
                      sugestoes.map((p, i) => (
                        <li key={p.codigo}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={i === sugestaoIdx}
                            className={`inventario-captura__sugestao${i === sugestaoIdx ? ' inventario-captura__sugestao--active' : ''}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selecionarSugestao(p)}
                          >
                            <span className="inventario-captura__sugestao-cod">{p.codigo}</span>
                            <span className="inventario-captura__sugestao-desc">{p.descricao}</span>
                            {p.ean ? (
                              <span className="inventario-captura__sugestao-ean">EAN {p.ean}</span>
                            ) : null}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
                  </div>
                  <div className="inventario-captura__field inventario-captura__field--full inv-cap__field inv-cap__produto-box inv-cap__cell inv-cap__cell--produto-id">
                <label htmlFor="inv-produto">Produto identificado</label>
                <textarea
                  id="inv-produto"
                  value={produtoLabel}
                  readOnly
                  rows={1}
                  title={produtoLabel || undefined}
                  className="inventario-captura__readonly inventario-captura__produto"
                  placeholder="Aguardando leitura do produto…"
                />
                {codigoInterno ? (
                  <p className="inv-cap__codigo-interno">
                    Código interno: <strong>{codigoInterno}</strong>
                  </p>
                ) : null}
                  </div>
                </section>
              </div>

              <div className="inv-cap__form-line inv-cap__form-line--secondary">
                <section className="inv-cap__section inv-cap__section--qty">
                  <h2 className="inv-cap__section-title inv-cap__section-title--stack">
                    <span className="inv-cap__step">3</span> Quantidade e validade
                  </h2>
                  <div className="inv-cap__grid">
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-quantidade">Quantidade</label>
                  <input
                    id="inv-quantidade"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleSalvar()
                      }
                    }}
                    disabled={readonly}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-unidade">Unidade</label>
                  <input
                    id="inv-unidade"
                    value={unidade}
                    readOnly
                    className="inventario-captura__readonly"
                    placeholder="—"
                  />
                </div>
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-up">UP</label>
                  <input
                    id="inv-up"
                    value={up}
                    onChange={(e) => setUp(e.target.value)}
                    disabled={readonly}
                    inputMode="decimal"
                    placeholder="UP"
                    autoComplete="off"
                  />
                </div>
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-lote">Lote</label>
                  <input
                    id="inv-lote"
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    disabled={readonly}
                    placeholder="Lote"
                    autoComplete="off"
                  />
                </div>
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-fabricacao">Fabricação</label>
                  <div className="inventario-captura__input-row">
                    <input
                      id="inv-fabricacao"
                      type="date"
                      max={maxDataFabricacaoHoje()}
                      value={fabricacao}
                      onChange={(e) => setFabricacao(clampDataFabricacaoYmd(e.target.value))}
                      disabled={readonly}
                      title="Fabricação (até hoje)"
                    />
                    <button
                      type="button"
                      className="inventario-captura__action-btn inventario-captura__action-btn--icon inventario-captura__action-btn--icon-only inventario-captura__action-btn--calendar"
                      disabled={readonly}
                      title="Abrir calendário"
                      aria-label="Abrir calendário de fabricação"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => abrirDatePicker('inv-fabricacao')}
                    >
                      <IconCalendar className="inventario-captura__btn-icon" />
                    </button>
                  </div>
                </div>
                <div className="inventario-captura__field inv-cap__field">
                  <label htmlFor="inv-validade">Validade</label>
                  <div className="inventario-captura__input-row">
                    <input
                      id="inv-validade"
                      type="date"
                      value={validade}
                      onChange={(e) => setValidade(e.target.value)}
                      disabled={readonly}
                      title="Validade"
                    />
                    <button
                      type="button"
                      className="inventario-captura__action-btn inventario-captura__action-btn--icon inventario-captura__action-btn--icon-only inventario-captura__action-btn--calendar"
                      disabled={readonly}
                      title="Abrir calendário"
                      aria-label="Abrir calendário de validade"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => abrirDatePicker('inv-validade')}
                    >
                      <IconCalendar className="inventario-captura__btn-icon" />
                    </button>
                  </div>
                </div>
                </div>
                </section>

                <div className="inv-cap__save-bar inv-cap__cell inv-cap__cell--save">
              <span className="inv-cap__field-label-placeholder" aria-hidden="true">
                Salvar
              </span>
              {editandoLinhaId ? (
                <button type="button" className="inv-cap__cancel-edit page-btn-ghost" onClick={limparFormulario}>
                  Cancelar edição
                </button>
              ) : null}
              <div className="inventario-captura__footer-mobile">
                <input
                  readOnly
                  value={codigoInterno || produtoLabel ? codigoInterno || '—' : '—'}
                  className="inventario-captura__readonly inventario-captura__footer-status"
                  aria-label="Código do produto"
                />
                <button
                  type="button"
                  className="inventario-captura__save-icon"
                  onClick={handleSalvar}
                  disabled={readonly}
                  aria-label="Salvar linha"
                >
                  <IconSave />
                </button>
              </div>
              <button
                type="button"
                className="inventario-captura__save inventario-captura__save--desktop"
                onClick={handleSalvar}
                disabled={readonly}
              >
                {editandoLinhaId ? 'Atualizar linha' : 'Salvar linha'}
              </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="inv-cap__linhas-panel" aria-label="Linhas salvas">
            <div className="inv-cap__linhas-head">
              <h2>Linhas salvas</h2>
              <span className="inv-cap__linhas-count">{linhasSalvas.length}</span>
            </div>
            {enderecosRepetidos.size > 0 ? (
              <p className="inv-cap__linhas-hint-duplicado">Endereços em amarelo estão repetidos nesta sessão.</p>
            ) : null}
            {linhasSalvas.length === 0 ? (
              <p className="inv-cap__linhas-empty">Nenhuma linha registrada ainda.</p>
            ) : (
              <>
              <CapturaLinhasMobile
                linhas={linhasMobile}
                readonly={readonly}
                onEdit={(id) => {
                  const linha = linhasSalvas.find((l) => l.id === id)
                  if (linha) iniciarEdicaoLinha(linha)
                }}
                onDelete={(id) => {
                  const linha = linhasSalvas.find((l) => l.id === id)
                  if (linha) void excluirLinha(linha)
                }}
              />
              <div className="inventario-captura__linhas-wrap inv-cap__linhas-desktop">
                <table className="inventario-captura__linhas-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Data</th>
                      <th>Hora</th>
                      <th>Câm.</th>
                      <th>Conferente</th>
                      <th>Endereço</th>
                      <th>Código</th>
                      <th>Produto</th>
                      <th>Qtd</th>
                      <th>UP</th>
                      <th>Lote</th>
                      <th>Fab.</th>
                      <th>Val.</th>
                      {!readonly ? <th>Ações</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasPaginadas.map((linha, idx) => (
                      <tr
                        key={linha.id}
                        className={classeLinhaCapturaEndereco({
                          editando: editandoLinhaId === linha.id,
                          endereco: linha.endereco,
                          enderecosRepetidos,
                        })}
                      >
                        <td>{linhasSalvas.length - ((linhasPageSafe - 1) * LINHAS_PAGE_SIZE + idx)}</td>
                        <td>{formatDataLinha(linha.createdAt)}</td>
                        <td>{formatHora(linha.createdAt)}</td>
                        <td>{linhaCamaraLabel(linha)}</td>
                        <td className="inventario-captura__linhas-conf">{linha.conferenteNome?.trim() || '—'}</td>
                        <td>{linha.endereco}</td>
                        <td className="inventario-captura__linhas-cod">{linha.codigoInterno}</td>
                        <td className="inventario-captura__linhas-desc">{linha.descricao}</td>
                        <td>
                          {linha.quantidade}
                          {linha.unidade ? ` ${linha.unidade}` : ''}
                        </td>
                        <td>{linha.up?.trim() ? linha.up : '—'}</td>
                        <td>{linha.lote?.trim() ? linha.lote : '—'}</td>
                        <td>{formatYmdBR(linha.fabricacao ?? '')}</td>
                        <td>{formatYmdBR(linha.validade ?? '')}</td>
                        {!readonly ? (
                          <td className="inv-cap__linhas-acoes">
                            <button
                              type="button"
                              className="inv-cap__linha-btn"
                              onClick={() => iniciarEdicaoLinha(linha)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="inv-cap__linha-btn inv-cap__linha-btn--danger"
                              onClick={() => void excluirLinha(linha)}
                            >
                              Excluir
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
            {linhasSalvas.length > LINHAS_PAGE_SIZE ? (
              <div className="inv-cap__linhas-pagination" aria-label="Paginação das linhas salvas">
                <button
                  type="button"
                  disabled={linhasPageSafe <= 1}
                  onClick={() => setLinhasPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <span>
                  {linhasRangeFrom}–{linhasRangeTo} de {linhasSalvas.length} · Página {linhasPageSafe} de{' '}
                  {totalLinhasPages}
                </span>
                <button
                  type="button"
                  disabled={linhasPageSafe >= totalLinhasPages}
                  onClick={() => setLinhasPage((p) => Math.min(totalLinhasPages, p + 1))}
                >
                  Próxima
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      </div>

      <BarcodeCameraScanner
        open={barcodeCameraOpen}
        onClose={() => setBarcodeCameraOpen(false)}
        onScan={handleBarcodeCameraScan}
        title={barcodeCameraAlvo === 'endereco' ? 'Ler endereço' : 'Ler código de barras'}
      />
    </div>
  )
}
