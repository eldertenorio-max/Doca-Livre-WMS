import { useCallback, useEffect, useMemo, useState } from 'react'
import PortalHierarchyGroups from '../components/PortalHierarchyGroups'
import PortalHierarchyTree from '../components/PortalHierarchyTree'
import {
  fetchPortalConfigOverview,
  isLocalSuperUser,
  normalizeModulosMap,
  savePortalHierarquiaUsuario,
  savePortalPermissoes,
  type ModuloAcesso,
  type OrgNo,
  type PortalConfigOverview,
  type PortalUsuarioRow,
  type SistemaId,
  type SistemaPermissao,
} from '../lib/portalConfigApi'
import './PortalConfigScreen.css'

function flattenOrg(nodes: OrgNo[], acc: OrgNo[] = []): OrgNo[] {
  for (const n of nodes) {
    acc.push(n)
    if (n.children?.length) flattenOrg(n.children, acc)
  }
  return acc
}

type Props = {
  usuario: string
  onContinuar: () => void
  onSair: () => void
}

const SISTEMA_LABEL: Record<SistemaId, string> = {
  light: 'WMS Light',
  plus: 'WMS Plus',
  pro: 'WMS Pro',
}

const SISTEMA_HINT: Record<SistemaId, string> = {
  light: 'Estoque · inventário · endereçamento',
  plus: 'Entrada · saída · consulta · financeiro',
  pro: 'Carga · retorno · descarga · WMS',
}

function isHiddenConfigUser(u: PortalUsuarioRow): boolean {
  return Boolean(u.is_superuser) || isLocalSuperUser(u.usuario) || isLocalSuperUser(u.email || '')
}

