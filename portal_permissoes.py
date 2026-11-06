"""Permissões e hierarquia do portal (Super Usuários Elder/Diego)."""
from __future__ import annotations

import json
import os
from typing import Any

# Super usuários fixos do portal (login = coluna usuarios.usuario).
# Nomes com espaço/acento (Elder Tenório, Diego Isidoro) também contam.
PORTAL_SUPERUSERS = {
    n.strip().lower()
    for n in (
        os.environ.get('PORTAL_SUPERUSERS')
        or 'Diego,Elder,diego,elder,diego.isidoro,elder.tenorio,diego isidoro,elder tenório,elder tenorio'
    ).split(',')
    if n.strip()
}

# Logins em formato de e-mail só contam como Super Usuário nestes domínios.
PORTAL_SUPERUSER_DOMINIOS = {
    d.strip().lower()
    for d in (os.environ.get('PORTAL_SUPERUSER_DOMINIOS') or 'docalivre.com.br').split(',')
    if d.strip()
}

SISTEMAS = ('light', 'plus', 'pro')

PORTAL_MODULOS_CATALOGO: dict[str, list[dict[str, str]]] = {
    'light': [
        {'id': 'painel', 'label': 'Painel'},
        {'id': 'produtosFamilia', 'label': 'Produtos · Família'},
        {'id': 'produtosGrupos', 'label': 'Produtos · Grupos'},
        {'id': 'produtosImportacao', 'label': 'Produtos · Importação'},
        {'id': 'produtos', 'label': 'Produtos'},
        {'id': 'produtosSubGrupos', 'label': 'Produtos · SubGrupos'},
        {'id': 'temperatura', 'label': 'Temperatura'},
        {'id': 'ocupacao', 'label': 'Ocupação'},
        {'id': 'seguranca', 'label': 'Estoque de segurança'},
        {'id': 'enderecamento', 'label': 'Endereçamento'},
        {'id': 'inventarios', 'label': 'Inventários'},
        {'id': 'contagem', 'label': 'Contagem diária'},
        {'id': 'estoque', 'label': 'Estoque'},
        {'id': 'agendamentos', 'label': 'Agendamentos'},
    ],
    'plus': [
        {'id': 'consulta', 'label': 'Consulta'},
        {'id': 'entrada', 'label': 'Entrada'},
        {'id': 'agendamentosHub', 'label': 'Agendamentos'},
        {'id': 'saida', 'label': 'Saída'},
        {'id': 'editar', 'label': 'Editar posição'},
        {'id': 'canceladas', 'label': 'Canceladas'},
        {'id': 'historico', 'label': 'Histórico'},
        {'id': 'relatorio', 'label': 'Relatório'},
        {'id': 'painel', 'label': 'Painel'},
        {'id': 'financeiro', 'label': 'Financeiro'},
        {'id': 'cadastroVoz', 'label': 'Cadastro de voz'},
        {'id': 'imprimir', 'label': 'Imprimir'},
    ],
    'pro': [
        {'id': 'carregamento', 'label': 'Carga/Expedição'},
        {'id': 'devolucoes', 'label': 'Retorno'},
        {'id': 'terceiros', 'label': 'Descarga/Recebimento'},
        {'id': 'estoque-sp', 'label': 'Estoque'},
        {'id': 'enderecamento-wms', 'label': 'Endereçamento WMS'},
    ],
}

NIVEIS_PADRAO = [
    {'id': 'super', 'label': 'Super Usuário', 'ordem': 1},
    {'id': 'gestor', 'label': 'Gestor', 'ordem': 2},
    {'id': 'operador', 'label': 'Operador', 'ordem': 3},
]


def normalize_usuario(raw: str) -> str:
    return (raw or '').strip().lower()


