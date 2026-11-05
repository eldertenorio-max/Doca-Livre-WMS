import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ALL_MENU_VIEW_IDS, APP_MENU_PERMISSIONS } from '../lib/appPermissions'
import { isAppAdmin } from '../lib/authUser'
import { formatUnknownError } from '../lib/supabaseError'
import {
  conferenteCombinaUsuario,
  conferenteEhOrfao,
  ensureConferenteParaUsuario,
  excluirConferente,
  listConferentes,
  type Conferente,
} from '../lib/conferentesStore'
import {
  autorizarAcessoUsuario,
  excluirUsuario,
  fetchUsuariosComPermissoes,
  revogarAcessoUsuario,
  salvarPermissoesUsuario,
  type UsuarioComPermissoes,
} from '../lib/usuarioPermissoesStore'
import { PageInfoBlock, PagePanelHeading } from '../components/ui/PagePanelHeading'
import './PermissoesAcessoPage.css'

type Props = {
  session: Session | null
}

type DraftMap = Record<string, Set<string> | null>

function cloneDraftFromUsuarios(usuarios: UsuarioComPermissoes[]): DraftMap {
  const out: DraftMap = {}
  for (const u of usuarios) {
    out[u.id] = u.permissoesViews == null ? null : new Set(u.permissoesViews)
  }
  return out
}

function draftLabel(u: UsuarioComPermissoes, draft: Set<string> | null | undefined): string {
  if (!u.acessoAutorizado) return 'Aguardando autorização'
  if (draft == null) return 'Acesso total'
  if (draft.size === 0) return 'Nenhuma tela'
  return `${draft.size} tela(s)`
}

function sortUsuarios(lista: UsuarioComPermissoes[]): UsuarioComPermissoes[] {
  return [...lista].sort((a, b) => {
    if (a.acessoAutorizado !== b.acessoAutorizado) return a.acessoAutorizado ? 1 : -1
    return (b.createdAt || '').localeCompare(a.createdAt || '')
  })
}

