import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isAppOnline, subscribeAppConnectivity } from '../lib/appConnectivity'
import InventarioPosicoesModal from '../components/inventario/InventarioPosicoesModal'
import InventarioIniciarModal from '../components/inventario/InventarioIniciarModal'
import { usernameFromSession } from '../lib/authUser'
import {
  atualizarInventarioMeta,
  configurarInventarioListas,
  criarInventario,
  deleteInventario,
  fecharInventario,
  inventarioAbertoComMesmoTitulo,
  inventarioListasConfiguradas,
  listInventarios,
  mensagemTituloInventarioEmUso,
  reabrirInventario,
  resetInventarioSupabaseProbe,
  recuperarLinhasInventarioDoAparelho,
  inventarioUsaArmazenamentoLocal,
  type InventarioSessao,
} from '../lib/inventarioSessaoStore'
import { formatUnknownError } from '../lib/supabaseError'
import CadastroConferenteModal from '../components/conferente/CadastroConferenteModal'
import { PagePanelHeading } from '../components/ui/PagePanelHeading'
import {
  countPendingInventarioSync,
  flushPendingInventarioSync,
} from '../lib/inventarioOfflineSync'
import { offlineCatalogStats } from '../lib/offlineCatalogCache'
import { prefetchContagemOfflineCatalog } from '../lib/prefetchContagemOfflineCatalog'
import { fetchInventarioCapturaPresencaBatch } from '../lib/inventarioCapturaPresenca'
import { useGerenciarCapturaPresenca } from '../lib/useGerenciarCapturaPresenca'
import GerenciarColunaContando from '../components/gerenciar/GerenciarColunaContando'

type Props = {
  onAbrirCaptura: (inventarioId: string) => void
  session?: Session | null
}

type ListaTab = 'todos' | 'abertos' | 'finalizados'

