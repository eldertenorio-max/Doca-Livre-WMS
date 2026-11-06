# -*- coding: utf-8 -*-
"""
Camada compatível com a API REST do Supabase (PostgREST) servida pelo próprio Flask.

Os módulos Light (/contagem) e Plus (/camaras) usam o cliente @supabase/supabase-js.
Em vez de falar com o Supabase, eles passam a apontar para  <origem>/sb  e esta camada
executa as consultas no PostgreSQL da Azure (DATABASE_URL), sem reescrever o frontend.

Segurança:
  - exige sessão do WMS (cookie Flask, mesma origem) — sem sessão → 401;
  - só tabelas/views da lista TABELAS_PERMITIDAS (Light/Plus) são acessíveis;
  - identificadores sempre entre aspas (psycopg.sql.Identifier) e valores como parâmetros;
  - UPDATE/DELETE sem filtro são recusados (evita apagar a tabela inteira).

Suporta o subconjunto do PostgREST usado pelos frontends: select (colunas, alias, cast),
filtros eq/neq/gt/gte/lt/lte/like/ilike/match/imatch/is/in/cs/cd/ov/isdistinct (+ not.),
or=/and= aninhados, order, limit/offset/Range, count=exact, HEAD, insert/upsert
(on_conflict, merge-duplicates, ignore-duplicates, missing=default), update, delete,
return=representation|minimal e Accept: application/vnd.pgrst.object+json (single).

Tempo real: o supabase-js usa WebSocket; aqui há /sb/changes (consulta periódica) e os
frontends trocam .channel() por um canal que consulta esse endpoint.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import json
import os
import re
import threading
import time
import uuid

from flask import Blueprint, Response, request

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover
    psycopg = None
    sql = None
    dict_row = None

bp = Blueprint('supabase_compat', __name__)

# ── Tabelas acessíveis pelos módulos Light / Plus ──────────────────────────────
TABELAS_PERMITIDAS = {
    # Light
    'Todos os Produtos', 'conferentes', 'produtos', 'contagens_estoque', 'contagens_inventario',
    'contagem_diaria_sessoes', 'contagem_diaria_presenca', 'contagem_diaria_captura_presenca',
    'contagem_ocupacao_camaras', 'contagem_ocupacao_avaria_camaras', 'contagem_temperatura_camaras',
    'enderecamento_listas', 'produto_listas', 'inventario_sessoes', 'inventario_planilha_linhas',
    'inventario_captura_presenca', 'sheet_outbox', 'sistema_protecao_dados', 'light_usuarios',
    'v_contagem_diaria_painel', 'v_contagem_diaria_itens_painel',
    # Plus
    'ultrafrio_notas_fiscais', 'ultrafrio_nf_itens', 'ultrafrio_enderecamentos', 'ultrafrio_movimentos',
    'ultrafrio_notas_canceladas', 'ultrafrio_cadastro_remetentes', 'ultrafrio_fin_tabelas',
    'ultrafrio_fin_clientes', 'ultrafrio_fin_contratos', 'ultrafrio_voz_cadastros',
}
# O Light chama .from('usuarios'): na base unificada a tabela dele é light_usuarios
# (a tabela usuarios é a do Pro, com senha_hash — nunca exposta por aqui).
ALIASES = {'usuarios': 'light_usuarios'}

_conn_factory = None        # () -> conexão psycopg crua
_usuario_atual = None       # () -> str | None
_meta_cache: dict = {}      # tabela -> {'colunas': {nome: tipo}, 'pk': [..], 'ts': t}
_meta_lock = threading.Lock()
_META_TTL = 300


def registrar(conn_factory, usuario_atual):
    """Chamado pelo app: como abrir conexão e como saber o usuário logado."""
    global _conn_factory, _usuario_atual
    _conn_factory = conn_factory
    _usuario_atual = usuario_atual


# ── Respostas ──────────────────────────────────────────────────────────────────
def _json_default(o):
    if isinstance(o, (_dt.datetime, _dt.date, _dt.time)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return int(o) if o == o.to_integral_value() and abs(o) < 2 ** 53 else float(o)
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, (bytes, memoryview)):
        return '\\x' + bytes(o).hex()
    if isinstance(o, _dt.timedelta):
        return str(o)
    return str(o)


def _resp(corpo, status=200, headers=None, sem_corpo=False):
    txt = '' if sem_corpo or corpo is None else json.dumps(corpo, default=_json_default, ensure_ascii=False)
    r = Response(txt, status=status, mimetype='application/json')
    r.headers['Cache-Control'] = 'no-store'
    for k, v in (headers or {}).items():
        r.headers[k] = v
    return r


def _erro(status, message, code='PGRST000', details=None, hint=None):
    return _resp({'code': code, 'message': message, 'details': details, 'hint': hint}, status)


def _erro_pg(e):
    code = getattr(e, 'sqlstate', None) or 'PGRST000'
    diag = getattr(e, 'diag', None)
    msg = (getattr(diag, 'message_primary', None) or str(e) or 'Erro no banco').strip()
    det = getattr(diag, 'message_detail', None)
    hint = getattr(diag, 'message_hint', None)
    status = 400
    if code in ('23505', '23503', '23P01'):
        status = 409
    elif code == '42P01':
        status = 404
    elif code in ('42501',):
        status = 403
    elif code in ('57014', '53300', '08006', '08001'):
        status = 503
    return _erro(status, msg, code, det, hint)


class ErroConsulta(Exception):
    def __init__(self, msg, code='PGRST100', status=400):
        super().__init__(msg)
        self.code = code
        self.status = status


# ── Metadados da tabela (colunas, tipos, PK) ───────────────────────────────────
def _meta(conn, tabela):
    agora = time.time()
    with _meta_lock:
        m = _meta_cache.get(tabela)
        if m and agora - m['ts'] < _META_TTL:
            return m
    cols = {
        r['column_name']: r['data_type']
        for r in conn.execute(
            '''SELECT column_name, data_type FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = %s''',
            (tabela,),
        ).fetchall()
    }
    pk = [
        r['attname']
        for r in conn.execute(
            '''SELECT a.attname
               FROM pg_index i
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
               WHERE i.indrelid = %s::regclass AND i.indisprimary
               ORDER BY array_position(i.indkey, a.attnum)''',
            (sql.Identifier('public', tabela).as_string(conn),),
        ).fetchall()
    ] if cols else []
    m = {'colunas': cols, 'pk': pk, 'ts': agora}
    with _meta_lock:
        _meta_cache[tabela] = m
    return m


# ── Parser PostgREST ───────────────────────────────────────────────────────────
_OPS = {
    'eq': '=', 'neq': '<>', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=',
    'like': 'LIKE', 'ilike': 'ILIKE', 'match': '~', 'imatch': '~*',
    'cs': '@>', 'cd': '<@', 'ov': '&&', 'isdistinct': 'IS DISTINCT FROM',
}
_RESERVADOS = {'select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and', 'not.or', 'not.and'}
_RE_CAST = re.compile(r'^[A-Za-z_][A-Za-z0-9_ \[\]]*$')


def _split_top(s, sep=','):
    """Divide por `sep` fora de parênteses e aspas."""
    partes, buf, prof, aspas = [], [], 0, False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            aspas = not aspas
            buf.append(c)
        elif c == '\\' and aspas and i + 1 < len(s):
            buf.append(s[i:i + 2])
            i += 1
        elif not aspas and c == '(':
            prof += 1
            buf.append(c)
        elif not aspas and c == ')':
            prof -= 1
            buf.append(c)
        elif not aspas and prof == 0 and c == sep:
            partes.append(''.join(buf))
            buf = []
        else:
            buf.append(c)
        i += 1
    partes.append(''.join(buf))
    return [p for p in partes if p != '']


def _desaspar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return v[1:-1].replace('\\"', '"').replace('\\\\', '\\')
    return v


def _coluna_expr(nome):
    """Coluna com caminho JSON opcional: col, col->a, col->>b, col->a->>b."""
    partes = re.split(r'(->>|->)', nome)
    expr = sql.Identifier(partes[0].strip())
    i = 1
    while i < len(partes) - 1:
        op, chave = partes[i], partes[i + 1].strip()
        if chave.isdigit():
            expr = sql.SQL('{} {} {}').format(expr, sql.SQL(op), sql.Literal(int(chave)))
        else:
            expr = sql.SQL('{} {} {}').format(expr, sql.SQL(op), sql.Literal(chave))
        i += 2
    return expr


def _parse_select(sel):
    """'*' | 'a,b:c,d::text' → lista de sql.Composable."""
    sel = (sel or '*').strip() or '*'
    itens = []
    for item in _split_top(sel):
        item = item.strip()
        if not item:
            continue
        if '(' in item:
            raise ErroConsulta('Recursos aninhados (embed) não são suportados: %s' % item)
        if item == '*':
            itens.append(sql.SQL('*'))
            continue
        alias = None
        if ':' in item and '::' not in item.split(':', 1)[0] + ':':
            # "alias:col" (cuidado com "col::tipo")
            m = re.match(r'^([^:]+):(?!:)(.+)$', item)
            if m:
                alias, item = m.group(1).strip(), m.group(2).strip()
        cast = None
        if '::' in item:
            item, cast = item.split('::', 1)
            if not _RE_CAST.match(cast.strip()):
                raise ErroConsulta('Cast inválido: %s' % cast)
        nome = _desaspar(item)
        expr = _coluna_expr(nome)
        if cast:
            expr = sql.SQL('{}::{}').format(expr, sql.SQL(cast.strip()))
        if alias:
            expr = sql.SQL('{} AS {}').format(expr, sql.Identifier(alias))
        elif '->' in nome:
            expr = sql.SQL('{} AS {}').format(expr, sql.Identifier(re.split(r'->>|->', nome)[-1].strip()))
        itens.append(expr)
    return itens or [sql.SQL('*')]


def _parse_lista_in(v):
    v = v.strip()
    if not (v.startswith('(') and v.endswith(')')):
        raise ErroConsulta('Lista inválida para in: %s' % v)
    return [_desaspar(x) for x in _split_top(v[1:-1])]


def _condicao(coluna, expr_op):
    """coluna + 'op.valor' (ou 'not.op.valor') → (sql, params)."""
    negar = False
    if expr_op.startswith('not.'):
        negar, expr_op = True, expr_op[4:]
    if '.' not in expr_op:
        raise ErroConsulta('Filtro inválido: %s=%s' % (coluna, expr_op))
    op, valor = expr_op.split('.', 1)
    # modificadores any/all (ex.: eq(any).{a,b}) — não usados pelos frontends
    col = _coluna_expr(coluna)
    params = []
    if op == 'is':
        v = valor.strip().lower()
        mapa = {'null': 'NULL', 'not_null': 'NOT NULL', 'true': 'TRUE', 'false': 'FALSE', 'unknown': 'UNKNOWN'}
        if v not in mapa:
            raise ErroConsulta('Valor inválido para is: %s' % valor)
        frag = sql.SQL('{} IS {}').format(col, sql.SQL(mapa[v]))
    elif op == 'in':
        itens = _parse_lista_in(valor)
        if not itens:
            frag = sql.SQL('FALSE')
        else:
            frag = sql.SQL('{} IN ({})').format(col, sql.SQL(', ').join(sql.Placeholder() * len(itens)))
            params.extend(itens)
    elif op in ('like', 'ilike'):
        frag = sql.SQL('{} {} {}').format(col, sql.SQL(_OPS[op]), sql.Placeholder())
        params.append(_desaspar(valor).replace('*', '%'))
    elif op in ('cs', 'cd', 'ov'):
        v = _desaspar(valor)
        if op == 'ov' and v.startswith('(') and v.endswith(')'):
            v = '{' + v[1:-1] + '}'
        frag = sql.SQL('{} {} {}').format(col, sql.SQL(_OPS[op]), sql.Placeholder())
        params.append(v)
    elif op in _OPS:
        frag = sql.SQL('{} {} {}').format(col, sql.SQL(_OPS[op]), sql.Placeholder())
        params.append(_desaspar(valor))
    else:
        raise ErroConsulta('Operador não suportado: %s' % op)
    if negar:
        frag = sql.SQL('NOT ({})').format(frag)
    return frag, params


def _parse_logico(conteudo, juncao):
    """'(a.eq.1,b.gt.2,and(c.eq.3,d.eq.4))' → (sql, params)."""
    conteudo = conteudo.strip()
    if not (conteudo.startswith('(') and conteudo.endswith(')')):
        raise ErroConsulta('Expressão lógica inválida: %s' % conteudo)
    partes, params = [], []
    for item in _split_top(conteudo[1:-1]):
        item = item.strip()
        m = re.match(r'^(not\.)?(and|or)(\(.*\))$', item, re.S)
        if m:
            frag, p = _parse_logico(m.group(3), m.group(2))
            if m.group(1):
                frag = sql.SQL('NOT ({})').format(frag)
        else:
            # coluna.op.valor  (coluna pode ter caminho JSON, mas não ponto)
            m2 = re.match(r'^([^.]+?)\.((?:not\.)?[a-z]+\..*)$', item, re.S)
            if not m2:
                raise ErroConsulta('Condição inválida: %s' % item)
            frag, p = _condicao(_desaspar(m2.group(1)), m2.group(2))
        partes.append(frag)
        params.extend(p)
    if not partes:
        return sql.SQL('TRUE'), []
    j = sql.SQL(' AND ') if juncao == 'and' else sql.SQL(' OR ')
    return sql.SQL('({})').format(j.join(partes)), params


def _parse_filtros(args):
    """Query string → (lista de sql, params). Ignora parâmetros reservados."""
    frags, params = [], []
    for chave in args.keys():
        for valor in args.getlist(chave):
            if chave in ('or', 'and', 'not.or', 'not.and'):
                neg = chave.startswith('not.')
                frag, p = _parse_logico(valor, chave.split('.')[-1])
                if neg:
                    frag = sql.SQL('NOT {}').format(frag)
                frags.append(frag)
                params.extend(p)
                continue
            if chave in _RESERVADOS:
                continue
            frag, p = _condicao(chave, valor)
            frags.append(frag)
            params.extend(p)
    return frags, params


def _parse_order(valor):
    itens = []
    for parte in _split_top(valor or ''):
        tokens = parte.strip().split('.')
        if not tokens or not tokens[0]:
            continue
        # "tabela_ref(col)" (ordem em embed) não é suportado — ignora
        if '(' in tokens[0]:
            continue
        col = _coluna_expr(_desaspar(tokens[0]))
        direcao, nulls = '', ''
        for t in tokens[1:]:
            t = t.lower()
            if t in ('asc', 'desc'):
                direcao = ' ' + t.upper()
            elif t == 'nullsfirst':
                nulls = ' NULLS FIRST'
            elif t == 'nullslast':
                nulls = ' NULLS LAST'
        itens.append(sql.SQL('{}' + direcao + nulls).format(col))
    return itens


def _prefer():
    out = {}
    for parte in (request.headers.get('Prefer') or '').split(','):
        if '=' in parte:
            k, v = parte.strip().split('=', 1)
            out[k.strip().lower()] = v.strip().lower()
    return out


def _range_header():
    r = (request.headers.get('Range') or '').strip()
    m = re.match(r'^(\d+)-(\d*)$', r)
    if not m:
        return None, None
    ini = int(m.group(1))
    fim = int(m.group(2)) if m.group(2) else None
    return ini, (fim - ini + 1 if fim is not None else None)


def _where(frags):
    if not frags:
        return sql.SQL('')
    return sql.SQL(' WHERE ') + sql.SQL(' AND ').join(frags)


def _adaptar_valor(valor, tipo):
    if valor is None:
        return None
    if isinstance(valor, (dict, list)):
        if tipo == 'ARRAY' and isinstance(valor, list):
            return valor
        return json.dumps(valor, ensure_ascii=False)
    if tipo in ('json', 'jsonb') and not isinstance(valor, str):
        return json.dumps(valor)
    return valor


def _quer_objeto():
    return 'application/vnd.pgrst.object+json' in (request.headers.get('Accept') or '')


def _corpo_resultado(linhas, status_ok):
    if _quer_objeto():
        if len(linhas) != 1:
            return _erro(
                406, 'JSON object requested, multiple (or no) rows returned', 'PGRST116',
                'The result contains %d rows' % len(linhas),
            )
        return _resp(linhas[0], status_ok)
    return _resp(linhas, status_ok)


def _marcar_alteracao(conn, tabela):
    try:
        conn.execute(
            '''INSERT INTO public._sb_alteracoes (tabela, alterado_em) VALUES (%s, clock_timestamp())
               ON CONFLICT (tabela) DO UPDATE SET alterado_em = clock_timestamp()''',
            (tabela,),
        )
    except Exception:
        pass


_tabela_alteracoes_ok = False


def _garantir_tabela_alteracoes(conn):
    global _tabela_alteracoes_ok
    if _tabela_alteracoes_ok:
        return
    conn.execute(
        '''CREATE TABLE IF NOT EXISTS public._sb_alteracoes (
            tabela TEXT PRIMARY KEY,
            alterado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )'''
    )
    conn.commit()
    _tabela_alteracoes_ok = True


# ── Rotas ──────────────────────────────────────────────────────────────────────
_local = threading.local()
_CONEXAO_MAX_IDADE_S = 600


def _abrir():
    """
    Conexão reaproveitada por thread (autocommit). O Plus consulta várias tabelas a cada
    poucos segundos; abrir uma conexão TLS nova com a Azure por requisição esgotaria o
    limite de conexões e deixaria tudo lento.
    """
    if _conn_factory is None or psycopg is None:
        raise ErroConsulta('Banco Postgres não configurado (DATABASE_URL).', 'PGRST503', 503)
    conn = getattr(_local, 'conn', None)
    if conn is not None and (conn.closed or conn.broken
                             or time.time() - getattr(_local, 'criada', 0) > _CONEXAO_MAX_IDADE_S):
        _descartar(conn)
        conn = None
    if conn is None:
        conn = _conn_factory()
        if conn is None:
            raise ErroConsulta('Banco Postgres não configurado (DATABASE_URL).', 'PGRST503', 503)
        conn.autocommit = True
        conn.row_factory = dict_row
        _local.conn = conn
        _local.criada = time.time()
    return conn


def _descartar(conn):
    try:
        conn.close()
    except Exception:
        pass
    if getattr(_local, 'conn', None) is conn:
        _local.conn = None


def _liberar(conn, erro=None):
    """Mantém a conexão para a próxima requisição; descarta se ela quebrou."""
    if conn is None:
        return
    quebrou = conn.closed or conn.broken or (
        psycopg is not None and isinstance(erro, (psycopg.OperationalError, psycopg.InterfaceError))
    )
    if quebrou:
        _descartar(conn)


def _autenticado():
    try:
        return bool(_usuario_atual and _usuario_atual())
    except Exception:
        return False


@bp.route('/rest/v1/<path:tabela>', methods=['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'])
def rest(tabela):
    if request.method == 'OPTIONS':
        return Response('', 204)
    if not _autenticado():
        return _erro(401, 'Sessão expirada. Faça login novamente no WMS.', 'PGRST301')
    tabela = ALIASES.get(tabela, tabela)
    if tabela.startswith('rpc/'):
        return _erro(404, 'Funções RPC não são suportadas.', 'PGRST202')
    if tabela not in TABELAS_PERMITIDAS:
        return _erro(404, "Could not find the table 'public.%s' in the schema cache" % tabela, 'PGRST205')
    conn = None
    erro = None
    try:
        conn = _abrir()
        if request.method in ('GET', 'HEAD'):
            return _get(conn, tabela)
        _garantir_tabela_alteracoes(conn)
        if request.method == 'POST':
            return _post(conn, tabela)
        if request.method == 'PATCH':
            return _patch(conn, tabela)
        return _delete(conn, tabela)
    except ErroConsulta as e:
        return _erro(e.status, str(e), e.code)
    except Exception as e:
        erro = e
        if psycopg is not None and isinstance(e, psycopg.Error):
            return _erro_pg(e)
        return _erro(500, 'Erro interno: %s' % e, 'PGRST500')
    finally:
        _liberar(conn, erro)


def _get(conn, tabela):
    args = request.args
    colunas = _parse_select(args.get('select'))
    frags, params = _parse_filtros(args)
    ordem = _parse_order(args.get('order'))
    limite = args.get('limit')
    offset = args.get('offset')
    r_ini, r_lim = _range_header()
    lim = int(limite) if (limite or '').isdigit() else r_lim
    off = int(offset) if (offset or '').isdigit() else (r_ini or 0)
    pref = _prefer()

    q = sql.SQL('SELECT {} FROM {}').format(sql.SQL(', ').join(colunas), sql.Identifier('public', tabela))
    q += _where(frags)
    if ordem:
        q += sql.SQL(' ORDER BY ') + sql.SQL(', ').join(ordem)
    if lim is not None:
        q += sql.SQL(' LIMIT {}').format(sql.Literal(int(lim)))
    if off:
        q += sql.SQL(' OFFSET {}').format(sql.Literal(int(off)))

    total = None
    if pref.get('count') in ('exact', 'planned', 'estimated'):
        qc = sql.SQL('SELECT COUNT(*) AS n FROM {}').format(sql.Identifier('public', tabela)) + _where(frags)
        total = conn.execute(qc, params).fetchone()['n']

    linhas = [] if request.method == 'HEAD' and total is not None else conn.execute(q, params).fetchall()
    n = len(linhas)
    tot_txt = str(total) if total is not None else '*'
    content_range = ('%d-%d/%s' % (off, off + n - 1, tot_txt)) if n else ('*/%s' % tot_txt)
    headers = {'Content-Range': content_range}
    if request.method == 'HEAD':
        return _resp(None, 200, headers, sem_corpo=True)
    resp = _corpo_resultado(linhas, 200)
    resp.headers['Content-Range'] = content_range
    return resp


def _linhas_corpo():
    corpo = request.get_json(silent=True)
    if corpo is None:
        raise ErroConsulta('Corpo JSON inválido.', 'PGRST102')
    if isinstance(corpo, dict):
        return [corpo], False
    if isinstance(corpo, list) and all(isinstance(x, dict) for x in corpo):
        return corpo, True
    raise ErroConsulta('Corpo deve ser objeto ou lista de objetos.', 'PGRST102')


def _returning(pref):
    if pref.get('return') == 'representation':
        cols = _parse_select(request.args.get('select'))
        return sql.SQL(' RETURNING ') + sql.SQL(', ').join(cols)
    return sql.SQL('')


def _post(conn, tabela):
    linhas, _ = _linhas_corpo()
    pref = _prefer()
    meta = _meta(conn, tabela)
    tipos = meta['colunas']
    if request.args.get('columns'):
        cols = [_desaspar(c) for c in _split_top(request.args['columns'])]
    else:
        cols = []
        for ln in linhas:
            for k in ln.keys():
                if k not in cols:
                    cols.append(k)
    status_ok = 201
    if not linhas:
        return _resp([] if pref.get('return') == 'representation' else None, status_ok,
                     sem_corpo=pref.get('return') != 'representation')
    missing_default = pref.get('missing') == 'default'
    params = []
    valores_sql = []
    for ln in linhas:
        itens = []
        for c in cols:
            if c not in ln and missing_default:
                itens.append(sql.SQL('DEFAULT'))
            else:
                itens.append(sql.Placeholder())
                params.append(_adaptar_valor(ln.get(c), tipos.get(c)))
        valores_sql.append(sql.SQL('({})').format(sql.SQL(', ').join(itens)))
    if cols:
        q = sql.SQL('INSERT INTO {} ({}) VALUES {}').format(
            sql.Identifier('public', tabela),
            sql.SQL(', ').join(sql.Identifier(c) for c in cols),
            sql.SQL(', ').join(valores_sql),
        )
    else:
        q = sql.SQL('INSERT INTO {} DEFAULT VALUES').format(sql.Identifier('public', tabela))

    resolucao = pref.get('resolution')
    on_conflict = request.args.get('on_conflict')
    if resolucao in ('merge-duplicates', 'ignore-duplicates') or on_conflict:
        alvo = [_desaspar(c) for c in _split_top(on_conflict)] if on_conflict else list(meta['pk'])
        if not alvo:
            raise ErroConsulta('Tabela sem chave primária para upsert; informe on_conflict.')
        conflito = sql.SQL(', ').join(sql.Identifier(c) for c in alvo)
        atualizar = [c for c in cols if c not in alvo]
        if resolucao == 'ignore-duplicates' or not atualizar:
            q += sql.SQL(' ON CONFLICT ({}) DO NOTHING').format(conflito)
        else:
            q += sql.SQL(' ON CONFLICT ({}) DO UPDATE SET {}').format(
                conflito,
                sql.SQL(', ').join(
                    sql.SQL('{} = EXCLUDED.{}').format(sql.Identifier(c), sql.Identifier(c)) for c in atualizar
                ),
            )
    q += _returning(pref)
    cur = conn.execute(q, params)
    resultado = cur.fetchall() if pref.get('return') == 'representation' else None
    _marcar_alteracao(conn, tabela)
    conn.commit()
    if resultado is None:
        return _resp(None, status_ok, sem_corpo=True)
    return _corpo_resultado(resultado, status_ok)


def _patch(conn, tabela):
    corpo = request.get_json(silent=True)
    if not isinstance(corpo, dict):
        raise ErroConsulta('Corpo do update deve ser um objeto JSON.', 'PGRST102')
    frags, params_where = _parse_filtros(request.args)
    if not frags:
        raise ErroConsulta('UPDATE sem filtro não é permitido.', '21000')
    pref = _prefer()
    if not corpo:
        return _resp([] if pref.get('return') == 'representation' else None,
                     200 if pref.get('return') == 'representation' else 204,
                     sem_corpo=pref.get('return') != 'representation')
    tipos = _meta(conn, tabela)['colunas']
    sets, params = [], []
    for c, v in corpo.items():
        sets.append(sql.SQL('{} = {}').format(sql.Identifier(c), sql.Placeholder()))
        params.append(_adaptar_valor(v, tipos.get(c)))
    q = sql.SQL('UPDATE {} SET {}').format(sql.Identifier('public', tabela), sql.SQL(', ').join(sets))
    q += _where(frags) + _returning(pref)
    cur = conn.execute(q, params + params_where)
    resultado = cur.fetchall() if pref.get('return') == 'representation' else None
    _marcar_alteracao(conn, tabela)
    conn.commit()
    if resultado is None:
        return _resp(None, 204, sem_corpo=True)
    return _corpo_resultado(resultado, 200)


def _e_exclusao_em_massa(args):
    """Filtros que casam com todas as linhas (ex.: .delete().not('id','is',null))."""
    filtros = [(k, v) for k in args.keys() for v in args.getlist(k) if k not in _RESERVADOS]
    if not filtros:
        return True
    return all(v.strip().lower() in ('not.is.null', 'is.not_null') for _, v in filtros)


def _delete(conn, tabela):
    frags, params = _parse_filtros(request.args)
    if not frags:
        raise ErroConsulta('DELETE sem filtro não é permitido.', '21000')
    # Homologação e produção podem usar o MESMO banco: o botão "Zerar banco (homolog)"
    # apagaria os dados de produção. Só com PERMITIR_APAGAR_TUDO=1 (banco exclusivo).
    if _e_exclusao_em_massa(request.args) and (os.environ.get('PERMITIR_APAGAR_TUDO') or '').strip() != '1':
        raise ErroConsulta(
            'Exclusão de todos os registros bloqueada: este banco é compartilhado com a produção. '
            'Defina PERMITIR_APAGAR_TUDO=1 apenas num banco de homologação separado.',
            '42501', 403,
        )
    pref = _prefer()
    q = sql.SQL('DELETE FROM {}').format(sql.Identifier('public', tabela)) + _where(frags) + _returning(pref)
    cur = conn.execute(q, params)
    resultado = cur.fetchall() if pref.get('return') == 'representation' else None
    _marcar_alteracao(conn, tabela)
    conn.commit()
    if resultado is None:
        return _resp(None, 204, sem_corpo=True)
    return _corpo_resultado(resultado, 200)


@bp.route('/changes', methods=['GET'])
def changes():
    """Tempo real por consulta periódica: tabelas alteradas desde `since` (ms epoch)."""
    if not _autenticado():
        return _erro(401, 'Sessão expirada.', 'PGRST301')
    agora_ms = int(time.time() * 1000)
    try:
        since_ms = int(request.args.get('since') or 0)
    except ValueError:
        since_ms = 0
    tabelas = [ALIASES.get(t, t) for t in (request.args.get('tables') or '').split(',') if t.strip()]
    conn = None
    try:
        conn = _abrir()
        _garantir_tabela_alteracoes(conn)
        linhas = conn.execute(
            '''SELECT tabela, (EXTRACT(EPOCH FROM alterado_em) * 1000)::bigint AS ms,
                      (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS agora
               FROM public._sb_alteracoes WHERE alterado_em > to_timestamp(%s / 1000.0)''',
            (since_ms,),
        ).fetchall()
        if linhas:
            agora_ms = max(int(linhas[0]['agora']), agora_ms)
        else:
            r = conn.execute('SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS agora').fetchone()
            agora_ms = int(r['agora'])
        alteradas = [l['tabela'] for l in linhas if not tabelas or l['tabela'] in tabelas]
        inv = {v: k for k, v in ALIASES.items()}
        alteradas += [inv[t] for t in list(alteradas) if t in inv]
        return _resp({'now': agora_ms, 'changed': alteradas})
    except ErroConsulta as e:
        return _erro(e.status, str(e), e.code)
    except Exception as e:
        if conn is not None:
            _descartar(conn)
            conn = None
        return _erro(503, 'Falha ao consultar alterações: %s' % type(e).__name__, 'PGRST503')
    finally:
        _liberar(conn)


@bp.route('/auth/v1/<path:_resto>', methods=['GET', 'POST', 'PUT', 'OPTIONS'])
def auth_indisponivel(_resto):
    """O login é o do WMS (sessão Flask); o Auth do Supabase não existe mais."""
    if request.method == 'OPTIONS':
        return Response('', 204)
    return _resp({'error': 'auth_indisponivel', 'error_description': 'Use o login do WMS.'}, 400)


@bp.route('/realtime/v1/<path:_resto>', methods=['GET'])
def realtime_indisponivel(_resto):
    return _resp({'error': 'Tempo real via WebSocket indisponível; use /sb/changes.'}, 404)
