import { parsePermissoesViewsFromDb } from './appPermissions'
import { formatUnknownError } from './supabaseError'
import { supabase } from './supabaseClient'

export type UsuarioComPermissoes = {
  id: string
  nome: string
  username: string
  ativo: boolean
  acessoAutorizado: boolean
  permissoesViews: string[] | null
  createdAt: string
}

export type MeuAcesso = {
  permissoesViews: string[] | null
  acessoAutorizado: boolean
}

function mapUsuarioRow(row: Record<string, unknown>): UsuarioComPermissoes {
  return {
    id: String(row.id ?? ''),
    nome: String(row.nome ?? '').trim(),
    username: String(row.username ?? '').trim(),
    ativo: row.ativo !== false,
    acessoAutorizado: row.acesso_autorizado === true,
    permissoesViews: parsePermissoesViewsFromDb(row.permissoes_views),
    createdAt: String(row.created_at ?? ''),
  }
}

/** Controle de acesso por tela foi desativado no Light (portal/SSO). Sempre libera. */
export async function fetchMeuAcesso(_userId: string): Promise<MeuAcesso> {
  return { permissoesViews: null, acessoAutorizado: true }
}

/** @deprecated use fetchMeuAcesso */
export async function fetchMinhasPermissoes(userId: string): Promise<string[] | null> {
  const acesso = await fetchMeuAcesso(userId)
  return acesso.permissoesViews
}

export async function fetchUsuariosComPermissoes(): Promise<UsuarioComPermissoes[]> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nome,username,ativo,permissoes_views,acesso_autorizado,created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao listar usuários.')
  return (data ?? []).map((r) => mapUsuarioRow(r as Record<string, unknown>))
}

export async function salvarPermissoesUsuario(
  usuarioId: string,
  views: string[] | null,
): Promise<void> {
  const payload =
    views == null
      ? { permissoes_views: null }
      : { permissoes_views: [...new Set(views.map((v) => v.trim()).filter(Boolean))] }
  const { error } = await supabase.from('usuarios').update(payload).eq('id', usuarioId)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao salvar permissões.')
}

export async function autorizarAcessoUsuario(
  usuarioId: string,
  views: string[] | null,
): Promise<void> {
  const permissoes =
    views == null ? null : [...new Set(views.map((v) => v.trim()).filter(Boolean))]
  const { error } = await supabase
    .from('usuarios')
    .update({
      acesso_autorizado: true,
      permissoes_views: permissoes,
    })
    .eq('id', usuarioId)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao autorizar acesso.')
}

export async function revogarAcessoUsuario(usuarioId: string): Promise<void> {
  const { error } = await supabase
    .from('usuarios')
    .update({
      acesso_autorizado: false,
      permissoes_views: [],
    })
    .eq('id', usuarioId)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao revogar acesso.')
}

export async function excluirUsuario(usuarioId: string): Promise<void> {
  const id = String(usuarioId ?? '').trim()
  if (!id) return
  const { error } = await supabase.from('usuarios').delete().eq('id', id)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao excluir usuário.')
}
