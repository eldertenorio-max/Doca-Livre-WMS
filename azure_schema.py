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
    'fix_wms_camara_totais.sql',
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


def aplicar_estrutura(conn_factory, log=print, forcar=False) -> dict:
    """
    Aplica os arquivos de estrutura que ainda não foram aplicados (ou mudaram).
    conn_factory() deve devolver uma conexão psycopg *crua* (não CompatConn).
    Retorna um resumo {arquivo: {'aplicados': n, 'ignorados': n, 'erros': [...]}}.
    """
    resumo: dict = {}
    conn = conn_factory()
    try:
        conn.autocommit = True
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS public._schema_bootstrap (
                arquivo TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                aplicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                erros INTEGER NOT NULL DEFAULT 0
            )'''
        )
        feitos = {
            r[0]: r[1]
            for r in conn.execute('SELECT arquivo, checksum FROM public._schema_bootstrap').fetchall()
        }
        pendentes: list[tuple[str, str]] = []  # (arquivo, comando) que falharam: 2ª passada
        for nome in ARQUIVOS_ESTRUTURA:
            caminho = os.path.join(SQL_DIR, nome)
            if not os.path.isfile(caminho):
                resumo[nome] = {'aplicados': 0, 'ignorados': 0, 'erros': ['arquivo ausente']}
                continue
            with open(caminho, encoding='utf-8') as f:
                texto = f.read()
            ck = _checksum(texto)
            if not forcar and feitos.get(nome) == ck:
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
                    msg = (str(e).strip().splitlines() or [''])[0][:200]
                    info['erros'].append(msg)
                    pendentes.append((nome, cmd))
            resumo[nome] = info
            resumo[nome]['_checksum'] = ck
        # 2ª passada: comandos que dependiam de objetos criados em arquivos posteriores.
        for nome, cmd in pendentes:
            try:
                conn.execute(cmd)
                info = resumo[nome]
                info['aplicados'] += 1
                if info['erros']:
                    info['erros'].pop(0)
            except Exception:
                pass
        for nome, info in resumo.items():
            ck = info.pop('_checksum', None)
            if ck is None:
                continue
            conn.execute(
                '''INSERT INTO public._schema_bootstrap (arquivo, checksum, aplicado_em, erros)
                   VALUES (%s, %s, NOW(), %s)
                   ON CONFLICT (arquivo) DO UPDATE
                   SET checksum = EXCLUDED.checksum, aplicado_em = NOW(), erros = EXCLUDED.erros''',
                (nome, ck, len(info['erros'])),
            )
            log('[azure_schema] %s: %d aplicados, %d ignorados, %d erros' % (
                nome, info['aplicados'], info['ignorados'], len(info['erros'])))
            for e in info['erros'][:5]:
                log('[azure_schema]   - %s' % e)
    finally:
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
