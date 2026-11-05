import { useCallback, useEffect, useMemo, useState } from 'react'
import { inventarioCamaraLabelFromGrupo } from '../components/inventario/inventarioPlanilhaModel'
import {
  camaraLabelFromGrupo,
  estoqueFiltrosPadrao,
  fetchEstoqueConsulta,
  type EstoqueConsultaFiltros,
  type EstoqueLinha,
} from '../lib/estoqueConsultaFetch'
import { formatUnknownError } from '../lib/supabaseError'
import RelatorioContagem from './RelatorioContagem'
import { PageInfoBlock, PagePanelHeading } from '../components/ui/PagePanelHeading'

const PAGE_SIZE = 50

type EstoqueTab = 'consulta' | 'exportar'
type ExportarTipo = 'contagem_diaria' | 'inventario'

function formatDataBR(ymd: string) {
  if (!ymd || ymd.length < 10) return '—'
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function formatDataHoraBR(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR')
}

function tipoLabel(fonte: EstoqueLinha['fonte']) {
  return fonte === 'inventario' ? 'Inventário' : 'Contagem diária'
}

export default function EstoqueConsulta() {
  const [estoqueTab, setEstoqueTab] = useState<EstoqueTab>('consulta')
  const [exportTipo, setExportTipo] = useState<ExportarTipo>('contagem_diaria')
  const [filtros, setFiltros] = useState<EstoqueConsultaFiltros>(() => estoqueFiltrosPadrao())
  const [draft, setDraft] = useState<EstoqueConsultaFiltros>(() => estoqueFiltrosPadrao())
  const [rows, setRows] = useState<EstoqueLinha[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [carregado, setCarregado] = useState(false)

  const carregar = useCallback(async (f: EstoqueConsultaFiltros) => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchEstoqueConsulta(f)
      setRows(data)
      setFiltros(f)
      setCarregado(true)
      setPage(1)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao carregar estoque.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void carregar(estoqueFiltrosPadrao())
  }, [carregar])

  const conferentes = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) {
      if (r.conferente_id) m.set(r.conferente_id, r.conferente_nome)
    }
    return [...m.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [rows])

  const filtrados = useMemo(() => {
    const q = draft.busca.trim().toUpperCase()
    return rows.filter((r) => {
      if (draft.conferenteId && r.conferente_id !== draft.conferenteId) return false
      if (draft.grupoCamara) {
        const g = Number(draft.grupoCamara)
        if (!Number.isFinite(g) || r.planilha_grupo_armazem !== g) return false
      }
      if (!q) return true
      return (
        r.codigo_interno.toUpperCase().includes(q) ||
        r.descricao.toUpperCase().includes(q) ||
        (r.lote ?? '').toUpperCase().includes(q)
      )
    })
  }, [rows, draft.busca, draft.conferenteId, draft.grupoCamara])

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const slice = filtrados.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  function aplicarFiltrosServidor() {
    void carregar(draft)
  }

  function aplicarFiltrosLocais() {
    setPage(1)
  }

  return (
    <div className="page-panel page-panel--wide">
      <PagePanelHeading
        title="Estoque"
        info={
          <>
            <PageInfoBlock>
              Consulte as contagens registradas no banco ou gere planilhas Excel com o mesmo layout dos relatórios.
            </PageInfoBlock>
            <PageInfoBlock title="Consulta">
              Use os filtros e clique em <strong>Carregar</strong> para buscar no período; busca, conferente e câmara
              refinam a lista já carregada.
            </PageInfoBlock>
            <PageInfoBlock title="Exportar Excel">
              Escolha o tipo, o período e exporte a planilha Excel com as mesmas colunas dos relatórios.
            </PageInfoBlock>
          </>
        }
      />

      <div className="page-tabs inv-gerenciar__tabs" role="tablist" aria-label="Estoque">
        <button
          type="button"
          role="tab"
          aria-selected={estoqueTab === 'consulta'}
          className={`page-tabs__btn${estoqueTab === 'consulta' ? ' page-tabs__btn--active' : ''}`}
          onClick={() => setEstoqueTab('consulta')}
        >
          Consulta
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={estoqueTab === 'exportar'}
          className={`page-tabs__btn${estoqueTab === 'exportar' ? ' page-tabs__btn--active' : ''}`}
          onClick={() => setEstoqueTab('exportar')}
        >
          Exportar Excel
        </button>
      </div>

      {estoqueTab === 'exportar' ? (
        <>
          <RelatorioContagem
            key={exportTipo}
            exportOnly
            exportConsultaLayout
            exportTipo={exportTipo}
            onExportTipoChange={setExportTipo}
            lockListColumnMode
            listColumnPrefsInventario={exportTipo === 'inventario'}
          />
        </>
      ) : (
        <>
      <section className="page-form-grid page-form-grid--filters">
        <label>
          Tipo
          <select
            value={draft.tipo}
            onChange={(e) =>
              setDraft((d) => ({ ...d, tipo: e.target.value as EstoqueConsultaFiltros['tipo'] }))
            }
          >
            <option value="todos">Todos</option>
            <option value="contagem_diaria">Contagem diária</option>
            <option value="inventario">Inventário</option>
          </select>
        </label>
        <label>
          Data de
          <input
            type="date"
            value={draft.dataDe}
            onChange={(e) => setDraft((d) => ({ ...d, dataDe: e.target.value }))}
          />
        </label>
        <label>
          Data até
          <input
            type="date"
            value={draft.dataAte}
            onChange={(e) => setDraft((d) => ({ ...d, dataAte: e.target.value }))}
          />
        </label>
        <label>
          Busca (código, descrição, lote)
          <input
            value={draft.busca}
            onChange={(e) => setDraft((d) => ({ ...d, busca: e.target.value }))}
            placeholder="Filtrar na lista…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') aplicarFiltrosLocais()
            }}
          />
        </label>
        <label>
          Conferente
          <select
            value={draft.conferenteId}
            onChange={(e) => setDraft((d) => ({ ...d, conferenteId: e.target.value }))}
          >
            <option value="">Todos</option>
            {conferentes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Câmara / grupo
          <select
            value={draft.grupoCamara}
            onChange={(e) => setDraft((d) => ({ ...d, grupoCamara: e.target.value }))}
          >
            <option value="">Todas</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
              <option key={g} value={String(g)}>
                {inventarioCamaraLabelFromGrupo(g) ?? camaraLabelFromGrupo(g)}
              </option>
            ))}
          </select>
        </label>
        <div className="page-form-grid__actions page-form-grid__actions--wrap page-form-grid__full">
          <button type="button" disabled={loading} onClick={aplicarFiltrosServidor}>
            {loading ? 'Carregando…' : 'Carregar'}
          </button>
          <button type="button" className="page-btn-ghost" onClick={aplicarFiltrosLocais}>
            Aplicar filtros locais
          </button>
        </div>
      </section>

      {error ? <p className="page-msg page-msg--error">{error}</p> : null}

      {carregado ? (
        <p className="page-panel__meta">
          {filtrados.length} linha(s) — período {formatDataBR(filtros.dataDe)} a {formatDataBR(filtros.dataAte)}
          {filtros.tipo !== 'todos' ? ` · ${filtros.tipo === 'inventario' ? 'Inventário' : 'Contagem diária'}` : ''}
        </p>
      ) : null}

      <div className="page-table-wrap">
        <table className="page-table page-table--compact">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Código</th>
              <th>Descrição</th>
              <th>Qtd</th>
              <th>Un.</th>
              <th>Lote</th>
              <th>Validade</th>
              <th>Conferente</th>
              <th>Câmara</th>
              <th>Rodada</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11}>Carregando…</td>
              </tr>
            ) : slice.length === 0 ? (
              <tr>
                <td colSpan={11}>Nenhum registro para os filtros.</td>
              </tr>
            ) : (
              slice.map((r) => (
                <tr key={`${r.fonte}-${r.id}`}>
                  <td title={formatDataHoraBR(r.data_hora_contagem)}>{formatDataBR(r.data_contagem)}</td>
                  <td>{tipoLabel(r.fonte)}</td>
                  <td>{r.codigo_interno}</td>
                  <td>{r.descricao}</td>
                  <td>{r.quantidade_up}</td>
                  <td>{r.unidade_medida ?? '—'}</td>
                  <td>{r.lote ?? '—'}</td>
                  <td>{r.data_validade ? formatDataBR(r.data_validade) : '—'}</td>
                  <td>{r.conferente_nome}</td>
                  <td>
                    {r.planilha_grupo_armazem != null
                      ? inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem) ??
                        camaraLabelFromGrupo(r.planilha_grupo_armazem)
                      : '—'}
                  </td>
                  <td>{r.inventario_numero_contagem ?? '—'}</td>
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
        </>
      )}
    </div>
  )
}
