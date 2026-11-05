import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isAppOnline, subscribeAppConnectivity } from '../lib/appConnectivity'
import { resolveConferenteDoUsuarioLogado, usernameFromSession } from '../lib/authUser'
import {
  atualizarContagemDiariaMeta,
  criarContagemDiaria,
  deleteContagemDiaria,
  fecharContagemDiaria,
  formatDataContagemBR,
  listContagensDiarias,
  reabrirContagemDiaria,
  resetContagemDiariaSupabaseProbe,
  contagemDiariaUsaArmazenamentoLocal,
  type ContagemDiariaSessao,
} from '../lib/contagemDiariaSessaoStore'
import { formatUnknownError } from '../lib/supabaseError'
import { listConferentes } from '../lib/conferentesStore'
import CadastroConferenteModal from '../components/conferente/CadastroConferenteModal'
import { PagePanelHeading } from '../components/ui/PagePanelHeading'
import {
  countPendingContagemDiariaSync,
  flushPendingContagemDiariaSync,
} from '../lib/contagemDiariaOfflineSync'
import { offlineCatalogStats } from '../lib/offlineCatalogCache'
import { prefetchContagemOfflineCatalog } from '../lib/prefetchContagemOfflineCatalog'
import { fetchContagemDiariaCapturaPresencaBatch } from '../lib/contagemDiariaCapturaPresenca'
import { useGerenciarCapturaPresenca } from '../lib/useGerenciarCapturaPresenca'
import GerenciarColunaContando from '../components/gerenciar/GerenciarColunaContando'

type Props = {
  onAbrirContagem: (contagemId: string) => void
  session?: Session | null
}

type ListaTab = 'todos' | 'abertos' | 'finalizados'

const SUGESTOES_NOME_CONTAGEM = [
  'Contagem Turno da Manhã',
  'Contagem Turno da Tarde',
  'Contagem Turno da Noite',
] as const