def is_portal_superuser(usuario: str) -> bool:
    u = normalize_usuario(usuario)
    if not u:
        return False
    if u in PORTAL_SUPERUSERS:
        return True
    # Remove acentos simples para comparar "tenório" ~ "tenorio"
    u_ascii = (
        u.replace('á', 'a')
        .replace('à', 'a')
        .replace('ã', 'a')
        .replace('â', 'a')
        .replace('é', 'e')
        .replace('ê', 'e')
        .replace('í', 'i')
        .replace('ó', 'o')
        .replace('ô', 'o')
        .replace('õ', 'o')
        .replace('ú', 'u')
        .replace('ç', 'c')
    )
    if u_ascii in PORTAL_SUPERUSERS:
        return True
    # Somente correspondência EXATA. Não usar prefixo (startswith): antes qualquer login
    # iniciado por "diego"/"elder" (ex.: "diegoqualquer") virava Super Usuário.
    if '@' in u_ascii:
        # Login em formato de e-mail: só vale o domínio da empresa (diego@qualquer.com NÃO é super).
        local_ascii, dominio = u_ascii.split('@', 1)
        if dominio not in PORTAL_SUPERUSER_DOMINIOS:
            return False
        if local_ascii in PORTAL_SUPERUSERS:
            return True
    else:
        local_ascii = u_ascii
    compact = local_ascii.replace('.', '').replace(' ', '')
    return compact in {'diegoisidoro', 'eldertenorio'}


def ensure_portal_permissoes_schema(conn) -> None:
    kind = getattr(conn, 'kind', 'sqlite')
    if kind == 'pg':
        try:
            conn.execute('ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS nivel_hierarquia TEXT')
            conn.execute('ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS superior_usuario TEXT')
            conn.execute('ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS empresa_org_id TEXT')
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS public.portal_hierarquia_niveis (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                ordem INTEGER NOT NULL DEFAULT 100
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS public.portal_permissoes (
                id BIGSERIAL PRIMARY KEY,
                usuario TEXT NOT NULL,
                sistema TEXT NOT NULL,
                pode_acessar BOOLEAN NOT NULL DEFAULT TRUE,
                modulos JSONB,
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_por TEXT,
                UNIQUE (usuario, sistema)
            )'''
        )
        try:
            conn.execute(
                'CREATE INDEX IF NOT EXISTS idx_portal_permissoes_usuario ON public.portal_permissoes (lower(usuario))'
            )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    else:
        try:
            cols = {r[1] for r in conn.execute('PRAGMA table_info(usuarios)').fetchall()}
            if 'nivel_hierarquia' not in cols:
                conn.execute('ALTER TABLE usuarios ADD COLUMN nivel_hierarquia TEXT')
            if 'superior_usuario' not in cols:
                conn.execute('ALTER TABLE usuarios ADD COLUMN superior_usuario TEXT')
            if 'empresa_org_id' not in cols:
                conn.execute('ALTER TABLE usuarios ADD COLUMN empresa_org_id TEXT')
            conn.commit()
        except Exception:
            pass
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS portal_hierarquia_niveis (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                ordem INTEGER NOT NULL DEFAULT 100
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS portal_permissoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario TEXT NOT NULL,
                sistema TEXT NOT NULL,
                pode_acessar INTEGER NOT NULL DEFAULT 1,
                modulos TEXT,
                atualizado_em TEXT,
                atualizado_por TEXT,
                UNIQUE (usuario, sistema)
            )'''
        )
        try:
            conn.commit()
        except Exception:
            pass

    for n in NIVEIS_PADRAO:
        try:
            if kind == 'pg':
                conn.execute(
                    '''INSERT INTO public.portal_hierarquia_niveis (id, label, ordem)
                       VALUES (?, ?, ?)
                       ON CONFLICT (id) DO NOTHING''',
                    (n['id'], n['label'], n['ordem']),
                )
            else:
                conn.execute(
                    'INSERT OR IGNORE INTO portal_hierarquia_niveis (id, label, ordem) VALUES (?, ?, ?)',
                    (n['id'], n['label'], n['ordem']),
                )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass

    for su in ('Diego', 'Elder'):
        try:
            conn.execute(
                '''UPDATE usuarios
                   SET nivel_hierarquia = COALESCE(NULLIF(nivel_hierarquia, ''), 'super')
                   WHERE lower(usuario) = lower(?)''',
                (su,),
            )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    try:
        conn.commit()
    except Exception:
        pass


def _normalize_acesso(raw: Any) -> str | None:
    v = str(raw or '').strip().lower()
    if v in ('visualizar', 'view', 'leitura', 'read', 'ver'):
        return 'visualizar'
    if v in ('editar', 'edit', 'escrita', 'write', 'full', 'completo'):
        return 'editar'
    return None


