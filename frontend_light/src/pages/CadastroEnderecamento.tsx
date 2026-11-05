import { useCallback, useEffect, useMemo, useState } from 'react'
import { getRuasPorCamara, INVENTARIO_CAMARAS } from '../components/inventario/inventarioPlanilhaModel'
import {
  createEnderecoLista,
  deleteEnderecoLista,
  ensureEnderecoListaPadrao,
  listEnderecoListas,
  saveEnderecoLista,
  type EnderecoLista,
} from '../lib/enderecamentoListaSupabase'
import {
  buildCodigoEndereco,
  contarEnderecosPorFiltroEm,
  deleteEnderecoEm,
  deleteEnderecosPorFiltroEm,
  deleteTodosEnderecosEm,
  planejarEnderecosEmLote,
  saveEnderecoEm,
  saveEnderecosEmLoteEm,
  type EnderecoCadastro,
} from '../lib/enderecamentoStore'
import { formatUnknownError } from '../lib/supabaseError'
import { PageInfoBlock, PagePanelHeading, PageSectionHeading } from '../components/ui/PagePanelHeading'

const PAGE_SIZE = 30

const emptyForm = () => ({
  id: '',
  codigo: '',
  camara: '',
  rua: '',
  posicao: '',
  nivel: '',
  observacao: '',
})

const emptyLote = () => ({
  camara: '11',
  rua: 'A',
  nivelDe: '1',
  nivelAte: '5',
  posicaoDe: '1',
  posicaoAte: '15',
  observacao: '',
  substituirExistentes: false,
})

const emptyExclusao = () => ({
  camara: '11',
  rua: 'A',
  nivel: '',
})

