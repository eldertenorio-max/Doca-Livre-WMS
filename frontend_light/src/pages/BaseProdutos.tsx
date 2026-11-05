import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { normalizeCodigoInternoCompareKey } from '../lib/codigoInternoCompare'
import {
  createProdutoLista,
  deleteProdutoLista,
  ensureProdutoListaPadrao,
  listProdutoListas,
  saveProdutoLista,
  sincronizarProdutoNasListas,
  type ProdutoLista,
  type ProdutoListaItem,
} from '../lib/produtoListaSupabase'
import {
  emitProdutoListaAtualizada,
  getSessaoProdutoListaContext,
  PRODUTO_LISTA_ATUALIZADA_EVENT,
} from '../lib/sessaoProdutoListaContext'
import { formatUnknownError, isColumnMissingError } from '../lib/supabaseError'
import { supabase } from '../lib/supabaseClient'
import PageInfoButton, { PageInfoBlock } from '../components/ui/PageInfoButton'
import { PageSectionHeading } from '../components/ui/PagePanelHeading'
import './BaseProdutos.css'

const TABELA_PRODUTOS = 'Todos os Produtos'
const PAGE_SIZE = 25

function grupoProdutoTab(codigo: string): string {
  const p = codigo.trim().split('.')[0]
  return p && /^\d+$/u.test(p) ? p : 'Outros'
}

type ProdutoDbRow = {
  id: string
  codigo_interno: string
  descricao: string
  /** Coluna `unidade` em "Todos os Produtos" (fallback: `unidade_medida` legado). */
  unidade: string | null
  ean: string | null
  dun: string | null
  /** Data (YYYY-MM-DD) da última alteração do EAN no cadastro. */
  ean_alterado_em: string | null
  /** Horário ISO da última alteração do EAN (quando a coluna existir no banco). */
  ean_alterado_em_hora: string | null
  /** Conferente da última alteração do EAN. */
  ean_alterado_conferente: string | null
  /** Data (YYYY-MM-DD) da última alteração do DUN no cadastro. */
  dun_alterado_em: string | null
  dun_alterado_em_hora: string | null
  dun_alterado_conferente: string | null
  /** Só preenchido se o banco ainda expuser a coluna legada `ean_dun_alterado_em`. */
  ean_dun_alterado_em?: string | null
}

function rowKey(r: ProdutoDbRow) {
  if (r.id && String(r.id).trim() !== '') return String(r.id)
  return `cod:${normalizeCodigoInternoCompareKey(r.codigo_interno)}`
}

function normEanDun(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function nowIsoLocal(): string {
  return new Date().toISOString()
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '')
}

/** Compara valor cadastrado com o lido no bipador (com ou sem dígitos só). */
function matchesBarcode(stored: string | null | undefined, scanned: string): boolean {
  const q = scanned.trim()
  if (!q) return false
  const a = normEanDun(stored)
  if (a != null && a === q) return true
  if (a != null && onlyDigits(a) !== '' && onlyDigits(a) === onlyDigits(q)) return true
  return false
}

const MSG_CONFERENTE_OBRIGATORIO =
  'Selecione o conferente no campo «Conferente (ao alterar EAN/DUN)» antes de salvar alteração de EAN ou DUN.'

type UnidadeDbField = 'unidade' | 'unidade_medida'

/** O que o banco expõe para metadados de alteração EAN/DUN. */
type DbMetaCap = 'full' | 'dates' | 'legacy' | 'none'

function unidadeColFromSelect(cols: string): UnidadeDbField {
  return cols.includes('unidade_medida') && !cols.includes('descricao,unidade,') ? 'unidade_medida' : 'unidade'
}

function metaCapFromSelect(cols: string): DbMetaCap {
  if (cols.includes('ean_alterado_em_hora') && cols.includes('ean_alterado_conferente')) return 'full'
  if (cols.includes('ean_alterado_em')) return 'dates'
  if (cols.includes('ean_dun_alterado_em')) return 'legacy'
  return 'none'
}

function pickIsoHoraFromDb(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  if (/T\d{2}:\d{2}/.test(s) || (s.includes('T') && s.length > 11)) return s
  return null
}

function payloadTemMetaHoraConferente(p: Record<string, unknown>): boolean {
  return 'ean_alterado_em_hora' in p || 'ean_alterado_conferente' in p
}

function patchUnidadeField(field: UnidadeDbField, unidade: string | null): Record<string, string | null> {
  return field === 'unidade_medida' ? { unidade_medida: unidade } : { unidade }
}

