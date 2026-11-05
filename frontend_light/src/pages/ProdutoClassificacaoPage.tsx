import { useMemo, useState } from 'react'

type ParentOption = { id: string; label: string }

type Row = {
  id: string
  codigo: string
  nome: string
  ativo: boolean
  parentId?: string
}

type Props = {
  titulo: string
  subtitulo: string
  parentLabel?: string
  parentOptions?: ParentOption[]
  rows: Row[]
  onRefresh: () => void
  onSave: (row: { id?: string; codigo: string; nome: string; ativo: boolean; parentId?: string }) => void
  onDelete: (id: string) => void
}

const emptyForm = (parentId = '') => ({
  id: '',
  codigo: '',
  nome: '',
  ativo: true,
  parentId,
})

export default function ProdutoClassificacaoPage({
  titulo,
  subtitulo,
  parentLabel,
  parentOptions,
  rows,
  onRefresh,
  onSave,
  onDelete,
}: Props) {
  const [form, setForm] = useState(emptyForm)
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase()
    if (!q) return rows
    return rows.filter((r) => r.codigo.toUpperCase().includes(q) || r.nome.toUpperCase().includes(q))
  }, [rows, busca])

  const parentMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of parentOptions ?? []) m.set(p.id, p.label)
    return m
  }, [parentOptions])

  function limpar() {
    setForm(emptyForm(parentOptions?.[0]?.id ?? ''))
  }

  function editar(r: Row) {
    setForm({
      id: r.id,
      codigo: r.codigo,
      nome: r.nome,
      ativo: r.ativo,
      parentId: r.parentId ?? parentOptions?.[0]?.id ?? '',
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.codigo.trim() || !form.nome.trim()) return
    if (parentOptions?.length && !form.parentId) return
    onSave({
      id: form.id || undefined,
      codigo: form.codigo,
      nome: form.nome,
      ativo: form.ativo,
      parentId: form.parentId || undefined,
    })
    limpar()
    onRefresh()
  }

  return (
    <div className="page-panel">
      <h1 className="page-panel__title">{titulo}</h1>
      <p className="page-panel__subtitle">{subtitulo}</p>

      <form
        className={`page-form-grid page-form-grid--cadastro${parentOptions?.length ? ' has-parent' : ''}`}
        onSubmit={handleSubmit}
      >
        {parentOptions?.length ? (
          <label>
            {parentLabel}
            <select
              value={form.parentId}
              onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
              required
            >
              <option value="">Selecione…</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Código
          <input
            value={form.codigo}
            onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
            placeholder="Ex.: 01"
            required
          />
        </label>
        <label>
          Nome
          <input
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Descrição"
            required
          />
        </label>
        <label className="page-form-grid__check">
          <input
            type="checkbox"
            checked={form.ativo}
            onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
          />
          Ativo
        </label>
        <div className="page-form-grid__actions">
          <button type="submit">{form.id ? 'Salvar' : 'Cadastrar'}</button>
          {form.id ? (
            <button type="button" className="page-btn-ghost" onClick={limpar}>
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      <div className="page-form-grid--cadastro-search">
        <label className="page-field-label">
          Buscar
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código ou nome" />
        </label>
      </div>

      <div className="page-table-wrap" style={{ marginTop: 12 }}>
        <table className="page-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              {parentOptions?.length ? <th>{parentLabel}</th> : null}
              <th>Ativo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={parentOptions?.length ? 5 : 4}>Nenhum registro.</td>
              </tr>
            ) : (
              filtrados.map((r) => (
                <tr key={r.id}>
                  <td>{r.codigo}</td>
                  <td>{r.nome}</td>
                  {parentOptions?.length ? (
                    <td>{r.parentId ? (parentMap.get(r.parentId) ?? '—') : '—'}</td>
                  ) : null}
                  <td>{r.ativo ? 'Sim' : 'Não'}</td>
                  <td className="page-table__actions">
                    <button type="button" onClick={() => editar(r)}>
                      Editar
                    </button>
                    <button type="button" className="page-btn-danger" onClick={() => onDelete(r.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
