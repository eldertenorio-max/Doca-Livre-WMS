import { useMemo, useState } from 'react'
import ProdutoClassificacaoPage from './ProdutoClassificacaoPage'
import {
  deleteGrupo,
  listFamilias,
  listGrupos,
  saveGrupo,
  type ProdutoGrupo,
} from '../lib/produtoClassificacaoStore'

export default function ProdutosGrupos() {
  const [rows, setRows] = useState<ProdutoGrupo[]>(() => listGrupos())
  const parentOptions = useMemo(
    () => listFamilias().map((f) => ({ id: f.id, label: `${f.codigo} — ${f.nome}` })),
    [rows],
  )

  return (
    <ProdutoClassificacaoPage
      titulo="Grupos"
      subtitulo="Classificação de produtos — nível grupo (ex.: 01.01), vinculado à família."
      parentLabel="Família"
      parentOptions={parentOptions}
      rows={rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        ativo: r.ativo,
        parentId: r.familiaId,
      }))}
      onRefresh={() => setRows(listGrupos())}
      onSave={(row) => {
        if (!row.parentId) return
        saveGrupo({
          id: row.id,
          familiaId: row.parentId,
          codigo: row.codigo,
          nome: row.nome,
          ativo: row.ativo,
        })
      }}
      onDelete={(id) => {
        deleteGrupo(id)
        setRows(listGrupos())
      }}
    />
  )
}
