# -*- coding: utf-8 -*-
"""
Estrutura completa do banco (Pro + Light + Plus) num PostgreSQL comum (Azure).

Os arquivos em supabase/*.sql foram escritos para o Supabase. Aqui eles são aplicados
em ordem, comando a comando, ignorando o que só existe no Supabase:
  - Row Level Security / políticas (CREATE POLICY, ENABLE ROW LEVEL SECURITY);
  - GRANT/REVOKE para os papéis anon, authenticated e service_role;
  - publicação supabase_realtime, schemas auth/storage.

Na Azure o controle de acesso é feito pelo Flask (sessão + lista de tabelas permitidas
em supabase_compat.py), não por RLS.

Cada arquivo aplicado fica registrado em public._schema_bootstrap (nome + checksum);
no próximo boot só arquivos novos ou alterados são reaplicados. Os comandos são
idempotentes (IF NOT EXISTS / OR REPLACE) e cada um roda na própria transação, então
uma falha isolada não impede o restante.
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
import time

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQL_DIR = os.path.join(_BASE_DIR, 'supabase')

# Ordem documentada em supabase/SUPABASE_HOMOLOG.md (passos 1–21, só estrutura)
# + terceiros, status cancelada e a base unificada Light/Plus.
ARQUIVOS_ESTRUTURA = [
    'schema.sql',
    'migrate_excel_base_to_base_codigo_barras.sql',
    'create_table_romaneio_por_item.sql',
    'create_table_motoristas.sql',
    'create_table_placas.sql',
    'migrate_roteiros.sql',
    'migrate_identificador_rota.sql',
    'migrate_viagem_periodo_bipagem.sql',
    'migrate_devolucao_nf.sql',
    'migrate_devolucao_nf_status_cancelada.sql',
    'migrate_ravex_importacoes.sql',
    'migrate_ravex_importacoes_sem_fk.sql',
    'migrate_ravex_importacoes_conjuntos.sql',
    'migrate_tabela_geral_dados.sql',
    'create_table_terceiros.sql',
    'migrate_terceiros_motivos_fluxo.sql',
    'migrate_terceiros_consumivel_sp.sql',
    'migrate_terceiros_recebedor_mg.sql',
    'migrate_terceiros_motorista_saida_mg.sql',
    'fix_fn_sync_tabela_geral.sql',
    'create_wms_enderecamento.sql',
    'migrate_wms_produto_planejamento.sql',
    # fix_wms_camara_totais.sql NÃO entra: é correção de DADOS pontual (UPDATE de totais e
    # DELETE de endereços vazios fora de um layout antigo) — perigosa num banco com dados atuais.
    'migrate_unificar_light_plus_pro.sql',
]

_PAPEIS_SUPABASE = r'(anon|authenticated|service_role|supabase_\w+|authenticator|dashboard_user)'
_IGNORAR = [
    re.compile(r'^\s*(CREATE|DROP|ALTER)\s+POLICY\b', re.I),
    re.compile(r'\b(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b', re.I),
    re.compile(r'^\s*(GRANT|REVOKE)\b.*\b' + _PAPEIS_SUPABASE + r'\b', re.I | re.S),
    re.compile(r'^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b.*\b' + _PAPEIS_SUPABASE + r'\b', re.I | re.S),
    re.compile(r'\bsupabase_realtime\b', re.I),
    re.compile(r'^\s*ALTER\s+(TABLE|VIEW|FUNCTION)\b.*\bOWNER\s+TO\b', re.I | re.S),
    re.compile(r'\b(auth|storage|realtime|extensions|vault|graphql)\.\w+', re.I),
    re.compile(r'^\s*(BEGIN|COMMIT|ROLLBACK)\s*$', re.I),
    re.compile(r'^\s*NOTIFY\s+pgrst\b', re.I),
]


def dividir_sql(texto: str) -> list[str]:
    """Divide um script SQL em comandos, respeitando aspas, $$…$$ e comentários."""
    comandos: list[str] = []
    buf: list[str] = []
    i, n = 0, len(texto)
    while i < n:
        c = texto[i]
        nxt = texto[i + 1] if i + 1 < n else ''
        if c == '-' and nxt == '-':  # comentário de linha
            j = texto.find('\n', i)
            i = n if j < 0 else j + 1
            buf.append('\n')
            continue
        if c == '/' and nxt == '*':  # comentário de bloco
            j = texto.find('*/', i + 2)
            i = n if j < 0 else j + 2
            buf.append(' ')
            continue
        if c in ("'", '"'):
            j = i + 1
            while j < n:
                if texto[j] == c:
                    if j + 1 < n and texto[j + 1] == c:  # aspas escapadas
                        j += 2
                        continue
                    break
                j += 1
            buf.append(texto[i:j + 1])
            i = j + 1
            continue
        if c == '$':
            m = re.match(r'\$[A-Za-z_]*\$', texto[i:])
            if m:
                tag = m.group(0)
                j = texto.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                buf.append(texto[i:j])
                i = j
                continue
        if c == ';':
            cmd = ''.join(buf).strip()
            if cmd:
                comandos.append(cmd)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    cmd = ''.join(buf).strip()
    if cmd:
        comandos.append(cmd)
    return comandos


def deve_ignorar(cmd: str) -> bool:
    return any(p.search(cmd) for p in _IGNORAR)


def _checksum(texto: str) -> str:
    return hashlib.sha256(texto.encode('utf-8')).hexdigest()[:16]


# Erros que significam "já existe" (comando idempotente já aplicado antes): não contam como falha.
_JA_EXISTE = {'42710', '42P07', '42723', '42P06', '42P16'}
_TRAVA_ESTRUTURA = 727001  # pg_advisory_lock: só um worker do gunicorn aplica por vez
_RE_VIEW = re.compile(r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?("?)([A-Za-z_][\w ]*?)\1\s+(?:WITH\b|AS\b)', re.I)


def _views_esperadas() -> dict[str, set[str]]:
    """{nome_da_view: {arquivos que a definem}}."""
    out: dict[str, set[str]] = {}
    for nome in ARQUIVOS_ESTRUTURA:
        caminho = os.path.join(SQL_DIR, nome)
        if not os.path.isfile(caminho):
            continue
        with open(caminho, encoding='utf-8') as f:
            for m in _RE_VIEW.finditer(f.read()):
                out.setdefault(m.group(2).strip(), set()).add(nome)
    return out


def _corrigir_views_congeladas(conn, log) -> set[str]:
    """
    Cópias de banco às vezes gravam uma VIEW como TABELA (dados parados no dia da cópia).
    Renomeia essas tabelas para <nome>_tabela_antiga (nada é apagado) e devolve os arquivos
    que precisam ser reaplicados para recriar as views verdadeiras.
    """
    sql_relkind = (
        "SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relname = %s"
    )
    reaplicar: set[str] = set()
    for view, arquivos in _views_esperadas().items():
        r = conn.execute(sql_relkind, (view,)).fetchone()
        if not r or r[0] not in ('r', 'p'):
            continue
        destino = (view + '_tabela_antiga')[:63]
        if conn.execute(sql_relkind, (destino,)).fetchone():
            destino = (view + '_tabela_antiga_' + time.strftime('%Y%m%d%H%M%S'))[:63]
        conn.execute('ALTER TABLE public."%s" RENAME TO "%s"' % (view.replace('"', ''), destino.replace('"', '')))
        log('[azure_schema] "%s" era TABELA (cópia congelada); renomeada para "%s" e a view será recriada.'
            % (view, destino))
        reaplicar |= arquivos
    return reaplicar


def aplicar_estrutura(conn_factory, log=print, forcar=False) -> dict:
    """
    Aplica os arquivos de estrutura que ainda não foram aplicados, que mudaram ou que
    tiveram erro real na última vez. conn_factory() deve devolver uma conexão psycopg
    *crua* (não CompatConn). Retorna {arquivo: {'aplicados', 'ignorados', 'erros'}}.
    """
    resumo: dict = {}
    conn = conn_factory()
    try:
        conn.autocommit = True
        # Vários workers sobem juntos: o primeiro aplica, os outros esperam e encontram tudo feito.
        conn.execute('SELECT pg_advisory_lock(%s)', (_TRAVA_ESTRUTURA,))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS public._schema_bootstrap ("
            " arquivo TEXT PRIMARY KEY,"
            " checksum TEXT NOT NULL,"
            " aplicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
            " erros INTEGER NOT NULL DEFAULT 0)"
        )
        feitos = {
            r[0]: (r[1], int(r[2] or 0))
            for r in conn.execute('SELECT arquivo, checksum, erros FROM public._schema_bootstrap').fetchall()
        }
        try:
            reaplicar = _corrigir_views_congeladas(conn, log)
        except Exception as e:
            log('[azure_schema] verificação de views falhou: %s' % e)
            reaplicar = set()
        pendentes: list[tuple[str, str]] = []  # (arquivo, comando) que falharam: 2ª passada
        for nome in ARQUIVOS_ESTRUTURA:
            caminho = os.path.join(SQL_DIR, nome)
            if not os.path.isfile(caminho):
                resumo[nome] = {'aplicados': 0, 'ignorados': 0, 'erros': ['arquivo ausente']}
                continue
            with open(caminho, encoding='utf-8') as f:
                texto = f.read()
            ck = _checksum(texto)
            anterior = feitos.get(nome)
            if not forcar and nome not in reaplicar and anterior and anterior[0] == ck and anterior[1] == 0:
                continue
            info = {'aplicados': 0, 'ignorados': 0, 'erros': []}
            for cmd in dividir_sql(texto):
                if deve_ignorar(cmd):
                    info['ignorados'] += 1
                    continue
                try:
                    conn.execute(cmd)
                    info['aplicados'] += 1
                except Exception as e:  # cada comando é independente (autocommit)
                    if getattr(e, 'sqlstate', None) in _JA_EXISTE:
                        info['aplicados'] += 1
                        continue
                    msg = (str(e).strip().splitlines() or [''])[0][:200]
                    info['erros'].append(msg)
                    pendentes.append((nome, cmd))
            resumo[nome] = info
            resumo[nome]['_checksum'] = ck
        # 2ª passada: comandos que dependiam de objetos criados em arquivos posteriores.
        for nome, cmd in pendentes:
            try:
                conn.execute(cmd)
                ok = True
            except Exception as e:
                ok = getattr(e, 'sqlstate', None) in _JA_EXISTE
            if ok:
                info = resumo[nome]
                info['aplicados'] += 1
                if info['erros']:
                    info['erros'].pop(0)
        for nome, info in resumo.items():
            ck = info.pop('_checksum', None)
            if ck is None:
                continue
            conn.execute(
                "INSERT INTO public._schema_bootstrap (arquivo, checksum, aplicado_em, erros)"
                " VALUES (%s, %s, NOW(), %s)"
                " ON CONFLICT (arquivo) DO UPDATE"
                " SET checksum = EXCLUDED.checksum, aplicado_em = NOW(), erros = EXCLUDED.erros",
                (nome, ck, len(info['erros'])),
            )
            log('[azure_schema] %s: %d aplicados, %d ignorados, %d erros' % (
                nome, info['aplicados'], info['ignorados'], len(info['erros'])))
            for e in info['erros'][:5]:
                log('[azure_schema]   - %s' % e)
        if not resumo:
            log('[azure_schema] estrutura já em dia.')
    finally:
        try:
            conn.execute('SELECT pg_advisory_unlock(%s)', (_TRAVA_ESTRUTURA,))
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass
    return resumo


def aplicar_em_background(conn_factory, atraso=3.0):
    """Roda aplicar_estrutura numa thread (não atrasa o boot / health check)."""
    def _run():
        try:
            time.sleep(atraso)
            aplicar_estrutura(conn_factory, log=lambda m: print(m, flush=True))
        except Exception as e:
            print('[azure_schema] falhou:', e, flush=True)
    threading.Thread(target=_run, daemon=True, name='azure_schema').start()