function formatListaAtualizado(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

function produtoListaItemToRow(p: ProdutoListaItem): ProdutoDbRow {
  return {
    id: '',
    codigo_interno: p.codigo_interno,
    descricao: p.descricao,
    unidade: p.unidade ?? null,
    ean: p.ean ?? null,
    dun: p.dun ?? null,
    ean_alterado_em: null,
    ean_alterado_em_hora: null,
    ean_alterado_conferente: null,
    dun_alterado_em: null,
    dun_alterado_em_hora: null,
    dun_alterado_conferente: null,
  }
}

function rowsToProdutoListaItems(rows: ProdutoDbRow[]): ProdutoListaItem[] {
  return rows.map((r) => ({
    codigo_interno: r.codigo_interno,
    descricao: r.descricao,
    unidade: r.unidade,
    ean: r.ean,
    dun: r.dun,
  }))
}

export default function BaseProdutos() {
  const [rows, setRows] = useState<ProdutoDbRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [listaTab, setListaTab] = useState('todos')
  const [page, setPage] = useState(1)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editSnapshot, setEditSnapshot] = useState<ProdutoDbRow | null>(null)
  /** Coluna de unidade que funcionou no último SELECT (evita UPDATE em coluna inexistente). */
  const [dbUnidadeField, setDbUnidadeField] = useState<UnidadeDbField>('unidade')
  const [dbMetaCap, setDbMetaCap] = useState<DbMetaCap>('none')

  const [cadastroOpen, setCadastroOpen] = useState(false)
  const [cadastroCodigo, setCadastroCodigo] = useState('')
  const [cadastroDescricao, setCadastroDescricao] = useState('')
  const [cadastroUnidade, setCadastroUnidade] = useState('')
  const [cadastroEan, setCadastroEan] = useState('')
  const [cadastroDun, setCadastroDun] = useState('')
  const [cadastroListaId, setCadastroListaId] = useState('')
  const [cadastroSaving, setCadastroSaving] = useState(false)

  const [bipCodigoBarras, setBipCodigoBarras] = useState('')

  const [conferentes, setConferentes] = useState<Array<{ id: string; nome: string }>>([])
  const [conferentesLoading, setConferentesLoading] = useState(false)
  const [alteracaoConferenteId, setAlteracaoConferenteId] = useState('')
  const bipInputRef = useRef<HTMLInputElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  const conferenteSelectRef = useRef<HTMLSelectElement | null>(null)

  const [produtoListas, setProdutoListas] = useState<ProdutoLista[]>([])
  const [editingListaId, setEditingListaId] = useState<string | null>(null)
  const [editingListaNome, setEditingListaNome] = useState('')
  const [listaProdutoMsg, setListaProdutoMsg] = useState('')
  const [listaProdutoSaving, setListaProdutoSaving] = useState(false)
  const [listaProdutoLoading, setListaProdutoLoading] = useState(true)
  const [sessaoListaCtx, setSessaoListaCtx] = useState(() => getSessaoProdutoListaContext())

  useEffect(() => {
    const atualizarCtx = () => setSessaoListaCtx(getSessaoProdutoListaContext())
    window.addEventListener('focus', atualizarCtx)
    const timer = window.setInterval(atualizarCtx, 3000)
    return () => {
      window.removeEventListener('focus', atualizarCtx)
      window.clearInterval(timer)
    }
  }, [])

  async function sincronizarProdutoNasListasVinculadas(
    row: ProdutoDbRow,
    listaIdsExtras: string[] = [],
  ): Promise<string | null> {
    const item = rowsToProdutoListaItems([row])[0]
    if (!item) return null
    const ids = new Set<string>()
    const ctx = getSessaoProdutoListaContext()
    if (ctx?.listaProdutosId) ids.add(ctx.listaProdutosId)
    if (editingListaId) ids.add(editingListaId)
    for (const id of listaIdsExtras) {
      if (id.trim()) ids.add(id.trim())
    }
    if (!ids.size) return null
    const atualizadas = await sincronizarProdutoNasListas(item, ids)
    if (atualizadas.length) emitProdutoListaAtualizada(atualizadas)
    const nomeCtx = ctx?.listaProdutosNome
    const nomeEdit = editingListaNome
    const nomeExtra = produtoListas.find((l) => listaIdsExtras.includes(l.id))?.nome
    return (
      nomeEdit ||
      nomeCtx ||
      nomeExtra ||
      produtoListas.find((l) => atualizadas.includes(l.id))?.nome ||
      null
    )
  }

  const emRascunhoNovaLista = !editingListaId && rows.length > 0

  const listaDestinoFixaCadastro = useMemo(() => {
    if (editingListaId) {
      return { id: editingListaId, nome: editingListaNome, modo: 'edicao' as const }
    }
    const ctx = sessaoListaCtx
    if (ctx?.listaProdutosId) {
      return {
        id: ctx.listaProdutosId,
        nome: ctx.listaProdutosNome ?? produtoListas.find((l) => l.id === ctx.listaProdutosId)?.nome ?? '',
        modo: 'sessao' as const,
      }
    }
    if (emRascunhoNovaLista) {
      return { id: null, nome: 'Rascunho da área abaixo (salve a lista depois)', modo: 'rascunho' as const }
    }
    return null
  }, [editingListaId, editingListaNome, sessaoListaCtx, produtoListas, emRascunhoNovaLista])

  function abrirModalCadastro() {
    setCadastroListaId(editingListaId ?? sessaoListaCtx?.listaProdutosId ?? '')
    setCadastroOpen(true)
    setError('')
  }

  const carregarListas = useCallback(async () => {
    setListaProdutoLoading(true)
    try {
      await ensureProdutoListaPadrao()
      const listas = await listProdutoListas()
      setProdutoListas([...listas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    } catch (e: unknown) {
      setListaProdutoMsg(formatUnknownError(e) || 'Erro ao carregar listas de produtos.')
    } finally {
      setListaProdutoLoading(false)
    }
  }, [])

  useEffect(() => {
    void carregarListas()
  }, [carregarListas])

  useEffect(() => {
    const onListasAtualizadas = () => {
      void carregarListas()
    }
    window.addEventListener(PRODUTO_LISTA_ATUALIZADA_EVENT, onListasAtualizadas)
    return () => window.removeEventListener(PRODUTO_LISTA_ATUALIZADA_EVENT, onListasAtualizadas)
  }, [carregarListas])

  function limparAreaTrabalho() {
    setRows([])
    setEditingKey(null)
    setEditSnapshot(null)
    setBipCodigoBarras('')
    setListaTab('todos')
    setPage(1)
    setEditingListaId(null)
    setEditingListaNome('')
    setError('')
    setSuccess('')
  }

  function iniciarNovaLista() {
    limparAreaTrabalho()
    setListaProdutoMsg('Área de produtos limpa. Monte a lista abaixo e clique em Salvar lista.')
  }

  function abrirListaSalva(lista: ProdutoLista) {
    setEditingListaId(lista.id)
    setEditingListaNome(lista.nome)
    setRows(lista.produtos.map(produtoListaItemToRow))
    setEditingKey(null)
    setEditSnapshot(null)
    setBipCodigoBarras('')
    setListaTab('todos')
    setPage(1)
    setListaProdutoMsg(
      `Editando «${lista.nome}» (${lista.produtos.length} produtos). Salve para gravar e limpar a área.`,
    )
  }

  function fecharListaAberta() {
    if (!editingListaId) return
    const nome = editingListaNome
    const msg =
      rows.length > 0
        ? `Fechar a lista «${nome}»? Alterações não salvas na área de trabalho serão descartadas.`
        : `Fechar a lista «${nome}»? A área de trabalho será limpa.`
    if (!confirm(msg)) return
    limparAreaTrabalho()
    setListaProdutoMsg(`Lista «${nome}» fechada.`)
  }

  async function salvarListaProdutosAtual() {
    if (rows.length === 0) {
      alert('Adicione pelo menos um produto antes de salvar a lista.')
      return
    }
    const nomePadrao = editingListaNome || 'Nova lista de produtos'
    const nome = window.prompt('Nome da lista de produtos:', nomePadrao)
    if (!nome?.trim()) return

    setListaProdutoSaving(true)
    setListaProdutoMsg('')
    try {
      const produtos = rowsToProdutoListaItems(rows)
      const existente = produtoListas.find((l) => l.id === editingListaId)
      const saved = existente
        ? await saveProdutoLista({ ...existente, nome: nome.trim(), produtos })
        : await createProdutoLista(nome.trim(), produtos)

      await carregarListas()
      const n = rows.length
      limparAreaTrabalho()
      emitProdutoListaAtualizada([saved.id])
      setListaProdutoMsg(`Lista «${saved.nome}» salva com ${n} produto(s). Área de produtos limpa.`)
    } catch (e: unknown) {
      setListaProdutoMsg(formatUnknownError(e) || 'Erro ao salvar lista.')
    } finally {
      setListaProdutoSaving(false)
    }
  }

  async function renomearListaSalva(lista: ProdutoLista) {
    const nome = window.prompt('Novo nome da lista de produtos:', lista.nome)
    if (!nome?.trim() || nome.trim() === lista.nome) return

    setListaProdutoSaving(true)
    setListaProdutoMsg('')
    try {
      const saved = await saveProdutoLista({ ...lista, nome: nome.trim() })
      if (editingListaId === lista.id) setEditingListaNome(saved.nome)
      await carregarListas()
      emitProdutoListaAtualizada([saved.id])
      setListaProdutoMsg(`Lista renomeada para «${saved.nome}».`)
    } catch (e: unknown) {
      setListaProdutoMsg(formatUnknownError(e) || 'Erro ao renomear lista.')
    } finally {
      setListaProdutoSaving(false)
    }
  }

  async function excluirListaSalva(lista: ProdutoLista) {
    if (
      !confirm(
        `Tem certeza que deseja excluir a lista «${lista.nome}»?\n\n` +
          `${lista.produtos.length} produto(s) serão removidos desta lista. ` +
          `Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    try {
      await deleteProdutoLista(lista.id)
      if (editingListaId === lista.id) limparAreaTrabalho()
      await carregarListas()
      setListaProdutoMsg(`Lista «${lista.nome}» excluída.`)
    } catch (e: unknown) {
      setListaProdutoMsg(formatUnknownError(e) || 'Erro ao excluir lista.')
    }
  }

  useEffect(() => {
    void (async () => {
      setConferentesLoading(true)
      try {
        const { data, error: qErr } = await supabase.from('conferentes').select('id,nome').order('nome')
        if (qErr) throw qErr
        setConferentes(data ?? [])
      } catch {
        setConferentes([])
      } finally {
        setConferentesLoading(false)
      }
    })()
  }, [])

  const alteracaoConferenteNome = useMemo(() => {
    const n = conferentes.find((c) => c.id === alteracaoConferenteId)?.nome?.trim()
    return n || ''
  }, [conferentes, alteracaoConferenteId])

  const precisaConferenteNaEdicao = useMemo(() => {
    if (!editingKey || !editSnapshot) return false
    const r = rows.find((x) => rowKey(x) === editingKey)
    if (!r) return false
    return (
      normEanDun(r.ean) !== normEanDun(editSnapshot.ean) || normEanDun(r.dun) !== normEanDun(editSnapshot.dun)
    )
  }, [editingKey, editSnapshot, rows])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      let data: Record<string, unknown>[] | null = null
      let qErr: { message?: string; code?: string } | null = null
      const selFull = 'id,codigo_interno,descricao,unidade,ean,dun'
      const selLegado = 'id,codigo_interno,descricao,unidade_medida,ean,dun'
      const selBasico = 'id,codigo_interno,descricao,ean,dun'

      const trySelect = async (cols: string) =>
        supabase.from(TABELA_PRODUTOS).select(cols).order('codigo_interno', { ascending: true }).limit(20000)

      const selMeta =
        'ean_alterado_em,ean_alterado_em_hora,ean_alterado_conferente,dun_alterado_em,dun_alterado_em_hora,dun_alterado_conferente'
      /** Meta + legado/básico antes de selects só com datas, para não perder hora/conferente quando `unidade` falha. */
      const candidates = [
        `${selFull},${selMeta}`,
        `${selLegado},${selMeta}`,
        `${selBasico},${selMeta}`,
        `${selFull},ean_alterado_em,dun_alterado_em`,
        `${selLegado},ean_alterado_em,dun_alterado_em`,
        `${selBasico},ean_alterado_em,dun_alterado_em`,
        `${selFull},ean_dun_alterado_em`,
        `${selLegado},ean_dun_alterado_em`,
        `${selBasico},ean_dun_alterado_em`,
        selFull,
        selLegado,
        selBasico,
      ]

      let usedSelect = candidates[0]
      let res = await trySelect(usedSelect)
      data = res.data as Record<string, unknown>[] | null
      qErr = res.error
      for (let i = 1; i < candidates.length && qErr && isColumnMissingError(qErr); i++) {
        usedSelect = candidates[i]
        res = await trySelect(usedSelect)
        data = res.data as Record<string, unknown>[] | null
        qErr = res.error
      }
      if (qErr) throw new Error(formatUnknownError(qErr))
      setDbUnidadeField(unidadeColFromSelect(usedSelect))
      setDbMetaCap(metaCapFromSelect(usedSelect))
      const mapped: ProdutoDbRow[] = (data ?? []).map((r: Record<string, unknown>) => {
        const um = r.unidade ?? r.unidade_medida ?? r.UNIDADE
        const leg = r.ean_dun_alterado_em
        const legStr = leg != null && String(leg).trim() !== '' ? String(leg).slice(0, 10) : null
        const eanA = r.ean_alterado_em
        const dunA = r.dun_alterado_em
        const eanStr =
          eanA != null && String(eanA).trim() !== '' ? String(eanA).slice(0, 10) : legStr
        const dunStr =
          dunA != null && String(dunA).trim() !== '' ? String(dunA).slice(0, 10) : legStr
        return {
          id: String(r.id ?? ''),
          codigo_interno: String(r.codigo_interno ?? r.codigo ?? ''),
          descricao: String(r.descricao ?? ''),
          unidade:
            um != null && String(um).trim() !== '' ? String(um).trim() : null,
          ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean) : null,
          dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun) : null,
          ean_alterado_em: eanStr,
          ean_alterado_em_hora:
            pickIsoHoraFromDb(r.ean_alterado_em_hora) ??
            pickIsoHoraFromDb(r.ean_alterado_em) ??
            null,
          ean_alterado_conferente:
            r.ean_alterado_conferente != null && String(r.ean_alterado_conferente).trim() !== ''
              ? String(r.ean_alterado_conferente).trim()
              : null,
          dun_alterado_em: dunStr,
          dun_alterado_em_hora:
            pickIsoHoraFromDb(r.dun_alterado_em_hora) ??
            pickIsoHoraFromDb(r.dun_alterado_em) ??
            null,
          dun_alterado_conferente:
            r.dun_alterado_conferente != null && String(r.dun_alterado_conferente).trim() !== ''
              ? String(r.dun_alterado_conferente).trim()
              : null,
          ean_dun_alterado_em: legStr,
        }
      })
      const list = mapped.filter((r) => r.codigo_interno.trim() !== '')
      setRows(list)
      setEditingKey(null)
      setEditSnapshot(null)
      setBipCodigoBarras('')
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao carregar a base.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  const abasProduto = useMemo(() => {
    const grupos = new Set<string>()
    for (const r of rows) grupos.add(grupoProdutoTab(r.codigo_interno))
    return ['todos', ...[...grupos].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))]
  }, [rows])

  const listaFiltrada = useMemo(() => {
    let list = rows
    if (listaTab !== 'todos') {
      list = list.filter((r) => grupoProdutoTab(r.codigo_interno) === listaTab)
    }
    const q = bipCodigoBarras.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.codigo_interno.toLowerCase().includes(q) ||
          r.descricao.toLowerCase().includes(q) ||
          matchesBarcode(r.ean, bipCodigoBarras) ||
          matchesBarcode(r.dun, bipCodigoBarras),
      )
    }
    return list
  }, [rows, listaTab, bipCodigoBarras])

  const totalPages = Math.max(1, Math.ceil(listaFiltrada.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const sliceLista = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE
    return listaFiltrada.slice(start, start + PAGE_SIZE)
  }, [listaFiltrada, pageSafe])

  const rangeFrom = listaFiltrada.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1
  const rangeTo =
    listaFiltrada.length === 0 ? 0 : Math.min(pageSafe * PAGE_SIZE, listaFiltrada.length)

  useEffect(() => {
    setPage(1)
  }, [listaTab, bipCodigoBarras])

  useEffect(() => {
    if (!abasProduto.includes(listaTab)) setListaTab('todos')
  }, [abasProduto, listaTab])

  function patchRow(key: string, patch: Partial<ProdutoDbRow>) {
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r)))
  }

  function startEdit(r: ProdutoDbRow) {
    const k = rowKey(r)
    if (editingKey && editingKey !== k) {
      if (!confirm('Há outra linha em edição. Descartar alterações nela e editar esta?')) return
      cancelEditInternal()
    }
    setEditSnapshot({ ...r })
    setEditingKey(k)
    setError('')
    setSuccess('')
  }

  function limparBusca() {
    setBipCodigoBarras('')
    setEditingKey(null)
    setEditSnapshot(null)
    setError('')
  }

  function buscarPorBipEanDun() {
    const q = bipCodigoBarras.trim()
    if (!q) {
      setError('Informe código, EAN, DUN ou parte da descrição.')
      setSuccess('')
      return
    }
    if (rows.length === 0) {
      setError('Nenhum produto no rascunho. Carregue a base do Supabase ou abra uma lista salva.')
      setSuccess('')
      return
    }
    const ql = q.toLowerCase()
    const matches = rows.filter(
      (r) =>
        matchesBarcode(r.ean, q) ||
        matchesBarcode(r.dun, q) ||
        r.codigo_interno.toLowerCase().includes(ql) ||
        r.descricao.toLowerCase().includes(ql),
    )
    if (!matches.length) {
      setError(`Nenhum produto encontrado para: ${q}`)
      setSuccess('')
      return
    }
    const found = matches[0]
    const tab = grupoProdutoTab(found.codigo_interno)
    setListaTab(matches.every((m) => grupoProdutoTab(m.codigo_interno) === tab) ? tab : 'todos')
    setError('')
    setSuccess(
      matches.length > 1
        ? `${matches.length} produto(s) na lista filtrada.`
        : `Produto ${found.codigo_interno} selecionado para edição.`,
    )
    startEdit(found)
    window.setTimeout(() => {
      rowRefs.current.get(rowKey(found))?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 100)
  }

  useEffect(() => {
    if (!editingKey) return
    const t = window.setTimeout(() => {
      const el = rowRefs.current.get(editingKey)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [editingKey])

  function cancelEditInternal() {
    if (editingKey && editSnapshot) {
      setRows((prev) => prev.map((x) => (rowKey(x) === editingKey ? { ...editSnapshot } : x)))
    }
    setEditingKey(null)
    setEditSnapshot(null)
  }

  function cancelEdit() {
    cancelEditInternal()
  }

  function buildFilterForRow(r: ProdutoDbRow) {
    if (r.id && r.id.trim() !== '') {
      return (q: ReturnType<typeof supabase.from>) => q.eq('id', r.id)
    }
    if (r.codigo_interno.trim()) {
      return (q: ReturnType<typeof supabase.from>) => q.eq('codigo_interno', r.codigo_interno.trim())
    }
    throw new Error('Sem id nem código para identificar a linha.')
  }

  async function saveRow(r: ProdutoDbRow) {
    const k = rowKey(r)
    setSavingKey(k)
    setError('')
    setSuccess('')
    try {
      const descricao = String(r.descricao ?? '').trim()
      if (!descricao) throw new Error('Descrição é obrigatória.')

      const ean = normEanDun(r.ean)
      const dun = normEanDun(r.dun)
      const unidadeRaw = String(r.unidade ?? '').trim()
      const unidade = unidadeRaw === '' ? null : unidadeRaw

      const snap = editSnapshot
      const eanChanged = normEanDun(r.ean) !== normEanDun(snap?.ean)
      const dunChanged = normEanDun(r.dun) !== normEanDun(snap?.dun)
      if ((eanChanged || dunChanged) && !alteracaoConferenteId.trim()) {
        setError(MSG_CONFERENTE_OBRIGATORIO)
        setSavingKey(null)
        window.setTimeout(() => conferenteSelectRef.current?.focus(), 0)
        return
      }
      const agoraIso = nowIsoLocal()
      const nomeAlt = alteracaoConferenteNome
      const ean_alterado_em = eanChanged ? todayYmdLocal() : (r.ean_alterado_em ?? null)
      const ean_alterado_em_hora = eanChanged ? agoraIso : (r.ean_alterado_em_hora ?? null)
      const ean_alterado_conferente = eanChanged ? nomeAlt : (r.ean_alterado_conferente ?? null)
      const dun_alterado_em = dunChanged ? todayYmdLocal() : (r.dun_alterado_em ?? null)
      const dun_alterado_em_hora = dunChanged ? agoraIso : (r.dun_alterado_em_hora ?? null)
      const dun_alterado_conferente = dunChanged ? nomeAlt : (r.dun_alterado_conferente ?? null)
      const legacy_combo =
        eanChanged || dunChanged
          ? todayYmdLocal()
          : (r.ean_dun_alterado_em ?? snap?.ean_dun_alterado_em ?? null)

      const selectRetorno =
        dbMetaCap === 'full'
          ? 'id,codigo_interno,ean_alterado_em,ean_alterado_em_hora,ean_alterado_conferente,dun_alterado_em,dun_alterado_em_hora,dun_alterado_conferente'
          : dbMetaCap === 'dates'
            ? 'id,codigo_interno,ean_alterado_em,dun_alterado_em'
            : 'id,codigo_interno'

      const runUpdate = (
        payload: Record<string, unknown>,
        filter: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>,
      ) => {
        let q = supabase.from(TABELA_PRODUTOS).update(payload)
        q = filter(q) as typeof q
        return q.select(selectRetorno).limit(1)
      }

      const tryUpdate = async (payload: Record<string, unknown>) => {
        let res = await runUpdate(payload, buildFilterForRow(r))
        if ((!res.data || res.data.length === 0) && !res.error && r.id && r.id.trim() !== '' && r.codigo_interno.trim()) {
          res = await runUpdate(payload, (q) => q.eq('codigo_interno', r.codigo_interno.trim()))
        }
        return res
      }

      const ufs: UnidadeDbField[] =
        dbUnidadeField === 'unidade_medida' ? ['unidade_medida', 'unidade'] : ['unidade', 'unidade_medida']
      const updateTries: Record<string, unknown>[] = []
      for (const uf of ufs) {
        const u = patchUnidadeField(uf, unidade)
        updateTries.push(
          {
            descricao,
            ean,
            dun,
            ...u,
            ean_alterado_em,
            ean_alterado_em_hora,
            ean_alterado_conferente,
            dun_alterado_em,
            dun_alterado_em_hora,
            dun_alterado_conferente,
          },
          { descricao, ean, dun, ...u, ean_alterado_em, dun_alterado_em },
          { descricao, ean, dun, ean_alterado_em, dun_alterado_em },
          { descricao, ean, dun, ...u, ean_dun_alterado_em: legacy_combo },
          { descricao, ean, dun, ean_dun_alterado_em: legacy_combo },
          { descricao, ean, dun, ...u },
        )
      }
      updateTries.push({ descricao, ean, dun })

      type IdCodRow = Record<string, unknown>
      let data: IdCodRow[] | null = null
      let uErr: { message?: string; code?: string } | null = null
      const precisaMetaNoBanco = (eanChanged || dunChanged) && dbMetaCap === 'full'
      for (const payload of updateTries) {
        const res = await tryUpdate(payload)
        data = res.data as IdCodRow[] | null
        uErr = res.error
        if (uErr) {
          if (!isColumnMissingError(uErr)) break
          continue
        }
        if (!precisaMetaNoBanco || payloadTemMetaHoraConferente(payload)) break
      }

      if (uErr) throw new Error(formatUnknownError(uErr))
      if (!data || data.length === 0) {
        throw new Error(
          'Nenhuma linha foi atualizada no banco (0 linhas). No Supabase, execute o script ' +
            'supabase/sql/rls_todos_os_produtos_crud.sql (RLS + GRANT). Se já executou, confira se o id/código da linha bate com o banco.',
        )
      }

      const rowSalva: ProdutoDbRow = {
        ...r,
        descricao,
        ean,
        dun,
        unidade,
        ean_alterado_em,
        ean_alterado_em_hora,
        ean_alterado_conferente,
        dun_alterado_em,
        dun_alterado_em_hora,
        dun_alterado_conferente,
        ean_dun_alterado_em: legacy_combo ?? r.ean_dun_alterado_em ?? null,
      }
      const ret = data[0]
      if (ret.ean_alterado_em_hora != null) {
        rowSalva.ean_alterado_em_hora = pickIsoHoraFromDb(ret.ean_alterado_em_hora) ?? rowSalva.ean_alterado_em_hora
      }
      if (ret.ean_alterado_conferente != null) {
        rowSalva.ean_alterado_conferente = String(ret.ean_alterado_conferente).trim() || rowSalva.ean_alterado_conferente
      }
      if (ret.dun_alterado_em_hora != null) {
        rowSalva.dun_alterado_em_hora = pickIsoHoraFromDb(ret.dun_alterado_em_hora) ?? rowSalva.dun_alterado_em_hora
      }
      if (ret.dun_alterado_conferente != null) {
        rowSalva.dun_alterado_conferente = String(ret.dun_alterado_conferente).trim() || rowSalva.dun_alterado_conferente
      }
      if (ret.ean_alterado_em != null) {
        const d = String(ret.ean_alterado_em).slice(0, 10)
        if (d) rowSalva.ean_alterado_em = d
      }
      if (ret.dun_alterado_em != null) {
        const d = String(ret.dun_alterado_em).slice(0, 10)
        if (d) rowSalva.dun_alterado_em = d
      }

      setRows((prev) => prev.map((x) => (rowKey(x) === k ? rowSalva : x)))

      let msgOk = `Produto ${r.codigo_interno} atualizado no banco.`
      if ((eanChanged || dunChanged) && dbMetaCap !== 'full') {
        msgOk +=
          ' A data foi gravada; hora e conferente exigem as colunas no Supabase (rode supabase/sql/alter_todos_os_produtos_ean_dun_alterado_meta.sql).'
      }
      try {
        const listaNome = await sincronizarProdutoNasListasVinculadas(rowSalva)
        if (listaNome) {
          msgOk += ` Sincronizado na lista «${listaNome}» — já pode bipar na contagem/inventário.`
        }
      } catch {
        msgOk += ' Não foi possível atualizar a lista do inventário/contagem; use «Atualizar produtos» na captura.'
      }
      setSuccess(msgOk)
      setEditingKey(null)
      setEditSnapshot(null)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao salvar.')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteRow(r: ProdutoDbRow) {
    if (!confirm(`Excluir permanentemente o produto ${r.codigo_interno} — ${r.descricao}?`)) return
    const k = rowKey(r)
    setDeletingKey(k)
    setError('')
    setSuccess('')
    try {
      const trimmedCod = r.codigo_interno.trim()

      if (r.id && String(r.id).trim() !== '') {
        const { data: del, error: dErr } = await supabase
          .from(TABELA_PRODUTOS)
          .delete()
          .eq('id', r.id)
          .select('id')
        if (dErr) throw dErr
        if (!del?.length) throw new Error('Nenhuma linha excluída (id não encontrado no banco).')
      } else {
        const { data: delExact, error: e1 } = await supabase
          .from(TABELA_PRODUTOS)
          .delete()
          .eq('codigo_interno', trimmedCod)
          .select('id')
        if (e1) throw e1
        if (!delExact?.length) {
          const { data: all, error: lErr } = await supabase.from(TABELA_PRODUTOS).select('id,codigo_interno').limit(20000)
          if (lErr) throw lErr
          type CodRow = { codigo_interno?: unknown }
          const exactValues = [
            ...new Set(
              ((all ?? []) as CodRow[])
                .filter((row) => String(row.codigo_interno ?? '').trim() === trimmedCod)
                .map((row) => String(row.codigo_interno ?? '')),
            ),
          ]
          if (exactValues.length === 0) {
            throw new Error(
              'Nenhuma linha com esse código. Se no Supabase o código parece igual ao digitado, ele pode ter espaços — rode supabase/sql/normalize_todos_os_produtos_codigo_trim.sql ou use delete com trim() no SQL Editor.',
            )
          }
          let total = 0
          for (const exact of exactValues) {
            const { data: del, error: de } = await supabase
              .from(TABELA_PRODUTOS)
              .delete()
              .eq('codigo_interno', exact)
              .select('id')
            if (de) throw de
            total += del?.length ?? 0
          }
          if (total === 0) throw new Error('Exclusão não removeu linhas.')
        }
      }

      setSuccess(`Produto ${trimmedCod} excluído do banco.`)
      if (editingKey === k) {
        setEditingKey(null)
        setEditSnapshot(null)
      }
      setRows((prev) => prev.filter((x) => rowKey(x) !== k))
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao excluir.')
    } finally {
      setDeletingKey(null)
    }
  }

  async function cadastrarProduto() {
    const cod = cadastroCodigo.trim()
    const desc = cadastroDescricao.trim()
    if (!cod || !desc) {
      setError('Código e descrição são obrigatórios no cadastro.')
      return
    }
    setCadastroSaving(true)
    setError('')
    setSuccess('')
    try {
      const ean = normEanDun(cadastroEan)
      const dun = normEanDun(cadastroDun)
      const unidadeRaw = cadastroUnidade.trim()
      const unidade = unidadeRaw === '' ? null : unidadeRaw

      if ((ean != null || dun != null) && !alteracaoConferenteId.trim()) {
        setError(MSG_CONFERENTE_OBRIGATORIO)
        setCadastroSaving(false)
        window.setTimeout(() => conferenteSelectRef.current?.focus(), 0)
        return
      }

      const tryInsert = async (payload: Record<string, unknown>) => {
        return supabase.from(TABELA_PRODUTOS).insert(payload).select('id,codigo_interno').limit(1)
      }

      const agoraIso = nowIsoLocal()
      const nomeAlt = alteracaoConferenteNome
      const patchNew: Record<string, unknown> = {}
      if (ean != null) {
        patchNew.ean_alterado_em = todayYmdLocal()
        patchNew.ean_alterado_em_hora = agoraIso
        patchNew.ean_alterado_conferente = nomeAlt
      }
      if (dun != null) {
        patchNew.dun_alterado_em = todayYmdLocal()
        patchNew.dun_alterado_em_hora = agoraIso
        patchNew.dun_alterado_conferente = nomeAlt
      }
      const legacyIns =
        ean != null || dun != null ? { ean_dun_alterado_em: todayYmdLocal() as string } : {}

      const insertTries: Record<string, unknown>[] = [
        { codigo_interno: cod, descricao: desc, ean, dun, unidade, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade, ...patchNew },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade, ...legacyIns },
        { codigo_interno: cod, descricao: desc, ean, dun, unidade_medida: unidade },
        { codigo_interno: cod, descricao: desc, ean, dun },
      ]

      type IdCodRowIns = { id: unknown; codigo_interno: unknown }
      let data: IdCodRowIns[] | null = null
      let insErr: { message?: string; code?: string } | null = null
      for (const p of insertTries) {
        const res = await tryInsert(p)
        data = res.data as IdCodRowIns[] | null
        insErr = res.error
        if (!insErr) break
        if (!isColumnMissingError(insErr)) break
      }

      if (insErr) throw new Error(formatUnknownError(insErr))
      if (!data || data.length === 0) {
        throw new Error(
          'Insert não retornou linha. Verifique permissões RLS (INSERT) na tabela "Todos os Produtos".',
        )
      }

      const ret = data[0]
      const novo: ProdutoDbRow = {
        id: String(ret.id ?? ''),
        codigo_interno: String(ret.codigo_interno ?? cod),
        descricao: desc,
        unidade,
        ean,
        dun,
        ean_alterado_em: ean != null ? todayYmdLocal() : null,
        ean_alterado_em_hora: ean != null ? agoraIso : null,
        ean_alterado_conferente: ean != null ? nomeAlt : null,
        dun_alterado_em: dun != null ? todayYmdLocal() : null,
        dun_alterado_em_hora: dun != null ? agoraIso : null,
        dun_alterado_conferente: dun != null ? nomeAlt : null,
      }

      const listaIdSync =
        editingListaId ?? sessaoListaCtx?.listaProdutosId ?? (cadastroListaId.trim() || null)

      if (!emRascunhoNovaLista && !listaIdSync && produtoListas.length > 0) {
        setError('Selecione em qual lista incluir o produto.')
        setCadastroSaving(false)
        return
      }

      if (editingListaId || emRascunhoNovaLista) {
        setRows((prev) => {
          const keyNovo = normalizeCodigoInternoCompareKey(novo.codigo_interno)
          const semDup = prev.filter((x) => normalizeCodigoInternoCompareKey(x.codigo_interno) !== keyNovo)
          return [...semDup, novo].sort((a, b) => a.codigo_interno.localeCompare(b.codigo_interno, 'pt-BR'))
        })
      }

      let msgOk = `Produto ${cod} cadastrado no banco.`
      try {
        const extras: string[] = []
        if (!emRascunhoNovaLista && listaIdSync && !listaDestinoFixaCadastro) {
          extras.push(listaIdSync)
        }
        const listaNome = await sincronizarProdutoNasListasVinculadas(novo, extras)
        if (listaNome) {
          msgOk += ` Incluído na lista «${listaNome}» — já pode bipar na contagem/inventário.`
        } else if (emRascunhoNovaLista) {
          msgOk += ' Incluído no rascunho — clique em Salvar lista para gravar.'
        } else if (listaIdSync) {
          const n = produtoListas.find((l) => l.id === listaIdSync)?.nome
          if (n) msgOk += ` Incluído na lista «${n}».`
        }
      } catch {
        msgOk += ' Não foi possível incluir na lista; tente novamente ou salve a lista manualmente.'
      }
      setSuccess(msgOk)
      setCadastroOpen(false)
      setCadastroCodigo('')
      setCadastroDescricao('')
      setCadastroUnidade('')
      setCadastroEan('')
      setCadastroDun('')
      setCadastroListaId('')
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao cadastrar.')
    } finally {
      setCadastroSaving(false)
    }
  }

  const canEditRow = (k: string) => editingKey === k

  function contagemAba(tab: string) {
    if (tab === 'todos') return rows.length
    return rows.filter((r) => grupoProdutoTab(r.codigo_interno) === tab).length
  }

  return (
    <div className="produtos-page produtos-page--lista">
      <header className="produtos-page__header">
        <div>
          <div className="produtos-page__title-row">
            <h1>Produtos</h1>
            <PageInfoButton title="Produtos" ariaLabel="Ajuda: Produtos">
              <PageInfoBlock>
                Monte listas de produtos para o inventário. A base oficial fica no Supabase ({TABELA_PRODUTOS}) — use
                «Carregar base» na área abaixo ou cadastre produtos manualmente.
              </PageInfoBlock>
              <PageInfoBlock title="Listas de produtos salvas">
                Listas gravadas para usar no inventário. Use <strong>Abrir</strong> para editar produtos,{' '}
                <strong>Editar</strong> para trocar o nome, <strong>Fechar</strong> para sair da edição; ao{' '}
                <strong>Salvar lista</strong>, os produtos são gravados e a área de trabalho é limpa.
              </PageInfoBlock>
            </PageInfoButton>
          </div>
        </div>
        <button
          type="button"
          className="produtos-page__btn-cadastrar"
          onClick={abrirModalCadastro}
        >
          + Cadastrar
        </button>
      </header>

      {sessaoListaCtx ? (
        <div className="produtos-page__sessao-ctx" role="status">
          {sessaoListaCtx.tipo === 'inventario' ? 'Inventário' : 'Contagem diária'} em andamento
          {sessaoListaCtx.listaProdutosNome ? (
            <>
              {' '}
              — lista <strong>{sessaoListaCtx.listaProdutosNome}</strong>
            </>
          ) : (
            ' — base «Todos os Produtos»'
          )}
          . Produtos cadastrados ou editados aqui entram na lista automaticamente.
        </div>
      ) : null}

      <section className="produtos-listas-salvas">
        <PageSectionHeading title="Listas de produtos salvas" />
        <div className="page-table-wrap">
          <table className="page-table page-table--compact">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Produtos</th>
                <th>Atualizado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listaProdutoLoading ? (
                <tr>
                  <td colSpan={4}>Carregando listas…</td>
                </tr>
              ) : produtoListas.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    Nenhuma lista salva ainda. Monte os produtos na área abaixo e clique em Salvar lista.
                  </td>
                </tr>
              ) : (
                produtoListas.map((l) => {
                  const emEdicao = editingListaId === l.id
                  return (
                    <tr key={l.id} className={emEdicao ? 'produtos-listas-salvas__row--ativa' : undefined}>
                      <td>
                        {l.nome}
                        {emEdicao ? <span className="produtos-listas-salvas__badge">em edição</span> : null}
                      </td>
                      <td>{l.produtos.length}</td>
                      <td>{formatListaAtualizado(l.updatedAt)}</td>
                      <td className="produtos-page__actions-cell">
                        {emEdicao ? (
                          <button
                            type="button"
                            className="page-btn-ghost"
                            disabled={listaProdutoSaving}
                            onClick={fecharListaAberta}
                          >
                            Fechar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="page-btn-ghost"
                            disabled={listaProdutoSaving}
                            onClick={() => abrirListaSalva(l)}
                          >
                            Abrir
                          </button>
                        )}
                        <button
                          type="button"
                          className="page-btn-ghost"
                          disabled={listaProdutoSaving}
                          onClick={() => void renomearListaSalva(l)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="page-btn-ghost page-btn-danger"
                          disabled={listaProdutoSaving}
                          onClick={() => void excluirListaSalva(l)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {listaProdutoMsg ? <p className="produtos-page__success produtos-listas-salvas__msg">{listaProdutoMsg}</p> : null}
      </section>

      <section className="produtos-area-trabalho">
        <div className="produtos-area-trabalho__header">
          <h2 className="produtos-area-trabalho__title">
            {editingListaId ? `Editando: ${editingListaNome}` : 'Área de produtos'}
          </h2>
          <div className="produtos-area-trabalho__actions">
            {editingListaId ? (
              <button type="button" disabled={listaProdutoSaving} onClick={fecharListaAberta}>
                Fechar lista
              </button>
            ) : null}
            <button type="button" disabled={listaProdutoLoading || listaProdutoSaving} onClick={iniciarNovaLista}>
              Nova lista
            </button>
            <button type="button" disabled={loading} onClick={() => void load()}>
              {loading ? 'Carregando…' : 'Carregar base do Supabase'}
            </button>
            <button
              type="button"
              disabled={rows.length === 0 || listaProdutoSaving}
              onClick={() => void salvarListaProdutosAtual()}
            >
              {listaProdutoSaving ? 'Salvando…' : 'Salvar lista'}
            </button>
          </div>
        </div>
        <p className="produtos-area-trabalho__meta">
          {rows.length === 0
            ? 'Nenhum produto no rascunho. Carregue a base, cadastre novos ou abra uma lista salva.'
            : `${rows.length} produto(s) no rascunho — salve para gravar na lista e limpar esta área.`}
        </p>

      <section className="produtos-page__search">
        <label className="produtos-page__search-label" htmlFor="produto-busca">
          Filtrar / buscar produto
        </label>
        <div className="produtos-page__search-row">
          <input
            id="produto-busca"
            ref={bipInputRef}
            className="produtos-page__search-input"
            value={bipCodigoBarras}
            onChange={(e) => {
              const v = e.target.value
              setBipCodigoBarras(v)
              if (v.trim() === '') setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                buscarPorBipEanDun()
              }
            }}
            autoComplete="off"
            placeholder="Código, EAN, DUN ou descrição…"
            aria-label="Buscar produto"
          />
          <div className="produtos-page__search-actions">
            <button
              type="button"
              className="produtos-page__btn-buscar"
              onClick={() => buscarPorBipEanDun()}
              disabled={loading}
            >
              Buscar
            </button>
            {bipCodigoBarras.trim() ? (
              <button type="button" className="produtos-page__btn-limpar" onClick={limparBusca}>
                Limpar
              </button>
            ) : null}
          </div>
        </div>
        <p className="produtos-page__hint">
          A lista abaixo filtra enquanto você digita. Use o leitor e Enter para ir direto ao produto e editar.
        </p>

        {editingKey && precisaConferenteNaEdicao ? (
          <div className="produtos-page__conferente">
            <label className="produtos-page__search-label" htmlFor="produto-conferente">
              Conferente (obrigatório ao alterar EAN/DUN)
            </label>
            <select
              id="produto-conferente"
              ref={conferenteSelectRef}
              value={alteracaoConferenteId}
              onChange={(e) => {
                setAlteracaoConferenteId(e.target.value)
                if (e.target.value.trim()) setError('')
              }}
              disabled={conferentesLoading}
            >
              <option value="">{conferentesLoading ? 'Carregando…' : 'Selecione…'}</option>
              {conferentes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      {error ? <div className="produtos-page__msg produtos-page__msg--error">{error}</div> : null}
      {success ? <div className="produtos-page__msg produtos-page__msg--ok">{success}</div> : null}

      <section className="produtos-page__lista">
        <div className="page-tabs" role="tablist" aria-label="Famílias de produtos">
          {abasProduto.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={listaTab === tab}
              className={`page-tabs__btn${listaTab === tab ? ' page-tabs__btn--active' : ''}`}
              onClick={() => setListaTab(tab)}
            >
              {tab === 'todos' ? `Todos (${contagemAba(tab)})` : `Fam. ${tab} (${contagemAba(tab)})`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="page-panel__meta">Carregando produtos…</p>
        ) : (
          <p className="page-panel__meta">
            Mostrando {rangeFrom}–{rangeTo} de {listaFiltrada.length} produto(s)
            {bipCodigoBarras.trim() ? ' (filtrado)' : ''} · Página {pageSafe} de {totalPages}
          </p>
        )}

        <div className="page-table-wrap produtos-page__table-wrap">
          <table className="page-table page-table--compact produtos-page__table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Un.</th>
                <th>EAN</th>
                <th>DUN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Carregando…</td>
                </tr>
              ) : sliceLista.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nenhum produto nesta aba ou filtro.</td>
                </tr>
              ) : (
                sliceLista.map((row) => {
                  const k = rowKey(row)
                  const edit = canEditRow(k)
                  const saving = savingKey === k
                  const deleting = deletingKey === k
                  return (
                    <tr
                      key={k}
                      ref={(el) => {
                        if (el) rowRefs.current.set(k, el)
                        else rowRefs.current.delete(k)
                      }}
                      className={edit ? 'produtos-page__row--edit' : undefined}
                    >
                      <td>
                        <span className="produtos-page__codigo-cell">{row.codigo_interno}</span>
                      </td>
                      <td>
                        {edit ? (
                          <textarea
                            className="produtos-page__cell-input produtos-page__cell-input--desc"
                            value={row.descricao}
                            onChange={(e) => patchRow(k, { descricao: e.target.value })}
                            rows={2}
                          />
                        ) : (
                          row.descricao
                        )}
                      </td>
                      <td>
                        {edit ? (
                          <input
                            className="produtos-page__cell-input"
                            value={row.unidade ?? ''}
                            onChange={(e) =>
                              patchRow(k, {
                                unidade: e.target.value.trim() === '' ? null : e.target.value,
                              })
                            }
                          />
                        ) : (
                          row.unidade ?? '—'
                        )}
                      </td>
                      <td>
                        <input
                          className="produtos-page__cell-input"
                          value={row.ean ?? ''}
                          onChange={(e) => patchRow(k, { ean: e.target.value === '' ? null : e.target.value })}
                          disabled={!edit || saving || deleting}
                          readOnly={!edit}
                          inputMode="numeric"
                        />
                      </td>
                      <td>
                        <input
                          className="produtos-page__cell-input"
                          value={row.dun ?? ''}
                          onChange={(e) => patchRow(k, { dun: e.target.value === '' ? null : e.target.value })}
                          disabled={!edit || saving || deleting}
                          readOnly={!edit}
                          inputMode="numeric"
                        />
                      </td>
                      <td className="produtos-page__actions-cell">
                        {!edit ? (
                          <>
                            <button
                              type="button"
                              className="page-btn-ghost"
                              disabled={!!editingKey || saving || deleting}
                              onClick={() => startEdit(row)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="page-btn-ghost page-btn-danger"
                              disabled={!!editingKey || deleting}
                              onClick={() => void deleteRow(row)}
                            >
                              {deleting ? '…' : 'Excluir'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="produtos-page__btn-primary"
                              disabled={saving || deleting}
                              onClick={() => void saveRow(row)}
                            >
                              {saving ? 'Salvando…' : 'Salvar'}
                            </button>
                            <button
                              type="button"
                              className="produtos-page__btn-muted"
                              disabled={saving || deleting}
                              onClick={() => cancelEdit()}
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {listaFiltrada.length > PAGE_SIZE ? (
          <div className="page-pagination">
            <button type="button" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </button>
            <span>
              Página {pageSafe} de {totalPages}
            </span>
            <button
              type="button"
              disabled={pageSafe >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Próxima
            </button>
          </div>
        ) : null}
      </section>

      </section>

      {cadastroOpen ? (
        <div
          className="produtos-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="produtos-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !cadastroSaving) setCadastroOpen(false)
          }}
        >
          <div className="produtos-modal">
            <div className="produtos-modal__head">
              <h2 id="produtos-modal-title">Novo produto</h2>
              <button
                type="button"
                className="produtos-modal__close"
                aria-label="Fechar"
                disabled={cadastroSaving}
                onClick={() => setCadastroOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="produtos-modal__body">
              {listaDestinoFixaCadastro ? (
                <p className="produtos-modal__lista-destino" role="status">
                  Lista de destino:{' '}
                  <strong>{listaDestinoFixaCadastro.nome || '—'}</strong>
                  {listaDestinoFixaCadastro.modo === 'edicao'
                    ? ' — o produto entra na lista aberta e na base.'
                    : listaDestinoFixaCadastro.modo === 'sessao'
                      ? ' — vinculado ao inventário/contagem em andamento.'
                      : ' — salve a lista depois para gravar no sistema.'}
                </p>
              ) : produtoListas.length > 0 ? (
                <div className="produtos-page__field">
                  <label htmlFor="cadastro-lista-destino">Lista de destino *</label>
                  <select
                    id="cadastro-lista-destino"
                    value={cadastroListaId}
                    onChange={(e) => setCadastroListaId(e.target.value)}
                    disabled={cadastroSaving || listaProdutoLoading}
                  >
                    <option value="">
                      {listaProdutoLoading ? 'Carregando listas…' : 'Selecione a lista…'}
                    </option>
                    {produtoListas.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome} ({l.produtos.length} produtos)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="produtos-modal__lista-destino" role="status">
                  O produto será gravado só na base «{TABELA_PRODUTOS}». Crie ou abra uma lista para vincular ao
                  inventário.
                </p>
              )}
              <div className="produtos-page__field">
                <label>Código do produto *</label>
                <input
                  value={cadastroCodigo}
                  onChange={(e) => setCadastroCodigo(e.target.value)}
                  placeholder="ex.: 01.01.0099"
                  autoComplete="off"
                />
              </div>
              <div className="produtos-page__field">
                <label>Descrição *</label>
                <textarea
                  value={cadastroDescricao}
                  onChange={(e) => setCadastroDescricao(e.target.value)}
                  placeholder="Descrição do produto"
                  rows={3}
                />
              </div>
              <div className="produtos-page__field">
                <label>Unidade</label>
                <input
                  value={cadastroUnidade}
                  onChange={(e) => setCadastroUnidade(e.target.value)}
                  placeholder="PT, CX…"
                  autoComplete="off"
                />
              </div>
              <div className="produtos-page__grid2">
                <div className="produtos-page__field">
                  <label>EAN</label>
                  <input value={cadastroEan} onChange={(e) => setCadastroEan(e.target.value)} autoComplete="off" />
                </div>
                <div className="produtos-page__field">
                  <label>DUN</label>
                  <input value={cadastroDun} onChange={(e) => setCadastroDun(e.target.value)} autoComplete="off" />
                </div>
              </div>
            </div>
            <div className="produtos-modal__foot">
              <button
                type="button"
                className="produtos-page__btn-primary"
                disabled={cadastroSaving}
                onClick={() => void cadastrarProduto()}
              >
                {cadastroSaving ? 'Salvando…' : 'Salvar produto'}
              </button>
              <button
                type="button"
                className="produtos-page__btn-muted"
                disabled={cadastroSaving}
                onClick={() => setCadastroOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}