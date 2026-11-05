import { useMemo, useState } from 'react'
import {
  addPortalGrupoMembro,
  deletePortalGrupo,
  deletePortalGrupoMembro,
  savePortalGrupo,
  type OrgGrupo,
  type OrgNo,
  type SistemaId,
} from '../lib/portalConfigApi'
import './PortalHierarchyTree.css'

type Props = {
  sistema: SistemaId
  grupos: OrgGrupo[]
  empresas: OrgNo[]
  onChanged: () => void
}

function flattenEmpresas(nodes: OrgNo[], acc: OrgNo[] = []): OrgNo[] {
  for (const n of nodes) {
    acc.push(n)
    if (n.children?.length) flattenEmpresas(n.children, acc)
  }
  return acc
}

export default function PortalHierarchyGroups({ sistema, grupos, empresas, onChanged }: Props) {
  const flat = useMemo(() => flattenEmpresas(empresas), [empresas])
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [selectedGrupo, setSelectedGrupo] = useState<string>('')
  const [empresaId, setEmpresaId] = useState('')
  const [parentId, setParentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const grupoAtivo = grupos.find((g) => g.id === selectedGrupo) || grupos[0] || null
  const membros = grupoAtivo?.membros || []
  const membrosIds = new Set(membros.map((m) => m.empresa_id))
  const disponiveis = flat.filter((e) => !membrosIds.has(e.id))

  async function handleCreateGrupo() {
    if (!nome.trim()) return
    setSaving(true)
    setErro(null)
    setOkMsg(null)
    const res = await savePortalGrupo({ nome, descricao, sistema })
    setSaving(false)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setNome('')
    setDescricao('')
    setOkMsg('Grupo criado.')
    if (res.grupo?.id) setSelectedGrupo(res.grupo.id)
    onChanged()
  }

  async function handleDeleteGrupo(id: string, label: string) {
    if (!window.confirm(`Excluir o grupo "${label}"?`)) return
    setErro(null)
    const res = await deletePortalGrupo(id)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setOkMsg('Grupo removido.')
    if (selectedGrupo === id) setSelectedGrupo('')
    onChanged()
  }

  async function handleAddMembro() {
    if (!grupoAtivo || !empresaId) return
    setSaving(true)
    setErro(null)
    const res = await addPortalGrupoMembro({
      grupo_id: grupoAtivo.id,
      empresa_id: empresaId,
      parent_empresa_id: parentId || null,
    })
    setSaving(false)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setEmpresaId('')
    setParentId('')
    setOkMsg('Empresa adicionada ao grupo.')
    onChanged()
  }

  async function handleRemoveMembro(membroId: string, label: string) {
    if (!window.confirm(`Remover "${label}" deste grupo?`)) return
    const res = await deletePortalGrupoMembro({ id: membroId })
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setOkMsg('Membro removido.')
    onChanged()
  }

  return (
    <div className="ph-grupos">
      <div className="ph-grupos__head">
        <div>
          <h3 className="ph-grupos__title">Grupos de hierarquia</h3>
          <p className="ph-grupos__hint">
            Uma empresa pode participar de vários grupos. A visibilidade é top-down (BFS) a partir da
            empresa do usuário.
          </p>
        </div>
      </div>

      {erro ? <p className="ph-tree__erro">{erro}</p> : null}
      {okMsg ? <p className="ph-tree__ok">{okMsg}</p> : null}

      <div className="ph-grupos__create">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do grupo"
        />
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional)"
        />
        <button
          type="button"
          className="ph-tree__btn ph-tree__btn--primary"
          disabled={saving || !nome.trim()}
          onClick={() => void handleCreateGrupo()}
        >
          + Criar grupo
        </button>
      </div>

      {grupos.length === 0 ? (
        <p className="ph-grupos__empty">Nenhum grupo neste sistema.</p>
      ) : (
        <div className="ph-grupos__body">
          <aside className="ph-grupos__list">
            {grupos.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`ph-grupos__item${(grupoAtivo?.id || '') === g.id ? ' ph-grupos__item--active' : ''}`}
                onClick={() => setSelectedGrupo(g.id)}
              >
                <strong>{g.nome}</strong>
                <span>{(g.membros || []).length} empresa(s)</span>
              </button>
            ))}
          </aside>

          {grupoAtivo ? (
            <div className="ph-grupos__detail">
              <div className="ph-grupos__detail-top">
                <div>
                  <strong>{grupoAtivo.nome}</strong>
                  {grupoAtivo.descricao ? <p>{grupoAtivo.descricao}</p> : null}
                </div>
                <button
                  type="button"
                  className="ph-tree__btn ph-tree__btn--danger"
                  onClick={() => void handleDeleteGrupo(grupoAtivo.id, grupoAtivo.nome)}
                >
                  Excluir grupo
                </button>
              </div>

              <div className="ph-grupos__add">
                <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                  <option value="">Empresa…</option>
                  {disponiveis.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome} ({e.label_tipo || e.tipo})
                    </option>
                  ))}
                </select>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">Sem pai no grupo</option>
                  {membros.map((m) => (
                    <option key={m.id} value={m.empresa_id}>
                      {m.empresa_nome || m.empresa_id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ph-tree__btn ph-tree__btn--primary"
                  disabled={saving || !empresaId}
                  onClick={() => void handleAddMembro()}
                >
                  Adicionar
                </button>
              </div>

              <ul className="ph-grupos__membros">
                {membros.length === 0 ? (
                  <li className="ph-grupos__empty">Nenhuma empresa neste grupo.</li>
                ) : (
                  membros.map((m) => (
                    <li key={m.id}>
                      <div>
                        <strong>{m.empresa_nome || m.empresa_id}</strong>
                        <span>
                          {m.empresa_tipo || '—'}
                          {m.parent_empresa_id
                            ? ` · sob ${
                                membros.find((x) => x.empresa_id === m.parent_empresa_id)?.empresa_nome ||
                                m.parent_empresa_id
                              }`
                            : ' · raiz no grupo'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ph-tree__btn ph-tree__btn--icon ph-tree__btn--danger"
                        onClick={() => void handleRemoveMembro(m.id, m.empresa_nome || m.empresa_id)}
                      >
                        −
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
