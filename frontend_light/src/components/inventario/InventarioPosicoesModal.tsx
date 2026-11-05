import { useEffect, useMemo, useState } from 'react'
import { getRuasPorCamara, INVENTARIO_CAMARAS } from './inventarioPlanilhaModel'
import {
  atualizarInventarioPosicoes,
  type InventarioSessao,
} from '../../lib/inventarioSessaoStore'
import {
  enderecosAtivosDaLista,
  getEnderecoLista,
  saveEnderecoLista,
  type EnderecoLista,
} from '../../lib/enderecamentoListaSupabase'
import {
  buildCodigoEndereco,
  listEnderecos,
  planejarEnderecosEmLote,
  saveEnderecosEmLoteEm,
  type EnderecoCadastro,
} from '../../lib/enderecamentoStore'

type Props = {
  inventario: InventarioSessao
  onClose: () => void
  onSaved: () => void
}

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

export default function InventarioPosicoesModal({ inventario, onClose, onSaved }: Props) {
  const [posicoesNome, setPosicoesNome] = useState(inventario.posicoesNome ?? '')
  const [selecionados, setSelecionados] = useState<Set<string>>(
    () => new Set((inventario.posicoesCodigos ?? []).map((c) => c.toUpperCase())),
  )
  const [listaEndereco, setListaEndereco] = useState<EnderecoLista | null>(null)
  const [enderecos, setEnderecos] = useState<EnderecoCadastro[]>([])
  const [enderecosLoading, setEnderecosLoading] = useState(true)
  const [filtroCamara, setFiltroCamara] = useState('')
  const [filtroRua, setFiltroRua] = useState('')
  const [busca, setBusca] = useState('')
  const [lote, setLote] = useState(emptyLote)
  const [loteAberto, setLoteAberto] = useState(true)
  const [loteMsg, setLoteMsg] = useState('')
  const [msg, setMsg] = useState('')

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

  const enderecosFiltrados = useMemo(() => {
    let list = enderecos
    if (filtroCamara) {
      const c = Number(filtroCamara)
      if (Number.isFinite(c)) list = list.filter((e) => e.camara === c)
    }
    if (filtroRua) list = list.filter((e) => e.rua.toUpperCase() === filtroRua.toUpperCase())
    const q = busca.trim().toUpperCase()
    if (q) list = list.filter((e) => e.codigo.toUpperCase().includes(q))
    return list
  }, [enderecos, filtroCamara, filtroRua, busca])

  const ruasFiltro = useMemo(() => {
    if (!filtroCamara) return []
    return getRuasPorCamara(Number(filtroCamara))
  }, [filtroCamara])

  useEffect(() => {
    let alive = true
    setEnderecosLoading(true)
    void (async () => {
      try {
        const listaId = inventario.listaEnderecamentoId
        if (listaId) {
          const lista = await getEnderecoLista(listaId)
          if (!alive) return
          setListaEndereco(lista)
          setEnderecos(lista ? enderecosAtivosDaLista(lista) : [])
        } else {
          setListaEndereco(null)
          setEnderecos(listEnderecos())
        }
      } catch {
        if (alive) {
          setListaEndereco(null)
          setEnderecos(listEnderecos())
        }
      } finally {
        if (alive) setEnderecosLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [inventario.listaEnderecamentoId])

  function refreshEnderecosFromLista(lista: EnderecoLista) {
    setListaEndereco(lista)
    setEnderecos(enderecosAtivosDaLista(lista))
  }

  async function persistListaEnderecos(nextEnderecos: EnderecoCadastro[]) {
    if (!listaEndereco) return
    const saved = await saveEnderecoLista({ ...listaEndereco, enderecos: nextEnderecos })
    refreshEnderecosFromLista(saved)
  }

  function toggleCodigo(codigo: string) {
    const key = codigo.toUpperCase()
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selecionarTodosVisiveis() {
    setSelecionados((prev) => {
      const next = new Set(prev)
      for (const e of enderecosFiltrados) next.add(e.codigo.toUpperCase())
      return next
    })
  }

  function limparSelecao() {
    setSelecionados(new Set())
  }

  function selecionarLoteGerado() {
    setSelecionados((prev) => {
      const next = new Set(prev)
      for (const p of previewLote) next.add(p.codigo.toUpperCase())
      return next
    })
    if (previewLote.length > 0 && !posicoesNome.trim()) {
      const cam = lote.camara
      const rua = lote.rua
      setPosicoesNome(`Câmara ${cam} — Rua ${rua}`)
    }
  }

  async function handleLoteSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoteMsg('')
    const camara = Number(lote.camara)
    const nivelDe = Number(lote.nivelDe)
    const nivelAte = Number(lote.nivelAte)
    const posicaoDe = Number(lote.posicaoDe)
    const posicaoAte = Number(lote.posicaoAte)
    if (!Number.isFinite(camara) || !lote.rua.trim()) {
      setLoteMsg('Informe câmara e rua.')
      return
    }
    const base = listaEndereco?.enderecos ?? enderecos
    const { all, resultado: res } = saveEnderecosEmLoteEm(base, {
      camara,
      rua: lote.rua,
      nivelDe,
      nivelAte,
      posicaoDe,
      posicaoAte,
      observacao: lote.observacao || posicoesNome.trim(),
      substituirExistentes: lote.substituirExistentes,
    })
    if (listaEndereco) {
      try {
        await persistListaEnderecos(all)
      } catch (err: unknown) {
        setLoteMsg(err instanceof Error ? err.message : 'Erro ao salvar endereços na lista.')
        return
      }
    } else {
      setEnderecos(all.filter((r) => r.ativo))
    }
    setSelecionados((prev) => {
      const next = new Set(prev)
      for (const p of previewLote) next.add(p.codigo.toUpperCase())
      return next
    })
    if (!posicoesNome.trim()) setPosicoesNome(`Câmara ${camara} — Rua ${lote.rua}`)
    const partes = [`${res.criados} criado(s)`]
    if (res.atualizados) partes.push(`${res.atualizados} atualizado(s)`)
    if (res.ignorados) partes.push(`${res.ignorados} ignorado(s)`)
    setLoteMsg(`Lote concluído: ${partes.join(', ')}. Posições já marcadas para este inventário.`)
  }

  async function handleSalvar() {
    setMsg('')
    try {
      await atualizarInventarioPosicoes(inventario.id, {
        posicoesNome: posicoesNome.trim(),
        posicoesCodigos: Array.from(selecionados),
      })
      setMsg('Posições salvas neste inventário.')
      onSaved()
      onClose()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao salvar posições.')
    }
  }

  const exemploCodigo =
    previewLote.length > 0 ? previewLote[0].codigo : buildCodigoEndereco(11, 'A', 1, 1)

  return (
    <div
      className="page-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inv-posicoes-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="page-modal page-modal--wide">
        <div className="page-modal__head">
          <h2 id="inv-posicoes-title">Posições — {inventario.titulo}</h2>
          <button type="button" className="page-modal__close" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="page-modal__body inv-posicoes-modal">
          <p className="inv-posicoes-modal__intro">
            Selecione as <strong>posições</strong> (endereços) deste inventário
            {inventario.listaEnderecamentoNome || listaEndereco?.nome
              ? ` — lista «${inventario.listaEnderecamentoNome ?? listaEndereco?.nome}»`
              : ''}
            . Os produtos vêm da lista escolhida ao começar o inventário.
          </p>
          {enderecosLoading ? <p className="inv-posicoes-modal__intro">Carregando endereços…</p> : null}

          <label className="page-form-grid__full">
            Nome do conjunto de posições
            <input
              value={posicoesNome}
              onChange={(e) => setPosicoesNome(e.target.value)}
              placeholder="ex.: Câmara 11 — Rua A — níveis 1 a 5"
            />
          </label>

          <section className="endereco-lote-panel">
            <button
              type="button"
              className="endereco-lote-panel__toggle"
              onClick={() => setLoteAberto((v) => !v)}
            >
              {loteAberto ? '▼' : '▶'} Criar posições em lote
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
                  />
                </label>
                <label>
                  Nível até
                  <input
                    value={lote.nivelAte}
                    onChange={(e) => setLote((f) => ({ ...f, nivelAte: e.target.value }))}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  Coluna (pos.) de
                  <input
                    value={lote.posicaoDe}
                    onChange={(e) => setLote((f) => ({ ...f, posicaoDe: e.target.value }))}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  Coluna (pos.) até
                  <input
                    value={lote.posicaoAte}
                    onChange={(e) => setLote((f) => ({ ...f, posicaoAte: e.target.value }))}
                    inputMode="numeric"
                  />
                </label>
                <label className="page-form-grid__full endereco-lote-check">
                  <input
                    type="checkbox"
                    checked={lote.substituirExistentes}
                    onChange={(e) => setLote((f) => ({ ...f, substituirExistentes: e.target.checked }))}
                  />
                  Atualizar posições que já existirem com o mesmo código
                </label>
                <div className="page-form-grid__full endereco-lote-preview">
                  <strong>{previewLote.length}</strong> posição(ões) serão geradas
                  {previewLote.length > 0 ? (
                    <span className="endereco-lote-preview__ex">
                      {' '}
                      — ex.: {exemploCodigo}
                      {previewLote.length > 1 ? ` … ${previewLote[previewLote.length - 1].codigo}` : ''}
                    </span>
                  ) : null}
                </div>
                <div className="page-form-grid__actions inv-posicoes-modal__lote-actions">
                  <button type="button" className="page-btn-ghost" onClick={selecionarLoteGerado}>
                    Marcar intervalo na lista
                  </button>
                  <button type="submit">Gerar {previewLote.length || ''} posições</button>
                </div>
                {loteMsg ? <p className="page-form-grid__full endereco-lote-msg">{loteMsg}</p> : null}
              </form>
            ) : null}
          </section>

          <section className="inv-posicoes-modal__selecao">
            <h3 className="inv-posicoes-modal__selecao-title">
              Escolher posições deste inventário ({selecionados.size} selecionada(s))
            </h3>
            <p className="inv-posicoes-modal__selecao-hint">
              Marque as posições que farão parte desta contagem. Se nenhuma for marcada, qualquer endereço poderá ser
              usado na coleta.
            </p>

            <div className="inv-posicoes-modal__filtros page-form-grid">
              <label>
                Filtrar câmara
                <select
                  value={filtroCamara}
                  onChange={(e) => {
                    setFiltroCamara(e.target.value)
                    setFiltroRua('')
                  }}
                >
                  <option value="">Todas</option>
                  {INVENTARIO_CAMARAS.map((c) => (
                    <option key={c} value={String(c)}>
                      Câmara {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filtrar rua
                <select value={filtroRua} onChange={(e) => setFiltroRua(e.target.value)} disabled={!filtroCamara}>
                  <option value="">Todas</option>
                  {ruasFiltro.map((r) => (
                    <option key={r} value={r}>
                      Rua {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="page-form-grid__full">
                Buscar código
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: 11-A-05" />
              </label>
            </div>

            <div className="inv-posicoes-modal__toolbar">
              <button type="button" className="page-btn-ghost" onClick={selecionarTodosVisiveis}>
                Marcar visíveis ({enderecosFiltrados.length})
              </button>
              <button type="button" className="page-btn-ghost" onClick={limparSelecao}>
                Limpar seleção
              </button>
            </div>

            <div className="inv-posicoes-modal__lista">
              {enderecosFiltrados.length === 0 ? (
                <p className="inv-posicoes-modal__empty">
                  Nenhuma posição cadastrada. Use «Criar posições em lote» acima.
                </p>
              ) : (
                enderecosFiltrados.map((e) => {
                  const key = e.codigo.toUpperCase()
                  const checked = selecionados.has(key)
                  return (
                    <label key={e.id} className={`inv-posicoes-modal__item${checked ? ' inv-posicoes-modal__item--on' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCodigo(e.codigo)} />
                      <span className="inv-posicoes-modal__cod">{e.codigo}</span>
                      {e.observacao?.trim() ? (
                        <span className="inv-posicoes-modal__obs">{e.observacao}</span>
                      ) : null}
                    </label>
                  )
                })
              )}
            </div>
          </section>

          {msg ? <p className="endereco-lote-msg">{msg}</p> : null}
        </div>

        <div className="page-modal__foot">
          <button type="button" className="page-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" onClick={handleSalvar}>
            Salvar posições ({selecionados.size})
          </button>
        </div>
      </div>
    </div>
  )
}
