import { useMemo, useState } from 'react'
import {
  allowedOrgChildTypes,
  deletePortalOrgNo,
  savePortalOrgNo,
  type OrgNo,
  type OrgTipo,
  type SistemaId,
} from '../lib/portalConfigApi'
import './PortalHierarchyTree.css'

type Props = {
  arvore: OrgNo[]
  sistema: SistemaId
  sistemaLabel?: string
  onChanged: () => void
}

type ModalState =
  | null
  | { mode: 'create'; parent: OrgNo | null; tipos: OrgTipo[]; tipo: OrgTipo }
  | { mode: 'edit'; no: OrgNo }

const LEGENDA = [
  { tipo: 'operador_logistico', label: 'Operador Logístico' },
  { tipo: 'filial_operador', label: 'Filial Operador' },
  { tipo: 'embarcador', label: 'Embarcador' },
  { tipo: 'unidade', label: 'Unidade' },
  { tipo: 'transportadora', label: 'Transportadora' },
] as const

function labelTipo(tipo: string) {
  return LEGENDA.find((l) => l.tipo === tipo)?.label || tipo
}

function NodeRow({
  no,
  onAdd,
  onEdit,
  onDelete,
}: {
  no: OrgNo
  onAdd: (parent: OrgNo) => void
  onEdit: (no: OrgNo) => void
  onDelete: (no: OrgNo) => void
}) {
  const [open, setOpen] = useState(true)
  const children = no.children || []
  const canAdd = allowedOrgChildTypes(no.tipo).length > 0
  const tipo = String(no.tipo || '')

  return (
    <div className="ph-node">
      <div className={`ph-node__row ph-node__row--${tipo}`}>
        {children.length > 0 ? (
          <button type="button" className="ph-node__toggle" onClick={() => setOpen((v) => !v)} aria-label="Expandir">
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span className="ph-node__toggle" aria-hidden />
        )}
        <div className="ph-node__main">
          <div className="ph-node__name">{no.nome}</div>
          <div className="ph-node__meta">
            <span className={`ph-node__badge ph-node__badge--${tipo}`}>{no.label_tipo || tipo}</span>
            {no.is_fornecedor ? <span className="ph-node__badge ph-node__badge--fornecedor">Fornecedor</span> : null}
            {no.cnpj ? <span>CNPJ: {no.cnpj}</span> : null}
            {typeof no.usuarios_count === 'number' ? <span>👥 {no.usuarios_count}</span> : null}
          </div>
        </div>
        <div className="ph-node__actions">
          <button type="button" className="ph-tree__btn ph-tree__btn--icon" title="Editar" onClick={() => onEdit(no)}>
            ✎
          </button>
          {canAdd ? (
            <button type="button" className="ph-tree__btn ph-tree__btn--icon" title="Adicionar" onClick={() => onAdd(no)}>
              +
            </button>
          ) : null}
          <button
            type="button"
            className="ph-tree__btn ph-tree__btn--icon ph-tree__btn--danger"
            title="Excluir"
            onClick={() => onDelete(no)}
          >
            −
          </button>
        </div>
      </div>
      {open && children.length > 0 ? (
        <div className="ph-node__children">
          {children.map((child) => (
            <NodeRow key={child.id} no={child} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function PortalHierarchyTree({ arvore, sistema, sistemaLabel, onChanged }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const [nome, setNome] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [codigo, setCodigo] = useState('')
  const [tipoSel, setTipoSel] = useState<OrgTipo>('filial_operador')
  const [isFornecedor, setIsFornecedor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const rootTitle = useMemo(() => arvore[0]?.nome || 'Hierarquia organizacional', [arvore])
  const labelSis = sistemaLabel || `WMS ${sistema}`

  function openCreate(parent: OrgNo | null) {
    const tipos = allowedOrgChildTypes(parent?.tipo || null)
    if (!tipos.length) return
    setNome('')
    setCnpj('')
    setCodigo('')
    setTipoSel(tipos[0])
    setIsFornecedor(false)
    setErro(null)
    setOkMsg(null)
    setModal({ mode: 'create', parent, tipos, tipo: tipos[0] })
  }

  function openEdit(no: OrgNo) {
    setNome(no.nome || '')
    setCnpj(no.cnpj || '')
    setCodigo(no.codigo || '')
    setIsFornecedor(Boolean(no.is_fornecedor))
    setErro(null)
    setOkMsg(null)
    setModal({ mode: 'edit', no })
  }

  async function handleSave() {
    if (!modal) return
    setSaving(true)
    setErro(null)
    setOkMsg(null)
    if (modal.mode === 'create') {
      const tipo = tipoSel
      const res = await savePortalOrgNo({
        parent_id: modal.parent?.id || null,
        tipo,
        nome,
        cnpj,
        codigo,
        sistema,
        is_fornecedor: tipo === 'embarcador' ? isFornecedor : false,
      })
      setSaving(false)
      if (!res.ok) {
        setErro(res.erro)
        return
      }
      setOkMsg('Empresa adicionada.')
      setModal(null)
      onChanged()
      return
    }
    const res = await savePortalOrgNo({
      id: modal.no.id,
      nome,
      cnpj,
      codigo,
      sistema,
      is_fornecedor: modal.no.tipo === 'embarcador' ? isFornecedor : false,
    })
    setSaving(false)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setOkMsg('Empresa atualizada.')
    setModal(null)
    onChanged()
  }

  async function handleDelete(no: OrgNo) {
    if (!window.confirm(`Excluir "${no.nome}"?`)) return
    setErro(null)
    setOkMsg(null)
    const res = await deletePortalOrgNo(no.id)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setOkMsg('Empresa removida.')
    onChanged()
  }

  const showFornecedor =
    (modal?.mode === 'create' && tipoSel === 'embarcador') ||
    (modal?.mode === 'edit' && modal.no.tipo === 'embarcador')

  return (
    <div className={`ph-tree ph-tree--${sistema}`}>
      <div className="ph-tree__top">
        <div>
          <p className={`ph-tree__sis ph-tree__sis--${sistema}`}>{labelSis}</p>
          <h2 className="ph-tree__title">{rootTitle} — Operador Logístico</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {arvore[0] ? (
            <button type="button" className="ph-tree__btn" onClick={() => openEdit(arvore[0])}>
              Renomear
            </button>
          ) : null}
          <button
            type="button"
            className="ph-tree__btn ph-tree__btn--primary"
            onClick={() => openCreate(arvore[0] || null)}
          >
            + Adicionar Empresa
          </button>
        </div>
      </div>

      <div className="ph-tree__legend">
        {LEGENDA.map((l) => (
          <span key={l.tipo}>
            <i className={`ph-dot ph-dot--${l.tipo}`} /> {l.label}
          </span>
        ))}
      </div>

      {erro ? <p className="ph-tree__erro">{erro}</p> : null}
      {okMsg ? <p className="ph-tree__ok">{okMsg}</p> : null}

      {arvore.length === 0 ? (
        <p>Nenhuma empresa neste sistema. Clique em “Adicionar Empresa”.</p>
      ) : (
        arvore.map((no) => (
          <NodeRow
            key={no.id}
            no={no}
            onAdd={openCreate}
            onEdit={openEdit}
            onDelete={(n) => void handleDelete(n)}
          />
        ))
      )}

      {modal ? (
        <div className="ph-modal-backdrop" role="dialog" aria-modal="true">
          <div className="ph-modal">
            <h3>{modal.mode === 'create' ? 'Adicionar empresa' : 'Editar empresa'}</h3>
            {modal.mode === 'create' ? (
              <>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                  {labelSis}
                  {modal.parent ? ` · sob ${modal.parent.nome}` : ' · raiz'}
                </p>
                {modal.tipos.length > 1 ? (
                  <label>
                    Tipo
                    <select
                      value={tipoSel}
                      onChange={(e) => {
                        const t = e.target.value as OrgTipo
                        setTipoSel(t)
                        if (t !== 'embarcador') setIsFornecedor(false)
                      }}
                    >
                      {modal.tipos.map((t) => (
                        <option key={t} value={t}>
                          {labelTipo(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                    Tipo: <strong>{labelTipo(tipoSel)}</strong>
                  </p>
                )}
              </>
            ) : null}
            <label>
              Nome
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
            </label>
            <label>
              CNPJ
              <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
            </label>
            <label>
              Código (opcional)
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </label>
            {showFornecedor ? (
              <label className="ph-modal__check">
                <input
                  type="checkbox"
                  checked={isFornecedor}
                  onChange={(e) => setIsFornecedor(e.target.checked)}
                />
                Marcar como fornecedor
              </label>
            ) : null}
            {erro ? <p className="ph-tree__erro">{erro}</p> : null}
            <div className="ph-modal__actions">
              <button type="button" className="ph-tree__btn" onClick={() => setModal(null)} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="ph-tree__btn ph-tree__btn--primary"
                onClick={() => void handleSave()}
                disabled={saving || !nome.trim()}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