def _modulos_from_db(raw: Any) -> dict[str, str] | None:
    """Retorna mapa id→acesso (visualizar|editar), ou None = todas as telas com editar.

    Formatos aceitos (legado + novo):
      null
      ["consulta", "entrada"]                      → todos editar
      [{"id": "consulta", "acesso": "visualizar"}]
      {"consulta": "visualizar", "entrada": "editar"}
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return {}
        if raw is None:
            return None
    if isinstance(raw, dict):
        out: dict[str, str] = {}
        for k, v in raw.items():
            mid = str(k).strip()
            if not mid:
                continue
            # Objeto aninhado legado
            if isinstance(v, dict):
                acesso = _normalize_acesso(v.get('acesso') or v.get('modo') or v.get('level'))
            else:
                acesso = _normalize_acesso(v)
            out[mid] = acesso or 'editar'
        return out
    if isinstance(raw, list):
        out = {}
        for item in raw:
            if isinstance(item, dict):
                mid = str(item.get('id') or item.get('modulo') or '').strip()
                acesso = _normalize_acesso(item.get('acesso') or item.get('modo') or 'editar')
                if mid:
                    out[mid] = acesso or 'editar'
            else:
                mid = str(item).strip()
                if mid:
                    out[mid] = 'editar'
        return out
    return {}


def _modulos_to_db(mods: Any) -> Any:
    """Normaliza payload do cliente para gravar (null ou dict id→acesso)."""
    if mods is None:
        return None
    parsed = _modulos_from_db(mods)
    if parsed is None:
        return None
    return parsed


def listar_niveis(conn) -> list[dict[str, Any]]:
    try:
        rows = conn.execute(
            'SELECT id, label, ordem FROM portal_hierarquia_niveis ORDER BY ordem ASC, label ASC'
        ).fetchall()
    except Exception:
        return list(NIVEIS_PADRAO)
    out = []
    for r in rows:
        out.append({'id': r['id'], 'label': r['label'], 'ordem': int(r['ordem'] or 100)})
    return out or list(NIVEIS_PADRAO)


def listar_usuarios_portal(conn) -> list[dict[str, Any]]:
    try:
        rows = conn.execute(
            '''SELECT usuario, email, ativo, nivel_hierarquia, superior_usuario, empresa_org_id
               FROM usuarios ORDER BY usuario ASC'''
        ).fetchall()
    except Exception:
        try:
            rows = conn.execute(
                '''SELECT usuario, email, ativo, nivel_hierarquia, superior_usuario
                   FROM usuarios ORDER BY usuario ASC'''
            ).fetchall()
        except Exception:
            rows = conn.execute('SELECT usuario FROM usuarios ORDER BY usuario ASC').fetchall()
    out = []
    for r in rows:
        keys = set(r.keys()) if hasattr(r, 'keys') else set()
        usuario = str(r['usuario'] if 'usuario' in keys or hasattr(r, 'keys') else r[0] or '')
        out.append(
            {
                'usuario': usuario,
                'email': str(r['email'] or '') if 'email' in keys else '',
                'ativo': bool(r['ativo']) if 'ativo' in keys else True,
                'nivel': str(r['nivel_hierarquia'] or '') if 'nivel_hierarquia' in keys else '',
                'superior': str(r['superior_usuario'] or '') if 'superior_usuario' in keys else '',
                'empresa_org_id': (
                    str(r['empresa_org_id'] or '') if 'empresa_org_id' in keys and r['empresa_org_id'] else None
                ),
                'is_superuser': is_portal_superuser(usuario),
            }
        )
    return out


def carregar_permissoes_usuario(conn, usuario: str) -> dict[str, Any]:
    u = (usuario or '').strip()
    by_sys: dict[str, dict[str, Any]] = {}
    try:
        rows = conn.execute(
            '''SELECT sistema, pode_acessar, modulos
               FROM portal_permissoes WHERE lower(usuario) = lower(?)''',
            (u,),
        ).fetchall()
        for r in rows:
            sistema = str(r['sistema'] or '').lower()
            pode = bool(r['pode_acessar'])
            mods = _modulos_from_db(r['modulos'])
            if sistema in SISTEMAS:
                by_sys[sistema] = {'pode_acessar': pode, 'modulos': mods}
    except Exception:
        pass

    if is_portal_superuser(u):
        for s in SISTEMAS:
            by_sys.setdefault(s, {'pode_acessar': True, 'modulos': None})
        return by_sys

    for s in SISTEMAS:
        by_sys.setdefault(s, {'pode_acessar': True, 'modulos': None})
    return by_sys


def salvar_permissoes_usuario(
    conn,
    *,
    usuario: str,
    matriz: dict[str, Any],
    atualizado_por: str,
) -> None:
    u = (usuario or '').strip()
    if not u:
        raise ValueError('Informe o usuário.')
    kind = getattr(conn, 'kind', 'sqlite')
    for sistema in SISTEMAS:
        bloco = matriz.get(sistema) or {}
        pode = bool(bloco.get('pode_acessar', True))
        mods = _modulos_to_db(bloco.get('modulos', None))
        if mods is not None and not isinstance(mods, dict):
            raise ValueError(f'modulos de {sistema} inválido.')
        mods_json = json.dumps(mods, ensure_ascii=False) if mods is not None else None
        if kind == 'pg':
            conn.execute(
                '''INSERT INTO public.portal_permissoes
                     (usuario, sistema, pode_acessar, modulos, atualizado_em, atualizado_por)
                   VALUES (?, ?, ?, CAST(? AS jsonb), NOW(), ?)
                   ON CONFLICT (usuario, sistema) DO UPDATE SET
                     pode_acessar = EXCLUDED.pode_acessar,
                     modulos = EXCLUDED.modulos,
                     atualizado_em = NOW(),
                     atualizado_por = EXCLUDED.atualizado_por''',
                (u, sistema, pode, mods_json, atualizado_por),
            )
        else:
            conn.execute(
                '''INSERT INTO portal_permissoes
                     (usuario, sistema, pode_acessar, modulos, atualizado_em, atualizado_por)
                   VALUES (?, ?, ?, ?, datetime('now'), ?)
                   ON CONFLICT(usuario, sistema) DO UPDATE SET
                     pode_acessar = excluded.pode_acessar,
                     modulos = excluded.modulos,
                     atualizado_em = datetime('now'),
                     atualizado_por = excluded.atualizado_por''',
                (u, sistema, 1 if pode else 0, mods_json, atualizado_por),
            )
    try:
        conn.commit()
    except Exception:
        pass


def salvar_hierarquia_usuario(
    conn,
    *,
    usuario: str,
    nivel: str | None = None,
    superior: str | None = None,
    empresa_org_id: str | None = None,
    atualizar_empresa_org: bool = False,
) -> None:
    u = (usuario or '').strip()
    if not u:
        raise ValueError('Informe o usuário.')
    nivel_v = (nivel or '').strip() or None
    sup_v = (superior or '').strip() or None
    if sup_v and normalize_usuario(sup_v) == normalize_usuario(u):
        raise ValueError('Usuário não pode ser superior de si mesmo.')
    if atualizar_empresa_org:
        emp_v = (empresa_org_id or '').strip() or None
        if emp_v:
            row = conn.execute('SELECT id FROM portal_org_nos WHERE id = ?', (emp_v,)).fetchone()
            if not row:
                raise ValueError('Empresa organizacional não encontrada.')
        conn.execute(
            '''UPDATE usuarios
               SET nivel_hierarquia = COALESCE(?, nivel_hierarquia),
                   superior_usuario = COALESCE(?, superior_usuario),
                   empresa_org_id = ?
               WHERE lower(usuario) = lower(?)''',
            (nivel_v, sup_v, emp_v, u),
        )
    else:
        conn.execute(
            '''UPDATE usuarios
               SET nivel_hierarquia = ?, superior_usuario = ?
               WHERE lower(usuario) = lower(?)''',
            (nivel_v, sup_v, u),
        )
    try:
        conn.commit()
    except Exception:
        pass


def catalogo_publico() -> dict[str, Any]:
    return {
        'sistemas': list(SISTEMAS),
        'modulos': PORTAL_MODULOS_CATALOGO,
        'niveis_padrao': NIVEIS_PADRAO,
    }