function formatListaAtualizado(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

function contarEnderecosAtivos(lista: EnderecoLista) {
  return lista.enderecos.filter((e) => e.ativo !== false).length
}

export default function CadastroEnderecamento() {
  const [listas, setListas] = useState<EnderecoLista[]>([])
  const [editingListaId, setEditingListaId] = useState<string | null>(null)
  const [editingListaNome, setEditingListaNome] = useState('')
  const [rows, setRows] = useState<EnderecoCadastro[]>([])
  const [listaLoading, setListaLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [listaMsg, setListaMsg] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [lote, setLote] = useState(emptyLote)
  const [loteAberto, setLoteAberto] = useState(false)
  const [exclusaoAberta, setExclusaoAberta] = useState(false)
  const [exclusao, setExclusao] = useState(emptyExclusao)
  const [exclusaoMsg, setExclusaoMsg] = useState('')
  const [busca, setBusca] = useState('')
  const [page, setPage] = useState(1)
  const [loteMsg, setLoteMsg] = useState('')
  const [cadastroListaId, setCadastroListaId] = useState('')

  const emRascunhoNovaLista = !editingListaId && rows.length > 0

  const listaDestinoFixaCadastro = useMemo(() => {
    if (editingListaId) {
      return { id: editingListaId, nome: editingListaNome, modo: 'edicao' as const }
    }
    if (emRascunhoNovaLista) {
      return { id: null, nome: 'Rascunho da área abaixo (salve a lista depois)', modo: 'rascunho' as const }
    }
    return null
  }, [editingListaId, editingListaNome, emRascunhoNovaLista])

  const sortRows = useCallback(
    (list: EnderecoCadastro[]) => [...list].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR')),
    [],
  )

  const carregarListas = useCallback(async () => {
    setListaLoading(true)
    try {
      await ensureEnderecoListaPadrao()
      const all = await listEnderecoListas()
      setListas([...all].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    } catch (e: unknown) {
      setListaMsg(formatUnknownError(e) || 'Erro ao carregar listas de endereçamento.')
    } finally {
      setListaLoading(false)
    }
  }, [])

  useEffect(() => {
    void carregarListas()
  }, [carregarListas])

  const applyRows = useCallback(
    (newRows: EnderecoCadastro[]) => {
      setRows(sortRows(newRows))
    },
    [sortRows],
  )

  function limparAreaTrabalho() {
    setRows([])
    setForm(emptyForm())
    setLote(emptyLote())
    setExclusao(emptyExclusao())
    setBusca('')
    setPage(1)
    setLoteMsg('')
    setExclusaoMsg('')
    setEditingListaId(null)
    setEditingListaNome('')
    setCadastroListaId('')
  }

  function iniciarNovaLista() {
    limparAreaTrabalho()
    setListaMsg('Área de cadastro limpa. Monte os endereços abaixo e clique em Salvar lista.')
  }

  function abrirListaSalva(lista: EnderecoLista) {
    setEditingListaId(lista.id)
    setEditingListaNome(lista.nome)
    setCadastroListaId(lista.id)
    setRows(sortRows(lista.enderecos))
    setForm(emptyForm())
    setPage(1)
    setListaMsg(`Editando «${lista.nome}» (${contarEnderecosAtivos(lista)} endereços). Salve para gravar e limpar a área.`)
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
    setListaMsg(`Lista «${nome}» fechada.`)
  }

  /** Base para cadastro: lista aberta, rascunho ou lista escolhida no select. */
  function prepararBaseRowsParaCadastro(): EnderecoCadastro[] | null {
    if (editingListaId || emRascunhoNovaLista) return rows
    if (listas.length === 0) return rows

    if (!cadastroListaId.trim()) {
      setListaMsg('Selecione a lista de destino antes de cadastrar.')
      return null
    }
    const lista = listas.find((l) => l.id === cadastroListaId)
    if (!lista) {
      setListaMsg('Lista não encontrada. Recarregue a página.')
      return null
    }
    setEditingListaId(lista.id)
    setEditingListaNome(lista.nome)
    setListaMsg(`Editando «${lista.nome}» — o endereço será incluído nesta lista.`)
    return sortRows(lista.enderecos)
  }

  async function salvarListaAtual() {
    if (rows.length === 0) {
      alert('Cadastre pelo menos um endereço antes de salvar a lista.')
      return
    }
    const nomePadrao = editingListaNome || 'Nova lista de endereçamento'
    const nome = window.prompt('Nome da lista de endereçamento:', nomePadrao)
    if (!nome?.trim()) return

    setSalvando(true)
    setListaMsg('')
    try {
      const existente = listas.find((l) => l.id === editingListaId)
      const saved = existente
        ? await saveEnderecoLista({ ...existente, nome: nome.trim(), enderecos: rows })
        : await createEnderecoLista(nome.trim(), rows)

      await carregarListas()
      limparAreaTrabalho()
      setListaMsg(`Lista «${saved.nome}» salva com ${rows.length} endereço(s). Área de cadastro limpa.`)
    } catch (e: unknown) {
      setListaMsg(formatUnknownError(e) || 'Erro ao salvar lista.')
    } finally {
      setSalvando(false)
    }
  }

  async function renomearListaSalva(lista: EnderecoLista) {
    const nome = window.prompt('Novo nome da lista de endereçamento:', lista.nome)
    if (!nome?.trim() || nome.trim() === lista.nome) return

    setSalvando(true)
    setListaMsg('')
    try {
      const saved = await saveEnderecoLista({ ...lista, nome: nome.trim() })
      if (editingListaId === lista.id) setEditingListaNome(saved.nome)
      await carregarListas()
      setListaMsg(`Lista renomeada para «${saved.nome}».`)
    } catch (e: unknown) {
      setListaMsg(formatUnknownError(e) || 'Erro ao renomear lista.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluirListaSalva(lista: EnderecoLista) {
    const n = contarEnderecosAtivos(lista)
    if (
      !confirm(
        `Tem certeza que deseja excluir a lista «${lista.nome}»?\n\n` +
          `${n} endereço(s) serão removidos desta lista. ` +
          `Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    try {
      await deleteEnderecoLista(lista.id)
      if (editingListaId === lista.id) limparAreaTrabalho()
      await carregarListas()
      setListaMsg(`Lista «${lista.nome}» excluída.`)
    } catch (e: unknown) {
      setListaMsg(formatUnknownError(e) || 'Erro ao excluir lista.')
    }
  }

  const ruasLote = useMemo(() => {
    const c = Number(lote.camara)
    if (!Number.isFinite(c)) return []
    return getRuasPorCamara(c)
  }, [lote.camara])

  const previewLote = useMemo(() => {
    const camara = Number(lote.camara)
    const nivelDe = Number(lote.nivelDe)
    const nivelAte = Number(lote.nivelAte)
    const posicaoDe = Number(lote.posicaoDe)
    const posicaoAte = Number(lote.posicaoAte)
    if (!Number.isFinite(camara) || !lote.rua.trim()) return []
    if (![nivelDe, nivelAte, posicaoDe, posicaoAte].every(Number.isFinite)) return []
    return planejarEnderecosEmLote({
      camara,
      rua: lote.rua,
      nivelDe,
      nivelAte,
      posicaoDe,
      posicaoAte,
      observacao: lote.observacao,
    })
  }, [lote])

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.codigo.toUpperCase().includes(q) ||
        r.rua.toUpperCase().includes(q) ||
        String(r.camara ?? '').includes(q),
    )
  }, [rows, busca])

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const slice = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE
    return filtrados.slice(start, start + PAGE_SIZE)
  }, [filtrados, pageSafe])

  const rangeFrom = filtrados.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1
  const rangeTo = filtrados.length === 0 ? 0 : Math.min(pageSafe * PAGE_SIZE, filtrados.length)

  useEffect(() => {
    setPage(1)
  }, [busca])

  const ruasExclusao = useMemo(() => {
    const c = Number(exclusao.camara)
    if (!Number.isFinite(c)) return []
    return getRuasPorCamara(c)
  }, [exclusao.camara])

  const previewExclusaoNivel = useMemo(() => {
    const camara = Number(exclusao.camara)
    const nivel = Number(exclusao.nivel)
    if (!Number.isFinite(camara) || !exclusao.rua.trim() || !Number.isFinite(nivel)) return 0
    return contarEnderecosPorFiltroEm(rows, { camara, rua: exclusao.rua, nivel })
  }, [exclusao, rows])

  const previewExclusaoRua = useMemo(() => {
    const camara = Number(exclusao.camara)
    if (!Number.isFinite(camara) || !exclusao.rua.trim()) return 0
    return contarEnderecosPorFiltroEm(rows, { camara, rua: exclusao.rua })
  }, [exclusao.camara, exclusao.rua, rows])

  const previewExclusaoCamara = useMemo(() => {
    const camara = Number(exclusao.camara)
    if (!Number.isFinite(camara)) return 0
    return contarEnderecosPorFiltroEm(rows, { camara })
  }, [exclusao.camara, rows])

  async function executarExclusao(tipo: 'nivel' | 'rua' | 'camara' | 'todos') {
    setExclusaoMsg('')
    const camara = Number(exclusao.camara)

    if (tipo === 'todos') {
      const n = rows.length
      if (n === 0) {
        setExclusaoMsg('Não há endereços para excluir.')
        return
      }
      if (!confirm(`Excluir TODOS os ${n} endereços desta lista? Esta ação não pode ser desfeita.`)) return
      if (!confirm('Confirme novamente: apagar todos os endereços desta lista?')) return
      try {
        applyRows(deleteTodosEnderecosEm())
        setPage(1)
        setExclusaoMsg(`${n} endereço(s) excluído(s).`)
      } catch {
        setExclusaoMsg('Erro ao excluir endereços.')
      }
      return
    }

    if (!Number.isFinite(camara)) {
      setExclusaoMsg('Selecione a câmara.')
      return
    }

    if (tipo === 'camara') {
      const n = previewExclusaoCamara
      if (n === 0) {
        setExclusaoMsg('Nenhum endereço nesta câmara.')
        return
      }
      if (!confirm(`Excluir ${n} endereço(s) da câmara ${camara}?`)) return
      try {
        const next = deleteEnderecosPorFiltroEm(rows, { camara })
        applyRows(next)
        setPage(1)
        setExclusaoMsg(`${n} endereço(s) da câmara ${camara} excluído(s).`)
      } catch {
        setExclusaoMsg('Erro ao excluir endereços.')
      }
      return
    }

    if (!exclusao.rua.trim()) {
      setExclusaoMsg('Selecione a rua.')
      return
    }

    if (tipo === 'rua') {
      const n = previewExclusaoRua
      if (n === 0) {
        setExclusaoMsg('Nenhum endereço nesta rua.')
        return
      }
      if (!confirm(`Excluir ${n} endereço(s) da câmara ${camara}, rua ${exclusao.rua}?`)) return
      try {
        const next = deleteEnderecosPorFiltroEm(rows, { camara, rua: exclusao.rua })
        applyRows(next)
        setPage(1)
        setExclusaoMsg(`${n} endereço(s) da rua ${exclusao.rua} (câm. ${camara}) excluído(s).`)
      } catch {
        setExclusaoMsg('Erro ao excluir endereços.')
      }
      return
    }

    const nivel = Number(exclusao.nivel)
    if (!Number.isFinite(nivel)) {
      setExclusaoMsg('Informe o nível a excluir.')
      return
    }
    const n = previewExclusaoNivel
    if (n === 0) {
      setExclusaoMsg('Nenhum endereço neste nível.')
      return
    }
    if (
      !confirm(
        `Excluir ${n} endereço(s) — câmara ${camara}, rua ${exclusao.rua}, nível ${nivel}?`,
      )
    ) {
      return
    }
    try {
      const next = deleteEnderecosPorFiltroEm(rows, { camara, rua: exclusao.rua, nivel })
      applyRows(next)
      setPage(1)
      setExclusaoMsg(
        `${n} endereço(s) do nível ${nivel} (câm. ${camara}, rua ${exclusao.rua}) excluído(s).`,
      )
    } catch {
      setExclusaoMsg('Erro ao excluir endereços.')
    }
  }

  function editar(r: EnderecoCadastro) {
    setForm({
      id: r.id,
      codigo: r.codigo,
      camara: r.camara != null ? String(r.camara) : '',
      rua: r.rua,
      posicao: r.posicao != null ? String(r.posicao) : '',
      nivel: r.nivel != null ? String(r.nivel) : '',
      observacao: r.observacao,
    })
  }

  function limpar() {
    setForm(emptyForm())
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.codigo.trim()) return
    const baseRows = prepararBaseRowsParaCadastro()
    if (baseRows === null) return
    const { all } = saveEnderecoEm(baseRows, {
      id: form.id || undefined,
      codigo: form.codigo,
      camara: form.camara ? Number(form.camara) : null,
      rua: form.rua,
      posicao: form.posicao ? Number(form.posicao) : null,
      nivel: form.nivel ? Number(form.nivel) : null,
      observacao: form.observacao,
      ativo: true,
    })
    applyRows(all)
    limpar()
  }

  function handleLoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoteMsg('')
    const camara = Number(lote.camara)
    const nivelDe = Number(lote.nivelDe)
    const nivelAte = Number(lote.nivelAte)
    const posicaoDe = Number(lote.posicaoDe)
    const posicaoAte = Number(lote.posicaoAte)
    if (!Number.isFinite(camara) || camara <= 0) {
      setLoteMsg('Informe a câmara.')
      return
    }
    if (!lote.rua.trim()) {
      setLoteMsg('Selecione a rua.')
      return
    }
    if (![nivelDe, nivelAte, posicaoDe, posicaoAte].every(Number.isFinite)) {
      setLoteMsg('Níveis e posições devem ser números válidos.')
      return
    }
    if (nivelDe < 1 || nivelAte < nivelDe) {
      setLoteMsg('Faixa de níveis inválida.')
      return
    }
    if (posicaoDe < 1 || posicaoAte < posicaoDe) {
      setLoteMsg('Faixa de posições (colunas) inválida.')
      return
    }

    const baseRows = prepararBaseRowsParaCadastro()
    if (baseRows === null) return

    const { all, resultado: res } = saveEnderecosEmLoteEm(baseRows, {
      camara,
      rua: lote.rua,
      nivelDe,
      nivelAte,
      posicaoDe,
      posicaoAte,
      observacao: lote.observacao,
      substituirExistentes: lote.substituirExistentes,
    })
    applyRows(all)
    const partes = [`${res.criados} criado(s)`]
    if (res.atualizados) partes.push(`${res.atualizados} atualizado(s)`)
    if (res.ignorados) partes.push(`${res.ignorados} já existente(s) — ignorado(s)`)
    setLoteMsg(`Lote concluído: ${partes.join(', ')} (total ${res.total} endereços no intervalo).`)
  }

  const exemploCodigo =
    previewLote.length > 0
      ? previewLote[0].codigo
      : buildCodigoEndereco(11, 'A', 1, 1)

  return (
    <div className="page-panel">
      <PagePanelHeading
        title="Cadastro de endereçamento"
        info={
          <>
            <PageInfoBlock>
              Endereços usados na contagem do inventário (câmara, rua, posição, nível). O código é o que o conferente bipa
              na tela de captura — formato padrão: <strong>{exemploCodigo}</strong> (câmara-rua-posição-nível).
            </PageInfoBlock>
            <PageInfoBlock title="Listas de endereçamento salvas">
              Listas gravadas no sistema. Use <strong>Abrir</strong> para editar endereços, <strong>Editar</strong> para
              trocar o nome, <strong>Fechar</strong> para sair da edição; ao <strong>Salvar lista</strong>, os endereços
              são gravados e a área de cadastro é limpa.
            </PageInfoBlock>
          </>
        }
      />

      <section className="endereco-listas-salvas" style={{ marginBottom: '1.5rem' }}>
        <PageSectionHeading title="Listas de endereçamento salvas" />
        <div className="page-table-wrap">
          <table className="page-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Endereços</th>
                <th>Atualizado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listaLoading ? (
                <tr>
                  <td colSpan={4}>Carregando listas…</td>
                </tr>
              ) : listas.length === 0 ? (
                <tr>
                  <td colSpan={4}>Nenhuma lista salva ainda. Cadastre endereços abaixo e clique em Salvar lista.</td>
                </tr>
              ) : (
                listas.map((l) => {
                  const n = contarEnderecosAtivos(l)
                  const emEdicao = editingListaId === l.id
                  return (
                    <tr key={l.id} className={emEdicao ? 'endereco-listas-salvas__row--ativa' : undefined}>
                      <td>
                        {l.nome}
                        {emEdicao ? <span className="endereco-listas-salvas__badge">em edição</span> : null}
                      </td>
                      <td>{n}</td>
                      <td>{formatListaAtualizado(l.updatedAt)}</td>
                      <td className="endereco-listas-salvas__actions">
                        {emEdicao ? (
                          <button
                            type="button"
                            className="page-btn-ghost"
                            disabled={salvando}
                            onClick={fecharListaAberta}
                          >
                            Fechar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="page-btn-ghost"
                            disabled={salvando}
                            onClick={() => abrirListaSalva(l)}
                          >
                            Abrir
                          </button>
                        )}
                        <button
                          type="button"
                          className="page-btn-ghost"
                          disabled={salvando}
                          onClick={() => void renomearListaSalva(l)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="page-btn-ghost page-btn-danger"
                          disabled={salvando}
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
        {listaMsg ? <p className="page-msg" style={{ marginTop: '0.75rem' }}>{listaMsg}</p> : null}
      </section>

      <section className="endereco-area-trabalho">
        <div className="endereco-area-trabalho__header">
          <h2 className="page-panel__section-title">
            {editingListaId ? `Editando: ${editingListaNome}` : 'Área de cadastro'}
          </h2>
          <div className="endereco-area-trabalho__actions">
            {editingListaId ? (
              <button type="button" disabled={salvando} onClick={fecharListaAberta}>
                Fechar lista
              </button>
            ) : null}
            <button type="button" disabled={listaLoading || salvando} onClick={iniciarNovaLista}>
              Nova lista
            </button>
            <button
              type="button"
              disabled={rows.length === 0 || salvando}
              onClick={() => void salvarListaAtual()}
            >
              {salvando ? 'Salvando…' : 'Salvar lista'}
            </button>
          </div>
        </div>
        <p className="page-panel__meta" style={{ marginBottom: '1rem' }}>
          {rows.length === 0
            ? 'Cadastre endereços abaixo (individual ou em lote). Nada é gravado até clicar em Salvar lista.'
            : `${rows.length} endereço(s) no rascunho — salve para gravar na lista e limpar esta área.`}
        </p>

        {listaDestinoFixaCadastro ? (
          <p className="endereco-lista-destino" role="status">
            Lista de destino:{' '}
            <strong>{listaDestinoFixaCadastro.nome || '—'}</strong>
            {listaDestinoFixaCadastro.modo === 'edicao'
              ? ' — o endereço entra na lista aberta.'
              : ' — salve a lista depois para gravar no sistema.'}
          </p>
        ) : listas.length > 0 ? (
          <div className="endereco-lista-destino-select">
            <label htmlFor="endereco-cadastro-lista-destino">Lista de destino *</label>
            <select
              id="endereco-cadastro-lista-destino"
              value={cadastroListaId}
              onChange={(e) => setCadastroListaId(e.target.value)}
              disabled={listaLoading || salvando}
            >
              <option value="">{listaLoading ? 'Carregando listas…' : 'Selecione a lista…'}</option>
              {listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome} ({contarEnderecosAtivos(l)} endereços)
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="endereco-lista-destino" role="status">
            Nenhuma lista salva ainda. Os endereços ficam no rascunho até você clicar em Salvar lista.
          </p>
        )}

      <section className="endereco-lote-panel">
        <button
          type="button"
          className="endereco-lote-panel__toggle"
          onClick={() => setLoteAberto((v) => !v)}
        >
          {loteAberto ? '▼' : '▶'} Cadastrar vários de uma vez
        </button>

        {loteAberto ? (
          <form className="page-form-grid endereco-lote-form" onSubmit={handleLoteSubmit}>
            <label>
              Câmara *
              <select
                value={lote.camara}
                onChange={(e) => {
                  const cam = e.target.value
                  const ruas = getRuasPorCamara(Number(cam))
                  setLote((f) => ({
                    ...f,
                    camara: cam,
                    rua: ruas.includes(f.rua) ? f.rua : (ruas[0] ?? ''),
                  }))
                }}
              >
                {INVENTARIO_CAMARAS.map((c) => (
                  <option key={c} value={String(c)}>
                    Câmara {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rua *
              <select value={lote.rua} onChange={(e) => setLote((f) => ({ ...f, rua: e.target.value }))}>
                {ruasLote.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  ruasLote.map((r) => (
                    <option key={r} value={r}>
                      Rua {r}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              Nível de
              <input
                value={lote.nivelDe}
                onChange={(e) => setLote((f) => ({ ...f, nivelDe: e.target.value }))}
                inputMode="numeric"
                min={1}
              />
            </label>
            <label>
              Nível até
              <input
                value={lote.nivelAte}
                onChange={(e) => setLote((f) => ({ ...f, nivelAte: e.target.value }))}
                inputMode="numeric"
                min={1}
              />
            </label>
            <label>
              Coluna (pos.) de
              <input
                value={lote.posicaoDe}
                onChange={(e) => setLote((f) => ({ ...f, posicaoDe: e.target.value }))}
                inputMode="numeric"
                min={1}
              />
            </label>
            <label>
              Coluna (pos.) até
              <input
                value={lote.posicaoAte}
                onChange={(e) => setLote((f) => ({ ...f, posicaoAte: e.target.value }))}
                inputMode="numeric"
                min={1}
              />
            </label>
            <label className="page-form-grid__full">
              Observação (opcional, igual em todos)
              <input
                value={lote.observacao}
                onChange={(e) => setLote((f) => ({ ...f, observacao: e.target.value }))}
              />
            </label>
            <label className="page-form-grid__full endereco-lote-check">
              <input
                type="checkbox"
                checked={lote.substituirExistentes}
                onChange={(e) => setLote((f) => ({ ...f, substituirExistentes: e.target.checked }))}
              />
              Atualizar endereços que já existirem com o mesmo código
            </label>
            <div className="page-form-grid__full endereco-lote-preview">
              <strong>{previewLote.length}</strong> endereço(s) serão gerados
              {previewLote.length > 0 ? (
                <span className="endereco-lote-preview__ex">
                  {' '}
                  — ex.: {previewLote[0].codigo}
                  {previewLote.length > 1 ? ` … ${previewLote[previewLote.length - 1].codigo}` : ''}
                </span>
              ) : null}
            </div>
            <div className="page-form-grid__actions">
              <button type="submit">Gerar {previewLote.length || ''} endereços</button>
            </div>
            {loteMsg ? <p className="page-form-grid__full endereco-lote-msg">{loteMsg}</p> : null}
          </form>
        ) : null}
      </section>

      <section className="endereco-lote-panel endereco-exclusao-panel">
        <button
          type="button"
          className="endereco-lote-panel__toggle endereco-exclusao-panel__toggle"
          onClick={() => setExclusaoAberta((v) => !v)}
        >
          {exclusaoAberta ? '▼' : '▶'} Excluir endereços em lote
        </button>

        {exclusaoAberta ? (
          <div className="endereco-exclusao-form">
            <p className="endereco-exclusao-form__hint">
              Escolha o alcance da exclusão. Endereço individual continua disponível na tabela abaixo.
            </p>
            <div className="page-form-grid">
              <label>
                Câmara
                <select
                  value={exclusao.camara}
                  onChange={(e) => {
                    const cam = e.target.value
                    const ruas = getRuasPorCamara(Number(cam))
                    setExclusao((f) => ({
                      ...f,
                      camara: cam,
                      rua: ruas.includes(f.rua) ? f.rua : (ruas[0] ?? ''),
                    }))
                  }}
                >
                  {INVENTARIO_CAMARAS.map((c) => (
                    <option key={c} value={String(c)}>
                      Câmara {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rua
                <select
                  value={exclusao.rua}
                  onChange={(e) => setExclusao((f) => ({ ...f, rua: e.target.value }))}
                >
                  {ruasExclusao.length === 0 ? (
                    <option value="">—</option>
                  ) : (
                    ruasExclusao.map((r) => (
                      <option key={r} value={r}>
                        Rua {r}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>
                Nível (só para excluir um nível)
                <input
                  value={exclusao.nivel}
                  onChange={(e) => setExclusao((f) => ({ ...f, nivel: e.target.value }))}
                  inputMode="numeric"
                  placeholder="Ex.: 3"
                />
              </label>
            </div>

            <div className="endereco-exclusao-form__actions">
              <button
                type="button"
                className="page-btn-ghost page-btn-danger"
                disabled={previewExclusaoNivel === 0}
                onClick={() => executarExclusao('nivel')}
              >
                Excluir nível ({previewExclusaoNivel})
              </button>
              <button
                type="button"
                className="page-btn-ghost page-btn-danger"
                disabled={previewExclusaoRua === 0}
                onClick={() => executarExclusao('rua')}
              >
                Excluir rua inteira ({previewExclusaoRua})
              </button>
              <button
                type="button"
                className="page-btn-ghost page-btn-danger"
                disabled={previewExclusaoCamara === 0}
                onClick={() => executarExclusao('camara')}
              >
                Excluir câmara inteira ({previewExclusaoCamara})
              </button>
              <button
                type="button"
                className="page-btn-ghost page-btn-danger endereco-exclusao-form__btn-todos"
                disabled={rows.length === 0}
                onClick={() => executarExclusao('todos')}
              >
                Excluir tudo ({rows.length})
              </button>
            </div>
            {exclusaoMsg ? <p className="endereco-exclusao-form__msg">{exclusaoMsg}</p> : null}
          </div>
        ) : null}
      </section>

      <h2 className="page-panel__section-title">Cadastro individual</h2>

      <form className="page-form-grid" onSubmit={handleSubmit}>
        <label>
          Código do endereço *
          <input
            value={form.codigo}
            onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
            placeholder="Ex.: 11-A-05-02"
            required
          />
        </label>
        <label>
          Câmara
          <input
            value={form.camara}
            onChange={(e) => setForm((f) => ({ ...f, camara: e.target.value }))}
            inputMode="numeric"
          />
        </label>
        <label>
          Rua
          <input value={form.rua} onChange={(e) => setForm((f) => ({ ...f, rua: e.target.value.toUpperCase() }))} />
        </label>
        <label>
          Posição
          <input
            value={form.posicao}
            onChange={(e) => setForm((f) => ({ ...f, posicao: e.target.value }))}
            inputMode="numeric"
          />
        </label>
        <label>
          Nível
          <input
            value={form.nivel}
            onChange={(e) => setForm((f) => ({ ...f, nivel: e.target.value }))}
            inputMode="numeric"
          />
        </label>
        <label className="page-form-grid__full">
          Observação
          <input
            value={form.observacao}
            onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
          />
        </label>
        <div className="page-form-grid__actions">
          <button type="submit">{form.id ? 'Atualizar endereço' : 'Cadastrar endereço'}</button>
          {form.id ? (
            <button type="button" className="page-btn-ghost" onClick={limpar}>
              Cancelar edição
            </button>
          ) : null}
        </div>
      </form>

      <section style={{ marginTop: 24 }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar endereços…"
          style={{ marginBottom: 12, maxWidth: 320 }}
        />

        {filtrados.length > 0 ? (
          <p className="page-panel__meta">
            Mostrando {rangeFrom}–{rangeTo} de {filtrados.length} endereço(s)
            {busca.trim() ? ' (filtrado)' : ''} · Página {pageSafe} de {totalPages}
          </p>
        ) : (
          <p className="page-panel__meta">Nenhum endereço{busca.trim() ? ' com este filtro' : ''}.</p>
        )}

        <div className="page-table-wrap">
          <table className="page-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Câmara</th>
                <th>Rua</th>
                <th>Pos.</th>
                <th>Nív.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nenhum endereço nesta página.</td>
                </tr>
              ) : (
                slice.map((r) => (
                  <tr key={r.id}>
                    <td>{r.codigo}</td>
                    <td>{r.camara ?? '—'}</td>
                    <td>{r.rua || '—'}</td>
                    <td>{r.posicao ?? '—'}</td>
                    <td>{r.nivel ?? '—'}</td>
                    <td>
                      <button type="button" className="page-btn-ghost" onClick={() => editar(r)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="page-btn-ghost page-btn-danger"
                        onClick={() => {
                          if (confirm(`Excluir o endereço ${r.codigo}?`)) {
                            const next = deleteEnderecoEm(rows, r.id)
                            applyRows(next)
                            if (form.id === r.id) limpar()
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtrados.length > PAGE_SIZE ? (
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
    </div>
  )
}