function userInitials(nome: string): string {
  const parts = (nome || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function countSistemasLiberados(
  matriz: Record<SistemaId, SistemaPermissao> | null | undefined,
): number {
  if (!matriz) return 0
  return (['light', 'plus', 'pro'] as SistemaId[]).filter((s) => matriz[s]?.pode_acessar !== false)
    .length
}

export default function PortalConfigScreen({ usuario, onContinuar, onSair }: Props) {
  const [tab, setTab] = useState<'hierarquia' | 'permissoes'>('hierarquia')
  const [hierSistema, setHierSistema] = useState<SistemaId>('plus')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [data, setData] = useState<PortalConfigOverview | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [filtroUser, setFiltroUser] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    const res = await fetchPortalConfigOverview()
    setLoading(false)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    // Normaliza mapas de módulos (legado lista → editar).
    const matrizNorm: PortalConfigOverview['matriz'] = {}
    for (const [user, sisMap] of Object.entries(res.matriz || {})) {
      matrizNorm[user] = {
        light: {
          pode_acessar: sisMap.light?.pode_acessar !== false,
          modulos: normalizeModulosMap(sisMap.light?.modulos as never),
        },
        plus: {
          pode_acessar: sisMap.plus?.pode_acessar !== false,
          modulos: normalizeModulosMap(sisMap.plus?.modulos as never),
        },
        pro: {
          pode_acessar: sisMap.pro?.pode_acessar !== false,
          modulos: normalizeModulosMap(sisMap.pro?.modulos as never),
        },
      }
    }
    setData({ ...res, matriz: matrizNorm })
    const editaveis = res.usuarios.filter((u) => !isHiddenConfigUser(u))
    setSelected((prev) => {
      if (prev && editaveis.some((u) => u.usuario === prev)) return prev
      return editaveis[0]?.usuario || ''
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!okMsg) return
    const t = window.setTimeout(() => setOkMsg(null), 4000)
    return () => window.clearTimeout(t)
  }, [okMsg])

  const usuariosEditaveis = useMemo(
    () => (data?.usuarios || []).filter((u) => !isHiddenConfigUser(u)),
    [data],
  )

  const usuariosFiltrados = useMemo(() => {
    const q = filtroUser.trim().toLowerCase()
    if (!q) return usuariosEditaveis
    return usuariosEditaveis.filter(
      (u) =>
        u.usuario.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.nivel || '').toLowerCase().includes(q),
    )
  }, [usuariosEditaveis, filtroUser])

  const selectedUser = useMemo(
    () => usuariosEditaveis.find((u) => u.usuario === selected) || null,
    [usuariosEditaveis, selected],
  )

  const perms = useMemo(() => {
    if (!data || !selected) return null
    return data.matriz[selected] || null
  }, [data, selected])

  async function handleSavePermissoes() {
    if (!selected || !perms) return
    setSaving(true)
    setErro(null)
    setOkMsg(null)
    const res = await savePortalPermissoes(selected, perms as Record<SistemaId, SistemaPermissao>)
    setSaving(false)
    if (!res.ok) {
      setErro(res.erro)
      return
    }
    setOkMsg('Permissões salvas com sucesso.')
    void load()
  }

  function patchSistema(sistema: SistemaId, patch: Partial<SistemaPermissao>) {
    if (!data || !selected) return
    const atual = data.matriz[selected] || {
      light: { pode_acessar: true, modulos: null },
      plus: { pode_acessar: true, modulos: null },
      pro: { pode_acessar: true, modulos: null },
    }
    const bloco = { ...(atual[sistema] || { pode_acessar: true, modulos: null }), ...patch }
    setData({
      ...data,
      matriz: {
        ...data.matriz,
        [selected]: { ...atual, [sistema]: bloco },
      },
    })
  }

  function acessoModulo(sistema: SistemaId, modId: string): ModuloAcesso | 'bloqueado' {
    if (!perms) return 'bloqueado'
    const bloco = perms[sistema] || { pode_acessar: true, modulos: null }
    const map = normalizeModulosMap(bloco.modulos as never)
    if (map == null) return 'editar'
    return map[modId] || 'bloqueado'
  }

  function setModuloAcesso(sistema: SistemaId, modId: string, acesso: ModuloAcesso | 'bloqueado') {
    if (!data || !selected || !perms) return
    const bloco = perms[sistema] || { pode_acessar: true, modulos: null }
    const modsCat = data.modulos[sistema] || []
    const allIds = modsCat.map((m) => m.id)
    let map = normalizeModulosMap(bloco.modulos as never)
    if (map == null) {
      map = Object.fromEntries(allIds.map((id) => [id, 'editar' as ModuloAcesso]))
    } else {
      map = { ...map }
    }
    if (acesso === 'bloqueado') {
      delete map[modId]
    } else {
      map[modId] = acesso
    }
    const next =
      allIds.length > 0 &&
      allIds.every((id) => map![id] === 'editar') &&
      Object.keys(map).length === allIds.length
        ? null
        : map
    patchSistema(sistema, { modulos: next })
  }

  function setAllModulos(sistema: SistemaId, modo: 'editar' | 'visualizar' | 'nenhuma') {
    if (!data) return
    if (modo === 'nenhuma') {
      patchSistema(sistema, { modulos: {} })
      return
    }
    if (modo === 'editar') {
      patchSistema(sistema, { modulos: null })
      return
    }
    const mods = data.modulos[sistema] || []
    const map: Record<string, ModuloAcesso> = {}
    for (const m of mods) map[m.id] = 'visualizar'
    patchSistema(sistema, { modulos: map })
  }

  if (loading && !data) {
    return <div className="portal-config__loading">Carregando configuração do portal…</div>
  }

  return (
    <div className="portal-config" role="main">
      <div className={`portal-config__shell${tab === 'hierarquia' ? ' portal-config__shell--wide' : ''}`}>
        <header className="portal-config__header">
          <div>
            <h1 className="portal-config__title">Configuração do portal</h1>
            <p className="portal-config__sub">
              Super Usuário <strong>{usuario}</strong> — hierarquia e permissões dos sistemas Light, Plus e
              Pro
            </p>
          </div>
          <div className="portal-config__actions">
            <button type="button" className="portal-config__btn" onClick={onSair}>
              Sair
            </button>
            <button type="button" className="portal-config__btn portal-config__btn--primary" onClick={onContinuar}>
              Ir aos sistemas
            </button>
          </div>
        </header>

        <div className="portal-config__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`portal-config__tab${tab === 'hierarquia' ? ' portal-config__tab--active' : ''}`}
            onClick={() => setTab('hierarquia')}
          >
            Hierarquia
          </button>
          <button
            type="button"
            role="tab"
            className={`portal-config__tab${tab === 'permissoes' ? ' portal-config__tab--active' : ''}`}
            onClick={() => setTab('permissoes')}
          >
            Permissões de acesso
          </button>
        </div>

        {erro ? <p className="portal-config__erro">{erro}</p> : null}

        {!data ? (
          <div>
            <p className="portal-config__erro">Não foi possível carregar os dados.</p>
            <button type="button" className="portal-config__btn portal-config__btn--primary" onClick={() => void load()}>
              Recarregar
            </button>
          </div>
        ) : tab === 'hierarquia' ? (
          <section className="portal-config__panel portal-config__panel--full">
            <div className="portal-config__hier-tabs" role="tablist" aria-label="Sistema da hierarquia">
              {([
                ['light', 'WMS Light'],
                ['plus', 'WMS Plus'],
                ['pro', 'WMS Pro'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={`portal-config__hier-tab portal-config__hier-tab--${id}${hierSistema === id ? ' portal-config__hier-tab--active' : ''}`}
                  aria-selected={hierSistema === id}
                  onClick={() => setHierSistema(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <PortalHierarchyTree
              sistema={hierSistema}
              sistemaLabel={
                hierSistema === 'light' ? 'WMS Light' : hierSistema === 'pro' ? 'WMS Pro' : 'WMS Plus'
              }
              arvore={
                data.arvores?.[hierSistema] ||
                (hierSistema === 'plus' ? data.arvore || [] : [])
              }
              onChanged={() => void load()}
            />
            <PortalHierarchyGroups
              sistema={hierSistema}
              grupos={data.grupos?.[hierSistema] || []}
              empresas={
                data.arvores?.[hierSistema] ||
                (hierSistema === 'plus' ? data.arvore || [] : [])
              }
              onChanged={() => void load()}
            />
          </section>
        ) : (
          <div className="portal-config__body portal-config__body--perms">
            <aside className="portal-config__list" aria-label="Usuários">
              <div className="portal-config__list-head">
                <div className="portal-config__list-title">
                  <strong>Usuários</strong>
                  <span className="portal-config__list-count">{usuariosEditaveis.length}</span>
                </div>
                <input
                  type="search"
                  className="portal-config__search"
                  placeholder="Buscar nome ou e-mail…"
                  value={filtroUser}
                  onChange={(e) => setFiltroUser(e.target.value)}
                  aria-label="Buscar usuário"
                />
              </div>
              {usuariosFiltrados.length === 0 ? (
                <p className="portal-config__empty">
                  {usuariosEditaveis.length === 0
                    ? 'Nenhum usuário para configurar ainda.'
                    : 'Nenhum resultado na busca.'}
                </p>
              ) : (
                <div className="portal-config__user-scroll">
                  {usuariosFiltrados.map((u) => {
                    const nSis = countSistemasLiberados(data.matriz[u.usuario])
                    return (
                      <button
                        key={u.usuario}
                        type="button"
                        className={`portal-config__user${selected === u.usuario ? ' portal-config__user--active' : ''}`}
                        onClick={() => {
                          setSelected(u.usuario)
                          setOkMsg(null)
                          setErro(null)
                        }}
                      >
                        <span className="portal-config__avatar" aria-hidden>
                          {userInitials(u.usuario)}
                        </span>
                        <span className="portal-config__user-text">
                          <span className="portal-config__user-name">{u.usuario}</span>
                          <span className="portal-config__user-meta">
                            {u.email || u.nivel || 'Sem e-mail'}
                          </span>
                        </span>
                        <span
                          className={`portal-config__user-badge${nSis === 0 ? ' portal-config__user-badge--off' : ''}`}
                          title={`${nSis} sistema(s) liberado(s)`}
                        >
                          {nSis}/3
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </aside>

            <section className="portal-config__panel portal-config__panel--perms">
              {!selectedUser ? (
                <div className="portal-config__empty-panel">
                  <p>
                    {usuariosEditaveis.length === 0
                      ? 'Cadastre outros usuários no portal para definir permissões.'
                      : 'Selecione um usuário à esquerda.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="portal-config__perms-hero">
                    <span className="portal-config__avatar portal-config__avatar--lg" aria-hidden>
                      {userInitials(selectedUser.usuario)}
                    </span>
                    <div>
                      <h2 className="portal-config__perms-title">{selectedUser.usuario}</h2>
                      <p className="portal-config__sub">
                        {selectedUser.email ? selectedUser.email : 'Sem e-mail'}
                        {selectedUser.nivel ? ` · ${selectedUser.nivel}` : ''}
                      </p>
                    </div>
                  </div>
                  <p className="portal-config__perms-hint">
                    Escolha os sistemas liberados e, em cada tela, se a pessoa pode só{' '}
                    <strong>visualizar</strong> ou também <strong>editar</strong>.
                  </p>

                  <div className="portal-config__empresa-org">
                    <label>
                      Empresa na hierarquia (ponto de partida da visibilidade)
                      <select
                        value={selectedUser.empresa_org_id || ''}
                        onChange={(e) => {
                          const empresa_org_id = e.target.value || null
                          void (async () => {
                            setErro(null)
                            setOkMsg(null)
                            const res = await savePortalHierarquiaUsuario({
                              usuario: selectedUser.usuario,
                              empresa_org_id,
                            })
                            if (!res.ok) {
                              setErro(res.erro)
                              return
                            }
                            setOkMsg('Empresa organizacional vinculada.')
                            void load()
                          })()
                        }}
                      >
                        <option value="">Sem vínculo</option>
                        {flattenOrg(
                          data.arvores?.plus ||
                            data.arvore ||
                            data.arvores?.light ||
                            data.arvores?.pro ||
                            [],
                        ).map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.nome} ({n.label_tipo || n.tipo})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="portal-config__sistemas">
                    {(['light', 'plus', 'pro'] as SistemaId[]).map((sistema) => {
                      const bloco = perms?.[sistema] || { pode_acessar: true, modulos: null }
                      const mods = data.modulos[sistema] || []
                      const map = normalizeModulosMap(bloco.modulos as never)
                      const liberados =
                        map == null ? mods.length : Object.keys(map).filter((id) => mods.some((m) => m.id === id)).length
                      const nEdit =
                        map == null
                          ? mods.length
                          : Object.values(map).filter((a) => a === 'editar').length
                      const nView =
                        map == null ? 0 : Object.values(map).filter((a) => a === 'visualizar').length
                      return (
                        <article
                          key={sistema}
                          className={`portal-config__sistema portal-config__sistema--${sistema}${bloco.pode_acessar ? '' : ' portal-config__sistema--off'}`}
                        >
                          <div className="portal-config__sistema-head">
                            <div className="portal-config__sistema-titles">
                              <span className={`portal-config__sis-pill portal-config__sis-pill--${sistema}`}>
                                {sistema}
                              </span>
                              <div>
                                <strong>{SISTEMA_LABEL[sistema]}</strong>
                                <p className="portal-config__sis-hint">{SISTEMA_HINT[sistema]}</p>
                              </div>
                            </div>
                            <label className="portal-config__switch">
                              <input
                                type="checkbox"
                                checked={bloco.pode_acessar}
                                onChange={(e) => patchSistema(sistema, { pode_acessar: e.target.checked })}
                              />
                              <span className="portal-config__switch-ui" aria-hidden />
                              <span className="portal-config__switch-label">
                                {bloco.pode_acessar ? 'Acesso liberado' : 'Bloqueado'}
                              </span>
                            </label>
                          </div>

                          {bloco.pode_acessar ? (
                            <>
                              <div className="portal-config__mods-toolbar">
                                <span className="portal-config__mods-count">
                                  {liberados}/{mods.length} telas
                                  {map == null
                                    ? ' · todas editar'
                                    : ` · ${nEdit} editar · ${nView} visualizar`}
                                </span>
                                <div className="portal-config__mods-actions">
                                  <button
                                    type="button"
                                    className="portal-config__link-btn"
                                    onClick={() => setAllModulos(sistema, 'editar')}
                                  >
                                    Todas editar
                                  </button>
                                  <button
                                    type="button"
                                    className="portal-config__link-btn"
                                    onClick={() => setAllModulos(sistema, 'visualizar')}
                                  >
                                    Todas visualizar
                                  </button>
                                  <button
                                    type="button"
                                    className="portal-config__link-btn"
                                    onClick={() => setAllModulos(sistema, 'nenhuma')}
                                  >
                                    Nenhuma
                                  </button>
                                </div>
                              </div>
                              <div className="portal-config__mod-rows">
                                {mods.map((m) => {
                                  const acesso = acessoModulo(sistema, m.id)
                                  return (
                                    <div key={m.id} className="portal-config__mod-row">
                                      <span className="portal-config__mod-name">{m.label}</span>
                                      <div
                                        className="portal-config__seg"
                                        role="group"
                                        aria-label={`Acesso a ${m.label}`}
                                      >
                                        {(
                                          [
                                            ['bloqueado', 'Sem acesso'],
                                            ['visualizar', 'Visualizar'],
                                            ['editar', 'Editar'],
                                          ] as const
                                        ).map(([val, label]) => (
                                          <button
                                            key={val}
                                            type="button"
                                            className={`portal-config__seg-btn${acesso === val ? ` portal-config__seg-btn--${val}` : ''}`}
                                            aria-pressed={acesso === val}
                                            onClick={() => setModuloAcesso(sistema, m.id, val)}
                                          >
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          ) : (
                            <p className="portal-config__blocked">
                              Sistema oculto no hub. Ative o acesso acima para liberar as telas.
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>

                  <div className="portal-config__save-bar">
                    {okMsg ? (
                      <p className="portal-config__msg portal-config__msg--ok" role="status">
                        {okMsg}
                      </p>
                    ) : (
                      <span className="portal-config__save-spacer" aria-hidden />
                    )}
                    <button
                      type="button"
                      className="portal-config__btn portal-config__btn--primary portal-config__btn--save"
                      disabled={saving}
                      onClick={() => void handleSavePermissoes()}
                    >
                      {saving ? 'Salvando…' : 'Salvar permissões'}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