export default function PermissoesAcessoPage({ session }: Props) {
  const admin = isAppAdmin(session)
  const [usuarios, setUsuarios] = useState<UsuarioComPermissoes[]>([])
  const [draft, setDraft] = useState<DraftMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [conferentes, setConferentes] = useState<Conferente[]>([])
  const [excluindoConferenteId, setExcluindoConferenteId] = useState<string | null>(null)

  const pendentesCount = useMemo(() => usuarios.filter((u) => !u.acessoAutorizado).length, [usuarios])

  const carregar = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [lista, confs] = await Promise.all([fetchUsuariosComPermissoes(), listConferentes()])
      const sorted = sortUsuarios(lista)
      setUsuarios(sorted)
      setConferentes(confs)
      setDraft(cloneDraftFromUsuarios(sorted))
      setSelectedId((prev) => {
        if (prev && sorted.some((u) => u.id === prev)) return prev
        const primeiroPendente = sorted.find((u) => !u.acessoAutorizado)
        return primeiroPendente?.id ?? sorted[0]?.id ?? null
      })
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (admin) void carregar()
    else setLoading(false)
  }, [admin, carregar])

  const selected = useMemo(
    () => usuarios.find((u) => u.id === selectedId) ?? null,
    [usuarios, selectedId],
  )

  const selectedDraft = selected ? draft[selected.id] : undefined

  function setSelectedDraft(next: Set<string> | null) {
    if (!selected) return
    setDraft((d) => ({ ...d, [selected.id]: next }))
  }

  function toggleView(viewId: string, checked: boolean) {
    if (!selected) return
    const current = draft[selected.id]
    if (current == null) {
      const base = new Set(ALL_MENU_VIEW_IDS)
      if (!checked) base.delete(viewId)
      setSelectedDraft(base)
      return
    }
    const next = new Set(current)
    if (checked) next.add(viewId)
    else next.delete(viewId)
    setSelectedDraft(next)
  }

  function marcarTodas() {
    setSelectedDraft(null)
  }

  function desmarcarTodas() {
    setSelectedDraft(new Set())
  }

  async function salvarAlteracoes() {
    if (!selected) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const views = draft[selected.id] ?? null
      const payload = views == null ? null : [...views]
      await salvarPermissoesUsuario(selected.id, payload)
      setUsuarios((list) =>
        list.map((u) => (u.id === selected.id ? { ...u, permissoesViews: payload } : u)),
      )
      setSuccess(`Permissões de ${selected.nome || selected.username} atualizadas.`)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function autorizarSelecionado() {
    if (!selected) return
    const views = draft[selected.id] ?? null
    const listaViews = views == null ? null : [...views]
    if (listaViews != null && listaViews.length === 0) {
      setError('Marque ao menos uma tela antes de autorizar o acesso.')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await ensureConferenteParaUsuario(selected.username)
      await autorizarAcessoUsuario(selected.id, listaViews)
      setUsuarios((list) =>
        sortUsuarios(
          list.map((u) =>
            u.id === selected.id
              ? { ...u, acessoAutorizado: true, permissoesViews: listaViews }
              : u,
          ),
        ),
      )
      setSuccess(`Acesso de ${selected.nome || selected.username} autorizado.`)
      const confs = await listConferentes()
      setConferentes(confs)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao autorizar.')
    } finally {
      setSaving(false)
    }
  }

  async function revogarSelecionado() {
    if (!selected || selected.id === session?.user?.id) return
    if (!confirm(`Revogar acesso de ${selected.nome || selected.username}?`)) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await revogarAcessoUsuario(selected.id)
      setDraft((d) => ({ ...d, [selected.id]: new Set() }))
      setUsuarios((list) =>
        sortUsuarios(
          list.map((u) =>
            u.id === selected.id ? { ...u, acessoAutorizado: false, permissoesViews: [] } : u,
          ),
        ),
      )
      setSuccess(`Acesso de ${selected.nome || selected.username} revogado.`)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao revogar.')
    } finally {
      setSaving(false)
    }
  }

  async function excluirSelecionado() {
    if (!selected || selected.id === session?.user?.id) return
    if (
      !confirm(
        `Excluir permanentemente o usuário ${selected.nome || selected.username}? Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await excluirUsuario(selected.id)
      setUsuarios((list) => list.filter((u) => u.id !== selected.id))
      setDraft((d) => {
        const next = { ...d }
        delete next[selected.id]
        return next
      })
      setSelectedId(null)
      setSuccess(`Usuário ${selected.nome || selected.username} excluído.`)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao excluir usuário.')
    } finally {
      setSaving(false)
    }
  }

  async function excluirConferenteOrfao(conf: Conferente) {
    if (!conferenteEhOrfao(conf, usuarios)) {
      setError('Só é possível excluir conferentes sem usuário com o mesmo login.')
      return
    }
    if (!confirm(`Excluir conferente "${conf.nome}"?`)) return
    setExcluindoConferenteId(conf.id)
    setError('')
    try {
      await excluirConferente(conf.id)
      setConferentes((list) => list.filter((c) => c.id !== conf.id))
      setSuccess(`Conferente "${conf.nome}" excluído.`)
    } catch (e: unknown) {
      setError(formatUnknownError(e) || 'Erro ao excluir conferente.')
    } finally {
      setExcluindoConferenteId(null)
    }
  }

  if (!admin) {
    return (
      <div className="page-panel">
        <p className="page-msg page-msg--error">Acesso restrito ao administrador.</p>
      </div>
    )
  }

  const grupos = [...new Set(APP_MENU_PERMISSIONS.map((p) => p.group).filter(Boolean))] as string[]

  return (
    <div className="page-panel page-panel--wide permissoes-page">
      <PagePanelHeading
        title="Permissões de acesso"
        info={
          <>
            <PageInfoBlock>
              Novos cadastros aparecem como <strong>aguardando autorização</strong>. Selecione o usuário,
              marque as telas permitidas e clique em <strong>Autorizar acesso</strong>.
            </PageInfoBlock>
            <PageInfoBlock>
              O nome do <strong>conferente</strong> deve ser igual ao <strong>login</strong> do usuário
              (ex.: usuário <code>alex</code> → conferente <code>alex</code>). Ao autorizar, o conferente é
              criado automaticamente.
            </PageInfoBlock>
            <PageInfoBlock title="SQL">
              Execute <code>alter_usuarios_permissoes_views.sql</code>,{' '}
              <code>alter_usuarios_acesso_pendente.sql</code> e <code>alter_usuarios_admin_delete.sql</code> no
              Supabase.
            </PageInfoBlock>
          </>
        }
      />

      {pendentesCount > 0 ? (
        <p className="permissoes-page__pendentes">
          {pendentesCount} cadastro(s) aguardando sua autorização.
        </p>
      ) : null}

      {error ? <p className="page-msg page-msg--error">{error}</p> : null}
      {success ? <p className="page-msg page-msg--ok">{success}</p> : null}

      <div className="permissoes-page__layout">
        <section className="permissoes-page__lista" aria-label="Usuários cadastrados">
          <div className="permissoes-page__lista-head">
            <h2 className="permissoes-page__subtitle">Usuários</h2>
            <button type="button" className="page-btn-ghost" disabled={loading} onClick={() => void carregar()}>
              Atualizar
            </button>
          </div>
          {loading ? (
            <p className="permissoes-page__hint">Carregando…</p>
          ) : usuarios.length === 0 ? (
            <p className="permissoes-page__hint">Nenhum usuário encontrado.</p>
          ) : (
            <ul className="permissoes-page__users">
              {usuarios.map((u) => {
                const isSelf = session?.user?.id === u.id
                const active = u.id === selectedId
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      className={`permissoes-page__user-btn${active ? ' permissoes-page__user-btn--active' : ''}${!u.acessoAutorizado ? ' permissoes-page__user-btn--pendente' : ''}`}
                      onClick={() => setSelectedId(u.id)}
                    >
                      <span className="permissoes-page__user-nome">
                        {u.nome || u.username || '—'}
                        {isSelf ? ' (você)' : ''}
                        {!u.acessoAutorizado ? (
                          <span className="permissoes-page__badge">Pendente</span>
                        ) : null}
                      </span>
                      <span className="permissoes-page__user-meta">
                        @{u.username || '—'} · {draftLabel(u, draft[u.id])}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="permissoes-page__editor" aria-label="Telas permitidas">
          {!selected ? (
            <p className="permissoes-page__hint">Selecione um usuário à esquerda.</p>
          ) : (
            <>
              <div className="permissoes-page__editor-head">
                <div>
                  <h2 className="permissoes-page__subtitle">{selected.nome || selected.username}</h2>
                  <p className="permissoes-page__hint">
                    Login: <strong>{selected.username || '—'}</strong> · {draftLabel(selected, selectedDraft)}
                  </p>
                </div>
                <div className="permissoes-page__editor-actions">
                  <button type="button" className="page-btn-ghost" onClick={marcarTodas}>
                    Acesso total
                  </button>
                  <button type="button" className="page-btn-ghost" onClick={desmarcarTodas}>
                    Nenhuma
                  </button>
                  {!selected.acessoAutorizado ? (
                    <button type="button" disabled={saving} onClick={() => void autorizarSelecionado()}>
                      {saving ? 'Autorizando…' : 'Autorizar acesso'}
                    </button>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => void salvarAlteracoes()}>
                      {saving ? 'Salvando…' : 'Salvar alterações'}
                    </button>
                  )}
                  {selected.acessoAutorizado && selected.id !== session?.user?.id ? (
                    <button
                      type="button"
                      className="page-btn-ghost permissoes-page__revogar"
                      disabled={saving}
                      onClick={() => void revogarSelecionado()}
                    >
                      Revogar acesso
                    </button>
                  ) : null}
                  {selected.id !== session?.user?.id ? (
                    <button
                      type="button"
                      className="page-btn-ghost permissoes-page__excluir"
                      disabled={saving}
                      onClick={() => void excluirSelecionado()}
                    >
                      Excluir usuário
                    </button>
                  ) : null}
                </div>
              </div>

              {selected.username ? (
                <p className="permissoes-page__hint permissoes-page__conferente-hint">
                  Conferente vinculado: <strong>{selected.username.toLowerCase()}</strong>
                  {conferentes.some((c) => conferenteCombinaUsuario(c.nome, selected.username)) ? (
                    <span className="permissoes-page__ok-tag"> · cadastrado</span>
                  ) : (
                    <span className="permissoes-page__warn-tag"> · será criado ao autorizar</span>
                  )}
                </p>
              ) : null}

              <div className="permissoes-page__checks">
                {grupos.map((grupo) => (
                  <fieldset key={grupo} className="permissoes-page__fieldset">
                    <legend>{grupo}</legend>
                    <div className="permissoes-page__check-grid">
                      {APP_MENU_PERMISSIONS.filter((p) => p.group === grupo).map((p) => {
                        const checked = selectedDraft == null ? true : selectedDraft.has(p.id)
                        return (
                          <label key={p.id} className="permissoes-page__check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleView(p.id, e.target.checked)}
                            />
                            <span>{p.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                ))}

                <fieldset className="permissoes-page__fieldset">
                  <legend>Operação</legend>
                  <div className="permissoes-page__check-grid">
                    {APP_MENU_PERMISSIONS.filter((p) => !p.group).map((p) => {
                      const checked = selectedDraft == null ? true : selectedDraft.has(p.id)
                      return (
                        <label key={p.id} className="permissoes-page__check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleView(p.id, e.target.checked)}
                          />
                          <span>{p.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="permissoes-page__conferentes" aria-label="Conferentes cadastrados">
        <div className="permissoes-page__lista-head">
          <h2 className="permissoes-page__subtitle">Conferentes cadastrados</h2>
        </div>
        <p className="permissoes-page__hint">
          Conferentes sem usuário com o mesmo login podem ser excluídos. Daqui pra frente o nome do conferente deve
          ser igual ao login.
        </p>
        <div className="page-table-wrap">
          <table className="page-table page-table--compact">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Usuário</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3}>Carregando…</td>
                </tr>
              ) : conferentes.length === 0 ? (
                <tr>
                  <td colSpan={3}>Nenhum conferente cadastrado.</td>
                </tr>
              ) : (
                conferentes.map((c) => {
                  const usuario = usuarios.find((u) => conferenteCombinaUsuario(c.nome, u.username))
                  const orfao = conferenteEhOrfao(c, usuarios)
                  return (
                    <tr key={c.id} className={orfao ? 'permissoes-page__conf-orfao' : ''}>
                      <td>{c.nome}</td>
                      <td>
                        {usuario ? (
                          <span>@{usuario.username}</span>
                        ) : orfao ? (
                          <span className="permissoes-page__warn-tag">Sem usuário</span>
                        ) : (
                          <span className="permissoes-page__ok-tag">OK</span>
                        )}
                      </td>
                      <td>
                        {orfao ? (
                          <button
                            type="button"
                            className="page-btn-ghost permissoes-page__excluir"
                            disabled={excluindoConferenteId === c.id}
                            onClick={() => void excluirConferenteOrfao(c)}
                          >
                            {excluindoConferenteId === c.id ? 'Excluindo…' : 'Excluir'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
