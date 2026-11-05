import { useMemo, useState } from 'react'
import ProdutoClassificacaoPage from './ProdutoClassificacaoPage'
import {
  deleteSubGrupo,
  listGrupos,
  listSubGrupos,
  saveSubGrupo,
  type ProdutoSubGrupo,
} from '../lib/produtoClassificacaoStore'

export default function ProdutosSubGrupos() {
  const [rows, setRows] = useState<ProdutoSubGrupo[]>(() => listSubGrupos())
  const parentOptions = useMemo(
    () => listGrupos().map((g) => ({ id: g.id, label: `${g.codigo} — ${g.nome}` })),
    [rows],
  )

  return (
    <ProdutoClassificacaoPage
      titulo="SubGrupos"
      subtitulo="Classificação de produtos — nível subgrupo, vinculado ao grupo."
      parentLabel="Grupo"
      parentOptions={parentOptions}
      rows={rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        ativo: r.ativo,
        parentId: r.grupoId,
      }))}
      onRefresh={() => setRows(listSubGrupos())}
      onSave={(row) => {
        if (!row.parentId) return
        saveSubGrupo({
          id: row.id,
          grupoId: row.parentId,
          codigo: row.codigo,
          nome: row.nome,
          ativo: row.ativo,
        })
      }}
      onDelete={(id) => {
        deleteSubGrupo(id)
        setRows(listSubGrupos())
      }}
    />
  )
}
