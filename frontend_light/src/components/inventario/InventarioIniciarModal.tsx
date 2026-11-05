import { useEffect, useState } from 'react'
import {
  ensureEnderecoListaPadrao,
  listEnderecoListas,
  type EnderecoLista,
} from '../../lib/enderecamentoListaSupabase'
import {
  ensureProdutoListaPadrao,
  listProdutoListas,
  type ProdutoLista,
} from '../../lib/produtoListaSupabase'
import type { InventarioSessao } from '../../lib/inventarioSessaoTypes'
import { formatUnknownError } from '../../lib/supabaseError'

type Props = {
  inventario: InventarioSessao
  onConfirm: (opts: {
    listaEnderecamentoId: string
    listaEnderecamentoNome: string
    listaProdutosId: string
    listaProdutosNome: string
  }) => void
  onClose: () => void
}

export default function InventarioIniciarModal({ inventario, onConfirm, onClose }: Props) {
  const [endListas, setEndListas] = useState<EnderecoLista[]>([])
  const [prodListas, setProdListas] = useState<ProdutoLista[]>([])
  const [endId, setEndId] = useState(inventario.listaEnderecamentoId ?? '')
  const [prodId, setProdId] = useState(inventario.listaProdutosId ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      setError('')
      try {
        await ensureEnderecoListaPadrao()
        await ensureProdutoListaPadrao()
        const [ends, prods] = await Promise.all([listEnderecoListas(), listProdutoListas()])
        if (!alive) return
        setEndListas(ends)
        setProdListas(prods)
        setEndId((prev) => prev || inventario.listaEnderecamentoId || ends[0]?.id || '')
        setProdId((prev) => prev || inventario.listaProdutosId || prods[0]?.id || '')
      } catch (e: unknown) {
        if (alive) setError(formatUnknownError(e) || 'Erro ao carregar listas.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [inventario.listaEnderecamentoId, inventario.listaProdutosId])

  function handleConfirmar() {
    const end = endListas.find((l) => l.id === endId)
    const prod = prodListas.find((l) => l.id === prodId)
    if (!end || !prod) {
      alert('Selecione a lista de endereçamento e a lista de produtos.')
      return
    }
    onConfirm({
      listaEnderecamentoId: end.id,
      listaEnderecamentoNome: end.nome,
      listaProdutosId: prod.id,
      listaProdutosNome: prod.nome,
    })
  }

  const endSel = endListas.find((l) => l.id === endId)
  const prodSel = prodListas.find((l) => l.id === prodId)

  return (
    <div
      className="page-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inv-iniciar-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="page-modal">
        <div className="page-modal__head">
          <h2 id="inv-iniciar-title">Começar inventário — {inventario.titulo}</h2>
          <button type="button" className="page-modal__close" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="page-modal__body page-form-grid">
          <p className="page-form-grid__full page-panel__subtitle" style={{ margin: 0 }}>
            Escolha qual <strong>endereçamento</strong> e qual <strong>lista de produtos</strong> usar neste inventário.
          </p>
          {error ? <p className="page-form-grid__full page-msg page-msg--error">{error}</p> : null}
          {loading ? (
            <p className="page-form-grid__full">Carregando listas…</p>
          ) : (
            <>
              <label className="page-form-grid__full">
                Lista de endereçamento *
                <select value={endId} onChange={(e) => setEndId(e.target.value)}>
                  <option value="">— Selecione —</option>
                  {endListas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} ({l.enderecos.filter((e) => e.ativo !== false).length} endereços)
                    </option>
                  ))}
                </select>
              </label>
              {endSel ? (
                <p className="page-form-grid__full page-panel__meta">
                  {endSel.enderecos.filter((e) => e.ativo !== false).length} posição(ões) nesta lista
                </p>
              ) : null}
              <label className="page-form-grid__full">
                Lista de produtos *
                <select value={prodId} onChange={(e) => setProdId(e.target.value)}>
                  <option value="">— Selecione —</option>
                  {prodListas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} ({l.produtos.length} produtos)
                    </option>
                  ))}
                </select>
              </label>
              {prodSel ? (
                <p className="page-form-grid__full page-panel__meta">{prodSel.produtos.length} produto(s) nesta lista</p>
              ) : null}
            </>
          )}
        </div>
        <div className="page-modal__foot">
          <button type="button" className="page-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={loading || !endId || !prodId} onClick={handleConfirmar}>
            Começar inventário
          </button>
        </div>
      </div>
    </div>
  )
}