function formatData(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

function labelColeta(c: ContagemDiariaSessao) {
  if (c.status === 'aberto') return 'Continuar contagem'
  return 'Começar contagem'
}

function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function isoDatePart(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function contagemMatchBusca(c: ContagemDiariaSessao, q: string): boolean {
  const u = q.trim().toUpperCase()
  if (!u) return true
  const campos = [
    c.titulo,
    c.local,
    String(c.numero),
    c.conferenteNome ?? '',
    c.dataContagem,
    formatDataContagemBR(c.dataContagem),
  ]
  return campos.some((campo) => campo.toUpperCase().includes(u))
}

export default function ContagemGerenciar({ onAbrirContagem, session }: Props) {
  const conferenteLogado = usernameFromSession(session)
  const [rows, setRows] = useState<ContagemDiariaSessao[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [listaTab, setListaTab] = useState<ListaTab>('todos')
  const [criarOpen, setCriarOpen] = useState(false)
  const [criarTitulo, setCriarTitulo] = useState('')
  const [criarLocal, setCriarLocal] = useState('ULTRAPAO GUARULHOS DISTRI')
  const [criarData, setCriarData] = useState(() => todayYmdLocal())
  const [conferentes, setConferentes] = useState<Array<{ id: string; nome: string }>>([])
  const [conferentesLoading, setConferentesLoading] = useState(false)
  const [editarId, setEditarId] = useState<string | null>(null)
  const [editarTitulo, setEditarTitulo] = useState('')
  const [editarLocal, setEditarLocal] = useState('')
  const [editarData, setEditarData] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroDataDe, setFiltroDataDe] = useState('')
  const [filtroDataAte, setFiltroDataAte] = useState('')
  const [modoLocal, setModoLocal] = useState(false)
  const [cadastroConferenteOpen, setCadastroConferenteOpen] = useState(false)
  const [online, setOnline] = useState(() => isAppOnline())
  const [catalogoOffline, setCatalogoOffline] = useState(() => offlineCatalogStats())
  const [pendingSync, setPendingSync] = useState(() => countPendingContagemDiariaSync())
  const [prefetching, setPrefetching] = useState(false)
  const [prefetchMsg, setPrefetchMsg] = useState('')

  const conferenteLogadoResolvido = useMemo(
    () => resolveConferenteDoUsuarioLogado(session, conferentes),
    [session, conferentes],
  )

  const abertos = useMemo(() => rows.filter((r) => r.status === 'aberto'), [rows])
  const finalizados = useMemo(() => rows.filter((r) => r.status === 'fechado'), [rows])
  const abertosIds = useMemo(() => abertos.map((r) => r.id), [abertos])
  const presencaMap = useGerenciarCapturaPresenca(abertosIds, fetchContagemDiariaCapturaPresencaBatch, online)

  const locaisDisponiveis = useMemo(() => {
    const set = new Set(rows.map((r) => r.local.trim()).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [rows])

  const listaPorTab = useMemo(() => {
    if (listaTab === 'abertos') return abertos
    if (listaTab === 'finalizados') return finalizados
    return rows
  }, [rows, listaTab, abertos, finalizados])

  const filtrosAtivos = Boolean(busca.trim() || filtroLocal || filtroDataDe || filtroDataAte)

  const listaFiltrada = useMemo(() => {
    let list = listaPorTab
    if (filtroLocal) list = list.filter((r) => r.local === filtroLocal)
    if (filtroDataDe) list = list.filter((r) => isoDatePart(r.dataInicio) >= filtroDataDe)
    if (filtroDataAte) list = list.filter((r) => isoDatePart(r.dataInicio) <= filtroDataAte)
    if (busca.trim()) list = list.filter((r) => contagemMatchBusca(r, busca))
    return list
  }, [listaPorTab, busca, filtroLocal, filtroDataDe, filtroDataAte])

  function limparFiltros() {
    setBusca('')
    setFiltroLocal('')
    setFiltroDataDe('')
    setFiltroDataAte('')
  }

  async function refresh() {
    setLoading(true)
    setLoadError('')
    resetContagemDiariaSupabaseProbe()
    try {
      setRows(await listContagensDiarias())
      setModoLocal(await contagemDiariaUsaArmazenamentoLocal())
    } catch (e: unknown) {
      setLoadError(formatUnknownError(e) || 'Erro ao carregar contagens.')
      setRows([])
      setModoLocal(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    return subscribeAppConnectivity((next) => {
      setOnline(next)
      if (next) {
        void flushPendingContagemDiariaSync().then(() => {
          setPendingSync(countPendingContagemDiariaSync())
          void refresh()
        })
      }
    })
  }, [])

  async function prepararModoOffline() {
    if (!isAppOnline()) {
      alert('Conecte-se à internet para baixar o catálogo de produtos antes de entrar na câmara fria.')
      return
    }
    setPrefetching(true)
    setPrefetchMsg('')
    try {
      const r = await prefetchContagemOfflineCatalog()
      setCatalogoOffline(offlineCatalogStats())
      setPrefetchMsg(
        `${r.produtos} produto(s), ${r.conferentes} conferente(s), ${r.listasEndereco} lista(s) de endereço e ${r.listasProduto} lista(s) de produto prontos para uso offline.`,
      )
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao preparar modo offline.')
    } finally {
      setPrefetching(false)
    }
  }

  useEffect(() => {
    let alive = true
    setConferentesLoading(true)
    void (async () => {
      try {
        const data = await listConferentes()
        if (alive) setConferentes(data)
      } catch {
        if (alive) setConferentes([])
      } finally {
        if (alive) setConferentesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function recarregarConferentes() {
    setConferentesLoading(true)
    try {
      setConferentes(await listConferentes())
    } catch {
      setConferentes([])
    } finally {
      setConferentesLoading(false)
    }
  }

  function abrirModalCriar() {
    setCriarTitulo('')
    setCriarLocal('ULTRAPAO GUARULHOS DISTRI')
    setCriarData(todayYmdLocal())
    setCriarOpen(true)
  }

  async function handleCriar() {
    const titulo = criarTitulo.trim()
    if (!titulo) {
      alert('Informe o nome da contagem.')
      return
    }
    const conferenteNome =
      conferenteLogadoResolvido?.nome?.trim() || conferenteLogado.trim()
    if (!conferenteNome || conferenteNome === 'usuário') {
      alert('Não foi possível identificar o usuário logado como conferente.')
      return
    }
    try {
      await criarContagemDiaria({
        titulo,
        local: criarLocal,
        dataContagem: criarData,
        conferenteNome,
      })
      setCriarOpen(false)
      setListaTab('abertos')
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao criar contagem.')
    }
  }

  function abrirModalEditar(c: ContagemDiariaSessao) {
    setEditarId(c.id)
    setEditarTitulo(c.titulo)
    setEditarLocal(c.local)
    setEditarData(c.dataContagem)
  }

  async function salvarEdicaoMeta() {
    if (!editarId) return
    const titulo = editarTitulo.trim()
    if (!titulo) {
      alert('Informe o nome da contagem.')
      return
    }
    try {
      await atualizarContagemDiariaMeta(editarId, { titulo, local: editarLocal, dataContagem: editarData })
      setEditarId(null)
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao salvar contagem.')
    }
  }

  async function continuarContagem(id: string) {
    onAbrirContagem(id)
  }

  async function entrarEAlterarContagem(c: ContagemDiariaSessao) {
    if (
      !confirm(
        `A contagem «${c.titulo}» está finalizada.\n\nDeseja reabrir para entrar e alterar?`,
      )
    ) {
      return
    }
    try {
      await reabrirContagemDiaria(c.id)
      await refresh()
      onAbrirContagem(c.id)
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao reabrir contagem.')
    }
  }

  async function handleExcluir(c: ContagemDiariaSessao) {
    const msg = c.iniciada
      ? `Excluir a contagem "${c.titulo}"? Ela já foi iniciada e deixará de aparecer na lista.`
      : `Excluir a contagem "${c.titulo}"?`
    if (!confirm(msg)) return
    try {
      await deleteContagemDiaria(c.id)
      if (editarId === c.id) setEditarId(null)
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao excluir contagem.')
    }
  }

  function renderAcoes(c: ContagemDiariaSessao, layout: 'table' | 'card') {
    const btnClass = layout === 'card' ? 'inv-card__btn' : undefined
    const ghostClass = layout === 'card' ? 'inv-card__btn inv-card__btn--ghost' : 'page-btn-ghost'
    const dangerClass =
      layout === 'card'
        ? 'inv-card__btn inv-card__btn--ghost inv-card__btn--danger'
        : 'page-btn-ghost page-btn-danger'

    if (c.status === 'aberto') {
      return (
        <>
          <button type="button" className={btnClass} onClick={() => void continuarContagem(c.id)}>
            {labelColeta(c)}
          </button>
          <button type="button" className={ghostClass} onClick={() => abrirModalEditar(c)}>
            Editar
          </button>
          <button
            type="button"
            className={ghostClass}
            onClick={() => {
              if (confirm('Finalizar esta contagem?')) {
                void fecharContagemDiaria(c.id).then(() => {
                  if (!isAppOnline()) {
                    setPendingSync(countPendingContagemDiariaSync())
                    alert(
                      'Contagem finalizada no aparelho. Ao voltar a ter internet, os dados serão enviados ao banco automaticamente.',
                    )
                  }
                  void refresh()
                })
              }
            }}
          >
            Finalizar
          </button>
          <button type="button" className={dangerClass} onClick={() => handleExcluir(c)}>
            Excluir
          </button>
        </>
      )
    }

    return (
      <>
        <span className="inv-status inv-status--closed inv-actions-finalizado" title="Contagem finalizada">
          Finalizado
        </span>
        <button type="button" className={ghostClass} onClick={() => abrirModalEditar(c)}>
          Editar
        </button>
        <button type="button" className={btnClass} onClick={() => void entrarEAlterarContagem(c)}>
          Entrar e alterar
        </button>
        <button type="button" className={ghostClass} onClick={() => onAbrirContagem(c.id)}>
          Ver
        </button>
        <button type="button" className={dangerClass} onClick={() => handleExcluir(c)}>
          Excluir
        </button>
      </>
    )
  }

  return (
    <div className="page-panel inv-gerenciar">
      <PagePanelHeading
        title="Contagem diária"
        info={
          <>
            Crie uma contagem com nome — ela aparecerá na lista. Depois clique em <strong>Começar contagem</strong> na
            linha para abrir a captura. Na <strong>câmara fria sem internet</strong>, use{' '}
            <strong>Preparar modo offline</strong> antes de entrar; as linhas ficam salvas no aparelho e sincronizam ao
            voltar a ter rede.
          </>
        }
      />

      <div className="inv-gerenciar-offline-bar">
        <span className={`inv-cap__badge ${online ? 'inv-cap__badge--online' : 'inv-cap__badge--offline'}`}>
          {online ? 'Online' : 'Offline'}
        </span>
        <span className="inv-gerenciar-offline-meta">
          Catálogo offline: {catalogoOffline.produtos} produto(s)
          {catalogoOffline.listasEndereco > 0 ? ` · ${catalogoOffline.listasEndereco} lista(s) de endereço` : ''}
          {pendingSync > 0 ? ` · ${pendingSync} contagem(ns) aguardando envio` : ''}
        </span>
        <button
          type="button"
          className="page-btn-ghost"
          disabled={prefetching || !online}
          onClick={() => void prepararModoOffline()}
        >
          {prefetching ? 'Baixando…' : 'Preparar modo offline'}
        </button>
      </div>
      {prefetchMsg ? <p className="page-msg page-msg--ok">{prefetchMsg}</p> : null}

      {loadError ? <p className="page-msg page-msg--error">{loadError}</p> : null}
      {modoLocal ? (
        <p className="page-msg page-msg--warn">
          Tabela <strong>contagem_diaria_sessoes</strong> ainda não existe no Supabase — as contagens ficam salvas só
          neste navegador. Execute <strong>supabase/sql/setup_inventario_listas_completo.sql</strong> no SQL Editor e
          clique em Atualizar lista.
        </p>
      ) : null}
      {loading ? <p className="page-panel__meta">Carregando contagens…</p> : null}

      <div className="gerenciar-toolbar">
          <button type="button" onClick={abrirModalCriar} disabled={loading}>
            Criar contagem
          </button>
          <button type="button" className="page-btn-ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? 'Carregando…' : 'Atualizar lista'}
          </button>
          <button
            type="button"
            className="page-btn-ghost"
            disabled={loading}
            onClick={() => setCadastroConferenteOpen(true)}
          >
            Cadastrar conferente
          </button>
      </div>

      <div className="page-tabs inv-gerenciar__tabs" role="tablist" aria-label="Filtro de contagens">
        <button
          type="button"
          role="tab"
          aria-selected={listaTab === 'todos'}
          className={`page-tabs__btn${listaTab === 'todos' ? ' page-tabs__btn--active' : ''}`}
          onClick={() => setListaTab('todos')}
        >
          Todos ({rows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={listaTab === 'abertos'}
          className={`page-tabs__btn${listaTab === 'abertos' ? ' page-tabs__btn--active' : ''}`}
          onClick={() => setListaTab('abertos')}
        >
          Abertos ({abertos.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={listaTab === 'finalizados'}
          className={`page-tabs__btn${listaTab === 'finalizados' ? ' page-tabs__btn--active' : ''}`}
          onClick={() => setListaTab('finalizados')}
        >
          Finalizados ({finalizados.length})
        </button>
      </div>

      <section className="page-form-grid page-form-grid--filters inv-gerenciar__filters" aria-label="Busca e filtros">
        <label className="page-form-grid__full">
          Buscar contagem
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, local, nº, conferente, dia da contagem…"
          />
        </label>
        <label>
          Local / unidade
          <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)}>
            <option value="">Todos</option>
            {locaisDisponiveis.map((local) => (
              <option key={local} value={local}>
                {local}
              </option>
            ))}
          </select>
        </label>
        <label>
          Início de
          <input type="date" value={filtroDataDe} onChange={(e) => setFiltroDataDe(e.target.value)} />
        </label>
        <label>
          Início até
          <input type="date" value={filtroDataAte} onChange={(e) => setFiltroDataAte(e.target.value)} />
        </label>
        <div className="page-form-grid__actions page-form-grid__actions--wrap">
          <button type="button" className="page-btn-ghost" disabled={!filtrosAtivos} onClick={limparFiltros}>
            Limpar filtros
          </button>
        </div>
      </section>

      <p className="page-panel__meta inv-gerenciar__resultado">
        {listaFiltrada.length === listaPorTab.length
          ? `${listaFiltrada.length} contagem(ns) nesta lista`
          : `Mostrando ${listaFiltrada.length} de ${listaPorTab.length} contagem(ns)`}
      </p>

      {abertos.length > 0 ? (
        <p className="inv-gerenciar__hint">{abertos.length} contagem(ns) aberta(s)</p>
      ) : null}

      <div className="inv-list-cards">
        {listaFiltrada.length === 0 ? (
          <p className="inv-list-empty">
            {filtrosAtivos ? 'Nenhuma contagem encontrada com estes filtros.' : 'Nenhuma contagem nesta lista.'}
          </p>
        ) : (
          listaFiltrada.map((c) => (
            <article key={c.id} className="inv-card">
              <div className="inv-card__head">
                <span className="inv-card__num">#{c.numero}</span>
                <span className={c.status === 'aberto' ? 'inv-status inv-status--open' : 'inv-status inv-status--closed'}>
                  {c.status === 'aberto' ? 'Aberto' : 'Finalizado'}
                </span>
              </div>
              <h3 className="inv-card__title">{c.titulo}</h3>
              <p className="inv-card__meta">
                {c.local} · Dia {formatDataContagemBR(c.dataContagem)}
              </p>
              <dl className="inv-card__stats">
                <div>
                  <dt>Contando</dt>
                  <dd>
                    <GerenciarColunaContando aberto={c.status === 'aberto'} nomes={presencaMap.get(c.id)} />
                  </dd>
                </div>
                <div>
                  <dt>Linhas</dt>
                  <dd>{c.linhas.length}</dd>
                </div>
                <div>
                  <dt>Início</dt>
                  <dd>{formatData(c.dataInicio)}</dd>
                </div>
                {c.dataFim ? (
                  <div>
                    <dt>Fim</dt>
                    <dd>{formatData(c.dataFim)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="inv-card__actions">{renderAcoes(c, 'card')}</div>
            </article>
          ))
        )}
      </div>

      <div className="page-table-wrap inv-list-table">
        <table className="page-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nome</th>
              <th>Local</th>
              <th>Dia</th>
              <th>Status</th>
              <th>Contando</th>
              <th>Linhas</th>
              <th>Início</th>
              <th>Fim</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  {filtrosAtivos ? 'Nenhuma contagem encontrada com estes filtros.' : 'Nenhuma contagem nesta lista.'}
                </td>
              </tr>
            ) : (
              listaFiltrada.map((c) => (
                <tr key={c.id}>
                  <td>{c.numero}</td>
                  <td>{c.titulo}</td>
                  <td>{c.local}</td>
                  <td>{formatDataContagemBR(c.dataContagem)}</td>
                  <td>
                    <span className={c.status === 'aberto' ? 'inv-status inv-status--open' : 'inv-status inv-status--closed'}>
                      {c.status === 'aberto' ? 'Aberto' : 'Finalizado'}
                    </span>
                  </td>
                  <td>
                    <GerenciarColunaContando aberto={c.status === 'aberto'} nomes={presencaMap.get(c.id)} />
                  </td>
                  <td>{c.linhas.length}</td>
                  <td>{formatData(c.dataInicio)}</td>
                  <td>{formatData(c.dataFim)}</td>
                  <td className="inv-actions-cell">{renderAcoes(c, 'table')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {criarOpen ? (
        <div
          className="page-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contagem-criar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCriarOpen(false)
          }}
        >
          <div className="page-modal">
            <div className="page-modal__head">
              <h2 id="contagem-criar-title">Nova contagem diária</h2>
              <button
                type="button"
                className="page-modal__close"
                aria-label="Fechar"
                onClick={() => setCriarOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="page-modal__body page-form-grid">
              <label className="page-form-grid__full">
                Nome da contagem *
                <input
                  list="contagem-nome-sugestoes"
                  value={criarTitulo}
                  onChange={(e) => setCriarTitulo(e.target.value)}
                  placeholder="Selecione na lista ou digite o nome"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCriar()
                  }}
                />
                <datalist id="contagem-nome-sugestoes">
                  {SUGESTOES_NOME_CONTAGEM.map((nome) => (
                    <option key={nome} value={nome} />
                  ))}
                </datalist>
              </label>
              <label className="page-form-grid__full">
                Conferente
                <input
                  readOnly
                  value={
                    conferenteLogadoResolvido?.nome ||
                    conferenteLogado ||
                    (conferentesLoading ? 'Carregando…' : '—')
                  }
                  className="inventario-captura__readonly"
                  title="Sempre o usuário logado — cada pessoa conta com a própria sessão"
                />
              </label>
              <label className="page-form-grid__full">
                Local / unidade
                <input value={criarLocal} onChange={(e) => setCriarLocal(e.target.value)} />
              </label>
              <label className="page-form-grid__full">
                Dia da contagem
                <input type="date" value={criarData} onChange={(e) => setCriarData(e.target.value)} />
              </label>
            </div>
            <div className="page-modal__foot">
              <button type="button" className="page-btn-ghost" onClick={() => setCriarOpen(false)}>
                Cancelar
              </button>
              <button type="button" onClick={handleCriar}>
                Criar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editarId ? (
        <div
          className="page-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contagem-editar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditarId(null)
          }}
        >
          <div className="page-modal">
            <div className="page-modal__head">
              <h2 id="contagem-editar-title">Editar contagem</h2>
              <button
                type="button"
                className="page-modal__close"
                aria-label="Fechar"
                onClick={() => setEditarId(null)}
              >
                ×
              </button>
            </div>
            <div className="page-modal__body page-form-grid">
              <label className="page-form-grid__full">
                Nome da contagem *
                <input
                  value={editarTitulo}
                  onChange={(e) => setEditarTitulo(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') salvarEdicaoMeta()
                  }}
                />
              </label>
              <label className="page-form-grid__full">
                Local / unidade
                <input value={editarLocal} onChange={(e) => setEditarLocal(e.target.value)} />
              </label>
              <label className="page-form-grid__full">
                Dia da contagem
                <input type="date" value={editarData} onChange={(e) => setEditarData(e.target.value)} />
              </label>
            </div>
            <div className="page-modal__foot">
              <button type="button" className="page-btn-ghost" onClick={() => setEditarId(null)}>
                Cancelar
              </button>
              <button type="button" onClick={salvarEdicaoMeta}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CadastroConferenteModal
        open={cadastroConferenteOpen}
        onClose={() => setCadastroConferenteOpen(false)}
        onSaved={() => void recarregarConferentes()}
        loginEsperado={conferenteLogado}
      />
    </div>
  )
}
