import { useState } from 'react'
import ProdutoClassificacaoPage from './ProdutoClassificacaoPage'
import {
  deleteFamilia,
  listFamilias,
  saveFamilia,
  type ProdutoFamilia,
} from '../lib/produtoClassificacaoStore'

export default function ProdutosFamilia() {
  const [rows, setRows] = useState<ProdutoFamilia[]>(() => listFamilias())

  return (
    <ProdutoClassificacaoPage
      titulo="Família"
      subtitulo="Classificação de produtos — nível família (ex.: 01). Cadastro local; em breve sincronização com o Supabase."
      rows={rows.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, ativo: r.ativo }))}
      onRefresh={() => setRows(listFamilias())}
      onSave={(row) => {
        saveFamilia({ id: row.id, codigo: row.codigo, nome: row.nome, ativo: row.ativo })
      }}
      onDelete={(id) => {
        deleteFamilia(id)
        setRows(listFamilias())
      }}
    />
  )
}