function formatData(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

function labelColeta(inv: InventarioSessao) {
  if (inv.status === 'aberto') return 'Continuar'
  return 'Começar inventário'
}

function labelPosicoes(inv: InventarioSessao) {
  const n = inv.posicoesCodigos?.length ?? 0
  if (n === 0) return 'Todas (livre)'
  const nome = inv.posicoesNome?.trim()
  return nome ? `${nome} (${n})` : `${n} posição(ões)`
}

function isoDatePart(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function inventarioMatchBusca(inv: InventarioSessao, q: string): boolean {
  const u = q.trim().toUpperCase()
  if (!u) return true
  const campos = [
    inv.titulo,
    inv.local,
    String(inv.numero),
    inv.listaEnderecamentoNome ?? '',
    inv.listaProdutosNome ?? '',
    inv.posicoesNome ?? '',
  ]
  return campos.some((c) => c.toUpperCase().includes(u))
}

export default function InventarioGerenciar({ onAbrirCaptura, session }: Props) {
  const conferenteLogado = usernameFromSession(session)
  const [rows, setRows] = useState<InventarioSessao[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [listaTab, setListaTab] = useState<ListaTab>('todos')
  const [criarOpen, setCriarOpen] = useState(false)
  const [criarTitulo, setCriarTitulo] = useState('')
  const [criarLocal, setCriarLocal] = useState('ULTRAPAO GUARULHOS DISTRI')
  const [editarId, setEditarId] = useState<string | null>(null)
  const [editarTitulo, setEditarTitulo] = useState('')
  const [editarLocal, setEditarLocal] = useState('')
  const [posicoesInvId, setPosicoesInvId] = useState<string | null>(null)
  const [iniciarInv, setIniciarInv] = useState<InventarioSessao | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroLocal, setFiltroLocal] = useState('')
  const [filtroDataDe, setFiltroDataDe] = useState('')
  const [filtroDataAte, setFiltroDataAte] = useState('')
  const [modoLocal, setModoLocal] = useState(false)
  const [cadastroConferenteOpen, setCadastroConferenteOpen] = useState(false)
  const [online, setOnline] = useState(() => isAppOnline())
  const [catalogoOffline, setCatalogoOffline] = useState(() => offlineCatalogStats())
  const [pendingSync, setPendingSync] = useState(() => countPendingInventarioSync())
  const [prefetching, setPrefetching] = useState(false)
  const [prefetchMsg, setPrefetchMsg] = useState('')

  const inventarioPosicoes = useMemo(
    () => (posicoesInvId ? rows.find((r) => r.id === posicoesInvId) : undefined),
    [posicoesInvId, rows],
  )

  const abertos = useMemo(() => rows.filter((r) => r.status === 'aberto'), [rows])
  const finalizados = useMemo(() => rows.filter((r) => r.status === 'fechado'), [rows])
  const abertosIds = useMemo(() => abertos.map((r) => r.id), [abertos])
  const presencaMap = useGerenciarCapturaPresenca(abertosIds, fetchInventarioCapturaPresencaBatch, online)

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
    if (busca.trim()) list = list.filter((r) => inventarioMatchBusca(r, busca))
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
    resetInventarioSupabaseProbe()
    try {
      let list = await listInventarios()
      for (const inv of list.filter((r) => r.status === 'aberto')) {
        await recuperarLinhasInventarioDoAparelho(inv.id)
      }
      list = await listInventarios()
      setRows(list)
      setModoLocal(await inventarioUsaArmazenamentoLocal())
    } catch (e: unknown) {
      setLoadError(formatUnknownError(e) || 'Erro ao carregar inventários.')
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
        void flushPendingInventarioSync().then(() => {
          setPendingSync(countPendingInventarioSync())
          void refresh()
        })
      }
    })
  }, [])

  async function prepararModoOffline() {
    if (!isAppOnline()) {
      alert('Conecte-se à internet para baixar o catálogo antes de entrar na câmara fria.')
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

  function abrirModalCriar() {
    setCriarTitulo('')
    setCriarLocal('ULTRAPAO GUARULHOS DISTRI')
    setCriarOpen(true)
  }

  async function handleCriar() {
    const titulo = criarTitulo.trim()
    if (!titulo) {
      alert('Informe o nome do inventário.')
      return
    }
    const dup = inventarioAbertoComMesmoTitulo(rows, titulo)
    if (dup) {
      alert(mensagemTituloInventarioEmUso(titulo, dup))
      return
    }
    try {
      const created = await criarInventario({ titulo, local: criarLocal })
      if (!created) {
        alert(mensagemTituloInventarioEmUso(titulo))
        return
      }
      setCriarOpen(false)
      setListaTab('abertos')
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao criar inventário.')
    }
  }

  function abrirModalEditar(inv: InventarioSessao) {
    setEditarId(inv.id)
    setEditarTitulo(inv.titulo)
    setEditarLocal(inv.local)
  }

  async function salvarEdicaoMeta() {
    if (!editarId) return
    const titulo = editarTitulo.trim()
    if (!titulo) {
      alert('Informe o nome do inventário.')
      return
    }
    const dup = inventarioAbertoComMesmoTitulo(rows, titulo, editarId)
    if (dup) {
      alert(mensagemTituloInventarioEmUso(titulo, dup))
      return
    }
    try {
      const updated = await atualizarInventarioMeta(editarId, { titulo, local: editarLocal })
      if (!updated) {
        alert(mensagemTituloInventarioEmUso(titulo))
        return
      }
      setEditarId(null)
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao salvar inventário.')
    }
  }

  async function handleExcluir(inv: InventarioSessao) {
    const n = inv.linhas.length
    const msg =
      n > 0
        ? `Excluir o inventário "${inv.titulo}"? As ${n} linha(s) coletadas serão perdidas permanentemente.`
        : `Excluir o inventário "${inv.titulo}"?`
    if (!confirm(msg)) return
    try {
      await deleteInventario(inv.id)
      if (editarId === inv.id) setEditarId(null)
      if (posicoesInvId === inv.id) setPosicoesInvId(null)
      await refresh()
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao excluir inventário.')
    }
  }

  function continuarInventario(inv: InventarioSessao) {
    if (!inventarioListasConfiguradas(inv)) {
      setIniciarInv(inv)
      return
    }
    onAbrirCaptura(inv.id)
  }

  async function entrarEAlterarInventario(inv: InventarioSessao) {
    if (
      !confirm(
        `O inventário «${inv.titulo}» está finalizado.\n\nDeseja reabrir para entrar e alterar?`,
      )
    ) {
      return
    }
    try {
      await reabrirInventario(inv.id)
      await refresh()
      onAbrirCaptura(inv.id)
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao reabrir inventário.')
    }
  }

  async function confirmarIniciarInventario(opts: {
    listaEnderecamentoId: string
    listaEnderecamentoNome: string
    listaProdutosId: string
    listaProdutosNome: string
  }) {
    if (!iniciarInv) return
    try {
      await configurarInventarioListas(iniciarInv.id, opts)
      const id = iniciarInv.id
      setIniciarInv(null)
      await refresh()
      onAbrirCaptura(id)
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao configurar inventário.')
    }
  }

  async function handleRecuperarLinhas(inv: InventarioSessao) {
    try {
      const r = await recuperarLinhasInventarioDoAparelho(inv.id)
      if (!r) {
        alert('Inventário não encontrado.')
        return
      }
      await refresh()
      if (r.recuperadas > 0) {
        alert(
          `Recuperadas ${r.recuperadas} linha(s).\n\nAntes: ${r.antes} → Agora: ${r.depois}\n\nFontes neste aparelho: banco ${r.fontes.banco}, cache ${r.fontes.cache}, legado ${r.fontes.legacy}, overlay ${r.fontes.overlay}.\n\nSe ainda faltar linha, abra o app no celular onde contou e clique em Recuperar linhas lá também.`,
        )
      } else {
        alert(
          `Nenhuma linha extra encontrada neste aparelho (total: ${r.depois}).\n\nFontes: banco ${r.fontes.banco}, cache ${r.fontes.cache}, legado ${r.fontes.legacy}, overlay ${r.fontes.overlay}.\n\nTente no celular/tablet onde foram lançadas as contagens que sumiram.`,
        )
      }
    } catch (e: unknown) {
      alert(formatUnknownError(e) || 'Erro ao recuperar linhas.')
    }
  }

  function renderAcoes(r: InventarioSessao, layout: 'table' | 'card') {
    const btnClass = layout === 'card' ? 'inv-card__btn' : undefined
    const ghostClass = layout === 'card' ? 'inv-card__btn inv-card__btn--ghost' : 'page-btn-ghost'
    const dangerClass =
      layout === 'card'
        ? 'inv-card__btn inv-card__btn--ghost inv-card__btn--danger'
        : 'page-btn-ghost page-btn-danger'

    if (r.status === 'aberto') {
      return (
        <>
          <button type="button" className={btnClass} onClick={() => continuarInventario(r)}>
            {labelColeta(r)}
          </button>
          <button type="button" className={ghostClass} onClick={() => abrirModalEditar(r)}>
            Editar
          </button>
          <button type="button" className={ghostClass} onClick={() => setPosicoesInvId(r.id)}>
            Posições
          </button>
          <button
            type="button"
            className={ghostClass}
            title="Une linhas salvas neste aparelho com o banco"
            onClick={() => void handleRecuperarLinhas(r)}
          >
            Recuperar linhas
          </button>
          <button
            type="button"
            className={ghostClass}
            onClick={() => {
              if (confirm('Finalizar este inventário?')) {
                void fecharInventario(r.id).then(() => {
                  if (!isAppOnline()) {
                    setPendingSync(countPendingInventarioSync())
                    alert(
                      'Inventário finalizado no aparelho. Ao voltar a ter internet, os dados serão enviados ao banco automaticamente.',
                    )
                  }
                  void refresh()
                })
              }
            }}
          >
            Finalizar
          </button>
          <button type="button" className={dangerClass} onClick={() => handleExcluir(r)}>
            Excluir
          </button>
        </>
      )
    }

    return (
      <>
        <span className="inv-status inv-status--closed inv-actions-finalizado" title="Inventário finalizado">
          Finalizado
        </span>
        <button type="button" className={ghostClass} onClick={() => abrirModalEditar(r)}>
          Editar
        </button>
        <button type="button" className={ghostClass} onClick={() => setPosicoesInvId(r.id)}>
          Posições
        </button>
        <button type="button" className={btnClass} onClick={() => void entrarEAlterarInventario(r)}>
          Entrar e alterar
        </button>
        <button type="button" className={ghostClass} onClick={() => onAbrirCaptura(r.id)}>
          Ver
        </button>
        <button type="button" className={dangerClass} onClick={() => handleExcluir(r)}>
          Excluir
        </button>
      </>
    )
  }

  return (
    <div className="page-panel inv-gerenciar">
      <PagePanelHeading
        title="Inventários"
        info={
          <>
            Crie um inventário com nome — configure as <strong>posições</strong> (endereços) e use a lista de produtos.
            Depois clique em <strong>Começar inventário</strong> para coletar. Na <strong>câmara fria sem internet</strong>,
            use <strong>Preparar modo offline</strong> antes de entrar; as linhas ficam salvas no aparelho e sincronizam ao
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
          {pendingSync > 0 ? ` · ${pendingSync} inventário(s) aguardando envio` : ''}
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
          Tabela <strong>inventario_sessoes</strong> ainda não existe no Supabase — os inventários ficam salvos só
          neste navegador. Execute <strong>supabase/sql/setup_inventario_listas_completo.sql</strong> no SQL Editor e
          clique em Atualizar lista.
        </p>
      ) : null}
      {loading ? <p className="page-panel__meta">Carregando inventários…</p> : null}

      <div className="gerenciar-toolbar">
          <button type="button" onClick={abrirModalCriar} disabled={loading}>
            Criar inventário
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

      <div className="page-tabs inv-gerenciar__tabs" role="tablist" aria-label="Filtro de inventários">
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
          Buscar inventário
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, local, nº, listas de endereço ou produtos…"
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
          ? `${listaFiltrada.length} inventário(s) nesta lista`
          : `Mostrando ${listaFiltrada.length} de ${listaPorTab.length} inventário(s)`}
      </p>

      {abertos.length > 0 ? (
        <p className="inv-gerenciar__hint">{abertos.length} inventário(s) aberto(s)</p>
      ) : null}

      <div className="inv-list-cards">
        {listaFiltrada.length === 0 ? (
          <p className="inv-list-empty">
            {filtrosAtivos ? 'Nenhum inventário encontrado com estes filtros.' : 'Nenhum inventário nesta lista.'}
          </p>
        ) : (
          listaFiltrada.map((r) => (
            <article key={r.id} className="inv-card">
              <div className="inv-card__head">
                <span className="inv-card__num">#{r.numero}</span>
                <span className={r.status === 'aberto' ? 'inv-status inv-status--open' : 'inv-status inv-status--closed'}>
                  {r.status === 'aberto' ? 'Aberto' : 'Finalizado'}
                </span>
              </div>
              <h3 className="inv-card__title">{r.titulo}</h3>
              <p className="inv-card__meta">{r.local}</p>
              <p className="inv-card__meta inv-card__meta--pos">{labelPosicoes(r)}</p>
              <dl className="inv-card__stats">
                <div>
                  <dt>Contando</dt>
                  <dd>
                    <GerenciarColunaContando aberto={r.status === 'aberto'} nomes={presencaMap.get(r.id)} />
                  </dd>
                </div>
                <div>
                  <dt>Linhas</dt>
                  <dd>{r.linhas.length}</dd>
                </div>
                <div>
                  <dt>Início</dt>
                  <dd>{formatData(r.dataInicio)}</dd>
                </div>
                {r.dataFim ? (
                  <div>
                    <dt>Fim</dt>
                    <dd>{formatData(r.dataFim)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="inv-card__actions">{renderAcoes(r, 'card')}</div>
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
              <th>Posições</th>
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
                  {filtrosAtivos ? 'Nenhum inventário encontrado com estes filtros.' : 'Nenhum inventário nesta lista.'}
                </td>
              </tr>
            ) : (
              listaFiltrada.map((r) => (
                <tr key={r.id}>
                  <td>{r.numero}</td>
                  <td>{r.titulo}</td>
                  <td>{r.local}</td>
                  <td className="inv-posicoes-cell">{labelPosicoes(r)}</td>
                  <td>
                    <span className={r.status === 'aberto' ? 'inv-status inv-status--open' : 'inv-status inv-status--closed'}>
                      {r.status === 'aberto' ? 'Aberto' : 'Finalizado'}
                    </span>
                  </td>
                  <td>
                    <GerenciarColunaContando aberto={r.status === 'aberto'} nomes={presencaMap.get(r.id)} />
                  </td>
                  <td>{r.linhas.length}</td>
                  <td>{formatData(r.dataInicio)}</td>
                  <td>{formatData(r.dataFim)}</td>
                  <td className="inv-actions-cell">{renderAcoes(r, 'table')}</td>
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
          aria-labelledby="inv-criar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCriarOpen(false)
          }}
        >
          <div className="page-modal">
            <div className="page-modal__head">
              <h2 id="inv-criar-title">Novo inventário</h2>
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
                Nome do inventário *
                <input
                  value={criarTitulo}
                  onChange={(e) => setCriarTitulo(e.target.value)}
                  placeholder="ex.: Inventário câmara 21 — validade"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCriar()
                  }}
                />
              </label>
              <label className="page-form-grid__full">
                Conferente
                <input
                  readOnly
                  value={conferenteLogado && conferenteLogado !== 'usuário' ? conferenteLogado : '—'}
                  className="inventario-captura__readonly"
                  title="Sempre o usuário logado — cada pessoa conta com a própria sessão"
                />
              </label>
              <label className="page-form-grid__full">
                Local / unidade
                <input value={criarLocal} onChange={(e) => setCriarLocal(e.target.value)} />
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
          aria-labelledby="inv-editar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditarId(null)
          }}
        >
          <div className="page-modal">
            <div className="page-modal__head">
              <h2 id="inv-editar-title">Editar inventário</h2>
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
                Nome do inventário *
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

      {inventarioPosicoes ? (
        <InventarioPosicoesModal
          inventario={inventarioPosicoes}
          onClose={() => setPosicoesInvId(null)}
          onSaved={refresh}
        />
      ) : null}

      {iniciarInv ? (
        <InventarioIniciarModal
          inventario={iniciarInv}
          onClose={() => setIniciarInv(null)}
          onConfirm={(opts) => void confirmarIniciarInventario(opts)}
        />
      ) : null}

      <CadastroConferenteModal
        open={cadastroConferenteOpen}
        onClose={() => setCadastroConferenteOpen(false)}
        loginEsperado={conferenteLogado}
      />
    </div>
  )
}
