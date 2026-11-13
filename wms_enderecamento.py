"""
Módulo WMS Endereçamento — localizações, paletes, putaway, recebimento e inventário.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
import string
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.parse import quote, urlencode

from flask import Blueprint, jsonify, make_response, redirect, render_template, request, session

from wms_etiqueta_zebra import (
    ETIQUETA_ZEBRA_ZD220,
    ctx_etiqueta_zebra,
    zpl_dimensoes_dots,
    zpl_longarina_grid_dots,
)
from wms_etiqueta_excel import gerar_workbook_longarina
from wms_endereco import (
    barcode_longarina as _barcode_longarina_mod,
    barcode_longarina_base as _barcode_longarina_base_mod,
    codigo_endereco as _codigo_endereco_mod,
    digito_verificador as _digito_verificador_mod,
    parse_bip as _parse_bip_mod,
    parse_codigo_wms as _parse_codigo_wms_mod,
)

bp = Blueprint('wms_enderecamento', __name__)

_get_db = None
_WMS_SCHEMA_READY = False
_WMS_AUX_DATA_READY = False
_WMS_DEFAULTS_SEEDED = False
_WMS_REC_TERCEIROS_COLS_READY = False
_WMS_ZONA_COLS_READY = False
_WMS_PROD_PLAN_COLS_READY = False
_WMS_PAINEL_CACHE = {'ts': 0.0, 'payload': None}
_WMS_PAINEL_TTL_SEC = 90
_WMS_ENDERECA_LEVE_CACHE = {'ts': 0.0, 'payload': None}
_WMS_ENDERECA_LEVE_TTL_SEC = 30
# Ações do passo a passo — sem ensure_wms_schema/seed (evita "Conferindo…" eterno).
_WMS_ACOES_BIP_LEVES = frozenset({
    'iniciar_bipagem',
    'reabrir_descarga',
    'bip_palete',
    'bip_produto',
    'sugerir_destino',
    'confirmar_armazenagem',
    'bip_etiqueta_palete',
})


def _invalidate_wms_painel_cache():
    _WMS_PAINEL_CACHE['ts'] = 0.0
    _WMS_PAINEL_CACHE['payload'] = None
    _WMS_ENDERECA_LEVE_CACHE['ts'] = 0.0
    _WMS_ENDERECA_LEVE_CACHE['payload'] = None


def register_wms_db(get_db_func):
    """Registra get_db de imediato (APIs WMS não dependem do schema em background)."""
    global _get_db
    _get_db = get_db_func


def init_wms_enderecamento(get_db_func):
    register_wms_db(get_db_func)
    try:
        conn = get_db_func()
        ensure_wms_schema(conn)
        try:
            _seed_wms_defaults(conn)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        try:
            _ensure_wms_aux_data(conn)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        conn.close()
    except Exception:
        pass


def _db():
    if _get_db is None:
        raise RuntimeError('WMS não inicializado: chame init_wms_enderecamento(get_db)')
    return _get_db()


def _usuario():
    return (session.get('usuario') or '').strip() or None


def _is_pg(conn):
    return getattr(conn, 'kind', None) == 'pg'


def _tbl(conn, name):
    return f'public.{name}' if _is_pg(conn) else name


def _ativo_sql(conn, alias=''):
    """Filtro de registro ativo (boolean no Postgres, integer no SQLite)."""
    p = f'{alias}.' if alias else ''
    if _is_pg(conn):
        return f'({p}ativo IS TRUE)'
    return f'({p}ativo = 1)'


def _bind_bool(conn, val=True):
    """Valor booleano para INSERT/UPDATE (Postgres bool, SQLite 0/1)."""
    if _is_pg(conn):
        return bool(val)
    return 1 if val else 0


def _bloqueio_off_sql(conn, col):
    """Filtro sem bloqueio ativo (boolean Postgres, integer SQLite)."""
    if _is_pg(conn):
        return f'({col} IS NOT TRUE)'
    return f'({col} = 0 OR {col} IS NULL)'


def _int_col(row, key='c', default=0):
    d = _row_dict(row)
    if not d:
        return default
    try:
        return int(d.get(key) if d.get(key) is not None else default)
    except (TypeError, ValueError):
        return default


def _wms_tabelas_existem(conn):
    t = _tbl(conn, 'wms_localizacao')
    try:
        conn.execute(f'SELECT 1 FROM {t} LIMIT 1')
        return True
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _map_nomes_camaras(conn):
    """Mapa código → nome/descrição da câmara (wms_camara)."""
    if not conn or not _wms_tabelas_existem(conn):
        return {}
    try:
        rows = conn.execute(
            f'SELECT codigo, descricao FROM {_tbl(conn, "wms_camara")} ORDER BY codigo',
        ).fetchall()
    except Exception:
        return {}
    out = {}
    for r in rows or []:
        rd = _row_dict(r) or {}
        cod = int(rd.get('codigo') or 0)
        if not cod:
            continue
        desc = str(rd.get('descricao') or '').strip()
        out[cod] = desc or ('Câmara %s' % cod)
    return out


def _nome_camara_label(conn, camara, nomes=None):
    cam = int(camara or 0)
    if nomes is None and conn:
        nomes = _map_nomes_camaras(conn)
    nome = (nomes or {}).get(cam) if nomes else None
    if nome:
        return nome
    return 'Câmara %s' % cam if cam else ''


def _validar_data_producao_fifo(dp):
    """Data de produção não pode ser futura (conferência / FIFO)."""
    if not dp:
        return 'Informe a data de produção na bipagem (FIFO).'
    raw = str(dp).strip()[:10]
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        return 'Data de produção inválida.'
    if d > date.today():
        return 'Data de produção não pode ser maior que o dia atual.'
    return None


def _formatar_data_etiqueta(val):
    """Converte data ISO (YYYY-MM-DD) para DD/MM/YYYY na etiqueta."""
    if val is None or val == '':
        return None
    if hasattr(val, 'strftime'):
        try:
            return val.strftime('%d/%m/%Y')
        except Exception:
            pass
    s = str(val).strip()
    if not s:
        return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return f'{m.group(3)}/{m.group(2)}/{m.group(1)}'
    m_br = re.match(r'^(\d{2})/(\d{2})/(\d{4})', s)
    if m_br:
        return f'{m_br.group(1)}/{m_br.group(2)}/{m_br.group(3)}'
    return s[:10]


def _codigo_endereco(camara, rua, posicao, nivel):
    return _codigo_endereco_mod(camara, rua, posicao, nivel)


def _ruas_camara(camara):
    cfg = _layout_camaras_config()
    for bloco in cfg.get('camaras') or []:
        if int(bloco['codigo']) == int(camara):
            return [str(r).strip().upper() for r in (bloco.get('ruas') or ['R'])]
    return ['R']


def _rua_para_apto(camara, rua):
    ruas = _ruas_camara(camara)
    r = str(rua or '').strip().upper()
    if r in ruas:
        return ruas.index(r) + 1
    return 1


def _apto_para_rua(camara, apto):
    ruas = _ruas_camara(camara)
    idx = int(apto) - 1
    if 0 <= idx < len(ruas):
        return ruas[idx]
    return ruas[0] if ruas else 'R'


def _barcode_longarina(camara, posicao, nivel, apto=None, rua=None):
    """Bipagem da longarina com dígito verificador (ex.: 12.14.1*47)."""
    if not rua and apto is not None:
        rua = _apto_para_rua(camara, apto)
    return _barcode_longarina_mod(camara, posicao, nivel, rua=rua)


def _barcode_longarina_base(bc):
    return _barcode_longarina_base_mod(bc)


def _codigo_endereco_por_cam_col_niv(conn, camara, posicao, nivel):
    """Resolve Câm·Col·Nív para código WMS quando há uma única vaga no banco."""
    t_loc = _tbl(conn, 'wms_localizacao')
    rows = conn.execute(
        f'''SELECT codigo_endereco FROM {t_loc}
            WHERE camara = ? AND posicao = ? AND nivel = ?''',
        (int(camara), int(posicao), int(nivel)),
    ).fetchall()
    if len(rows) == 1:
        rd = _row_dict(rows[0]) or {}
        return (rd.get('codigo_endereco') or '').strip().upper() or None
    return None


def _resolver_codigo_endereco_bip(codigo, conn=None):
    """Aceita bip da longarina (12.14.1*DV, 12.14.1 ou legado 12.14.1.1) ou código WMS (12-C-14-1)."""
    parsed = _parse_bip_mod(codigo)
    if parsed.get('erro') and not parsed.get('ok'):
        return None
    if parsed.get('codigo_wms'):
        rua = parsed.get('rua')
        dv = parsed.get('dv')
        if dv and rua:
            if dv != _digito_verificador_mod(
                parsed['camara'], rua, parsed['posicao'], parsed['nivel']
            ):
                return None
        return parsed['codigo_wms']
    cam = parsed.get('camara')
    pos = parsed.get('posicao')
    niv = parsed.get('nivel')
    if cam is None or pos is None or niv is None:
        return None
    if parsed.get('apto') is not None:
        rua = _apto_para_rua(cam, parsed['apto'])
        return _codigo_endereco(cam, rua, pos, niv)
    dv = parsed.get('dv')
    ruas = _ruas_camara(cam)
    if dv and ruas:
        matches = [
            r for r in ruas
            if _digito_verificador_mod(cam, r, pos, niv) == dv
        ]
        if len(matches) == 1:
            return _codigo_endereco(cam, matches[0], pos, niv)
        if not matches:
            return None
    if conn:
        cod = _codigo_endereco_por_cam_col_niv(conn, cam, pos, niv)
        if cod:
            return cod
    return None


def _erro_bip_endereco(codigo):
    parsed = _parse_bip_mod(codigo)
    if parsed.get('erro'):
        return parsed['erro']
    dv = parsed.get('dv')
    cam = parsed.get('camara')
    pos = parsed.get('posicao')
    niv = parsed.get('nivel')
    if dv and cam is not None and pos is not None and niv is not None:
        rua = parsed.get('rua')
        if rua:
            if dv != _digito_verificador_mod(cam, rua, pos, niv):
                return 'Dígito verificador inválido. Bipe a etiqueta da posição, não digite de memória.'
        else:
            matches = [
                r for r in _ruas_camara(cam)
                if _digito_verificador_mod(cam, r, pos, niv) == dv
            ]
            if not matches:
                return 'Dígito verificador inválido. Bipe a etiqueta da posição, não digite de memória.'
    return None


def _texto_endereco_humanizado(cam, rua, pos, niv, zona_label=None, destino_label=None):
    """Linha legível para etiquetas de palete e UI (sem Apto — rua já identifica o lado)."""
    zl = (destino_label or zona_label or '').strip()
    base = f'Câmara {int(cam)} · Rua {str(rua).upper()} · Col {int(pos)} · Nív {int(niv)}'
    if zl:
        return f'{base} ({zl})'
    return base


def _campos_etiqueta_palete_endereco(sug=None, codigo_wms=None, endereco_texto=None):
    """Campos estruturados para o template da etiqueta de palete."""
    cam = rua = col = niv = zona = texto = None
    if sug:
        cam = sug.get('camara') or sug.get('rua_num')
        rua = sug.get('rua_letra') or sug.get('rua')
        col = sug.get('predio') or sug.get('posicao')
        niv = sug.get('nivel')
        zona = (sug.get('zona_label') or sug.get('zona') or '').strip() or None
        texto = (sug.get('texto') or sug.get('texto_humano') or '').strip() or None
    cod = (codigo_wms or '').strip().upper()
    if not cod and sug:
        cod = (sug.get('codigo_wms') or sug.get('codigo_endereco') or '').strip().upper()
    if cod:
        parts = cod.split('-')
        if len(parts) == 4:
            cam = cam or parts[0]
            rua = rua or parts[1]
            col = col or parts[2]
            niv = niv or parts[3]
    if not texto and cam and rua and col is not None and niv is not None:
        try:
            texto = _texto_endereco_humanizado(int(cam), rua, int(col), int(niv), zona_label=zona)
        except (TypeError, ValueError):
            pass
    if not texto and endereco_texto:
        texto = endereco_texto.strip()
    return {
        'camara': str(int(cam)) if cam is not None and str(cam).isdigit() else (str(cam) if cam else None),
        'rua': str(rua).upper() if rua else None,
        'coluna': str(col) if col is not None else None,
        'nivel': str(niv) if niv is not None else None,
        'zona': zona,
        'endereco_texto': texto,
    }


# Câmaras de estoque (paletes). Renumeradas em 2026-11: 11→6, 12→7, 13→14, 21→15 e nova 16 (ruas I/J).
_WMS_CAMARAS_ESTOQUE = (6, 7, 14, 15, 16)
# Bloco principal (ex-11/12/13): contagem diária, temperatura e resumo de ocupação padrão.
_WMS_CAMARAS_PRINCIPAIS = (6, 7, 14)
_WMS_CAMARAS_ESTOQUE_SQL = ', '.join(str(c) for c in _WMS_CAMARAS_ESTOQUE)
_WMS_CAMARA_TOTAIS_PADRAO = {6: 148, 7: 133, 14: 142, 15: 28, 16: 150}
_WMS_CAMARA_STAGE = 99
_WMS_CAMARA_ESPECIAL = 98
_WMS_STAGE_SLOTS_POR_DOCA = 40
_WMS_AREAS_ESPECIAIS_DEFAULT = {
    'camara': 98,
    'descricao': 'Áreas especiais — quarentena, descarte, MG e reentregas',
    'areas': [
        {'area': 'descarte_perdas', 'rua': 'DP', 'slots': 10, 'label': 'Descarte / perdas'},
        {'area': 'avaria', 'rua': 'AV', 'slots': 3, 'label': 'Avariado (descarte avariado)'},
        {'area': 'retrabalho', 'rua': 'RT', 'slots': 5, 'label': 'Retrabalho'},
        {'area': 'palete_bloqueado', 'rua': 'PB', 'slots': 5, 'label': 'Palete bloqueado'},
        {'area': 'envio_mg', 'rua': 'MG', 'slots': 10, 'label': 'Envio MG'},
        {'area': 'reentregas', 'rua': 'RE', 'slots': 15, 'label': 'Reentregas (retorno da rua)'},
    ],
}


def _layout_camaras_config():
    path = os.path.join(os.path.dirname(__file__), 'data', 'wms_layout_camaras.json')
    if not os.path.isfile(path):
        return {
            'camaras': [
                {'codigo': 6, 'ruas': ['A', 'B'], 'niveis': 5, 'total_posicoes': 148},
                {'codigo': 7, 'ruas': ['C', 'D'], 'niveis': 5, 'total_posicoes': 133},
                {'codigo': 14, 'ruas': ['E', 'F'], 'niveis': 5, 'total_posicoes': 142},
                {'codigo': 15, 'ruas': ['G', 'H'], 'niveis': 2, 'total_posicoes': 28},
                {'codigo': 16, 'ruas': ['I', 'J'], 'niveis': 5, 'total_posicoes': 150},
            ]
        }
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _layout_bloqueios_fisicos():
    return (_layout_camaras_config().get('bloqueios_fisicos') or [])


def _sequencia_rota_layout():
    """Sentido de corredor (serpentina) por câmara/rua — JSON de layout."""
    cfg = _layout_camaras_config().get('sequencia_rota') or {}
    camaras_cfg = cfg.get('camaras') or {}
    padrao_nivel = (cfg.get('sentido_nivel') or 'asc').lower()
    out = {}
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cam = str(int(bloco.get('codigo') or 0))
        ruas = [str(r).strip().upper() for r in (bloco.get('ruas') or [])]
        spec = camaras_cfg.get(cam) or camaras_cfg.get(int(cam) if cam.isdigit() else cam) or {}
        sentido = spec.get('sentido_posicao') or {}
        nivel = (spec.get('sentido_nivel') or padrao_nivel).lower()
        pos_map = {}
        for i, rua in enumerate(ruas):
            raw = str(sentido.get(rua) or sentido.get(rua.lower()) or '').lower()
            if raw in ('asc', 'desc', 'crescente', 'decrescente'):
                pos_map[rua] = 'desc' if raw in ('desc', 'decrescente') else 'asc'
            else:
                pos_map[rua] = 'desc' if i % 2 else 'asc'
        out[int(cam)] = {'ruas': ruas, 'sentido_posicao': pos_map, 'sentido_nivel': nivel}
    return out


def _sql_ident_rua(rua):
    return re.sub(r'[^A-Z0-9]', '', str(rua or '').upper())[:3]


def _sql_ordem_rota(camara, conn=None):
    """ORDER BY rua na ordem da planta, posição no sentido do corredor, nível."""
    spec = _rota_camara(camara, conn)
    ruas = spec.get('ruas') or []
    sentido = spec.get('sentido_posicao') or {}
    nivel_dir = spec.get('sentido_nivel') or 'asc'
    if not ruas:
        niv = 'l.nivel DESC' if nivel_dir == 'desc' else 'l.nivel'
        return f'l.rua, l.posicao, {niv}'
    rua_whens = []
    pos_whens = []
    for i, rua in enumerate(ruas):
        ident = _sql_ident_rua(rua)
        if not ident:
            continue
        rua_whens.append(f"WHEN UPPER(TRIM(l.rua)) = '{ident}' THEN {i}")
        if sentido.get(rua) == 'desc':
            pos_whens.append(f"WHEN UPPER(TRIM(l.rua)) = '{ident}' THEN -l.posicao")
        else:
            pos_whens.append(f"WHEN UPPER(TRIM(l.rua)) = '{ident}' THEN l.posicao")
    rua_sql = f"CASE {' '.join(rua_whens)} ELSE 99 END" if rua_whens else 'l.rua'
    pos_sql = f"CASE {' '.join(pos_whens)} ELSE l.posicao END" if pos_whens else 'l.posicao'
    niv_sql = 'l.nivel DESC' if nivel_dir == 'desc' else 'l.nivel'
    return f'{rua_sql}, {pos_sql}, {niv_sql}'


def _rota_camara(camara, conn=None):
    spec = dict(_sequencia_rota_layout().get(int(camara)) or {})
    spec['sentido_posicao'] = dict(spec.get('sentido_posicao') or {})
    if conn is None:
        return spec
    try:
        t = _tbl(conn, 'wms_sequencia_rota')
        rows = conn.execute(
            f'SELECT rua, sentido_posicao, sentido_nivel FROM {t} WHERE camara = ?',
            (int(camara),),
        ).fetchall()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return spec
    for r in rows or []:
        rd = _row_dict(r) or {}
        rua = str(rd.get('rua') or '').strip().upper()
        if not rua:
            continue
        sp = str(rd.get('sentido_posicao') or '').lower()
        spec['sentido_posicao'][rua] = 'desc' if sp in ('desc', 'decrescente') else 'asc'
        sn = str(rd.get('sentido_nivel') or '').lower()
        if sn in ('asc', 'desc'):
            spec['sentido_nivel'] = sn
    return spec


def _chave_travel_item(item, conn=None):
    cam = item.get('camara')
    rua = str(item.get('rua') or '').upper()
    pos = item.get('posicao')
    niv = item.get('nivel')
    if cam is None or not rua:
        parsed = _parse_codigo_wms_mod(item.get('endereco') or item.get('codigo_endereco') or '')
        if parsed:
            cam = parsed.get('camara') if cam is None else cam
            rua = rua or str(parsed.get('rua') or '').upper()
            pos = pos if pos is not None else parsed.get('posicao')
            niv = niv if niv is not None else parsed.get('nivel')
    if cam is None:
        return (99, 99, 0, 0)
    spec = _rota_camara(int(cam), conn)
    ruas = spec.get('ruas') or []
    idx = ruas.index(rua) if rua in ruas else 99
    desc = (spec.get('sentido_posicao') or {}).get(rua) == 'desc'
    pos_ord = -(int(pos or 0)) if desc else int(pos or 0)
    niv_ord = int(niv or 0)
    if (spec.get('sentido_nivel') or 'asc') == 'desc':
        niv_ord = -niv_ord
    return (int(cam), idx, pos_ord, niv_ord)


def _listar_sequencia_rota(conn=None):
    """Sentido de cada corredor: JSON de planta + overrides do banco."""
    layout = _sequencia_rota_layout()
    db_map = {}
    if conn is not None:
        try:
            t = _tbl(conn, 'wms_sequencia_rota')
            rows = conn.execute(
                f'SELECT camara, rua, sentido_posicao, sentido_nivel FROM {t}'
            ).fetchall()
            for r in rows or []:
                rd = _row_dict(r) or {}
                cam = int(rd.get('camara') or 0)
                rua = str(rd.get('rua') or '').strip().upper()
                if not cam or not rua:
                    continue
                db_map[(cam, rua)] = rd
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    out = []
    for cam, spec in sorted(layout.items()):
        nivel_padrao = spec.get('sentido_nivel') or 'asc'
        for rua in spec.get('ruas') or []:
            db = db_map.get((int(cam), rua)) or {}
            sp = str(db.get('sentido_posicao') or (spec.get('sentido_posicao') or {}).get(rua) or 'asc').lower()
            sn = str(db.get('sentido_nivel') or nivel_padrao).lower()
            out.append({
                'camara': int(cam),
                'rua': rua,
                'sentido_posicao': 'desc' if sp in ('desc', 'decrescente') else 'asc',
                'sentido_nivel': 'desc' if sn == 'desc' else 'asc',
            })
    return out


def _salvar_sequencia_rota(conn, linhas):
    _ensure_sequencia_rota_table(conn)
    t = _tbl(conn, 'wms_sequencia_rota')
    n = 0
    for raw in linhas or []:
        try:
            cam = int(raw.get('camara') or 0)
        except (TypeError, ValueError):
            continue
        rua = str(raw.get('rua') or '').strip().upper()
        if not cam or not rua:
            continue
        sp = str(raw.get('sentido_posicao') or 'asc').lower()
        sn = str(raw.get('sentido_nivel') or 'asc').lower()
        sp = 'desc' if sp in ('desc', 'decrescente') else 'asc'
        sn = 'desc' if sn == 'desc' else 'asc'
        conn.execute(
            f'''INSERT INTO {t} (camara, rua, sentido_posicao, sentido_nivel)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (camara, rua) DO UPDATE SET
                  sentido_posicao = EXCLUDED.sentido_posicao,
                  sentido_nivel = EXCLUDED.sentido_nivel''',
            (cam, rua, sp, sn),
        )
        n += 1
    conn.commit()
    return n


def _celula_bloqueada_fisica(camara, rua, posicao, nivel):
    """Posições inexistentes fisicamente (ex.: topo bloqueado em colunas 14–15)."""
    cam = int(camara)
    pos = int(posicao)
    niv = int(nivel)
    rua_u = str(rua or '').strip().upper()
    for bloco in _layout_bloqueios_fisicos():
        if int(bloco.get('camara') or 0) != cam:
            continue
        ruas = bloco.get('ruas')
        if ruas:
            ruas_ok = {str(r).strip().upper() for r in ruas}
            if rua_u not in ruas_ok:
                continue
        colunas = [int(c) for c in (bloco.get('colunas') or [])]
        niveis = [int(n) for n in (bloco.get('niveis') or [])]
        if pos in colunas and niv in niveis:
            return True
    return False


def _total_posicoes_ref(camara, bloco=None):
    """Capacidade física de referência — não usar COUNT(*) do banco."""
    if bloco and bloco.get('total_posicoes'):
        return int(bloco['total_posicoes'])
    for b in (_layout_camaras_config().get('camaras') or []):
        if int(b.get('codigo') or 0) == int(camara) and b.get('total_posicoes'):
            return int(b['total_posicoes'])
    return int(_WMS_CAMARA_TOTAIS_PADRAO.get(int(camara), 0))


def _map_totais_ref_camaras():
    out = dict(_WMS_CAMARA_TOTAIS_PADRAO)
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cod = int(bloco.get('codigo') or 0)
        if cod and bloco.get('total_posicoes'):
            out[cod] = int(bloco['total_posicoes'])
    return out


def _limpar_localizacoes_orfas_vazias(conn, camara, codigos_validos):
    if not codigos_validos:
        return 0
    t_loc = _tbl(conn, 'wms_localizacao')
    ph = ','.join(['?' for _ in codigos_validos])
    cur = conn.execute(
        f'''DELETE FROM {t_loc}
            WHERE camara = ? AND status = 'vazia'
              AND codigo_endereco NOT IN ({ph})''',
        (int(camara), *codigos_validos),
    )
    return int(getattr(cur, 'rowcount', 0) or 0)


def _sync_wms_camara_layout(conn):
    """Restaura total_posicoes de referência e remove endereços vazios fora do layout."""
    if not _wms_tabelas_existem(conn):
        return
    t_cam = _tbl(conn, 'wms_camara')
    refs = _map_totais_ref_camaras()
    removidas = 0
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cod = int(bloco['codigo'])
        total = _total_posicoes_ref(cod, bloco)
        if total <= 0:
            continue
        conn.execute(f'UPDATE {t_cam} SET total_posicoes = ? WHERE codigo = ?', (total, cod))
        coords = _coords_from_bloco_layout(bloco)
        codigos = {_codigo_endereco(c, r, p, n) for c, r, p, n, _da, _dl, _ar in coords}
        removidas += _limpar_localizacoes_orfas_vazias(conn, cod, codigos)
    try:
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return removidas


def _ensure_categoria_zona_column(conn):
    if _is_pg(conn):
        try:
            conn.execute(
                'ALTER TABLE public.wms_localizacao ADD COLUMN IF NOT EXISTS categoria_zona TEXT'
            )
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    else:
        try:
            cols = conn.execute('PRAGMA table_info(wms_localizacao)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (cols or [])}
            if 'categoria_zona' not in names:
                conn.execute('ALTER TABLE wms_localizacao ADD COLUMN categoria_zona TEXT')
                conn.commit()
        except Exception:
            pass


def _ensure_zona_armazenagem_column(conn, backfill=False):
    """Garante coluna zona_armazenagem. Backfill em massa só sob demanda (nunca no boot de API)."""
    global _WMS_ZONA_COLS_READY
    if _WMS_ZONA_COLS_READY and not backfill:
        return
    _ensure_categoria_zona_column(conn)
    if _is_pg(conn):
        try:
            conn.execute(
                'ALTER TABLE public.wms_localizacao ADD COLUMN IF NOT EXISTS zona_armazenagem TEXT'
            )
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    else:
        try:
            cols = conn.execute('PRAGMA table_info(wms_localizacao)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (cols or [])}
            if 'zona_armazenagem' not in names:
                conn.execute('ALTER TABLE wms_localizacao ADD COLUMN zona_armazenagem TEXT')
                conn.commit()
        except Exception:
            pass
    if not _WMS_ZONA_COLS_READY:
        _WMS_ZONA_COLS_READY = True
    if not backfill:
        return
    t_loc = _tbl(conn, 'wms_localizacao')
    try:
        conn.execute(
            f"""UPDATE {t_loc} SET zona_armazenagem = CASE
                WHEN COALESCE(nivel, 0) = 1 THEN 'picking' ELSE 'pulmao' END
                WHERE zona_armazenagem IS NULL OR TRIM(zona_armazenagem) = ''"""
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _zona_por_nivel(nivel):
    return 'picking' if int(nivel or 0) == 1 else 'pulmao'


def _zona_label(zona):
    z = (zona or '').lower()
    if z == 'picking':
        return 'PICKING'
    if z in ('pulmao', ''):
        return 'PULMÃO'
    labels = _destinos_acao_labels()
    return labels.get(z, z.replace('_', ' ').upper())


def _format_locacao(loc):
    d = _row_dict(loc) or {}
    if not d:
        return {}
    tipo = (d.get('tipo') or '').strip().lower()
    area = (d.get('area') or '').strip().lower()
    labels = _destinos_acao_labels()
    destino_label = labels.get(area) if tipo == 'destino_fixo' and area else None
    zona = (d.get('zona_armazenagem') or _zona_por_nivel(d.get('nivel'))).lower()
    if tipo == 'destino_fixo' and area:
        zona = area
    cam = d.get('camara')
    rua = d.get('rua')
    pos = d.get('posicao')
    niv = d.get('nivel')
    zl = _zona_label(zona)
    apto = _rua_para_apto(cam, rua)
    bc_long = _barcode_longarina(cam, pos, niv, apto=apto)
    cod_wms = (d.get('codigo_endereco') or _codigo_endereco(cam, rua, pos, niv)).upper()
    texto = _texto_endereco_humanizado(cam, rua, pos, niv, zona_label=zl, destino_label=destino_label)
    if destino_label:
        texto = f'{destino_label} · {cod_wms} · {bc_long}'
    return {
        **d,
        'zona_armazenagem': zona,
        'zona_label': zl,
        'destino_label': destino_label,
        'texto': texto,
        'barcode_longarina': bc_long,
        'codigo_wms': cod_wms,
        'rua_letra': str(rua).upper(),
        'rua_num': str(int(cam)),
        'predio': str(int(pos)),
        'apto': str(apto),
    }


def _tbl_romaneio(conn):
    return 'public.romaneio_por_item' if _is_pg(conn) else 'romaneio_por_item'


def _filtro_zona_sql(zona, alias=''):
    p = f'{alias}.' if alias else ''
    z = (zona or 'pulmao').lower()
    if z == 'picking':
        return f"({p}nivel = 1 OR LOWER(COALESCE({p}zona_armazenagem, '')) = 'picking')"
    return f"({p}nivel >= 2 OR LOWER(COALESCE({p}zona_armazenagem, '')) = 'pulmao')"


def _ensure_produto_planejamento_columns(conn):
    global _WMS_PROD_PLAN_COLS_READY
    if _WMS_PROD_PLAN_COLS_READY:
        return
    cols_pg = [
        ('pedido_med_abril', 'INTEGER'),
        ('pedido_max_abril', 'INTEGER'),
        ('media_5_dias', 'INTEGER'),
        ('estoque_ideal_max', 'INTEGER'),
        ('estoque_ideal_med', 'INTEGER'),
        ('estoque_ideal_min', 'INTEGER'),
        ('dias_estoque_max', 'SMALLINT'),
        ('dias_estoque_med', 'SMALLINT'),
        ('dias_estoque_min', 'SMALLINT'),
        ('posicoes_max', 'SMALLINT'),
        ('posicoes_med', 'SMALLINT'),
        ('posicoes_min', 'SMALLINT'),
        ('estoque_atual', 'INTEGER'),
        ('posicao_atual', 'SMALLINT'),
        ('status_condicional', 'TEXT'),
    ]
    if _is_pg(conn):
        for name, typ in cols_pg:
            try:
                conn.execute(f'ALTER TABLE public.wms_produto_enderecamento ADD COLUMN IF NOT EXISTS {name} {typ}')
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass
    else:
        try:
            existing = conn.execute('PRAGMA table_info(wms_produto_enderecamento)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (existing or [])}
            for name, typ in cols_pg:
                if name not in names:
                    conn.execute(f'ALTER TABLE wms_produto_enderecamento ADD COLUMN {name} {typ}')
            conn.commit()
        except Exception:
            pass
    _WMS_PROD_PLAN_COLS_READY = True


def _ensure_pg_rls_basico(conn, nome_tabela):
    """Habilita RLS + policies padrão no Postgres (remove SEM RESTRIÇÕES no Supabase)."""
    if not _is_pg(conn):
        return
    t = _tbl(conn, nome_tabela)
    role_check = "(SELECT auth.role() IN ('anon'::text, 'authenticated'::text, 'service_role'::text))"
    try:
        conn.execute(f'ALTER TABLE {t} ENABLE ROW LEVEL SECURITY')
        for acao, sql_tail in (
            ('SELECT', 'FOR SELECT USING (true)'),
            ('INSERT', f'FOR INSERT WITH CHECK ({role_check})'),
            ('UPDATE', f'FOR UPDATE USING ({role_check})'),
            ('DELETE', f'FOR DELETE USING ({role_check})'),
        ):
            pol = f'Permitir {acao} em {nome_tabela}'
            conn.execute(f'DROP POLICY IF EXISTS "{pol}" ON {t}')
            conn.execute(f'CREATE POLICY "{pol}" ON {t} {sql_tail}')
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _ensure_wms_palete_controle_table(conn):
    t = _tbl(conn, 'wms_palete_controle')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    if _is_pg(conn):
        try:
            conn.execute(
                f'''CREATE TABLE IF NOT EXISTS {t} (
                    id BIGSERIAL PRIMARY KEY,
                    palete_id BIGINT NOT NULL REFERENCES {t_pal}(id) ON DELETE CASCADE,
                    tipo TEXT NOT NULL,
                    subtipo TEXT,
                    motivo TEXT,
                    destino_externo TEXT,
                    localizacao_id BIGINT REFERENCES {t_loc}(id) ON DELETE SET NULL,
                    codigo_endereco TEXT,
                    observacao TEXT,
                    registro_saida_id BIGINT REFERENCES {t}(id) ON DELETE SET NULL,
                    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    criado_por TEXT
                )'''
            )
            conn.execute(f'CREATE INDEX IF NOT EXISTS idx_wms_pal_ctrl_palete ON {t} (palete_id, criado_em DESC)')
            conn.commit()
            _ensure_pg_rls_basico(conn, 'wms_palete_controle')
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    else:
        try:
            conn.execute(
                '''CREATE TABLE IF NOT EXISTS wms_palete_controle (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palete_id INTEGER NOT NULL,
                    tipo TEXT NOT NULL,
                    subtipo TEXT,
                    motivo TEXT,
                    destino_externo TEXT,
                    localizacao_id INTEGER,
                    codigo_endereco TEXT,
                    observacao TEXT,
                    registro_saida_id INTEGER,
                    criado_em TEXT NOT NULL,
                    criado_por TEXT
                )'''
            )
            conn.commit()
        except Exception:
            pass


def _rotulo_disposicao_entrada(disposicao):
    d = (disposicao or '').strip().lower()
    if not d or d in ('bom', 'normal', 'ok'):
        return 'Estoque normal'
    if d == 'avaria':
        return 'Avaria'
    if d == 'descarte_perdas':
        return 'Descarte/perdas'
    if d == 'palete_bloqueado':
        return 'Palete bloqueado'
    return disposicao or 'Estoque normal'


def _normalizar_disposicao_item(disposicao):
    d = (disposicao or '').strip().lower()
    if not d or d in ('bom', 'normal', 'ok'):
        return 'normal'
    return d


def _destinos_linha_vazio():
    return {}


def _destinos_linha_add(destinos, disposicao, qtd, armazenado=False):
    key = _normalizar_disposicao_item(disposicao)
    if key not in destinos:
        destinos[key] = {'bip': 0.0, 'arm': 0.0}
    destinos[key]['bip'] += float(qtd or 0)
    if armazenado:
        destinos[key]['arm'] += float(qtd or 0)


def _montar_resumo_andamento_item_nf(destinos, q_pendente=0):
    """Texto legível do que já foi bipado/classificado na linha da NF."""
    partes = []
    for disp in sorted((destinos or {}).keys(), key=lambda x: (x != 'normal', x)):
        info = destinos.get(disp) or {}
        q_bip = float(info.get('bip') or 0)
        if q_bip <= 0:
            continue
        q_arm = float(info.get('arm') or 0)
        q_aguard = max(q_bip - q_arm, 0)
        lbl = _rotulo_disposicao_entrada(disp)
        q_fmt = int(q_bip) if q_bip == int(q_bip) else q_bip
        if q_arm >= q_bip:
            partes.append(f'{q_fmt} cx {lbl} (guardado)')
        elif q_arm > 0:
            partes.append(
                f'{int(q_arm) if q_arm == int(q_arm) else q_arm} cx {lbl} (guardado)'
                f' + {int(q_aguard) if q_aguard == int(q_aguard) else q_aguard} aguard. guardar'
            )
        else:
            partes.append(f'{q_fmt} cx {lbl} (aguard. guardar)')
    if q_pendente and float(q_pendente) > 0:
        qp = float(q_pendente)
        qp_fmt = int(qp) if qp == int(qp) else qp
        partes.append(f'{qp_fmt} cx pendente bipagem')
    return ' · '.join(partes) if partes else '—'


def _destinos_linha_para_api(destinos):
    out = []
    for disp in sorted((destinos or {}).keys(), key=lambda x: (x != 'normal', x)):
        info = destinos.get(disp) or {}
        q_bip = float(info.get('bip') or 0)
        if q_bip <= 0:
            continue
        q_arm = float(info.get('arm') or 0)
        out.append({
            'disposicao': disp,
            'rotulo': _rotulo_disposicao_entrada(disp),
            'quantidade': q_bip,
            'armazenada': q_arm,
            'aguardando_guardar': max(q_bip - q_arm, 0),
        })
    return out


WMS_DISPOSICOES_ENTRADA = frozenset({'avaria', 'descarte_perdas', 'palete_bloqueado'})


def _estado_recebimento_para_disposicao(estado):
    raw = (estado or '').strip().lower()
    if raw in ('', 'bom', 'normal', 'ok'):
        return None
    if raw in WMS_DISPOSICOES_ENTRADA:
        return raw
    if raw == 'deteriorado':
        return 'descarte_perdas'
    if raw == 'avaria':
        return 'avaria'
    return None


def _ensure_wms_palete_item_disposicao(conn):
    cols = [('disposicao_estoque', 'TEXT'), ('estoque_sp_lancado', 'INTEGER' if not _is_pg(conn) else 'SMALLINT')]
    t = _tbl(conn, 'wms_palete_item')
    if _is_pg(conn):
        for name, typ in cols:
            try:
                conn.execute(f'ALTER TABLE {t} ADD COLUMN IF NOT EXISTS {name} {typ}')
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass
    else:
        try:
            existing = conn.execute('PRAGMA table_info(wms_palete_item)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (existing or [])}
            for name, typ in cols:
                if name not in names:
                    conn.execute(f'ALTER TABLE wms_palete_item ADD COLUMN {name} {typ}')
            conn.commit()
        except Exception:
            pass


def _ensure_produtos_bipados_wms_cols(conn):
    tbl = 'public.produtos_bipados' if _is_pg(conn) else 'produtos_bipados'
    try:
        if _is_pg(conn):
            conn.execute(f'ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS disposicao_estoque TEXT')
            conn.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS fluxo TEXT DEFAULT 'carregamento'")
            conn.commit()
        else:
            cols = [r[1] for r in conn.execute('PRAGMA table_info(produtos_bipados)').fetchall()]
            if 'disposicao_estoque' not in cols:
                conn.execute('ALTER TABLE produtos_bipados ADD COLUMN disposicao_estoque TEXT')
            if 'fluxo' not in cols:
                conn.execute("ALTER TABLE produtos_bipados ADD COLUMN fluxo TEXT DEFAULT 'carregamento'")
            conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _registrar_entrada_classificada_estoque_sp(conn, palete_id):
    """Lança itens classificados (avaria/perdas/bloqueado) nas abas do Estoque SP."""
    _ensure_wms_palete_item_disposicao(conn)
    _ensure_produtos_bipados_wms_cols(conn)
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_rec = _tbl(conn, 'wms_recebimento')
    pal = conn.execute(
        f'''SELECT p.id, p.etiqueta, p.recebimento_id, r.numero_nf
            FROM {t_pal} p
            LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
            WHERE p.id = ?''',
        (int(palete_id),),
    ).fetchone()
    if not pal:
        return 0
    pd = _row_dict(pal) or {}
    rows = conn.execute(
        f'''SELECT id, sku, descricao, quantidade_caixas, disposicao_estoque
            FROM {t_item}
            WHERE palete_id = ?
              AND COALESCE(estoque_sp_lancado, 0) = 0
              AND COALESCE(disposicao_estoque, '') IN ('avaria', 'descarte_perdas', 'palete_bloqueado')''',
        (int(palete_id),),
    ).fetchall()
    if not rows:
        return 0
    agora = datetime.now(timezone.utc)
    user = _usuario() or ''
    rid = pd.get('recebimento_id') or ''
    nf = (pd.get('numero_nf') or '').strip()
    id_viagem_ref = f'wms-rec-{rid}' if rid else f'wms-pal-{palete_id}'
    veiculo = f'NF {nf}' if nf else 'Recebimento WMS'
    lancados = 0
    for r in rows:
        rd = _row_dict(r) or {}
        item_id = rd.get('id')
        sku = (rd.get('sku') or '').strip()
        disp = (rd.get('disposicao_estoque') or '').strip()
        qtd = int(rd.get('quantidade_caixas') or 0)
        if not sku or qtd <= 0 or not disp:
            continue
        conn.execute(
            '''INSERT INTO produtos_bipados
               (codigo_barras, produto, quantidade, data_hora, veiculo, status, id_viagem,
                codigo_interno, unidade, usuario_bipagem, fluxo, disposicao_estoque)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                sku,
                (rd.get('descricao') or sku),
                qtd,
                agora,
                veiculo,
                'PENDENTE',
                id_viagem_ref,
                sku,
                'Caixa',
                user,
                'devolucao',
                disp,
            ),
        )
        if item_id is not None:
            conn.execute(
                f'UPDATE {t_item} SET estoque_sp_lancado = ? WHERE id = ?',
                (_bind_bool(conn, True), int(item_id)),
            )
        lancados += 1
    return lancados


def _ensure_wms_palete_item_nf_columns(conn):
    cols = [('n_item_nf', 'TEXT')]
    t = _tbl(conn, 'wms_palete_item')
    if _is_pg(conn):
        for name, typ in cols:
            try:
                conn.execute(f'ALTER TABLE {t} ADD COLUMN IF NOT EXISTS {name} {typ}')
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass
    else:
        try:
            existing = conn.execute('PRAGMA table_info(wms_palete_item)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (existing or [])}
            for name, typ in cols:
                if name not in names:
                    conn.execute(f'ALTER TABLE wms_palete_item ADD COLUMN {name} {typ}')
            conn.commit()
        except Exception:
            pass


def _ensure_wms_recebimento_terceiros_columns(conn):
    """Garante colunas de vínculo com descarga — só ALTER na 1ª vez (evita lock/502)."""
    global _WMS_REC_TERCEIROS_COLS_READY
    if _WMS_REC_TERCEIROS_COLS_READY:
        return
    cols = [
        ('terceiros_documento_id', 'BIGINT' if _is_pg(conn) else 'INTEGER'),
        ('terceiros_area', 'TEXT'),
    ]
    t = _tbl(conn, 'wms_recebimento')
    if _is_pg(conn):
        for name, typ in cols:
            try:
                conn.execute(f'ALTER TABLE {t} ADD COLUMN IF NOT EXISTS {name} {typ}')
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass
    else:
        try:
            existing = conn.execute('PRAGMA table_info(wms_recebimento)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (existing or [])}
            for name, typ in cols:
                if name not in names:
                    conn.execute(f'ALTER TABLE wms_recebimento ADD COLUMN {name} {typ}')
            conn.commit()
        except Exception:
            pass
    _WMS_REC_TERCEIROS_COLS_READY = True


def _normalizar_nf_wms(numero_nf):
    s = ''.join(c for c in str(numero_nf or '').strip() if c.isdigit())
    return s.lstrip('0') or '0'


def _terceiros_bool_sim_local(valor):
    if valor is True or valor == 1:
        return True
    return str(valor or '').strip().lower() in ('1', 'true', 'sim', 's', 'yes', 't')


def _tbl_terceiros_doc(conn):
    return 'public.terceiros_documentos' if _is_pg(conn) else 'terceiros_documentos'


def _tbl_terceiros_itens(conn):
    return 'public.terceiros_documento_itens' if _is_pg(conn) else 'terceiros_documento_itens'


def _tbl_terceiros_eventos(conn):
    return 'public.terceiros_documento_eventos' if _is_pg(conn) else 'terceiros_documento_eventos'


def _terceiros_tabelas_existem(conn):
    try:
        conn.execute(f'SELECT 1 FROM {_tbl_terceiros_doc(conn)} LIMIT 1')
        return True
    except Exception:
        return False


def _sku_terceiros_item(item):
    d = _row_dict(item) or item or {}
    for k in ('codigo_produto_base', 'codigo_produto_xml'):
        v = (d.get(k) or '').strip()
        if v:
            return v
    return ''


def _buscar_documento_terceiros_por_nf(conn, numero_nf):
    """Localiza NF no módulo descarga/recebimento (prioriza carreta em pendência)."""
    nf_norm = _normalizar_nf_wms(numero_nf)
    if not nf_norm or nf_norm == '0':
        return None, 'Informe o número da NF.'
    if not _terceiros_tabelas_existem(conn):
        return None, 'Módulo de descarga/recebimento não disponível neste banco.'
    t_doc = _tbl_terceiros_doc(conn)
    raw = str(numero_nf or '').strip()
    variants = []
    for v in (raw, nf_norm, nf_norm.zfill(6), nf_norm.zfill(7), nf_norm.zfill(8), nf_norm.zfill(9)):
        s = str(v or '').strip()
        if s and s not in variants:
            variants.append(s)
    placeholders = ','.join('?' * len(variants))
    like_nf = f'%{nf_norm}%'
    # Filtro SQL primeiro (evita varrer 1200 docs em Python — causava timeout na aba).
    rows = conn.execute(
        f'''SELECT id, area, numero_nf, serie_nf, remetente_nome, remetente_cnpj,
                   placa_carreta, motorista_carreta, recebimento_concluido, previsao_chegada,
                   chave_nfe, destinatario_nome, criado_em
            FROM {t_doc}
            WHERE area IN ('carreta', 'recebimento', 'expedicao')
              AND (
                numero_nf IN ({placeholders})
                OR REPLACE(REPLACE(REPLACE(COALESCE(numero_nf, ''), ' ', ''), '.', ''), '-', '') LIKE ?
              )
            ORDER BY criado_em DESC, id DESC
            LIMIT 80''',
        tuple(variants) + (like_nf,),
    ).fetchall()
    matches = []
    for r in rows or []:
        rd = _row_dict(r) or {}
        if _normalizar_nf_wms(rd.get('numero_nf')) == nf_norm:
            matches.append(rd)
    if not matches:
        return None, 'NF não encontrada no módulo de descarga/recebimento (carreta/recebimento).'
    matches.sort(key=lambda m: (
        1 if _terceiros_bool_sim_local(m.get('recebimento_concluido')) else 0,
        0 if (m.get('area') or '').lower() == 'carreta' else (
            1 if (m.get('area') or '').lower() == 'recebimento' else 2
        ),
        -int(m.get('id') or 0),
    ))
    doc = matches[0]
    t_it = _tbl_terceiros_itens(conn)
    itens_raw = conn.execute(
        f'''SELECT id, n_item, codigo_produto_xml, codigo_produto_base, descricao_xml, descricao_base,
                   quantidade_xml, quantidade_bipada, codigo_ean, unidade_xml
            FROM {t_it} WHERE documento_id = ? ORDER BY n_item, id''',
        (doc['id'],),
    ).fetchall()
    itens = []
    for it in itens_raw or []:
        rd = _row_dict(it) or {}
        q_xml = float(rd.get('quantidade_xml') or 0)
        q_bip = float(rd.get('quantidade_bipada') or 0)
        sku = _sku_terceiros_item(rd)
        itens.append({
            'id': rd.get('id'),
            'n_item': rd.get('n_item'),
            'sku': sku,
            'descricao': (rd.get('descricao_base') or rd.get('descricao_xml') or '').strip(),
            'quantidade_xml': q_xml,
            'quantidade_bipada': q_bip,
            'codigo_ean': rd.get('codigo_ean') or '',
            'unidade': rd.get('unidade_xml') or '',
        })
    area = (doc.get('area') or '').lower()
    return {
        'documento_id': doc['id'],
        'area': area,
        'numero_nf': doc.get('numero_nf') or '',
        'serie_nf': doc.get('serie_nf') or '',
        'fornecedor': (doc.get('remetente_nome') or '').strip(),
        'remetente_cnpj': doc.get('remetente_cnpj') or '',
        'placa': (doc.get('placa_carreta') or '').strip().upper(),
        'motorista': (doc.get('motorista_carreta') or '').strip(),
        'previsao_chegada': doc.get('previsao_chegada') or '',
        'recebimento_concluido': _terceiros_bool_sim_local(doc.get('recebimento_concluido')),
        'chave_nfe': doc.get('chave_nfe') or '',
        'itens': itens,
        'total_itens': len(itens),
        'quantidade_total_xml': round(sum(i['quantidade_xml'] for i in itens), 3),
    }, None


_STATUS_RECEBIMENTO_WMS_ENCERRADO = frozenset({'finalizado', 'cancelado', 'concluido'})


def _recebimento_wms_esta_ativo(rec):
    if not rec:
        return False
    st = (rec.get('status') if isinstance(rec, dict) else None) or ''
    return str(st).strip().lower() not in _STATUS_RECEBIMENTO_WMS_ENCERRADO


def _sql_recebimento_wms_ativo(alias=''):
    p = f'{alias}.' if alias else ''
    return f"LOWER(COALESCE({p}status, '')) NOT IN ('finalizado', 'cancelado', 'concluido')"


def _buscar_recebimento_wms_por_nf(conn, documento_id=None, numero_nf=None, somente_ativo=False):
    t_rec = _tbl(conn, 'wms_recebimento')
    ativo_sql = f' AND {_sql_recebimento_wms_ativo()}' if somente_ativo else ''
    if documento_id:
        row = conn.execute(
            f'''SELECT id, status, numero_nf, terceiros_documento_id FROM {t_rec}
                WHERE terceiros_documento_id = ?{ativo_sql}
                ORDER BY id DESC LIMIT 1''',
            (int(documento_id),),
        ).fetchone()
        if row:
            return _row_dict(row) or {}
    nf = (numero_nf or '').strip()
    if nf:
        row = conn.execute(
            f'''SELECT id, status, numero_nf, terceiros_documento_id FROM {t_rec}
                WHERE numero_nf = ?{ativo_sql}
                ORDER BY id DESC LIMIT 1''',
            (nf,),
        ).fetchone()
        if row:
            return _row_dict(row) or {}
    return None


def _obter_ou_criar_recebimento_wms(conn, numero_nf=None, fornecedor=None, placa=None, doca=None,
                                    origem=None, ter_doc_id=None, ter_area=None, now=None):
    """Reutiliza recebimento em andamento da mesma NF/doc; evita duplicatas."""
    now = now or _now_iso()
    t_rec = _tbl(conn, 'wms_recebimento')
    existente = _buscar_recebimento_wms_por_nf(
        conn, documento_id=ter_doc_id, numero_nf=numero_nf, somente_ativo=True,
    )
    if existente:
        rid = int(existente['id'])
        sets = []
        params = []
        if fornecedor:
            sets.append('fornecedor = ?')
            params.append(fornecedor)
        if placa:
            sets.append('placa = ?')
            params.append(placa)
        if doca:
            sets.append('doca = ?')
            params.append(doca)
        if ter_doc_id and not existente.get('terceiros_documento_id'):
            sets.append('terceiros_documento_id = ?')
            params.append(int(ter_doc_id))
        if ter_area:
            sets.append('terceiros_area = ?')
            params.append(ter_area)
        if origem:
            sets.append('origem = ?')
            params.append(origem)
        if sets:
            sets.append('atualizado_em = ' + ('NOW()' if _is_pg(conn) else '?'))
            if not _is_pg(conn):
                params.append(now)
            params.append(rid)
            conn.execute(f"UPDATE {t_rec} SET {', '.join(sets)} WHERE id = ?", tuple(params))
        return rid, True, existente.get('status')

    if _is_pg(conn):
        cur = conn.execute(
            f'''INSERT INTO {t_rec} (numero_nf, fornecedor, placa, doca, origem, status,
                terceiros_documento_id, terceiros_area, criado_em, atualizado_em, criado_por)
                VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?, NOW(), NOW(), ?) RETURNING id''',
            (
                numero_nf, fornecedor, placa, doca, origem or 'manual',
                ter_doc_id, ter_area or None, _usuario(),
            ),
        )
        new_id = cur.fetchone()['id']
    else:
        conn.execute(
            f'''INSERT INTO {t_rec} (numero_nf, fornecedor, placa, doca, origem, status,
                terceiros_documento_id, terceiros_area, criado_em, atualizado_em, criado_por)
                VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?, ?, ?, ?)''',
            (
                numero_nf, fornecedor, placa, doca, origem or 'manual',
                ter_doc_id, ter_area or None, now, now, _usuario(),
            ),
        )
        new_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    return new_id, False, 'aguardando'


def _quantidades_por_linha_nf(conn, recebimento_id, doc_itens):
    """Quantidades bipadas/armazenadas por linha (n_item) da NF, com alocação FIFO para registros legados."""
    if not recebimento_id:
        return {}
    _ensure_wms_palete_item_nf_columns(conn)
    _ensure_wms_palete_item_disposicao(conn)
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    rows = conn.execute(
        f'''SELECT i.n_item_nf, i.sku, COALESCE(i.quantidade_caixas, 0) AS qtd,
                   LOWER(COALESCE(p.status, '')) AS palete_status,
                   i.disposicao_estoque
            FROM {t_rp} rp
            JOIN {t_pal} p ON p.id = rp.palete_id
            JOIN {t_item} i ON i.palete_id = rp.palete_id
            WHERE rp.recebimento_id = ?
            ORDER BY i.criado_em, i.id''',
        (int(recebimento_id),),
    ).fetchall()

    def _linha_vazia():
        return {'bip': 0.0, 'arm': 0.0, 'destinos': _destinos_linha_vazio()}

    linhas_doc = sorted(doc_itens or [], key=lambda x: int(x.get('n_item') or 0))
    out = {str(it.get('n_item')): _linha_vazia() for it in linhas_doc if it.get('n_item') is not None}
    legacy = []

    for r in rows or []:
        rd = _row_dict(r) or {}
        q = float(rd.get('qtd') or 0)
        is_arm = (rd.get('palete_status') or '') == 'armazenado'
        disp = rd.get('disposicao_estoque')
        n_raw = rd.get('n_item_nf')
        if n_raw is not None and str(n_raw).strip() != '':
            key = str(n_raw).strip()
            if key not in out:
                out[key] = _linha_vazia()
            out[key]['bip'] += q
            if is_arm:
                out[key]['arm'] += q
            _destinos_linha_add(out[key]['destinos'], disp, q, armazenado=is_arm)
        else:
            sku = (rd.get('sku') or '').strip().upper()
            if sku and q > 0:
                legacy.append({'sku': sku, 'q': q, 'arm': is_arm, 'disp': disp})

    for it in linhas_doc:
        n_key = str(it.get('n_item'))
        sku_u = (it.get('sku') or '').strip().upper()
        cap = float(it.get('quantidade_xml') or 0)
        if not n_key or not sku_u or cap <= 0:
            continue
        if n_key not in out:
            out[n_key] = _linha_vazia()
        for leg in legacy:
            if leg.get('used') or leg.get('sku') != sku_u:
                continue
            room = max(cap - out[n_key]['bip'], 0)
            if room <= 0:
                break
            take = min(leg['q'], room)
            if take <= 0:
                continue
            out[n_key]['bip'] += take
            if leg.get('arm'):
                out[n_key]['arm'] += take
            _destinos_linha_add(out[n_key]['destinos'], leg.get('disp'), take, armazenado=leg.get('arm'))
            leg['q'] -= take
            if leg['q'] <= 0:
                leg['used'] = True
    return out


def _documento_nf_do_recebimento(conn, recebimento_id, completo=False):
    if not recebimento_id:
        return None
    t_rec = _tbl(conn, 'wms_recebimento')
    rec = conn.execute(
        f'SELECT numero_nf FROM {t_rec} WHERE id = ?',
        (int(recebimento_id),),
    ).fetchone()
    if not rec:
        return None
    numero_nf = (_row_dict(rec) or {}).get('numero_nf')
    if not numero_nf:
        return None
    doc, _err = _buscar_documento_terceiros_por_nf(conn, numero_nf)
    if not doc:
        return None
    if completo:
        return _enriquecer_documento_nf_wms(conn, doc, reabrir_descarga=False)
    return _enriquecer_documento_nf_wms_leve(conn, doc)


def _item_nf_coincide_sku(item, sku):
    sku_u = (sku or '').strip().upper()
    if not sku_u:
        return False
    it_sku = (item.get('sku') or '').strip().upper()
    if it_sku and it_sku == sku_u:
        return True
    ean = ''.join(c for c in str(item.get('codigo_ean') or '') if c.isdigit())
    cod = ''.join(c for c in str(sku or '') if c.isdigit())
    if ean and cod and (ean == cod or ean.endswith(cod) or cod.endswith(ean)):
        return True
    return False


def _resolver_linha_nf_bipagem(doc, sku, n_item_nf=None):
    """Próxima linha da NF com quantidade pendente de bipagem (FIFO por n_item)."""
    if not doc:
        return None
    itens = sorted(doc.get('itens') or [], key=lambda x: int(x.get('n_item') or 0))
    if n_item_nf is not None and str(n_item_nf).strip() != '':
        alvo = str(n_item_nf).strip()
        for it in itens:
            if str(it.get('n_item')) == alvo:
                return it
        return None
    for it in itens:
        if not _item_nf_coincide_sku(it, sku):
            continue
        if float(it.get('pendente_wms') or 0) > 0:
            return it
    return None


def _doc_descarga_reabrivel_wms(doc):
    """Espelha wmsDocDescargaReabrivel no frontend."""
    if not doc or not doc.get('recebimento_concluido'):
        return False
    st = (doc.get('recebimento_wms_status') or '').lower()
    if st == 'finalizado' or doc.get('wms_bloqueado'):
        return False
    if doc.get('descarga_reabrivel') is not None:
        return bool(doc.get('descarga_reabrivel'))
    return not doc.get('recebimento_wms_id')


def _iniciar_bipagem_wms_leve(conn, data):
    """
    Abre/reutiliza recebimento WMS no caminho mais curto possível.
    - Usa documento_id/NF do cliente (sem varrer descarga).
    - NÃO reabre descarga aqui (write lento/lock → 502).
    """
    numero_nf = (data.get('numero_nf') or '').strip()
    if not numero_nf:
        return None, ('Informe numero_nf.', 400)

    ter_doc_id = data.get('terceiros_documento_id')
    try:
        ter_doc_id = int(ter_doc_id) if ter_doc_id not in (None, '', 0, '0') else None
    except (TypeError, ValueError):
        ter_doc_id = None
    ter_area = (data.get('terceiros_area') or '').strip().lower()
    fornecedor = (data.get('fornecedor') or '').strip()
    placa = (data.get('placa') or '').strip().upper()
    t_rec = _tbl(conn, 'wms_recebimento')

    # 1) Reutiliza recebimento ativo da NF (query mínima).
    try:
        row = conn.execute(
            f'''SELECT id, status FROM {t_rec}
                WHERE numero_nf = ? AND {_sql_recebimento_wms_ativo()}
                ORDER BY id DESC LIMIT 1''',
            (numero_nf,),
        ).fetchone()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, (
            'Schema WMS ainda não está pronto. Abra a aba Painel uma vez e tente de novo. (%s)' % exc,
            503,
        )
    if row:
        rd = _row_dict(row) or {}
        rid = int(rd.get('id') or 0)
        st = rd.get('status') or 'aguardando'
        return {
            'ok': True,
            'id': rid,
            'reutilizado': True,
            'status': st,
            'reabriu_descarga': False,
            'mensagem': 'Recebimento em andamento reutilizado.',
            'terceiros_documento_id': ter_doc_id,
            'terceiros_area': ter_area,
        }, None

    # 2) Bloqueia só se o último da NF já foi finalizado.
    try:
        fin = conn.execute(
            f'''SELECT id, status FROM {t_rec}
                WHERE numero_nf = ?
                ORDER BY id DESC LIMIT 1''',
            (numero_nf,),
        ).fetchone()
        if fin:
            fd = _row_dict(fin) or {}
            if (fd.get('status') or '').lower() == 'finalizado':
                return None, ('NF já finalizada no WMS — consulte o Histórico NF.', 400)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass

    origem = 'carreta' if ter_area == 'carreta' else ('terceiros' if ter_doc_id else 'manual')
    now = _now_iso()
    try:
        new_id, reutilizado, st_rec = _obter_ou_criar_recebimento_wms(
            conn,
            numero_nf=numero_nf,
            fornecedor=fornecedor or None,
            placa=placa or None,
            origem=origem,
            ter_doc_id=ter_doc_id,
            ter_area=ter_area or None,
            now=now,
        )
        conn.commit()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return None, ('Falha ao criar recebimento WMS: %s' % exc, 500)

    return {
        'ok': True,
        'id': new_id,
        'reutilizado': reutilizado,
        'status': st_rec,
        'reabriu_descarga': False,
        'mensagem': 'Recebimento em andamento reutilizado.' if reutilizado else None,
        'terceiros_documento_id': ter_doc_id,
        'terceiros_area': ter_area,
    }, None


def _quantidades_wms_recebimento(conn, recebimento_id):
    if not recebimento_id:
        return {}
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    rows = conn.execute(
        f'''SELECT i.sku, SUM(COALESCE(i.quantidade_caixas, 0)) AS qtd
            FROM {t_rp} rp
            JOIN {t_item} i ON i.palete_id = rp.palete_id
            WHERE rp.recebimento_id = ?
            GROUP BY i.sku''',
        (int(recebimento_id),),
    ).fetchall()
    out = {}
    for r in rows or []:
        rd = _row_dict(r) or {}
        sku = (rd.get('sku') or '').strip()
        if sku:
            out[sku.upper()] = float(rd.get('qtd') or 0)
    return out


def _quantidades_wms_armazenadas_recebimento(conn, recebimento_id):
    """Quantidades bipadas em paletes já guardados (status armazenado)."""
    if not recebimento_id:
        return {}
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    rows = conn.execute(
        f'''SELECT i.sku, SUM(COALESCE(i.quantidade_caixas, 0)) AS qtd
            FROM {t_rp} rp
            JOIN {t_pal} p ON p.id = rp.palete_id
            JOIN {t_item} i ON i.palete_id = rp.palete_id
            WHERE rp.recebimento_id = ? AND LOWER(COALESCE(p.status, '')) = 'armazenado'
            GROUP BY i.sku''',
        (int(recebimento_id),),
    ).fetchall()
    out = {}
    for r in rows or []:
        rd = _row_dict(r) or {}
        sku = (rd.get('sku') or '').strip()
        if sku:
            out[sku.upper()] = float(rd.get('qtd') or 0)
    return out


def _rotulo_status_recebimento_wms(status):
    st = (status or '').strip().lower()
    mapa = {
        'aguardando': 'Aguardando bipagem',
        'em_conferencia': 'Em conferência (bipagem)',
        'aguardando_armazenagem': 'Aguardando guardar paletes',
        'finalizado': 'Finalizado',
        'cancelado': 'Cancelado',
        'concluido': 'Concluído',
    }
    return mapa.get(st, status or '—')


def _montar_situacao_recebimento_nf(conn, doc, rec_ativo, rec_ultimo):
    """Resumo legível da situação WMS da NF (para busca no recebimento)."""
    st_wms = ((rec_ativo or rec_ultimo or {}).get('status') or '').lower()
    rid_ativo = (rec_ativo or {}).get('id')
    rid_ultimo = (rec_ultimo or {}).get('id')
    rid_ref = rid_ativo or rid_ultimo

    if rid_ativo:
        situacao = 'em_andamento'
        rotulo = 'Recebimento em andamento'
        cor = '#e65100'
    elif rid_ultimo and st_wms == 'finalizado':
        situacao = 'finalizado'
        rotulo = 'Recebimento finalizado'
        cor = '#1565c0'
    elif rid_ultimo:
        situacao = 'encerrado'
        rotulo = 'Recebimento encerrado'
        cor = '#616161'
    else:
        situacao = 'sem_recebimento'
        rotulo = 'Sem recebimento WMS'
        cor = '#2e7d32'

    resumo = _resumo_finalizacao_recebimento(conn, rid_ref) if rid_ref else None
    detalhes = []
    if rid_ref:
        detalhes.append(f'Recebimento WMS #{rid_ref}')
        detalhes.append(_rotulo_status_recebimento_wms(st_wms))
    if resumo:
        if resumo.get('paletes_total'):
            detalhes.append(
                f'{resumo.get("paletes_armazenados", 0)}/{resumo.get("paletes_total")} palete(s) guardado(s)'
            )
        if resumo.get('mov_pendentes'):
            detalhes.append(f'{resumo["mov_pendentes"]} movimentação(ões) pendente(s)')
        if not resumo.get('itens_nf_ok') and resumo.get('itens_nf_pendentes'):
            detalhes.append(f'{resumo["itens_nf_pendentes"]} item(ns) da NF pendente(s)')
        if situacao == 'finalizado':
            detalhes.append('NF encerrada no WMS')
        elif resumo.get('motivo') and not resumo.get('pode_finalizar'):
            detalhes.append(resumo.get('motivo'))
    elif situacao == 'sem_recebimento':
        detalhes.append('Clique em Montar paletes para iniciar a bipagem')

    return {
        'situacao': situacao,
        'rotulo': rotulo,
        'cor': cor,
        'detalhe': ' · '.join(detalhes),
        'recebimento_id': rid_ref,
        'recebimento_id_ativo': rid_ativo,
        'recebimento_id_ultimo': rid_ultimo,
        'status_wms': st_wms or None,
        'resumo': resumo,
    }


def _enriquecer_documento_nf_wms_leve(conn, doc):
    """Anexa status WMS básico sem quantidades/reabrir (rápido — evita 502 na busca da NF)."""
    if not doc:
        return doc
    doc = dict(doc)
    doc_id = doc.get('documento_id')
    numero_nf = doc.get('numero_nf')
    rec_ativo = None
    rec_ultimo = None
    try:
        rec_ativo = _buscar_recebimento_wms_por_nf(conn, doc_id, numero_nf, somente_ativo=True)
        rec_ultimo = _buscar_recebimento_wms_por_nf(conn, doc_id, numero_nf, somente_ativo=False)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    if rec_ativo and rec_ultimo and int(rec_ativo.get('id') or 0) == int(rec_ultimo.get('id') or 0):
        rec_ultimo = rec_ativo
    doc['recebimento_wms_id'] = rec_ativo.get('id') if rec_ativo else None
    doc['recebimento_wms_id_ultimo'] = (rec_ultimo or {}).get('id')
    doc['recebimento_wms_status'] = (rec_ativo or rec_ultimo or {}).get('status')
    st_wms = (doc.get('recebimento_wms_status') or '').lower()
    doc['wms_bloqueado'] = st_wms == 'finalizado'
    doc['descarga_reabrivel'] = bool(doc.get('recebimento_concluido') and not doc['wms_bloqueado'])
    try:
        doc['situacao_recebimento'] = _montar_situacao_recebimento_nf(conn, doc, rec_ativo, rec_ultimo)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        doc['situacao_recebimento'] = {
            'situacao': 'pendente' if not st_wms else st_wms,
            'rotulo': 'NF na descarga',
            'detalhe': 'Clique em Montar paletes para iniciar a bipagem',
            'cor': '#1565c0',
        }
    itens = []
    for it in doc.get('itens') or []:
        rd = dict(it)
        q_xml = float(rd.get('quantidade_xml') or 0)
        rd.setdefault('quantidade_wms', 0)
        rd.setdefault('quantidade_armazenada', 0)
        rd.setdefault('pendente_wms', q_xml)
        rd.setdefault('status_wms', 'pendente')
        rd.setdefault('destinos_wms', [])
        rd.setdefault('resumo_andamento', ('%s cx pendente bipagem' % (
            int(q_xml) if q_xml == int(q_xml) else q_xml
        )) if q_xml else '—')
        itens.append(rd)
    doc['itens'] = itens
    return doc


def _enriquecer_documento_nf_wms(conn, doc, reabrir_descarga=False):
    if not doc:
        return doc
    doc_id = doc.get('documento_id')
    numero_nf = doc.get('numero_nf')
    rec_ativo = _buscar_recebimento_wms_por_nf(conn, doc_id, numero_nf, somente_ativo=True)
    rec_ultimo = _buscar_recebimento_wms_por_nf(conn, doc_id, numero_nf, somente_ativo=False)
    if rec_ativo and rec_ultimo and int(rec_ativo.get('id') or 0) == int(rec_ultimo.get('id') or 0):
        rec_ultimo = rec_ativo
    doc = dict(doc)
    doc['recebimento_wms_id'] = rec_ativo.get('id') if rec_ativo else None
    doc['recebimento_wms_id_ultimo'] = (rec_ultimo or {}).get('id')
    doc['recebimento_wms_status'] = (rec_ativo or rec_ultimo or {}).get('status')
    st_wms = (doc.get('recebimento_wms_status') or '').lower()
    doc['wms_bloqueado'] = st_wms == 'finalizado'
    doc['descarga_reabrivel'] = bool(doc.get('recebimento_concluido') and not doc['wms_bloqueado'])
    doc['situacao_recebimento'] = _montar_situacao_recebimento_nf(conn, doc, rec_ativo, rec_ultimo)
    # Reabrir só quando pedido explicitamente (nunca em GET de busca — causa lock/502).
    if (
        reabrir_descarga
        and doc.get('recebimento_concluido')
        and not doc['wms_bloqueado']
        and doc.get('documento_id')
    ):
        ok_ter, _err_ter = _reabrir_terceiros_recebimento_wms(
            conn, int(doc['documento_id']), motivo='busca_nf_sem_wms',
        )
        if ok_ter:
            doc['recebimento_concluido'] = False
            doc['descarga_reabrivel'] = False
            doc['_wms_descarga_reaberta'] = True
    rid_qtd = doc.get('recebimento_wms_id') or doc.get('recebimento_wms_id_ultimo')
    qtd_wms = _quantidades_wms_recebimento(conn, rid_qtd)
    qtd_arm = _quantidades_wms_armazenadas_recebimento(conn, rid_qtd)
    por_linha = _quantidades_por_linha_nf(conn, rid_qtd, doc.get('itens') or [])
    itens = []
    for it in doc.get('itens') or []:
        rd = dict(it)
        sku = (rd.get('sku') or '').strip()
        n_key = str(rd.get('n_item')) if rd.get('n_item') is not None else ''
        lin = por_linha.get(n_key) or {}
        q_wms = float(lin.get('bip') or 0)
        q_arm = float(lin.get('arm') or 0)
        if not n_key and sku:
            q_wms = qtd_wms.get(sku.upper(), 0)
            q_arm = qtd_arm.get(sku.upper(), 0)
        q_xml = float(rd.get('quantidade_xml') or 0)
        rd['quantidade_wms'] = q_wms
        rd['quantidade_armazenada'] = q_arm
        rd['pendente_wms'] = max(q_xml - q_wms, 0)
        destinos = lin.get('destinos') or {}
        rd['destinos_wms'] = _destinos_linha_para_api(destinos)
        rd['resumo_andamento'] = _montar_resumo_andamento_item_nf(destinos, rd['pendente_wms'])
        if q_xml > 0 and q_arm >= q_xml:
            rd['status_wms'] = 'concluido'
        elif q_xml > 0 and q_wms >= q_xml:
            rd['status_wms'] = 'bipado'
        else:
            rd['status_wms'] = 'pendente'
        itens.append(rd)
    doc['itens'] = itens
    return doc


def _codigo_barras_produto_nf(item):
    ean = ''.join(c for c in str((item or {}).get('codigo_ean') or '').strip() if c.isdigit())
    sku = (item or {}).get('sku') or ''
    if len(ean) in (8, 12, 13, 14):
        fmt = 'EAN13' if len(ean) == 13 else ('EAN8' if len(ean) == 8 else 'CODE128')
        return ean, fmt
    if sku:
        return str(sku).strip(), 'CODE128'
    return ean or '0', 'CODE128'


def _itens_para_etiquetas_nf(doc, sku_filtro=None, n_item_filtro=None):
    itens_out = []
    for it in doc.get('itens') or []:
        sku = (it.get('sku') or '').strip()
        n_item = it.get('n_item')
        if sku_filtro and sku.upper() != str(sku_filtro).strip().upper():
            continue
        if n_item_filtro is not None and str(n_item) != str(n_item_filtro):
            continue
        cod, fmt = _codigo_barras_produto_nf(it)
        q = float(it.get('quantidade_xml') or 0)
        itens_out.append({
            'n_item': n_item,
            'sku': sku,
            'descricao': it.get('descricao') or '',
            'codigo_ean': it.get('codigo_ean') or '',
            'codigo_barras': cod,
            'formato_barras': fmt,
            'quantidade_xml_fmt': int(q) if q == int(q) else q,
            'unidade': it.get('unidade') or 'UN',
        })
    return itens_out


def _html_etiquetas_produto_nf(doc, auto_print=False, sku_filtro=None, n_item_filtro=None):
    itens = _itens_para_etiquetas_nf(doc, sku_filtro=sku_filtro, n_item_filtro=n_item_filtro)
    return render_template(
        'wms/etiquetas_produto_nf.html',
        numero_nf=doc.get('numero_nf') or '',
        fornecedor=doc.get('fornecedor') or '',
        itens=itens,
        total=len(itens),
        auto_print=auto_print,
    )


def _status_bipagem_terceiros_wms(qtd_xml, qtd_bipada):
    qtd_xml = float(qtd_xml or 0)
    qtd_bipada = float(qtd_bipada or 0)
    if qtd_bipada <= 0:
        return 'PENDENTE'
    if qtd_bipada < qtd_xml:
        return 'PARCIAL'
    if qtd_bipada == qtd_xml:
        return 'COMPLETO'
    return 'EXCEDENTE'


def _sincronizar_terceiros_itens_desde_wms(conn, documento_id, recebimento_id=None, usuario=None):
    """Espelha quantidades bipadas no WMS para terceiros_documento_itens (descarga somente leitura)."""
    if not documento_id or not _terceiros_tabelas_existem(conn):
        return False, None
    t_doc = _tbl_terceiros_doc(conn)
    row = conn.execute(
        f'SELECT id, numero_nf FROM {t_doc} WHERE id = ?', (int(documento_id),)
    ).fetchone()
    if not row:
        return False, None
    rd = _row_dict(row) or {}
    rid = recebimento_id
    if not rid:
        rec = _buscar_recebimento_wms_por_nf(
            conn, documento_id=int(documento_id), numero_nf=rd.get('numero_nf'), somente_ativo=True,
        )
        if not rec:
            rec = _buscar_recebimento_wms_por_nf(
                conn, documento_id=int(documento_id), numero_nf=rd.get('numero_nf'), somente_ativo=False,
            )
        rid = (rec or {}).get('id')
    if not rid:
        return True, None
    t_it = _tbl_terceiros_itens(conn)
    itens_rows = conn.execute(
        f'''SELECT id, n_item, codigo_produto_xml, codigo_produto_base, descricao_xml, descricao_base,
                   quantidade_xml, quantidade_bipada, codigo_ean, unidade_xml
            FROM {t_it} WHERE documento_id = ? ORDER BY n_item, id''',
        (int(documento_id),),
    ).fetchall()
    doc_itens = []
    for r in itens_rows or []:
        it = _row_dict(r) or {}
        doc_itens.append({
            'n_item': it.get('n_item'),
            'sku': _sku_terceiros_item(it),
            'quantidade_xml': it.get('quantidade_xml'),
        })
    por_linha = _quantidades_por_linha_nf(conn, int(rid), doc_itens)
    user = (usuario or _usuario() or 'wms').strip()
    now = _now_iso()
    for r in itens_rows or []:
        it = _row_dict(r) or {}
        n_key = str(it.get('n_item')) if it.get('n_item') is not None else ''
        q_wms = float((por_linha.get(n_key) or {}).get('bip') or 0)
        q_atual = float(it.get('quantidade_bipada') or 0)
        if abs(q_wms - q_atual) <= 1e-6:
            continue
        q_xml = float(it.get('quantidade_xml') or 0)
        status = _status_bipagem_terceiros_wms(q_xml, q_wms)
        conn.execute(
            f'''UPDATE {t_it} SET quantidade_bipada = ?, status_bipagem = ?,
                    atualizado_em = ?, atualizado_por = ? WHERE id = ?''',
            (q_wms, status, now, user, int(it['id'])),
        )
    return True, int(rid)


def _concluir_terceiros_recebimento_wms(conn, documento_id, usuario=None):
    """Marca recebimento_concluido no módulo terceiros/descarga (sai da pendência)."""
    if not documento_id or not _terceiros_tabelas_existem(conn):
        return False, 'Documento terceiros indisponível.'
    t_doc = _tbl_terceiros_doc(conn)
    t_ev = _tbl_terceiros_eventos(conn)
    row = conn.execute(
        f'SELECT id, recebimento_concluido FROM {t_doc} WHERE id = ?', (int(documento_id),)
    ).fetchone()
    if not row:
        return False, 'Documento terceiros não encontrado.'
    rd = _row_dict(row) or {}
    if _terceiros_bool_sim_local(rd.get('recebimento_concluido')):
        return True, None
    user = (usuario or _usuario() or 'wms').strip()
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(
            f'''UPDATE {t_doc} SET recebimento_concluido = TRUE, recebimento_concluido_em = NOW(),
                recebimento_concluido_por = ?, atualizado_em = NOW(), atualizado_por = ? WHERE id = ?''',
            (user, user, int(documento_id)),
        )
    else:
        conn.execute(
            f'''UPDATE {t_doc} SET recebimento_concluido = 1, recebimento_concluido_em = ?,
                recebimento_concluido_por = ?, atualizado_em = ?, atualizado_por = ? WHERE id = ?''',
            (now, user, now, user, int(documento_id)),
        )
    try:
        conn.execute(
            f'''INSERT INTO {t_ev} (documento_id, evento, valor_anterior, valor_novo, usuario, criado_em, detalhes)
                VALUES (?, 'recebimento_concluido', '0', '1', ?, ?, 'via_wms_enderecamento')''',
            (int(documento_id), user, now),
        )
    except Exception:
        pass
    return True, None


def _reabrir_terceiros_recebimento_wms(conn, documento_id, usuario=None, motivo='exclusao_wms'):
    """Reabre pendência de recebimento no módulo descarga (ex.: ao excluir/recomeçar WMS)."""
    if not documento_id or not _terceiros_tabelas_existem(conn):
        return False, 'Documento terceiros indisponível.'
    t_doc = _tbl_terceiros_doc(conn)
    t_ev = _tbl_terceiros_eventos(conn)
    row = conn.execute(
        f'SELECT id, recebimento_concluido FROM {t_doc} WHERE id = ?', (int(documento_id),)
    ).fetchone()
    if not row:
        return False, 'Documento terceiros não encontrado.'
    rd = _row_dict(row) or {}
    if not _terceiros_bool_sim_local(rd.get('recebimento_concluido')):
        return True, None
    user = (usuario or _usuario() or 'wms').strip()
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(
            f'''UPDATE {t_doc} SET recebimento_concluido = FALSE, recebimento_concluido_em = NULL,
                recebimento_concluido_por = NULL, atualizado_em = NOW(), atualizado_por = ? WHERE id = ?''',
            (user, int(documento_id)),
        )
    else:
        conn.execute(
            f'''UPDATE {t_doc} SET recebimento_concluido = 0, recebimento_concluido_em = NULL,
                recebimento_concluido_por = NULL, atualizado_em = ?, atualizado_por = ? WHERE id = ?''',
            (now, user, int(documento_id)),
        )
    try:
        conn.execute(
            f'''INSERT INTO {t_ev} (documento_id, evento, valor_anterior, valor_novo, usuario, criado_em, detalhes)
                VALUES (?, 'recebimento_concluido', '1', '0', ?, ?, ?)''',
            (int(documento_id), user, now, motivo or 'via_wms_enderecamento'),
        )
    except Exception:
        pass
    return True, None


def _pesos_categoria_produtos(conn):
    """Peso de cada categoria pela soma de posições médias (planejamento)."""
    _ensure_produto_planejamento_columns(conn)
    t = _tbl(conn, 'wms_produto_enderecamento')
    rows = conn.execute(
        f'''SELECT UPPER(SUBSTR(categoria, 1, 1)) AS cat,
                   SUM(COALESCE(NULLIF(posicoes_med, 0), 1)) AS n
            FROM {t}
            WHERE {_ativo_sql(conn)}
            GROUP BY UPPER(SUBSTR(categoria, 1, 1))'''
    ).fetchall()
    pesos = {}
    for r in rows:
        d = _row_dict(r) or {}
        cat = (d.get('cat') or 'C').strip().upper()
        if cat in ('A', 'B', 'C', 'D'):
            pesos[cat] = int(float(d.get('n') or 0))
    if not pesos:
        rows = conn.execute(
            f'''SELECT UPPER(SUBSTR(categoria, 1, 1)) AS cat, COUNT(*) AS n
                FROM {t} WHERE {_ativo_sql(conn)}
                GROUP BY UPPER(SUBSTR(categoria, 1, 1))'''
        ).fetchall()
        for r in rows:
            d = _row_dict(r) or {}
            cat = (d.get('cat') or 'C').strip().upper()
            if cat in ('A', 'B', 'C', 'D'):
                pesos[cat] = int(d.get('n') or 0)
    if not pesos:
        pesos = {'A': 1, 'B': 1, 'C': 1, 'D': 1}
    return pesos


def _calcular_status_condicional(pos_wms, pos_min, pos_med, pos_max, qtd_wms=0, est_min=0, est_med=0, est_max=0):
    """Status Verde/Amarelo/Vermelho/Excedido a partir do estoque WMS vs metas planejadas."""
    pos_wms = int(pos_wms or 0)
    pos_min = int(pos_min or 0)
    pos_med = int(pos_med or 0)
    pos_max = int(pos_max or 0)
    if pos_max > 0 or pos_med > 0 or pos_min > 0:
        if pos_max > 0 and pos_wms > pos_max:
            return 'Excedido'
        if pos_min > 0 and pos_wms < pos_min:
            return 'Vermelho'
        if pos_med > 0 and pos_wms < pos_med:
            return 'Amarelo'
        return 'Verde'
    qtd = int(qtd_wms or 0)
    est_min = int(est_min or 0)
    est_med = int(est_med or 0)
    est_max = int(est_max or 0)
    if est_max > 0 and qtd > est_max:
        return 'Excedido'
    if est_min > 0 and qtd < est_min:
        return 'Vermelho'
    if est_med > 0 and qtd < est_med:
        return 'Amarelo'
    return 'Verde' if qtd > 0 else 'Verde'


def _info_produto_wms(conn, sku, prod=None):
    """Fonte única de verdade: estoque/posições/status sempre do WMS endereçado (paletes armazenados)."""
    _ensure_produto_planejamento_columns(conn)
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    if prod is None:
        prod = conn.execute(
            f'SELECT * FROM {t_prod} WHERE sku = ? AND {_ativo_sql(conn)} LIMIT 1',
            (sku,),
        ).fetchone()
    pd = _row_dict(prod) or {}
    metricas = _metricas_sku_wms(conn, sku)
    pos_wms = metricas['posicoes_wms']
    qtd_wms = metricas['quantidade_wms']
    status = _calcular_status_condicional(
        pos_wms,
        pd.get('posicoes_min'),
        pd.get('posicoes_med'),
        pd.get('posicoes_max'),
        qtd_wms,
        pd.get('estoque_ideal_min'),
        pd.get('estoque_ideal_med'),
        pd.get('estoque_ideal_max'),
    )
    return {
        **pd,
        'sku': sku,
        'estoque_atual': qtd_wms,
        'posicao_atual': pos_wms,
        'status_condicional': status,
        'posicoes_wms': pos_wms,
        'quantidade_wms': qtd_wms,
    }


def _sync_all_produtos_estoque_cache(conn):
    """Recalcula cache de todos os SKUs a partir do estoque WMS real."""
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    rows = conn.execute(f'SELECT sku FROM {t_prod} WHERE {_ativo_sql(conn)}').fetchall()
    n = 0
    for r in rows:
        sku = (_row_dict(r) or {}).get('sku') or (r[0] if not isinstance(r, dict) else None)
        if sku:
            _sync_produto_estoque_cache(conn, str(sku).strip())
            n += 1
    return n


def _aplicar_estoque_real_dict(conn, d, sku=None):
    """Substitui estoque/status no dict pelos valores reais do WMS."""
    sku = (sku or d.get('sku') or '').strip()
    if not sku:
        d['fonte_estoque'] = 'wms'
        return d
    info = _info_produto_wms(conn, sku)
    d['estoque_atual'] = info.get('estoque_atual', 0)
    d['posicao_atual'] = info.get('posicao_atual', 0)
    d['status_condicional'] = info.get('status_condicional')
    d['quantidade_wms'] = info.get('quantidade_wms', 0)
    d['posicoes_wms'] = info.get('posicoes_wms', 0)
    d['fonte_estoque'] = 'wms'
    return d


def _sync_produto_estoque_cache(conn, sku):
    """Grava cache de estoque/status após bipagem + armazenagem."""
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    existe = conn.execute(f'SELECT sku FROM {t_prod} WHERE sku = ? LIMIT 1', (sku,)).fetchone()
    info = _info_produto_wms(conn, sku)
    if not existe:
        return info
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(
            f'''UPDATE {t_prod} SET estoque_atual = ?, posicao_atual = ?, status_condicional = ?,
                atualizado_em = NOW() WHERE sku = ?''',
            (info['estoque_atual'], info['posicao_atual'], info['status_condicional'], sku),
        )
    else:
        conn.execute(
            f'''UPDATE {t_prod} SET estoque_atual = ?, posicao_atual = ?, status_condicional = ?,
                atualizado_em = ? WHERE sku = ?''',
            (info['estoque_atual'], info['posicao_atual'], info['status_condicional'], now, sku),
        )
    return info


def _skus_do_palete(conn, palete_id):
    t_item = _tbl(conn, 'wms_palete_item')
    rows = conn.execute(
        f'SELECT DISTINCT sku FROM {t_item} WHERE palete_id = ? AND sku IS NOT NULL',
        (palete_id,),
    ).fetchall()
    out = []
    for r in rows:
        s = (_row_dict(r) or {}).get('sku') or (r[0] if not isinstance(r, dict) else None)
        if s and str(s).strip():
            out.append(str(s).strip())
    return out


def _resumo_status_planejamento(conn):
    """Resumo rápido a partir do cache (status recalculado na armazenagem)."""
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    rows = conn.execute(
        f'''SELECT COALESCE(NULLIF(TRIM(status_condicional), ''), 'Verde') AS st, COUNT(*) AS c
            FROM {t_prod} WHERE {_ativo_sql(conn)}
            GROUP BY COALESCE(NULLIF(TRIM(status_condicional), ''), 'Verde')'''
    ).fetchall()
    out = {}
    for r in rows:
        rd = _row_dict(r) or {}
        st = rd.get('st') or 'Verde'
        out[st] = int(rd.get('c') or 0)
    return out


def _prioridade_status_condicional(status):
    s = (status or '').strip().lower()
    if s == 'vermelho':
        return 0
    if s == 'amarelo':
        return 1
    if s == 'verde':
        return 2
    if s == 'excedido':
        return 3
    return 2


def _metricas_sku_wms(conn, sku):
    """Posições ocupadas e quantidade total do SKU no estoque endereçado."""
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    row = conn.execute(
        f'''SELECT COUNT(DISTINCT l.id) AS posicoes,
                   COALESCE(SUM(i.quantidade_caixas), 0) AS qtd
            FROM {t_item} i
            JOIN {t_pal} p ON p.id = i.palete_id
            JOIN {t_loc} l ON l.id = p.localizacao_id
            WHERE i.sku = ? AND p.status = 'armazenado'
              AND l.status = 'ocupada'
              AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')''',
        (sku,),
    ).fetchone()
    d = _row_dict(row) or {}
    return {
        'posicoes_wms': int(d.get('posicoes') or 0),
        'quantidade_wms': int(d.get('qtd') or 0),
    }


def _rua_cluster_sku(conn, sku, cat):
    """Rua com maior concentração do SKU (adensamento por coluna)."""
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    row = conn.execute(
        f'''SELECT l.camara, l.rua, COUNT(*) AS n
            FROM {t_loc} l
            JOIN {t_pal} p ON p.localizacao_id = l.id
            JOIN {t_item} i ON i.palete_id = p.id
            WHERE i.sku = ? AND l.status = 'ocupada'
              AND UPPER(TRIM(COALESCE(l.categoria_zona, ''))) = ?
              AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
            GROUP BY l.camara, l.rua
            ORDER BY n DESC, l.rua
            LIMIT 1''',
        (sku, cat),
    ).fetchone()
    return _row_dict(row) or {}


def _rua_cluster_categoria(conn, cat, camaras=None):
    """Rua com maior concentração da categoria (produtos da mesma família perto)."""
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    params = [cat]
    filtro_cam = ''
    if camaras:
        placeholders = ','.join('?' * len(camaras))
        filtro_cam = f' AND l.camara IN ({placeholders})'
        params.extend(camaras)
    row = conn.execute(
        f'''SELECT l.camara, l.rua, COUNT(*) AS n
            FROM {t_loc} l
            JOIN {t_pal} p ON p.localizacao_id = l.id
            WHERE l.status = 'ocupada'
              AND UPPER(TRIM(COALESCE(l.categoria_zona, ''))) = ?
              AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
              {filtro_cam}
            GROUP BY l.camara, l.rua
            ORDER BY n DESC, l.rua
            LIMIT 1''',
        tuple(params),
    ).fetchone()
    return _row_dict(row) or {}


def _anchor_fifo_sku(conn, sku, cat):
    """Endereço do estoque mais antigo do SKU (referência FIFO na armazenagem)."""
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    order_fifo = 'i.data_producao ASC NULLS LAST, i.data_validade ASC NULLS LAST, l.rua, l.posicao, l.nivel'
    if not _is_pg(conn):
        order_fifo = 'i.data_producao ASC, i.data_validade ASC, l.rua, l.posicao, l.nivel'
    row = conn.execute(
        f'''SELECT l.camara, l.rua, l.posicao, l.nivel, i.data_producao
            FROM {t_loc} l
            JOIN {t_pal} p ON p.localizacao_id = l.id
            JOIN {t_item} i ON i.palete_id = p.id
            WHERE i.sku = ? AND l.status = 'ocupada'
              AND UPPER(TRIM(COALESCE(l.categoria_zona, ''))) = ?
              AND i.data_producao IS NOT NULL
              AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
            ORDER BY {order_fifo}
            LIMIT 1''',
        (sku, cat),
    ).fetchone()
    return _row_dict(row) or {}


_LAYOUT_META_CACHE = None


def _layout_meta_cache():
    global _LAYOUT_META_CACHE
    if _LAYOUT_META_CACHE is None:
        flex = set()
        max_niv = {}
        for bloco in (_layout_camaras_config().get('camaras') or []):
            cod = int(bloco['codigo'])
            max_niv[cod] = max(1, int(bloco.get('niveis') or 5))
            for c, r, p, n, dest, _lbl, ar in _coords_from_bloco_layout(bloco):
                if _slot_reentrega_ou_estoque_flexivel(dest, ar):
                    flex.add(_codigo_endereco(c, r, p, n))
        _LAYOUT_META_CACHE = {'flex_reentrega': flex, 'max_nivel': max_niv}
    return _LAYOUT_META_CACHE


def _parse_data_fifo(val):
    if val is None or val == '':
        return None
    if isinstance(val, date):
        return val
    if hasattr(val, 'date') and callable(getattr(val, 'date', None)):
        try:
            return val.date()
        except Exception:
            pass
    s = str(val).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _sql_putaway_tipo_ok(alias='l'):
    p = f'{alias}.'
    return f"COALESCE(LOWER(TRIM({p}tipo)), 'porta_palete') NOT IN ('destino_fixo')"


def _ocupacao_fifo_colunas(conn, camaras):
    """{(cam, rua, pos): {nivel: data_producao_min}} para colunas ocupadas."""
    if not camaras:
        return {}
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    ph = ','.join(['?'] * len(camaras))
    rows = conn.execute(
        f'''SELECT l.camara, l.rua, l.posicao, l.nivel,
                   MIN(i.data_producao) AS dp_min
            FROM {t_loc} l
            JOIN {t_pal} p ON p.localizacao_id = l.id
            JOIN {t_item} i ON i.palete_id = p.id
            WHERE l.camara IN ({ph})
              AND l.status = 'ocupada'
              AND p.status = 'armazenado'
              AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
            GROUP BY l.camara, l.rua, l.posicao, l.nivel''',
        tuple(camaras),
    ).fetchall()
    out = {}
    for r in rows or []:
        rd = _row_dict(r) or {}
        key = (int(rd.get('camara') or 0), str(rd.get('rua') or '').upper(), int(rd.get('posicao') or 0))
        niv = int(rd.get('nivel') or 0)
        if not key[0] or not key[1] or not niv:
            continue
        out.setdefault(key, {})[niv] = rd.get('dp_min')
    return out


def _nivel_fifo_vertical(data_nova, ocup, vazios):
    """Datas mais antigas nos níveis baixos; mais novas nos níveis altos."""
    vazios = sorted({int(x) for x in (vazios or []) if int(x) > 0})
    if not vazios:
        return None
    ocup = {int(k): v for k, v in (ocup or {}).items()}
    d = _parse_data_fifo(data_nova)
    if not ocup:
        return vazios[0]

    melhor = None
    for n in vazios:
        ok = True
        if d is not None:
            for on, od in ocup.items():
                od_p = _parse_data_fifo(od)
                if not od_p:
                    continue
                if on < n and d < od_p:
                    ok = False
                    break
                if on > n and d > od_p:
                    ok = False
                    break
        if ok:
            melhor = n
    if melhor is not None:
        return melhor

    datas_occ = [_parse_data_fifo(v) for v in ocup.values() if _parse_data_fifo(v)]
    if d is not None and datas_occ:
        if d >= max(datas_occ):
            return max(vazios)
        if d <= min(datas_occ):
            return min(vazios)
    return min(vazios)


def _buscar_vaga_putaway_fifo(
    conn, cat, cam_list, zona, order_prefix, order_params, data_producao, motivo, prioridade,
    codigos_permitidos=None, codigos_excluir=None,
):
    """
    Putaway com FIFO vertical por coluna, proximidade (order_prefix) e exclusão de destinos fixos.
    """
    t_loc = _tbl(conn, 'wms_localizacao')
    zona_sql = _filtro_zona_sql(zona, 'l')
    prefix = (order_prefix + ', ') if order_prefix else ''
    cam_list = [int(c) for c in (cam_list or []) if c]
    if not cam_list:
        return None, None

    permitidos = set(codigos_permitidos or [])
    excluir = set(codigos_excluir or [])
    filtro_cod = ''
    extra_params = []
    if permitidos:
        ph = ','.join(['?'] * len(permitidos))
        filtro_cod = f' AND l.codigo_endereco IN ({ph})'
        extra_params.extend(sorted(permitidos))

    rows = []
    for cam in cam_list:
        params = [cam, cat, *order_params, *extra_params]
        chunk = conn.execute(
            f'''SELECT l.id, l.codigo_endereco, l.camara, l.rua, l.posicao, l.nivel, l.zona_armazenagem
                FROM {t_loc} l
                WHERE l.camara = ?
                  AND l.status = 'vazia'
                  AND UPPER(TRIM(COALESCE(l.categoria_zona, ''))) = ?
                  AND {zona_sql}
                  AND {_sql_putaway_tipo_ok('l')}
                  AND {_bloqueio_off_sql(conn, 'l.bloqueio_entrada')}
                  {filtro_cod}
                ORDER BY {prefix}{_sql_ordem_rota(cam, conn)}''',
            tuple(params),
        ).fetchall()
        rows.extend(chunk or [])

    if not rows:
        return None, None

    vazios_por_col = {}
    slot_por_col_niv = {}
    ordem_colunas = []
    for r in rows:
        rd = _row_dict(r) or {}
        cod = (rd.get('codigo_endereco') or '').strip().upper()
        if excluir and cod in excluir:
            continue
        cam = int(rd.get('camara') or 0)
        rua = str(rd.get('rua') or '').upper()
        pos = int(rd.get('posicao') or 0)
        niv = int(rd.get('nivel') or 0)
        if not cam or not rua or not pos or not niv:
            continue
        key = (cam, rua, pos)
        if key not in vazios_por_col:
            ordem_colunas.append(key)
        vazios_por_col.setdefault(key, set()).add(niv)
        slot_por_col_niv[(cam, rua, pos, niv)] = rd

    if not ordem_colunas:
        return None, None

    ocup_cols = _ocupacao_fifo_colunas(conn, cam_list)
    for key in ordem_colunas:
        cam, rua, pos = key
        niv_ideal = _nivel_fifo_vertical(
            data_producao,
            ocup_cols.get(key, {}),
            vazios_por_col.get(key, set()),
        )
        if niv_ideal is None:
            continue
        rd = slot_por_col_niv.get((cam, rua, pos, niv_ideal))
        if not rd:
            continue
        motivo.append(
            f'Câmara {cam} · Rua {rua} · pos {pos} · nív {niv_ideal}'
            f' (FIFO vertical, prioridade: {prioridade})'
        )
        if data_producao:
            motivo.append(f'Data produção {str(data_producao)[:10]} — mais antiga embaixo')
        return _format_locacao(rd), prioridade
    return None, None


def _buscar_vaga_vazia_putaway(conn, cat, cam_list, zona, order_prefix, order_params, motivo, prioridade):
    """Compat: delega ao putaway FIFO vertical."""
    return _buscar_vaga_putaway_fifo(
        conn, cat, cam_list, zona, order_prefix, order_params, None, motivo, prioridade,
    )


def _camaras_putaway_expandidas(conn, cat, cam_list):
    """Garante câmaras do layout no zoneamento + 15 (ex-21) quando aplicável."""
    out = []
    seen = set()
    for c in cam_list or []:
        ci = int(c)
        if ci not in seen:
            seen.add(ci)
            out.append(ci)
    for cam in _WMS_CAMARAS_ESTOQUE:
        if cam in seen:
            continue
        row = conn.execute(
            f'''SELECT 1 FROM {_tbl(conn, 'wms_zoneamento')}
                WHERE categoria = ? AND camara = ? AND {_ativo_sql(conn)}
                LIMIT 1''',
            (cat, cam),
        ).fetchone()
        if row:
            seen.add(cam)
            out.append(cam)
    return out or list(_WMS_CAMARAS_PRINCIPAIS)


def _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, prioridade):
    if not loc:
        return {
            'localizacao_id': None,
            'codigo_endereco': None,
            'camara': None,
            'zona_label': None,
            'texto': None,
            'motivo': motivo,
            'status_condicional': status,
            'posicoes_wms': pos_wms,
            'posicoes_planejadas': pos_med,
            'alerta': alerta,
            'prioridade': prioridade,
        }
    return {
        'localizacao_id': loc.get('id'),
        'codigo_endereco': loc.get('codigo_endereco'),
        'barcode_longarina': loc.get('barcode_longarina'),
        'camara': loc.get('camara'),
        'zona_armazenagem': loc.get('zona_armazenagem'),
        'zona_label': loc.get('zona_label'),
        'texto': loc.get('texto'),
        'motivo': motivo,
        'status_condicional': status,
        'posicoes_wms': pos_wms,
        'posicoes_planejadas': pos_med,
        'alerta': alerta,
        'prioridade': prioridade,
    }


def _categorias_camara_zoneamento(conn, camara):
    t_z = _tbl(conn, 'wms_zoneamento')
    rows = conn.execute(
        f'''SELECT DISTINCT categoria FROM {t_z}
            WHERE camara = ? AND {_ativo_sql(conn)}
            ORDER BY categoria''',
        (int(camara),),
    ).fetchall()
    cats = []
    for r in rows:
        c = (r['categoria'] if isinstance(r, dict) else r[0] or '').strip().upper()
        if c and c not in cats:
            cats.append(c)
    return cats or ['C']


def _distribuir_categorias_em_slots(total, categorias, pesos):
    """Divide `total` posições entre categorias permitidas, proporcional ao peso dos produtos."""
    if total <= 0 or not categorias:
        return []
    cats = list(categorias)
    soma = sum(max(int(pesos.get(c, 0)), 1) for c in cats)
    aloc = {}
    resto = total
    for i, c in enumerate(cats):
        if i == len(cats) - 1:
            aloc[c] = resto
        else:
            n = max(1, round(total * max(int(pesos.get(c, 0)), 1) / soma))
            n = min(n, resto - (len(cats) - i - 1))
            aloc[c] = n
            resto -= n
    seq = []
    for c in cats:
        seq.extend([c] * aloc.get(c, 0))
    while len(seq) < total:
        seq.append(cats[len(seq) % len(cats)])
    return seq[:total]


def _gerar_coordenadas_camara(camara, ruas, niveis, total):
    """Gera (camara, rua, posicao, nivel) — coluna cheia com todos os níveis antes da próxima."""
    ruas = [str(r).strip().upper() for r in (ruas or ['A']) if str(r).strip()] or ['A']
    niveis = max(1, int(niveis or 5))
    out = []
    base = total // len(ruas)
    extra = total % len(ruas)
    for idx, rua in enumerate(ruas):
        slots_rua = base + (1 if idx < extra else 0)
        pos = 1
        i = 0
        while i < slots_rua:
            for niv in range(1, niveis + 1):
                if i >= slots_rua:
                    break
                out.append((int(camara), rua, pos, niv))
                i += 1
            pos += 1
    return out[:total]


def _destinos_acao_labels():
    cfg = _layout_camaras_config()
    labels = dict(cfg.get('destinos_acao') or {})
    labels.setdefault('envio_mg', 'ENVIO P/ MINAS')
    labels.setdefault('retrabalho', 'RETRABALHO')
    labels.setdefault('descarte_perdas', 'DESCARTE')
    labels.setdefault('palete_bloqueado', 'BLOQUEADOS')
    labels.setdefault('avaria', 'AVARIA')
    labels.setdefault('reentregas', 'REENTREGAS')
    return labels


def _slot_reentrega_ou_estoque_flexivel(dest_acao, apenas_rotulo):
    """Rótulo REENTREGAS no layout, mas endereço aceita estoque normal quando vazio."""
    return (dest_acao or '').strip().lower() == 'reentregas' and bool(apenas_rotulo)


def _slot_destino_fixo_no_layout(dest_acao, apenas_rotulo):
    return bool(dest_acao) and not _slot_reentrega_ou_estoque_flexivel(dest_acao, apenas_rotulo)


def _portas_bloco(bloco):
    """Portas físicas por rua — colunas e níveis inclusivos (1-based)."""
    out = []
    for p in bloco.get('portas') or []:
        rua = str(p.get('rua') or '').strip().upper()
        cols = p.get('colunas') or p.get('cols') or []
        nivs = p.get('niveis') or []
        if not rua or len(cols) < 2 or len(nivs) < 2:
            continue
        out.append({
            'rua': rua,
            'colunas': [int(cols[0]), int(cols[1])],
            'niveis': [int(nivs[0]), int(nivs[1])],
        })
    return out


def _celula_e_porta(bloco, rua, posicao, nivel):
    rua = str(rua or '').strip().upper()
    pos = int(posicao)
    niv = int(nivel)
    for p in _portas_bloco(bloco):
        if p['rua'] != rua:
            continue
        c0, c1 = p['colunas']
        n0, n1 = p['niveis']
        if c0 <= pos <= c1 and n0 <= niv <= n1:
            return True
    return False


def _coords_from_bloco_layout(bloco):
    """Retorna [(camara, rua, posicao, nivel, destino_acao, destino_label, apenas_rotulo), ...]."""
    cod = int(bloco['codigo'])
    ends = bloco.get('enderecos') or []
    if ends:
        out = []
        labels = _destinos_acao_labels()
        for e in ends:
            dest = (e.get('destino_acao') or '').strip().lower() or None
            lbl = (e.get('destino_label') or '').strip() or (labels.get(dest) if dest else None)
            out.append((
                cod,
                str(e.get('rua') or '').strip().upper(),
                int(e['posicao']),
                int(e['nivel']),
                dest,
                lbl,
                bool(e.get('destino_apenas_rotulo')),
            ))
        return [c for c in out if not _celula_bloqueada_fisica(c[0], c[1], c[2], c[3])]
    total = _total_posicoes_ref(cod, bloco)
    coords = _gerar_coordenadas_camara(cod, bloco.get('ruas'), bloco.get('niveis', 5), total)
    return [(c, r, p, n, None, None, False) for c, r, p, n in coords]


def _layout_niveis_esperados():
    return {
        int(b['codigo']): max(1, int(b.get('niveis') or 5))
        for b in (_layout_camaras_config().get('camaras') or [])
    }


def _precisa_regenerar_layout_niveis(conn):
    """Regenera quando falta câmara de estoque ou níveis incompletos no banco."""
    if not _wms_tabelas_existem(conn):
        return True
    t_loc = _tbl(conn, 'wms_localizacao')
    esperados = _layout_niveis_esperados()
    if not esperados:
        return True
    for cam, n_esp in esperados.items():
        row = conn.execute(
            f'''SELECT COUNT(*) AS c, MAX(nivel) AS mx
                FROM {t_loc} WHERE camara = ?''',
            (cam,),
        ).fetchone()
        rd = _row_dict(row) or {}
        cnt = int(rd.get('c') or 0)
        if cnt <= 0:
            return True
        mx = int(rd.get('mx') or 0)
        if mx < n_esp:
            return True
    return False


def _ensure_layout_enderecos_atualizado(conn):
    """Gera endereços de estoque se faltarem; regera com force se níveis incompletos."""
    if _precisa_regenerar_layout_niveis(conn):
        gerar_layout_enderecos(conn, force=True)
    else:
        _ensure_layout_enderecos(conn)
        return _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {_tbl(conn, "wms_localizacao")}').fetchone(), 'c')
    try:
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {_tbl(conn, "wms_localizacao")}').fetchone(), 'c')


def gerar_layout_enderecos(conn, force=False):
    """
    Gera/atualiza endereços no banco a partir do layout JSON + zoneamento por categoria.
    Não usa planilha Excel.
    """
    _ensure_categoria_zona_column(conn)
    ensure_wms_schema(conn)
    _seed_wms_defaults(conn)

    t_loc = _tbl(conn, 'wms_localizacao')
    t_cam = _tbl(conn, 'wms_camara')
    pesos = _pesos_categoria_produtos(conn)
    cfg = _layout_camaras_config()
    now = _now_iso()

    if not force:
        sem_zona = conn.execute(
            f'''SELECT COUNT(*) AS c FROM {t_loc}
                WHERE categoria_zona IS NULL OR TRIM(categoria_zona) = ?''',
            ('',),
        ).fetchone()
        cnt = int((sem_zona or {}).get('c', 0) if isinstance(sem_zona, dict) else 0)
        total_loc = conn.execute(f'SELECT COUNT(*) AS c FROM {t_loc}').fetchone()
        total_loc = int((total_loc or {}).get('c', 0) if isinstance(total_loc, dict) else 0)
        if total_loc > 0 and cnt == 0:
            return {'ok': True, 'geradas': 0, 'mensagem': 'Layout já distribuído por categoria.'}

    inseridas = 0
    por_categoria = Counter()

    for bloco in cfg.get('camaras') or []:
        cod = int(bloco['codigo'])
        coords_full = _coords_from_bloco_layout(bloco)
        total = len(coords_full) if coords_full else _total_posicoes_ref(cod, bloco)
        if total <= 0:
            continue
        cats = _categorias_camara_zoneamento(conn, cod)
        slots_cat = [c for c in coords_full if not _slot_destino_fixo_no_layout(c[4], c[6])]
        seq_cat = _distribuir_categorias_em_slots(len(slots_cat), cats, pesos) if slots_cat else []
        codigos_validos = []
        idx_cat = 0
        for cam, rua, pos, nivel, dest_acao, dest_lbl, _apenas_rotulo in coords_full:
            if _slot_destino_fixo_no_layout(dest_acao, _apenas_rotulo):
                cat_z = None
                area = dest_acao
                zona = dest_acao
                tipo = 'destino_fixo'
            else:
                cat_z = seq_cat[idx_cat] if idx_cat < len(seq_cat) else (cats[0] if cats else 'C')
                idx_cat += 1
                area = cat_z
                zona = _zona_por_nivel(nivel)
                tipo = 'porta_palete'
            cod_end = _codigo_endereco(cam, rua, pos, nivel)
            codigos_validos.append(cod_end)
            if _is_pg(conn):
                conn.execute(
                    f'''INSERT INTO {t_loc}
                        (camara, rua, posicao, nivel, codigo_endereco, tipo, status, area, categoria_zona, zona_armazenagem)
                        VALUES (?, ?, ?, ?, ?, ?, 'vazia', ?, ?, ?)
                        ON CONFLICT (codigo_endereco) DO UPDATE SET
                          tipo = EXCLUDED.tipo,
                          area = EXCLUDED.area,
                          categoria_zona = EXCLUDED.categoria_zona,
                          zona_armazenagem = EXCLUDED.zona_armazenagem,
                          atualizado_em = NOW()''',
                    (cam, rua, pos, nivel, cod_end, tipo, area, cat_z, zona),
                )
            else:
                conn.execute(
                    f'''INSERT INTO {t_loc}
                        (camara, rua, posicao, nivel, codigo_endereco, tipo, status, area, categoria_zona, zona_armazenagem,
                         criado_em, atualizado_em)
                        VALUES (?, ?, ?, ?, ?, ?, 'vazia', ?, ?, ?, ?, ?)
                        ON CONFLICT (codigo_endereco) DO UPDATE SET
                          tipo = excluded.tipo,
                          area = excluded.area,
                          categoria_zona = excluded.categoria_zona,
                          zona_armazenagem = excluded.zona_armazenagem,
                          atualizado_em = excluded.atualizado_em''',
                    (cam, rua, pos, nivel, cod_end, tipo, area, cat_z, zona, now, now),
                )
            inseridas += 1
            if cat_z:
                por_categoria[cat_z] += 1

        if force:
            _limpar_localizacoes_orfas_vazias(conn, cod, codigos_validos)
        conn.execute(f'UPDATE {t_cam} SET total_posicoes = ? WHERE codigo = ?', (total, cod))

    try:
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {
        'ok': True,
        'geradas': inseridas,
        'por_categoria': dict(por_categoria),
        'pesos_produtos': pesos,
    }


def _distribuicao_categoria(conn):
    t_loc = _tbl(conn, 'wms_localizacao')
    rows = conn.execute(
        f'''SELECT categoria_zona AS categoria, camara,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'vazia' THEN 1 ELSE 0 END) AS vazias,
                   SUM(CASE WHEN status = 'ocupada' THEN 1 ELSE 0 END) AS ocupadas
            FROM {t_loc}
            WHERE categoria_zona IS NOT NULL AND TRIM(categoria_zona) <> ''
            GROUP BY categoria_zona, camara
            ORDER BY categoria_zona, camara'''
    ).fetchall()
    return [_row_dict(r) or {} for r in rows]


def _painel_ocupacao_e_dist(conn):
    """Uma varredura agregada de wms_localizacao → câmaras + distribuição."""
    t_loc = _tbl(conn, 'wms_localizacao')
    t_cam = _tbl(conn, 'wms_camara')
    cam_rows = conn.execute(
        f'''SELECT codigo, descricao, total_posicoes
            FROM {t_cam}
            WHERE {_ativo_sql(conn)}
            ORDER BY codigo'''
    ).fetchall()
    agg = conn.execute(
        f'''SELECT camara, categoria_zona, status, COUNT(*) AS n
            FROM {t_loc}
            GROUP BY camara, categoria_zona, status'''
    ).fetchall()
    by_cam = {}
    dist_map = {}
    for r in agg:
        d = _row_dict(r) or {}
        cam = int(d.get('camara') or 0)
        cat = (d.get('categoria_zona') or '').strip()
        st = (d.get('status') or '').strip().lower()
        n = int(d.get('n') or 0)
        bc = by_cam.setdefault(cam, {'cadastradas': 0, 'ocupadas': 0, 'vazias': 0})
        bc['cadastradas'] += n
        if st == 'ocupada':
            bc['ocupadas'] += n
        elif st == 'vazia':
            bc['vazias'] += n
        if cat:
            key = (cat, cam)
            dd = dist_map.setdefault(
                key,
                {'categoria': cat, 'camara': cam, 'total': 0, 'vazias': 0, 'ocupadas': 0},
            )
            dd['total'] += n
            if st == 'vazia':
                dd['vazias'] += n
            elif st == 'ocupada':
                dd['ocupadas'] += n
    refs = _map_totais_ref_camaras()
    camaras = []
    for r in cam_rows:
        d = _row_dict(r) or {}
        cod = int(d.get('codigo') or 0)
        stats = by_cam.get(cod) or {'cadastradas': 0, 'ocupadas': 0, 'vazias': 0}
        cad = int(stats['cadastradas'])
        ocup = int(stats['ocupadas'])
        vaz = int(stats['vazias'])
        total_ref = refs.get(cod) or int(d.get('total_posicoes') or cad or 1)
        base = cad if cad > 0 else total_ref
        vaz_calc = cad - ocup if cad > 0 else max(total_ref - ocup, 0)
        pct = round(100.0 * ocup / base, 1) if base else 0
        camaras.append({
            'camara': cod,
            'descricao': d.get('descricao'),
            'total_posicoes': total_ref,
            'cadastradas': cad,
            'ocupadas': ocup,
            'vazias': vaz if cad else vaz_calc,
            'ocupacao_pct': pct,
        })
    dist = sorted(dist_map.values(), key=lambda x: (str(x.get('categoria') or ''), int(x.get('camara') or 0)))
    return camaras, dist


def _listar_zoneamento(conn):
    t = _tbl(conn, 'wms_zoneamento')
    rows = conn.execute(
        f'''SELECT z.categoria, z.camara, z.prioridade, c.descricao AS camara_descricao
            FROM {t} z
            LEFT JOIN {_tbl(conn, "wms_camara")} c ON c.codigo = z.camara
            WHERE {_ativo_sql(conn, 'z')}
            ORDER BY z.categoria, z.prioridade'''
    ).fetchall()
    out = []
    for r in rows:
        rd = _row_dict(r) or {}
        out.append({
            'categoria': rd.get('categoria'),
            'camara': rd.get('camara'),
            'prioridade': rd.get('prioridade'),
            'camara_descricao': rd.get('camara_descricao'),
        })
    return out


def _ensure_layout_enderecos(conn):
    """Gera endereços das câmaras de estoque (6–16) se ainda não existirem (ignora 98/99)."""
    t_loc = _tbl(conn, 'wms_localizacao')
    falta_estoque = False
    for cam in _WMS_CAMARAS_ESTOQUE:
        cnt = _int_col(
            conn.execute(f'SELECT COUNT(*) AS c FROM {t_loc} WHERE camara = ?', (cam,)).fetchone(),
            'c',
        )
        if cnt <= 0:
            falta_estoque = True
            break
    if not falta_estoque:
        return _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {t_loc}').fetchone(), 'c')
    gerar_layout_enderecos(conn, force=False)
    try:
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {t_loc}').fetchone(), 'c')


def _gerar_etiqueta_palete():
    """Etiqueta palete WMS — exatamente 22 caracteres."""
    prefix = 'UP'
    ts = datetime.now(timezone.utc).strftime('%y%m%d%H%M')
    rest = 22 - len(prefix) - len(ts)
    suffix = ''.join(secrets.choice(string.digits + string.ascii_uppercase) for _ in range(max(rest, 4)))
    etiqueta = (prefix + ts + suffix)[:22]
    if len(etiqueta) < 22:
        etiqueta = etiqueta.ljust(22, '0')
    return etiqueta


def _ensure_wms_aux_data(conn):
    """Stage/áreas especiais — pesado; só uma vez, fora do path crítico das abas."""
    global _WMS_AUX_DATA_READY
    if _WMS_AUX_DATA_READY:
        return
    for fn, label in (
        (_ensure_stage_localizacoes, 'stage'),
        (_ensure_areas_especiais_localizacoes, 'areas_especiais'),
    ):
        try:
            fn(conn)
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                print('[wms] aux %s falhou:' % label, e, flush=True)
            except Exception:
                pass
    _WMS_AUX_DATA_READY = True


def _ensure_sequencia_rota_table(conn):
    t = _tbl(conn, 'wms_sequencia_rota')
    try:
        if _is_pg(conn):
            conn.execute(
                f'''CREATE TABLE IF NOT EXISTS {t} (
                    camara INTEGER NOT NULL,
                    rua TEXT NOT NULL,
                    sentido_posicao TEXT NOT NULL DEFAULT 'asc',
                    sentido_nivel TEXT NOT NULL DEFAULT 'asc',
                    PRIMARY KEY (camara, rua)
                )'''
            )
            conn.commit()
            _ensure_pg_rls_basico(conn, 'wms_sequencia_rota')
        else:
            conn.execute(
                '''CREATE TABLE IF NOT EXISTS wms_sequencia_rota (
                    camara INTEGER NOT NULL,
                    rua TEXT NOT NULL,
                    sentido_posicao TEXT NOT NULL DEFAULT 'asc',
                    sentido_nivel TEXT NOT NULL DEFAULT 'asc',
                    PRIMARY KEY (camara, rua)
                )'''
            )
            conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def ensure_wms_schema(conn):
    """DDL leve das tabelas WMS. Sem UPDATE em massa nem inserts de stage/áreas."""
    global _WMS_SCHEMA_READY
    if _WMS_SCHEMA_READY:
        return
    if _wms_tabelas_existem(conn):
        # Só ALTER COLUMN leve — NÃO regenera layout nem faz UPDATE full-table.
        for fn, label in (
            (lambda c: _ensure_zona_armazenagem_column(c, backfill=False), 'zona_armazenagem'),
            (_ensure_produto_planejamento_columns, 'produto_planejamento'),
            (_ensure_wms_recebimento_terceiros_columns, 'recebimento_terceiros'),
            (_ensure_wms_palete_item_nf_columns, 'palete_item_nf'),
            (_ensure_wms_palete_item_disposicao, 'palete_item_disposicao'),
            (_ensure_wms_palete_controle_table, 'palete_controle'),
            (_ensure_movimentacao_expedicao_columns, 'movimentacao_expedicao'),
            (_ensure_sequencia_rota_table, 'sequencia_rota'),
        ):
            try:
                fn(conn)
            except Exception as e:
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    print('[wms] ensure %s falhou:' % label, e, flush=True)
                except Exception:
                    pass
        _WMS_SCHEMA_READY = True
        return
    if _is_pg(conn):
        sql_path = os.path.join(os.path.dirname(__file__), 'supabase', 'create_wms_enderecamento.sql')
        if os.path.isfile(sql_path):
            with open(sql_path, encoding='utf-8') as f:
                raw = f.read()
            buf = []
            for line in raw.splitlines():
                stripped = line.strip()
                if stripped.startswith('--'):
                    continue
                buf.append(line)
            blob = '\n'.join(buf)
            stmts = []
            cur = []
            for part in blob.split(';'):
                part = part.strip()
                if not part:
                    continue
                if part.upper().startswith('COMMENT'):
                    continue
                stmts.append(part)
            for stmt in stmts:
                try:
                    conn.execute(stmt)
                except Exception:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
    else:
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_camara (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                codigo INTEGER NOT NULL UNIQUE,
                descricao TEXT NOT NULL,
                total_posicoes INTEGER NOT NULL DEFAULT 0,
                ativo INTEGER NOT NULL DEFAULT 1,
                criado_em TEXT NOT NULL
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_localizacao (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camara INTEGER NOT NULL,
                rua TEXT NOT NULL,
                posicao INTEGER NOT NULL,
                nivel INTEGER NOT NULL DEFAULT 1,
                codigo_endereco TEXT NOT NULL UNIQUE,
                tipo TEXT NOT NULL DEFAULT 'porta_palete',
                status TEXT NOT NULL DEFAULT 'vazia',
                capacidade_max INTEGER NOT NULL DEFAULT 1,
                bloqueio_entrada INTEGER NOT NULL DEFAULT 0,
                bloqueio_saida INTEGER NOT NULL DEFAULT 0,
                bloqueio_inventario INTEGER NOT NULL DEFAULT 0,
                area TEXT,
                categoria_zona TEXT,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL,
                UNIQUE (camara, rua, posicao, nivel)
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_produto_enderecamento (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sku TEXT NOT NULL UNIQUE,
                descricao TEXT,
                medida_cx TEXT,
                cubagem REAL,
                peso_cx REAL,
                padrao_plt TEXT,
                conversao INTEGER,
                categoria TEXT NOT NULL DEFAULT 'C',
                temperatura_zona TEXT DEFAULT 'congelado',
                ativo INTEGER NOT NULL DEFAULT 1,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_zoneamento (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                categoria TEXT NOT NULL,
                camara INTEGER NOT NULL,
                prioridade INTEGER NOT NULL DEFAULT 1,
                ativo INTEGER NOT NULL DEFAULT 1,
                UNIQUE (categoria, camara)
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_palete (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                etiqueta TEXT NOT NULL UNIQUE,
                localizacao_id INTEGER,
                status TEXT NOT NULL DEFAULT 'em_conferencia',
                estado_fisico TEXT DEFAULT 'bom',
                temperatura REAL,
                bloqueio_tipo TEXT,
                bloqueio_motivo TEXT,
                recebimento_id INTEGER,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL,
                criado_por TEXT
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_palete_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                palete_id INTEGER NOT NULL,
                sku TEXT NOT NULL,
                descricao TEXT,
                lote TEXT,
                data_producao TEXT,
                data_validade TEXT,
                sif TEXT,
                quantidade_caixas INTEGER NOT NULL DEFAULT 0,
                peso_liquido REAL,
                rg_caixa TEXT,
                shelf_dias INTEGER,
                criado_em TEXT NOT NULL
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_movimentacao (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                palete_id INTEGER NOT NULL,
                origem_localizacao_id INTEGER,
                destino_localizacao_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pendente',
                prioridade INTEGER NOT NULL DEFAULT 5,
                observacao TEXT,
                criado_em TEXT NOT NULL,
                concluida_em TEXT,
                criado_por TEXT,
                concluida_por TEXT
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_posicao_picking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                localizacao_id INTEGER NOT NULL UNIQUE,
                sku TEXT,
                shelf_min_dias INTEGER,
                qtd_minima INTEGER DEFAULT 0,
                buffer INTEGER NOT NULL DEFAULT 0,
                ativo INTEGER NOT NULL DEFAULT 1,
                criado_em TEXT NOT NULL
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_recebimento (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero_nf TEXT,
                fornecedor TEXT,
                placa TEXT,
                doca TEXT,
                origem TEXT NOT NULL DEFAULT 'manual',
                status TEXT NOT NULL DEFAULT 'aguardando',
                check_qualidade_ok INTEGER,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL,
                criado_por TEXT
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_recebimento_palete (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recebimento_id INTEGER NOT NULL,
                palete_id INTEGER NOT NULL,
                estado_palete TEXT DEFAULT 'bom',
                conferencia_cega INTEGER NOT NULL DEFAULT 1,
                UNIQUE (recebimento_id, palete_id)
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_check_qualidade (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contexto TEXT NOT NULL DEFAULT 'recebimento',
                ordem INTEGER NOT NULL DEFAULT 1,
                pergunta TEXT NOT NULL,
                tipo_resposta TEXT NOT NULL DEFAULT 'sim_nao',
                ativo INTEGER NOT NULL DEFAULT 1
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_check_qualidade_resposta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recebimento_id INTEGER NOT NULL,
                pergunta_id INTEGER NOT NULL,
                resposta TEXT,
                valor_numerico REAL,
                respondido_em TEXT NOT NULL,
                respondido_por TEXT
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_inventario (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT NOT NULL,
                descricao TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ativo',
                criado_em TEXT NOT NULL,
                finalizado_em TEXT,
                criado_por TEXT
            )'''
        )
        conn.execute(
            '''CREATE TABLE IF NOT EXISTS wms_inventario_linha (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                inventario_id INTEGER NOT NULL,
                localizacao_id INTEGER,
                palete_etiqueta TEXT,
                sku TEXT,
                status_esperado TEXT,
                status_informado TEXT,
                quantidade_contada INTEGER,
                divergencia INTEGER NOT NULL DEFAULT 0,
                contado_em TEXT,
                contado_por TEXT
            )'''
        )
    try:
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    _ensure_categoria_zona_column(conn)
    _ensure_produto_planejamento_columns(conn)
    _ensure_wms_palete_controle_table(conn)
    _ensure_wms_inventario_linha_produto_columns(conn)
    _ensure_sequencia_rota_table(conn)
    _WMS_SCHEMA_READY = True


def _obter_palete_por_etiqueta(conn, etiqueta):
    etiqueta = (etiqueta or '').strip()
    if not etiqueta:
        return None
    t_pal = _tbl(conn, 'wms_palete')
    row = conn.execute(f'SELECT * FROM {t_pal} WHERE etiqueta = ?', (etiqueta,)).fetchone()
    if not row and len(etiqueta) == 22:
        row = conn.execute(f'SELECT * FROM {t_pal} WHERE UPPER(etiqueta) = ?', (etiqueta.upper(),)).fetchone()
    return _row_dict(row)


def _saida_aberta_palete(conn, palete_id):
    t = _tbl(conn, 'wms_palete_controle')
    row = conn.execute(
        f'''SELECT c.* FROM {t} c
            WHERE c.palete_id = ? AND c.tipo = 'saida'
              AND NOT EXISTS (
                SELECT 1 FROM {t} r
                WHERE r.tipo = 'retorno' AND r.registro_saida_id = c.id
              )
            ORDER BY c.id DESC LIMIT 1''',
        (int(palete_id),),
    ).fetchone()
    return _row_dict(row)


def _registrar_controle_palete(
    conn, palete_id, tipo, subtipo=None, motivo=None, destino_externo=None,
    localizacao_id=None, codigo_endereco=None, observacao=None, registro_saida_id=None,
):
    t = _tbl(conn, 'wms_palete_controle')
    user = _usuario()
    now = _now_iso()
    if _is_pg(conn):
        cur = conn.execute(
            f'''INSERT INTO {t}
                (palete_id, tipo, subtipo, motivo, destino_externo, localizacao_id,
                 codigo_endereco, observacao, registro_saida_id, criado_em, criado_por)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?) RETURNING id''',
            (
                int(palete_id), tipo, subtipo, motivo, destino_externo,
                localizacao_id, codigo_endereco, observacao, registro_saida_id, user,
            ),
        )
        rid = cur.fetchone()['id']
    else:
        conn.execute(
            f'''INSERT INTO {t}
                (palete_id, tipo, subtipo, motivo, destino_externo, localizacao_id,
                 codigo_endereco, observacao, registro_saida_id, criado_em, criado_por)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                int(palete_id), tipo, subtipo, motivo, destino_externo,
                localizacao_id, codigo_endereco, observacao, registro_saida_id, now, user,
            ),
        )
        rid = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    return rid


def _info_palete_controle(conn, palete_id):
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_rec = _tbl(conn, 'wms_recebimento')
    t_ctrl = _tbl(conn, 'wms_palete_controle')
    pal = conn.execute(
        f'''SELECT p.*, l.codigo_endereco, r.numero_nf, r.fornecedor
            FROM {t_pal} p
            LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
            LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
            WHERE p.id = ?''',
        (int(palete_id),),
    ).fetchone()
    if not pal:
        return None
    rd = _row_dict(pal) or {}
    itens = conn.execute(
        f'''SELECT sku, descricao, lote, quantidade_caixas, data_producao, data_validade, criado_em
            FROM {t_item} WHERE palete_id = ? ORDER BY id''',
        (int(palete_id),),
    ).fetchall()
    hist = conn.execute(
        f'''SELECT * FROM {t_ctrl} WHERE palete_id = ? ORDER BY criado_em DESC, id DESC LIMIT 100''',
        (int(palete_id),),
    ).fetchall()
    saida_aberta = _saida_aberta_palete(conn, palete_id)
    return {
        'palete': rd,
        'itens': [_row_dict(i) for i in itens or []],
        'historico': [_row_dict(h) for h in hist or []],
        'saida_aberta': saida_aberta,
        'fora_armazem': (rd.get('status') == 'fora_armazem') or bool(saida_aberta),
    }


def _registrar_saida_palete(conn, palete_id, motivo, destino_externo=None, observacao=None):
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    pal = conn.execute(f'SELECT * FROM {t_pal} WHERE id = ?', (int(palete_id),)).fetchone()
    if not pal:
        return None, 'Palete não encontrado.'
    rd = _row_dict(pal) or {}
    if _saida_aberta_palete(conn, palete_id):
        return None, 'Este palete já possui saída em aberto (aguardando retorno).'
    st = (rd.get('status') or '').lower()
    if st == 'fora_armazem':
        return None, 'Palete já está marcado como fora do armazém.'
    if st == 'bloqueado':
        return None, 'Palete bloqueado — não é possível registrar saída.'
    loc_id = rd.get('localizacao_id')
    cod_end = None
    if loc_id:
        loc = conn.execute(f'SELECT codigo_endereco FROM {t_loc} WHERE id = ?', (loc_id,)).fetchone()
        cod_end = (_row_dict(loc) or {}).get('codigo_endereco')
    rid = _registrar_controle_palete(
        conn, palete_id, 'saida',
        subtipo='apontamento_saida',
        motivo=motivo or 'nao_informado',
        destino_externo=(destino_externo or '').strip() or None,
        localizacao_id=loc_id,
        codigo_endereco=cod_end,
        observacao=observacao,
    )
    now = _now_iso()
    if loc_id and st == 'armazenado':
        if _is_pg(conn):
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (loc_id,))
            conn.execute(
                f"UPDATE {t_pal} SET localizacao_id = NULL, status = 'fora_armazem', atualizado_em = NOW() WHERE id = ?",
                (int(palete_id),),
            )
        else:
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, loc_id))
            conn.execute(
                f"UPDATE {t_pal} SET localizacao_id = NULL, status = 'fora_armazem', atualizado_em = ? WHERE id = ?",
                (now, int(palete_id)),
            )
    else:
        if _is_pg(conn):
            conn.execute(f"UPDATE {t_pal} SET status = 'fora_armazem', atualizado_em = NOW() WHERE id = ?", (int(palete_id),))
        else:
            conn.execute(f"UPDATE {t_pal} SET status = 'fora_armazem', atualizado_em = ? WHERE id = ?", (now, int(palete_id)))
    return {'registro_id': rid, 'codigo_endereco_origem': cod_end}, None


def _registrar_retorno_palete(conn, palete_id, motivo=None, codigo_endereco=None, observacao=None):
    t_pal = _tbl(conn, 'wms_palete')
    saida = _saida_aberta_palete(conn, palete_id)
    if not saida:
        return None, 'Não há saída em aberto para este palete. Registre a saída antes do retorno.'
    pal = conn.execute(f'SELECT * FROM {t_pal} WHERE id = ?', (int(palete_id),)).fetchone()
    if not pal:
        return None, 'Palete não encontrado.'
    loc_id = None
    cod_end = (codigo_endereco or '').strip() or None
    loc_info = None
    if cod_end:
        loc_info, err = _confirmar_armazenagem_palete(conn, int(palete_id), cod_end)
        if err:
            return None, err
        loc_id = (loc_info or {}).get('id')
        cod_end = (loc_info or {}).get('codigo_endereco') or cod_end
    else:
        now = _now_iso()
        if _is_pg(conn):
            conn.execute(
                f"UPDATE {t_pal} SET status = 'em_conferencia', atualizado_em = NOW() WHERE id = ?",
                (int(palete_id),),
            )
        else:
            conn.execute(
                f"UPDATE {t_pal} SET status = 'em_conferencia', atualizado_em = ? WHERE id = ?",
                (now, int(palete_id)),
            )
    rid = _registrar_controle_palete(
        conn, palete_id, 'retorno',
        subtipo='apontamento_retorno',
        motivo=motivo or 'retorno',
        localizacao_id=loc_id,
        codigo_endereco=cod_end or saida.get('codigo_endereco'),
        observacao=observacao,
        registro_saida_id=saida.get('id'),
    )
    return {
        'registro_id': rid,
        'saida_registro_id': saida.get('id'),
        'localizacao': loc_info,
    }, None


def _contar_paletes_fora(conn):
    """Conta saídas sem retorno (mais leve que EXISTS por palete)."""
    t_ctrl = _tbl(conn, 'wms_palete_controle')
    row = conn.execute(
        f'''SELECT COUNT(DISTINCT c.palete_id) AS c
            FROM {t_ctrl} c
            WHERE c.tipo = 'saida'
              AND NOT EXISTS (
                SELECT 1 FROM {t_ctrl} r
                WHERE r.tipo = 'retorno' AND r.registro_saida_id = c.id
              )''',
    ).fetchone()
    return _int_col(row)


def _listar_paletes_fora(conn):
    data = _relatorio_wms(conn, 'paletes_fora')
    return (data or {}).get('linhas') or []


def _seed_wms_defaults(conn):
    """Câmaras, zoneamento e perguntas de qualidade padrão (idempotente)."""
    global _WMS_DEFAULTS_SEEDED
    if _WMS_DEFAULTS_SEEDED:
        return
    t_cam = _tbl(conn, 'wms_camara')
    t_z = _tbl(conn, 'wms_zoneamento')
    # Atalho: se já há câmaras e zoneamento, não reprocessa inserts.
    try:
        n_cam = _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {t_cam}').fetchone())
        n_z = _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {t_z}').fetchone())
        if n_cam > 0 and n_z > 0:
            _WMS_DEFAULTS_SEEDED = True
            return
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    now = _now_iso()
    camaras = [
        (6, 'Câmara 6', 144),
        (7, 'Câmara 7', 133),
        (14, 'Câmara 14', 142),
        (15, 'Câmara 15', 28),
        (16, 'Câmara 16', 150),
    ]
    for cod, desc, tot in camaras:
        try:
            if _is_pg(conn):
                conn.execute(
                    f'INSERT INTO {t_cam} (codigo, descricao, total_posicoes) VALUES (?, ?, ?) ON CONFLICT (codigo) DO NOTHING',
                    (cod, desc, tot),
                )
            else:
                conn.execute(
                    f'INSERT OR IGNORE INTO {t_cam} (codigo, descricao, total_posicoes, ativo, criado_em) VALUES (?, ?, ?, 1, ?)',
                    (cod, desc, tot, now),
                )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    zone = [
        ('A', 6, 1), ('A', 7, 2),
        ('B', 6, 1), ('B', 7, 2),
        ('C', 7, 1), ('C', 14, 2),
        ('D', 14, 1), ('D', 15, 2),
    ]
    for cat, cam, pri in zone:
        try:
            if _is_pg(conn):
                conn.execute(
                    f'INSERT INTO {t_z} (categoria, camara, prioridade) VALUES (?, ?, ?) ON CONFLICT (categoria, camara) DO NOTHING',
                    (cat, cam, pri),
                )
            else:
                conn.execute(
                    f'INSERT OR IGNORE INTO {t_z} (categoria, camara, prioridade, ativo) VALUES (?, ?, ?, 1)',
                    (cat, cam, pri),
                )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    perguntas = [
        (1, 'Veículo consta lacrado?'),
        (2, 'Divisória térmica em boas condições?'),
        (3, 'Condições higiênicas do baú adequadas?'),
        (4, 'Temperatura do baú (°C)'),
        (5, 'Número do lacre'),
        (6, 'Integridade das embalagens'),
    ]
    t_cq = _tbl(conn, 'wms_check_qualidade')
    for ordem, pergunta in perguntas:
        tipo = 'numero' if 'Temperatura' in pergunta or 'lacre' in pergunta.lower() else 'sim_nao'
        try:
            exist = conn.execute(
                f'SELECT 1 FROM {t_cq} WHERE contexto = ? AND pergunta = ?',
                ('recebimento', pergunta),
            ).fetchone()
            if not exist:
                if _is_pg(conn):
                    conn.execute(
                        f'INSERT INTO {t_cq} (contexto, ordem, pergunta, tipo_resposta) VALUES (?, ?, ?, ?)',
                        ('recebimento', ordem, pergunta, tipo),
                    )
                else:
                    conn.execute(
                        f'INSERT INTO {t_cq} (contexto, ordem, pergunta, tipo_resposta, ativo) VALUES (?, ?, ?, ?, 1)',
                        ('recebimento', ordem, pergunta, tipo),
                    )
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    try:
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    _WMS_DEFAULTS_SEEDED = True


def _row_dict(row):
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    return dict(row) if hasattr(row, 'keys') else None


def _sanitize_json(value):
    """Converte Decimal/datetime para tipos serializáveis (Postgres → JSON)."""
    if isinstance(value, dict):
        return {str(k): _sanitize_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_json(v) for v in value]
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    return value


def _ensure_wms_schema_safe(conn):
    try:
        ensure_wms_schema(conn)
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise RuntimeError('Falha ao preparar schema WMS: %s' % (e,)) from e


def _ocupacao_camara(conn):
    t_loc = _tbl(conn, 'wms_localizacao')
    t_cam = _tbl(conn, 'wms_camara')
    rows = conn.execute(
        f'''SELECT c.codigo, c.descricao, c.total_posicoes,
                   COUNT(l.id) AS cadastradas,
                   SUM(CASE WHEN l.status = 'ocupada' THEN 1 ELSE 0 END) AS ocupadas,
                   SUM(CASE WHEN l.status = 'vazia' THEN 1 ELSE 0 END) AS vazias
            FROM {t_cam} c
            LEFT JOIN {t_loc} l ON l.camara = c.codigo
            WHERE {_ativo_sql(conn, 'c')}
            GROUP BY c.codigo, c.descricao, c.total_posicoes
            ORDER BY c.codigo'''
    ).fetchall()
    refs = _map_totais_ref_camaras()
    out = []
    for r in rows:
        d = _row_dict(r) or {}
        cod = int(d.get('codigo') or 0)
        cad = int(d.get('cadastradas') or 0)
        ocup = int(d.get('ocupadas') or 0)
        vaz = int(d.get('vazias') or 0)
        total_ref = refs.get(cod) or int(d.get('total_posicoes') or cad or 1)
        base = cad if cad > 0 else total_ref
        vaz_calc = cad - ocup if cad > 0 else max(total_ref - ocup, 0)
        pct = round(100.0 * ocup / base, 1) if base else 0
        out.append({
            'camara': cod,
            'descricao': d.get('descricao'),
            'total_posicoes': total_ref,
            'cadastradas': cad,
            'ocupadas': ocup,
            'vazias': vaz if cad else vaz_calc,
            'ocupacao_pct': pct,
        })
    return out


def _sugerir_putaway(conn, sku, lote=None, data_producao=None, zona='pulmao'):
    """Putaway: FIFO + mesmo SKU junto + mesma categoria perto + zoneamento."""
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    t_z = _tbl(conn, 'wms_zoneamento')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    _ensure_zona_armazenagem_column(conn)
    _ensure_produto_planejamento_columns(conn)

    prod = conn.execute(f'SELECT * FROM {t_prod} WHERE sku = ? AND {_ativo_sql(conn)}', (sku,)).fetchone()
    info = _info_produto_wms(conn, sku, prod)
    pd = info
    cat = (pd.get('categoria') or 'C').strip().upper()
    zona = (zona or 'pulmao').lower()
    status = info.get('status_condicional') or ''
    pos_wms = info.get('posicoes_wms') or 0
    pos_max = int(pd.get('posicoes_max') or 0)
    pos_med = int(pd.get('posicoes_med') or 0)
    alerta = None

    motivo = [f'Categoria {cat}', f'Zona {_zona_label(zona)}']
    if status:
        motivo.append(f'Status planejamento: {status}')
    if pos_med:
        motivo.append(f'Posições ref.: {pos_wms}/{pos_med} (média planejada)')
    if status == 'Vermelho':
        motivo.append('Prioridade reposição — estoque abaixo do ideal')
    elif status == 'Excedido':
        motivo.append('Atenção — estoque acima do ideal')
        if pos_max and pos_wms >= pos_max:
            alerta = 'capacidade_posicoes_excedida'

    camaras = conn.execute(
        f'''SELECT camara FROM {t_z}
            WHERE categoria = ? AND {_ativo_sql(conn)}
            ORDER BY prioridade ASC''',
        (cat,),
    ).fetchall()
    cam_list = [r['camara'] if isinstance(r, dict) else r[0] for r in camaras]
    if not cam_list:
        cam_list = list(_WMS_CAMARAS_PRINCIPAIS)

    order_parts = []
    order_params = []

    # 1) Mesmo SKU + mesmo lote: vaga vazia na mesma rua do estoque existente
    if lote:
        anchor_lote = conn.execute(
            f'''SELECT l.camara, l.rua, l.posicao
                FROM {t_loc} l
                JOIN {t_pal} p ON p.localizacao_id = l.id
                JOIN {t_item} i ON i.palete_id = p.id
                WHERE i.sku = ? AND i.lote = ? AND l.status = 'ocupada'
                  AND UPPER(TRIM(COALESCE(l.categoria_zona, ''))) = ?
                  AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
                ORDER BY l.rua, l.posicao, l.nivel
                LIMIT 1''',
            (sku, lote, cat),
        ).fetchone()
        if anchor_lote:
            ad = _row_dict(anchor_lote) or {}
            motivo.insert(0, f'Mesmo SKU e lote — adensar na Rua {ad.get("rua")}')
            order_parts.append('CASE WHEN l.camara = ? AND UPPER(TRIM(l.rua)) = ? THEN 0 ELSE 1 END')
            order_params.extend([ad.get('camara'), str(ad.get('rua') or '').upper()])
            if ad.get('posicao') is not None:
                order_parts.append('CASE WHEN l.posicao = ? THEN 0 ELSE 1 END')
                order_params.append(int(ad.get('posicao')))
                order_parts.append('ABS(l.posicao - ?)')
                order_params.append(int(ad.get('posicao')))
            loc, pri = _buscar_vaga_putaway_fifo(
                conn, cat, cam_list, zona, ', '.join(order_parts), order_params,
                data_producao, motivo, 'adensamento_lote',
            )
            if loc:
                return _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, pri)

    # 2) Mesmo SKU: cluster na rua com mais paletes do código
    cluster = _rua_cluster_sku(conn, sku, cat)
    if cluster.get('camara') and cluster.get('rua'):
        motivo.append(f'Mesmo código: cluster na Rua {cluster["rua"]} (Câm {cluster["camara"]})')
        order_parts.append('CASE WHEN l.camara = ? AND UPPER(TRIM(l.rua)) = ? THEN 0 ELSE 1 END')
        order_params.extend([cluster['camara'], str(cluster['rua']).upper()])

    # 3) FIFO: alinhar com estoque mais antigo (data de produção)
    fifo_anchor = _anchor_fifo_sku(conn, sku, cat)
    if fifo_anchor.get('camara') and fifo_anchor.get('rua'):
        dp_ant = fifo_anchor.get('data_producao')
        motivo.append(
            f'FIFO: estoque mais antigo em Rua {fifo_anchor.get("rua")}'
            + (f' (prod. {dp_ant})' if dp_ant else '')
        )
        order_parts.append('CASE WHEN l.camara = ? AND UPPER(TRIM(l.rua)) = ? THEN 0 ELSE 1 END')
        order_params.extend([fifo_anchor['camara'], str(fifo_anchor['rua']).upper()])
        if fifo_anchor.get('posicao') is not None:
            order_parts.append('CASE WHEN l.posicao = ? THEN 0 ELSE 1 END')
            order_params.append(int(fifo_anchor['posicao']))
            order_parts.append('ABS(l.posicao - ?)')
            order_params.append(int(fifo_anchor['posicao']))
    elif data_producao:
        motivo.append(f'FIFO: primeira entrada deste SKU (prod. {str(data_producao)[:10]})')

    # 4) Mesma categoria: próximo à rua com mais produtos da família
    cat_cluster = _rua_cluster_categoria(conn, cat, cam_list)
    if cat_cluster.get('camara') and cat_cluster.get('rua'):
        motivo.append(f'Categoria {cat}: próximo à Rua {cat_cluster["rua"]} (Câm {cat_cluster["camara"]})')
        order_parts.append('CASE WHEN l.camara = ? AND UPPER(TRIM(l.rua)) = ? THEN 0 ELSE 1 END')
        order_params.extend([cat_cluster['camara'], str(cat_cluster['rua']).upper()])

    order_prefix = ', '.join(order_parts)
    flex_cods = _layout_meta_cache().get('flex_reentrega') or set()
    cam_exp = _camaras_putaway_expandidas(conn, cat, cam_list)

    def _tentar(prefix, params, cameras, zona_busca, pri, excluir_flex=False):
        return _buscar_vaga_putaway_fifo(
            conn, cat, cameras, zona_busca, prefix, params, data_producao, motivo, pri,
            codigos_excluir=flex_cods if excluir_flex else None,
        )

    # 5) Putaway padrão — perto do cluster/FIFO, FIFO vertical por coluna
    loc, pri = _tentar(order_prefix, order_params, cam_list, zona, 'zoneamento', excluir_flex=True)
    if loc:
        return _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, pri)

    # 6) Overflow: posições flexíveis REENTREGAS/estoque (câm. 11) quando demais lotadas
    if flex_cods:
        motivo.append('Estendendo para posições flexíveis REENTREGAS/estoque do layout')
        loc, pri = _buscar_vaga_putaway_fifo(
            conn, cat, cam_list, zona, order_prefix, order_params, data_producao, motivo,
            'flex_reentrega', codigos_permitidos=flex_cods,
        )
        if loc:
            return _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, pri)

    # 7) Expansão: qualquer vaga na categoria, sem excluir flex, câmaras ampliadas
    motivo.append('Expandindo busca nas câmaras do zoneamento')
    loc, pri = _tentar('', [], cam_exp, zona, 'expansao')
    if loc:
        return _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, pri)

    # 8) Zona alternativa (picking ↔ pulmão)
    alt_zona = 'picking' if zona == 'pulmao' else 'pulmao'
    motivo.append(f'Tentando zona alternativa: {_zona_label(alt_zona)}')
    loc, pri = _tentar(order_prefix, order_params, cam_exp, alt_zona, 'zona_alternativa')
    if loc:
        return _putaway_resposta(loc, motivo, status, pos_wms, pos_med, alerta, pri)

    motivo.append('Nenhuma posição vazia nas câmaras do zoneamento (incl. flexíveis)')
    out = _putaway_resposta(None, motivo, status, pos_wms, pos_med, alerta, None)
    out['zona_label'] = _zona_label(zona)
    return out


def _estoque_fifo_por_sku(conn, sku, qtd_necessaria=0, preferir_picking=True):
    """Paletes/endereços do SKU ordenados FIFO (data produção mais antiga primeiro)."""
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    _ensure_zona_armazenagem_column(conn)
    zona_pick = _filtro_zona_sql('picking', 'l')
    zona_pul = _filtro_zona_sql('pulmao', 'l')
    order_fifo = 'i.data_producao ASC NULLS LAST, i.data_validade ASC NULLS LAST, l.rua, l.posicao, l.nivel'
    if not _is_pg(conn):
        order_fifo = 'i.data_producao ASC, i.data_validade ASC, l.rua, l.posicao, l.nivel'
    sql = f'''SELECT i.sku, i.lote, i.data_producao, i.data_validade, i.quantidade_caixas,
                     p.id AS palete_id, p.etiqueta, p.status AS palete_status,
                     l.id AS localizacao_id, l.codigo_endereco, l.camara, l.rua, l.posicao, l.nivel,
                     l.zona_armazenagem
              FROM {t_item} i
              JOIN {t_pal} p ON p.id = i.palete_id
              JOIN {t_loc} l ON l.id = p.localizacao_id
              WHERE i.sku = ? AND p.status = 'armazenado'
                AND (p.bloqueio_tipo IS NULL OR p.bloqueio_tipo = '')
                AND l.status = 'ocupada'
                AND {_bloqueio_off_sql(conn, 'l.bloqueio_saida')}'''
    params = [sku]
    if preferir_picking:
        sql += f' ORDER BY CASE WHEN {zona_pick} THEN 0 ELSE 1 END, {order_fifo}'
    else:
        sql += f' ORDER BY {order_fifo}'
    rows = conn.execute(sql, tuple(params)).fetchall()
    out = []
    acum = 0
    for r in rows:
        rd = _row_dict(r) or {}
        item = {
            **_format_locacao(rd),
            'quantidade_caixas': int(rd.get('quantidade_caixas') or 0),
            'lote': rd.get('lote'),
            'data_producao': rd.get('data_producao'),
            'data_validade': rd.get('data_validade'),
            'etiqueta': rd.get('etiqueta'),
            'palete_id': rd.get('palete_id'),
        }
        out.append(item)
        acum += item['quantidade_caixas']
        if qtd_necessaria and acum >= qtd_necessaria:
            break
    return out


def _lista_picking_roteiro(conn, id_roteiro, id_viagem):
    t_rom = _tbl_romaneio(conn)
    try:
        conn.execute(f'SELECT 1 FROM {t_rom} LIMIT 1')
    except Exception:
        return [], 'Tabela romaneio_por_item não encontrada.'
    rows = conn.execute(
        f'''SELECT codigo_produto AS sku,
                   SUM(COALESCE(quantidade, 0)) AS quantidade
            FROM {t_rom}
            WHERE id_roteiro = ? AND id_viagem = ?
            GROUP BY codigo_produto
            HAVING SUM(COALESCE(quantidade, 0)) > 0
            ORDER BY codigo_produto''',
        (str(id_roteiro).strip(), str(id_viagem).strip()),
    ).fetchall()
    if not rows:
        return [], 'Nenhum item no romaneio para este roteiro/viagem.'
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    _ensure_produto_planejamento_columns(conn)

    def _info_sku(sku):
        pr = conn.execute(
            f'''SELECT * FROM {t_prod} WHERE sku = ? AND {_ativo_sql(conn)} LIMIT 1''',
            (sku,),
        ).fetchone()
        info = _info_produto_wms(conn, sku, pr)
        return info

    rom_itens = []
    for r in rows:
        rd = _row_dict(r) or {}
        sku = (rd.get('sku') or '').strip()
        qtd = int(rd.get('quantidade') or 0)
        if not sku or qtd <= 0:
            continue
        info = _info_sku(sku)
        rom_itens.append({
            'sku': sku,
            'quantidade': qtd,
            'status_condicional': info.get('status_condicional') or '',
            'categoria': info.get('categoria') or '',
            'descricao': info.get('descricao') or '',
            'prioridade': _prioridade_status_condicional(info.get('status_condicional')),
        })
    rom_itens.sort(key=lambda x: (x['prioridade'], x['sku']))

    lista = []
    seq = 0
    for item_rom in rom_itens:
        sku = item_rom['sku']
        qtd = item_rom['quantidade']
        status = item_rom['status_condicional']
        estoque = _estoque_fifo_por_sku(conn, sku, qtd, preferir_picking=True)
        if not estoque:
            seq += 1
            lista.append({
                'sequencia': seq,
                'sku': sku,
                'descricao': item_rom.get('descricao'),
                'categoria': item_rom.get('categoria'),
                'status_condicional': status,
                'quantidade_romaneio': qtd,
                'quantidade_atendida': 0,
                'endereco': None,
                'texto': 'Sem estoque endereçado',
                'zona_label': '—',
                'data_producao': None,
                'etiqueta': None,
                'alerta': 'sem_estoque',
            })
            continue
        restante = qtd
        for e in estoque:
            if restante <= 0:
                break
            q_palete = min(restante, int(e.get('quantidade_caixas') or 0))
            seq += 1
            lista.append({
                'sequencia': seq,
                'sku': sku,
                'descricao': item_rom.get('descricao'),
                'categoria': item_rom.get('categoria'),
                'status_condicional': status,
                'quantidade_romaneio': qtd,
                'quantidade_separar': q_palete,
                'quantidade_atendida': q_palete,
                'endereco': e.get('codigo_endereco'),
                'texto': e.get('texto'),
                'camara': e.get('camara'),
                'rua': e.get('rua'),
                'posicao': e.get('posicao'),
                'nivel': e.get('nivel'),
                'zona_label': e.get('zona_label'),
                'data_producao': e.get('data_producao'),
                'etiqueta': e.get('etiqueta'),
                'palete_id': e.get('palete_id'),
                'alerta': None,
            })
            restante -= q_palete
        if restante > 0:
            seq += 1
            lista.append({
                'sequencia': seq,
                'sku': sku,
                'descricao': item_rom.get('descricao'),
                'categoria': item_rom.get('categoria'),
                'status_condicional': status,
                'quantidade_romaneio': qtd,
                'quantidade_separar': restante,
                'quantidade_atendida': qtd - restante,
                'endereco': None,
                'texto': f'Faltam {restante} caixas no estoque WMS',
                'zona_label': '—',
                'alerta': 'quantidade_insuficiente',
            })
    com_end = [x for x in lista if x.get('endereco')]
    sem_end = [x for x in lista if not x.get('endereco')]
    com_end.sort(key=lambda x: _chave_travel_item(x, conn))
    lista = com_end + sem_end
    for i, item in enumerate(lista, 1):
        item['sequencia'] = i
    return lista, None


def _ensure_movimentacao_expedicao_columns(conn):
    """Colunas id_roteiro / id_viagem em wms_movimentacao (separação → stage)."""
    cols_needed = ('id_roteiro', 'id_viagem')
    if _is_pg(conn):
        for col in cols_needed:
            try:
                conn.execute(f'ALTER TABLE public.wms_movimentacao ADD COLUMN IF NOT EXISTS {col} TEXT')
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
    else:
        try:
            names = {
                (c[1] if not isinstance(c, dict) else c.get('name'))
                for c in (conn.execute('PRAGMA table_info(wms_movimentacao)').fetchall() or [])
            }
            for col in cols_needed:
                if col not in names:
                    conn.execute(f'ALTER TABLE wms_movimentacao ADD COLUMN {col} TEXT')
            conn.commit()
        except Exception:
            pass


def _ensure_stage_localizacoes(conn):
    """Câmara 99 — área stage por doca (posições para paletes aguardando validação de saída)."""
    t_cam = _tbl(conn, 'wms_camara')
    t_loc = _tbl(conn, 'wms_localizacao')
    now = _now_iso()
    cam = _WMS_CAMARA_STAGE
    desc = 'Área Stage (expedição)'
    total_slots = _WMS_STAGE_SLOTS_POR_DOCA * 4
    if _is_pg(conn):
        conn.execute(
            f'''INSERT INTO {t_cam} (codigo, descricao, total_posicoes, ativo, criado_em)
                VALUES (?, ?, ?, TRUE, NOW())
                ON CONFLICT (codigo) DO UPDATE SET
                    descricao = EXCLUDED.descricao,
                    total_posicoes = GREATEST({t_cam}.total_posicoes, EXCLUDED.total_posicoes)''',
            (cam, desc, total_slots),
        )
    else:
        ex = conn.execute(f'SELECT 1 FROM {t_cam} WHERE codigo = ?', (cam,)).fetchone()
        if not ex:
            conn.execute(
                f'INSERT INTO {t_cam} (codigo, descricao, total_posicoes, ativo, criado_em) VALUES (?, ?, ?, 1, ?)',
                (cam, desc, total_slots, now),
            )
    for doca in (1, 2, 3, 4):
        rua = f'D{doca}'
        for pos in range(1, _WMS_STAGE_SLOTS_POR_DOCA + 1):
            cod = _codigo_endereco(cam, rua, pos, 1)
            if _is_pg(conn):
                conn.execute(
                    f'''INSERT INTO {t_loc}
                        (camara, rua, posicao, nivel, codigo_endereco, tipo, status, capacidade_max,
                         area, zona_armazenagem, criado_em, atualizado_em)
                        VALUES (?, ?, ?, 1, ?, 'stage', 'vazia', 1, 'stage', 'stage', NOW(), NOW())
                        ON CONFLICT (codigo_endereco) DO UPDATE SET
                            area = 'stage', tipo = 'stage', zona_armazenagem = 'stage' ''',
                    (cam, rua, pos, cod),
                )
            else:
                ex_loc = conn.execute(
                    f'SELECT id FROM {t_loc} WHERE codigo_endereco = ?', (cod,),
                ).fetchone()
                if not ex_loc:
                    conn.execute(
                        f'''INSERT INTO {t_loc}
                            (camara, rua, posicao, nivel, codigo_endereco, tipo, status, capacidade_max,
                             bloqueio_entrada, bloqueio_saida, bloqueio_inventario, area, zona_armazenagem,
                             criado_em, atualizado_em)
                            VALUES (?, ?, ?, 1, ?, 'stage', 'vazia', 1, 0, 0, 0, 'stage', 'stage', ?, ?)''',
                        (cam, rua, pos, cod, now, now),
                    )
    try:
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _load_areas_especiais_config():
    path = os.path.join(os.path.dirname(__file__), 'data', 'wms_areas_especiais.json')
    try:
        if os.path.isfile(path):
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get('areas'):
                return data
    except Exception:
        pass
    return dict(_WMS_AREAS_ESPECIAIS_DEFAULT)


def _area_especial_por_chave(area_key):
    cfg = _load_areas_especiais_config()
    key = (area_key or '').strip().lower()
    for a in cfg.get('areas') or []:
        if (a.get('area') or '').lower() == key:
            return a
    return None


def _ensure_areas_especiais_localizacoes(conn):
    """Câmara 98 — posições fixas: descarte, avaria, retrabalho, bloqueado, MG, reentregas."""
    cfg = _load_areas_especiais_config()
    cam = int(cfg.get('camara') or _WMS_CAMARA_ESPECIAL)
    desc = cfg.get('descricao') or 'Áreas especiais'
    areas = cfg.get('areas') or []
    total_slots = sum(int(a.get('slots') or 0) for a in areas)
    t_cam = _tbl(conn, 'wms_camara')
    t_loc = _tbl(conn, 'wms_localizacao')
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(
            f'''INSERT INTO {t_cam} (codigo, descricao, total_posicoes, ativo, criado_em)
                VALUES (?, ?, ?, TRUE, NOW())
                ON CONFLICT (codigo) DO UPDATE SET
                    descricao = EXCLUDED.descricao,
                    total_posicoes = GREATEST({t_cam}.total_posicoes, EXCLUDED.total_posicoes)''',
            (cam, desc, total_slots),
        )
    else:
        ex = conn.execute(f'SELECT 1 FROM {t_cam} WHERE codigo = ?', (cam,)).fetchone()
        if not ex:
            conn.execute(
                f'INSERT INTO {t_cam} (codigo, descricao, total_posicoes, ativo, criado_em) VALUES (?, ?, ?, 1, ?)',
                (cam, desc, total_slots, now),
            )
    for zona in areas:
        area_key = (zona.get('area') or '').strip().lower()
        rua = (zona.get('rua') or area_key[:2].upper()).strip().upper()
        slots = max(0, int(zona.get('slots') or 0))
        label = (zona.get('label') or area_key).strip()
        for pos in range(1, slots + 1):
            cod = _codigo_endereco(cam, rua, pos, 1)
            if _is_pg(conn):
                conn.execute(
                    f'''INSERT INTO {t_loc}
                        (camara, rua, posicao, nivel, codigo_endereco, tipo, status, capacidade_max,
                         area, zona_armazenagem, criado_em, atualizado_em)
                        VALUES (?, ?, ?, 1, ?, 'area_especial', 'vazia', 1, ?, ?, NOW(), NOW())
                        ON CONFLICT (codigo_endereco) DO UPDATE SET
                            area = EXCLUDED.area, tipo = 'area_especial',
                            zona_armazenagem = EXCLUDED.zona_armazenagem''',
                    (cam, rua, pos, cod, area_key, area_key),
                )
            else:
                ex_loc = conn.execute(
                    f'SELECT id FROM {t_loc} WHERE codigo_endereco = ?', (cod,),
                ).fetchone()
                if not ex_loc:
                    conn.execute(
                        f'''INSERT INTO {t_loc}
                            (camara, rua, posicao, nivel, codigo_endereco, tipo, status, capacidade_max,
                             bloqueio_entrada, bloqueio_saida, bloqueio_inventario, area, zona_armazenagem,
                             criado_em, atualizado_em)
                            VALUES (?, ?, ?, 1, ?, 'area_especial', 'vazia', 1, 0, 0, 0, ?, ?, ?, ?)''',
                        (cam, rua, pos, cod, area_key, area_key, now, now),
                    )
    try:
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _obter_vaga_destino_fixo(conn, area_key, data_producao=None):
    """Posição fixa no layout (câmaras 6–16) marcada na planilha de endereçamento."""
    key = (area_key or '').strip().lower()
    if not key:
        return None, 'Destino não informado.'
    t_loc = _tbl(conn, 'wms_localizacao')
    rows = conn.execute(
        f'''SELECT * FROM {t_loc}
            WHERE LOWER(COALESCE(area, '')) = ?
              AND COALESCE(tipo, '') = 'destino_fixo'
              AND status = 'vazia'
              AND {_bloqueio_off_sql(conn, 'bloqueio_entrada')}
            ORDER BY camara, rua, posicao, nivel''',
        (key,),
    ).fetchall()
    if not rows:
        return None, None

    vazios_por_col = {}
    slot_por_col_niv = {}
    ordem_colunas = []
    for r in rows:
        rd = _row_dict(r) or {}
        cam = int(rd.get('camara') or 0)
        rua = str(rd.get('rua') or '').upper()
        pos = int(rd.get('posicao') or 0)
        niv = int(rd.get('nivel') or 0)
        if not cam or not rua or not pos or not niv:
            continue
        key_col = (cam, rua, pos)
        if key_col not in vazios_por_col:
            ordem_colunas.append(key_col)
        vazios_por_col.setdefault(key_col, set()).add(niv)
        slot_por_col_niv[(cam, rua, pos, niv)] = rd

    camaras = sorted({k[0] for k in ordem_colunas})
    ocup_cols = _ocupacao_fifo_colunas(conn, camaras)
    for key_col in ordem_colunas:
        cam, rua, pos = key_col
        niv_ideal = _nivel_fifo_vertical(
            data_producao,
            ocup_cols.get(key_col, {}),
            vazios_por_col.get(key_col, set()),
        )
        if niv_ideal is None:
            continue
        rd = slot_por_col_niv.get((cam, rua, pos, niv_ideal))
        if not rd:
            continue
        loc = _format_locacao(rd)
        labels = _destinos_acao_labels()
        lbl = labels.get(key, key.replace('_', ' ').upper())
        loc['texto'] = f'{lbl} · {loc.get("codigo_endereco")}'
        loc['zona_label'] = lbl
        return loc, None

    rd0 = _row_dict(rows[0]) or {}
    loc = _format_locacao(rd0)
    labels = _destinos_acao_labels()
    lbl = labels.get(key, key.replace('_', ' ').upper())
    loc['texto'] = f'{lbl} · {loc.get("codigo_endereco")}'
    loc['zona_label'] = lbl
    return loc, None


def _obter_vaga_area_especial(conn, area_key):
    cfg = _load_areas_especiais_config()
    cam = int(cfg.get('camara') or _WMS_CAMARA_ESPECIAL)
    meta = _area_especial_por_chave(area_key)
    if not meta:
        return None, f'Área especial desconhecida: {area_key}'
    t_loc = _tbl(conn, 'wms_localizacao')
    row = conn.execute(
        f'''SELECT * FROM {t_loc}
            WHERE camara = ? AND area = ?
              AND status = 'vazia'
              AND {_bloqueio_off_sql(conn, 'bloqueio_entrada')}
            ORDER BY posicao ASC
            LIMIT 1''',
        (cam, (meta.get('area') or area_key).lower()),
    ).fetchone()
    if not row:
        lbl = meta.get('label') or area_key
        return None, f'Sem vaga livre em {lbl} ({meta.get("slots")} posições).'
    loc = _format_locacao(row)
    lbl = meta.get('label') or area_key
    loc['texto'] = f'{lbl} · posição {loc.get("posicao")} ({loc.get("codigo_endereco")})'
    loc['zona_label'] = lbl.upper()
    return loc, None


def _sugerir_destino_area_especial(conn, area_key, data_producao=None):
    loc_fixo, _err_fixo = _obter_vaga_destino_fixo(conn, area_key, data_producao)
    if loc_fixo:
        labels = _destinos_acao_labels()
        key = (area_key or '').strip().lower()
        lbl = labels.get(key, key.replace('_', ' ').upper())
        motivo = [f'Destino fixo: {lbl}', f'Endereço {loc_fixo.get("codigo_endereco")}']
        return _putaway_resposta(loc_fixo, motivo, '', 0, 0, None, 'destino_fixo')
    loc, err = _obter_vaga_area_especial(conn, area_key)
    meta = _area_especial_por_chave(area_key) or {}
    motivo = [f'Área especial: {meta.get("label") or area_key}']
    if err:
        motivo.append(err)
    if not loc:
        return _putaway_resposta(None, motivo, '', 0, 0, 'area_especial_cheia', None)
    motivo.append(f'Endereço {loc.get("codigo_endereco")}')
    return _putaway_resposta(loc, motivo, '', 0, 0, None, 'area_especial')


def _coletar_ocupacao_areas_especiais(conn):
    _ensure_areas_especiais_localizacoes(conn)
    cfg = _load_areas_especiais_config()
    cam = int(cfg.get('camara') or _WMS_CAMARA_ESPECIAL)
    t_loc = _tbl(conn, 'wms_localizacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    out = []
    for meta in cfg.get('areas') or []:
        area_key = (meta.get('area') or '').strip().lower()
        slots = int(meta.get('slots') or 0)
        rows = conn.execute(
            f'''SELECT l.id, l.codigo_endereco, l.posicao, l.status, l.rua,
                       p.id AS palete_id, p.etiqueta, p.status AS palete_status,
                       (SELECT COALESCE(SUM(i.quantidade_caixas), 0) FROM {t_item} i WHERE i.palete_id = p.id) AS qtd_caixas
                FROM {t_loc} l
                LEFT JOIN {t_pal} p ON p.localizacao_id = l.id
                    AND p.status IN ('armazenado', 'bloqueado', 'em_stage', 'separado')
                WHERE l.camara = ? AND l.area = ?
                ORDER BY l.posicao ASC''',
            (cam, area_key),
        ).fetchall()
        posicoes = []
        ocupadas = 0
        for r in rows or []:
            rd = _row_dict(r) or {}
            st = (rd.get('status') or '').lower()
            if st == 'ocupada':
                ocupadas += 1
            posicoes.append({
                'posicao': rd.get('posicao'),
                'codigo_endereco': rd.get('codigo_endereco'),
                'status': st,
                'palete_id': rd.get('palete_id'),
                'etiqueta': rd.get('etiqueta'),
                'palete_status': rd.get('palete_status'),
                'qtd_caixas': int(rd.get('qtd_caixas') or 0),
            })
        while len(posicoes) < slots:
            posicoes.append({
                'posicao': len(posicoes) + 1,
                'codigo_endereco': None,
                'status': 'nao_criada',
                'palete_id': None,
                'etiqueta': None,
                'palete_status': None,
                'qtd_caixas': 0,
            })
        livres = max(0, slots - ocupadas)
        out.append({
            'area': area_key,
            'rua': meta.get('rua'),
            'label': meta.get('label') or area_key,
            'slots': slots,
            'ocupadas': ocupadas,
            'livres': livres,
            'percentual_ocupacao': round(100.0 * ocupadas / slots, 1) if slots else 0,
            'posicoes': posicoes,
        })
    return {
        'camara': cam,
        'descricao': cfg.get('descricao'),
        'areas': out,
        'total_slots': sum(x['slots'] for x in out),
        'total_ocupadas': sum(x['ocupadas'] for x in out),
        'total_livres': sum(x['livres'] for x in out),
    }


def _coletar_ocupacao_estoque_normal(conn, incluir_posicoes=True):
    """Ocupação do estoque normal (câmaras 6–16), excluindo destino_fixo e câm. 98/99."""
    t_loc = _tbl(conn, 'wms_localizacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_cam = _tbl(conn, 'wms_camara')
    sku_sql = (
        f'''(SELECT i.sku FROM {t_item} i
              WHERE i.palete_id = p.id AND TRIM(COALESCE(i.sku, '')) <> ''
              ORDER BY COALESCE(i.quantidade_caixas, 0) DESC, i.id
              LIMIT 1)'''
    )
    camaras_normais = _WMS_CAMARAS_ESTOQUE
    cfg = _layout_camaras_config()
    blocos = {
        int(b['codigo']): b
        for b in (cfg.get('camaras') or [])
        if int(b.get('codigo') or 0) in camaras_normais
    }
    nomes = _map_nomes_camaras(conn)
    filtro_tipo = "COALESCE(LOWER(TRIM(l.tipo)), 'estoque') <> 'destino_fixo'"
    camaras_out = []
    total_slots = total_ocup = total_livre = 0

    for cod in sorted(camaras_normais):
        bloco = blocos.get(cod) or {}
        coords = _coords_from_bloco_layout(bloco) if bloco else []
        slots_layout = sum(1 for _c, _r, _p, _n, da, _dl, _ar in coords if not da)
        cam_row = conn.execute(
            f'SELECT descricao, total_posicoes FROM {t_cam} WHERE codigo = ?',
            (cod,),
        ).fetchone()
        cr = _row_dict(cam_row) or {}
        total_ref = slots_layout or _total_posicoes_ref(cod, bloco) or int(cr.get('total_posicoes') or 0)

        stats = conn.execute(
            f'''SELECT COUNT(*) AS cadastradas,
                       SUM(CASE WHEN l.status = 'ocupada' THEN 1 ELSE 0 END) AS ocupadas,
                       SUM(CASE WHEN l.status = 'vazia' THEN 1 ELSE 0 END) AS vazias
                FROM {t_loc} l
                WHERE l.camara = ? AND {filtro_tipo}''',
            (cod,),
        ).fetchone()
        st = _row_dict(stats) or {}
        cad = int(st.get('cadastradas') or 0)
        ocup = int(st.get('ocupadas') or 0)
        vaz = int(st.get('vazias') or 0)
        base = cad if cad > 0 else total_ref
        livres = vaz if cad else max(base - ocup, 0)

        cat_rows = conn.execute(
            f'''SELECT UPPER(TRIM(COALESCE(l.categoria_zona, ''))) AS categoria,
                       COUNT(*) AS total,
                       SUM(CASE WHEN l.status = 'ocupada' THEN 1 ELSE 0 END) AS ocupadas,
                       SUM(CASE WHEN l.status = 'vazia' THEN 1 ELSE 0 END) AS vazias
                FROM {t_loc} l
                WHERE l.camara = ? AND {filtro_tipo}
                GROUP BY UPPER(TRIM(COALESCE(l.categoria_zona, '')))
                ORDER BY categoria''',
            (cod,),
        ).fetchall()
        por_categoria = []
        for r in cat_rows or []:
            rd = _row_dict(r) or {}
            cat = (rd.get('categoria') or '').strip().upper() or '—'
            por_categoria.append({
                'categoria': cat,
                'total': int(rd.get('total') or 0),
                'ocupadas': int(rd.get('ocupadas') or 0),
                'vazias': int(rd.get('vazias') or 0),
            })

        posicoes = []
        ocupadas_lista = []
        if incluir_posicoes:
            pos_rows = conn.execute(
                f'''SELECT l.codigo_endereco, l.rua, l.posicao, l.nivel, l.status, l.categoria_zona,
                           p.etiqueta, p.id AS palete_id,
                           (SELECT COALESCE(SUM(i.quantidade_caixas), 0) FROM {t_item} i WHERE i.palete_id = p.id) AS qtd_caixas,
                           {sku_sql} AS sku
                    FROM {t_loc} l
                    LEFT JOIN {t_pal} p ON p.localizacao_id = l.id
                        AND p.status IN ('armazenado', 'bloqueado', 'em_stage', 'separado')
                    WHERE l.camara = ? AND {filtro_tipo}
                    ORDER BY l.rua, l.posicao, l.nivel''',
                (cod,),
            ).fetchall()
            for idx, r in enumerate(pos_rows or [], start=1):
                rd = _row_dict(r) or {}
                st = (rd.get('status') or '').strip().lower()
                sku = (rd.get('sku') or '').strip() or None
                posicoes.append({
                    'posicao': idx,
                    'codigo_endereco': rd.get('codigo_endereco'),
                    'rua': rd.get('rua'),
                    'coluna': rd.get('posicao'),
                    'nivel': rd.get('nivel'),
                    'status': st or 'vazia',
                    'categoria_zona': (rd.get('categoria_zona') or '').strip().upper() or None,
                    'etiqueta': rd.get('etiqueta'),
                    'palete_id': rd.get('palete_id'),
                    'qtd_caixas': int(rd.get('qtd_caixas') or 0),
                    'sku': sku,
                    'codigo_produto': sku,
                })
                if st == 'ocupada':
                    ocupadas_lista.append({
                        'codigo_endereco': rd.get('codigo_endereco'),
                        'rua': rd.get('rua'),
                        'posicao': rd.get('posicao'),
                        'nivel': rd.get('nivel'),
                        'status': st,
                        'categoria_zona': (rd.get('categoria_zona') or '').strip().upper() or None,
                        'etiqueta': rd.get('etiqueta'),
                        'palete_id': rd.get('palete_id'),
                        'qtd_caixas': int(rd.get('qtd_caixas') or 0),
                        'sku': sku,
                        'codigo_produto': sku,
                    })
        else:
            occ_rows = conn.execute(
                f'''SELECT l.codigo_endereco, l.rua, l.posicao, l.nivel, l.status, l.categoria_zona,
                           p.etiqueta, p.id AS palete_id,
                           (SELECT COALESCE(SUM(i.quantidade_caixas), 0) FROM {t_item} i WHERE i.palete_id = p.id) AS qtd_caixas,
                           {sku_sql} AS sku
                    FROM {t_loc} l
                    LEFT JOIN {t_pal} p ON p.localizacao_id = l.id
                        AND p.status IN ('armazenado', 'bloqueado', 'em_stage', 'separado')
                    WHERE l.camara = ? AND {filtro_tipo} AND l.status = 'ocupada'
                    ORDER BY l.rua, l.posicao, l.nivel''',
                (cod,),
            ).fetchall()
            for r in occ_rows or []:
                rd = _row_dict(r) or {}
                st = (rd.get('status') or '').strip().lower()
                sku = (rd.get('sku') or '').strip() or None
                ocupadas_lista.append({
                    'codigo_endereco': rd.get('codigo_endereco'),
                    'rua': rd.get('rua'),
                    'posicao': rd.get('posicao'),
                    'nivel': rd.get('nivel'),
                    'status': st or 'ocupada',
                    'categoria_zona': (rd.get('categoria_zona') or '').strip().upper() or None,
                    'etiqueta': rd.get('etiqueta'),
                    'palete_id': rd.get('palete_id'),
                    'qtd_caixas': int(rd.get('qtd_caixas') or 0),
                    'sku': sku,
                    'codigo_produto': sku,
                })

        pct = round(100.0 * ocup / base, 1) if base else 0
        ruas_txt = ' / '.join(bloco.get('ruas') or [])
        camaras_out.append({
            'camara': cod,
            'descricao': _nome_camara_label(conn, cod, nomes) or cr.get('descricao') or f'Câmara {cod}',
            'label': f'Estoque normal — câmara {cod}',
            'rua': ruas_txt,
            'ruas': list(bloco.get('ruas') or []),
            'niveis': int(bloco.get('niveis') or 5),
            'slots': base,
            'total_slots': base,
            'cadastradas': cad,
            'ocupadas': ocup,
            'livres': livres,
            'percentual_ocupacao': pct,
            'por_categoria': por_categoria,
            'ocupadas_lista': ocupadas_lista,
            'posicoes': posicoes,
        })
        total_slots += base
        total_ocup += ocup
        total_livre += livres

    return {
        'descricao': 'Estoque normal — câmaras 6, 7, 14, 15 e 16 (posições de armazenagem por categoria)',
        'camaras': camaras_out,
        'total_slots': total_slots,
        'total_ocupadas': total_ocup,
        'total_livres': total_livre,
    }


def _parse_data_iso_br(val):
    if not val:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _contar_posicoes_avaria_wms(conn):
    """Posições ocupadas em área de avaria (câm. 98) ou paletes com disposição avaria."""
    t_loc = _tbl(conn, 'wms_localizacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    _ensure_wms_palete_item_disposicao(conn)
    row = conn.execute(
        f'''SELECT COUNT(DISTINCT l.id) AS c
            FROM {t_loc} l
            INNER JOIN {t_pal} p ON p.localizacao_id = l.id
            INNER JOIN {t_item} i ON i.palete_id = p.id
            WHERE l.status = 'ocupada'
              AND (
                LOWER(TRIM(COALESCE(l.area, ''))) = 'avaria'
                OR LOWER(TRIM(COALESCE(i.disposicao_estoque, ''))) = 'avaria'
              )''',
    ).fetchone()
    return _int_col(row, 'c')


def _coletar_resumo_ocupacao_wms(conn, camaras=_WMS_CAMARAS_PRINCIPAIS):
    """Resumo estilo painel de ocupação (câmaras frias) a partir do estoque WMS real."""
    estoque = _coletar_ocupacao_estoque_normal(conn)
    cam_set = {int(c) for c in camaras}
    selecionadas = [c for c in (estoque.get('camaras') or []) if int(c.get('camara') or 0) in cam_set]
    total_slots = sum(int(c.get('slots') or c.get('total_slots') or 0) for c in selecionadas)
    total_ocup = sum(int(c.get('ocupadas') or 0) for c in selecionadas)
    total_vazias_fisicas = sum(int(c.get('livres') or 0) for c in selecionadas)
    avaria = _contar_posicoes_avaria_wms(conn)
    ocup_com_avaria = total_ocup + avaria
    pct_ocup = round(100.0 * ocup_com_avaria / total_slots, 1) if total_slots else 0
    pct_livre = round(100.0 * max(0, total_slots - ocup_com_avaria) / total_slots, 1) if total_slots else 0
    pct_avaria = round(100.0 * avaria / total_slots, 1) if total_slots else 0
    camaras_resumo = []
    for c in selecionadas:
        slots = int(c.get('slots') or c.get('total_slots') or 0)
        ocup = int(c.get('ocupadas') or 0)
        vaz = int(c.get('livres') or 0)
        camaras_resumo.append({
            'camara': c.get('camara'),
            'descricao': c.get('descricao'),
            'total_posicoes': slots,
            'ocupadas': ocup,
            'vazias': vaz,
            'percentual_ocupacao': c.get('percentual_ocupacao'),
        })
    return {
        'atualizado_em': _now_iso(),
        'camaras_filtro': list(cam_set),
        'total_posicoes': total_slots,
        'posicoes_ocupadas': total_ocup,
        'posicoes_ocupadas_com_avaria': ocup_com_avaria,
        'posicoes_livres': max(0, total_slots - ocup_com_avaria),
        'posicoes_vazias_fisicas': total_vazias_fisicas,
        'avaria_posicoes': avaria,
        'percentual_ocupado': pct_ocup,
        'percentual_livre': pct_livre,
        'percentual_avaria': pct_avaria,
        'camaras': camaras_resumo,
        'estoque_normal': estoque,
        'areas_especiais': _coletar_ocupacao_areas_especiais(conn),
    }


def _listar_estoque_seguranca_wms(conn, categoria=None, sync=False):
    """Lista de planejamento com estoque/posições reais do WMS."""
    _ensure_produto_planejamento_columns(conn)
    if sync:
        _sync_all_produtos_estoque_cache(conn)
        try:
            conn.commit()
        except Exception:
            conn.rollback()
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    sql = f'SELECT * FROM {t_prod} WHERE {_ativo_sql(conn)}'
    params = []
    cat = (categoria or '').strip().upper()
    if cat:
        sql += ' AND UPPER(TRIM(categoria)) = ?'
        params.append(cat)
    sql += ' ORDER BY categoria, sku'
    rows = conn.execute(sql, tuple(params)).fetchall()
    out = []
    resumo = {'Excedido': 0, 'Verde': 0, 'Amarelo': 0, 'Vermelho': 0, 'Analisar': 0}
    for r in rows or []:
        rd = _row_dict(r) or {}
        sku = (rd.get('sku') or '').strip()
        if not sku:
            continue
        info = _info_produto_wms(conn, sku, prod=r)
        st = (info.get('status_condicional') or 'Verde').strip()
        if st not in resumo:
            st = 'Analisar'
        resumo[st] = resumo.get(st, 0) + 1
        out.append({
            'sku': sku,
            'descricao': info.get('descricao') or '',
            'categoria': info.get('categoria') or '',
            'pedido_med_abril': info.get('pedido_med_abril'),
            'pedido_max_abril': info.get('pedido_max_abril'),
            'media_5_dias': info.get('media_5_dias'),
            'estoque_ideal_max': info.get('estoque_ideal_max'),
            'estoque_ideal_med': info.get('estoque_ideal_med'),
            'estoque_ideal_min': info.get('estoque_ideal_min'),
            'dias_estoque_max': info.get('dias_estoque_max'),
            'dias_estoque_med': info.get('dias_estoque_med'),
            'dias_estoque_min': info.get('dias_estoque_min'),
            'posicoes_max': info.get('posicoes_max'),
            'posicoes_med': info.get('posicoes_med'),
            'posicoes_min': info.get('posicoes_min'),
            'estoque_atual': info.get('estoque_atual') or info.get('quantidade_wms') or 0,
            'posicao_atual': info.get('posicao_atual') or info.get('posicoes_wms') or 0,
            'para_condicional': st,
            'padrao_plt': info.get('padrao_plt') or '',
            'conversao': info.get('conversao'),
        })
    return {'itens': out, 'resumo_status': resumo, 'total': len(out)}


def _status_shelf_pct(pct):
    if pct is None:
        return 'Sem dado', None
    p = float(pct)
    if p >= 60:
        return 'Verde', p
    if p >= 40:
        return 'Amarelo', p
    if p >= 20:
        return 'Laranja', p
    return 'Vermelho', p


def _listar_shelf_life_wms(conn, categoria=None):
    """Shelf life calculado a partir de validade dos itens armazenados no WMS."""
    _ensure_wms_palete_item_disposicao(conn)
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    bloq_off = _bloqueio_off_sql(conn, 'l.bloqueio_saida')
    sql = f'''SELECT i.sku,
                     COALESCE(MAX(i.descricao), MAX(pr.descricao), '') AS descricao,
                     COALESCE(MAX(pr.categoria), '') AS categoria,
                     MIN(i.data_validade) AS validade_min,
                     MAX(i.shelf_dias) AS shelf_dias_item,
                     COALESCE(SUM(i.quantidade_caixas), 0) AS quantidade
              FROM {t_item} i
              INNER JOIN {t_pal} p ON p.id = i.palete_id
              INNER JOIN {t_loc} l ON l.id = p.localizacao_id
              LEFT JOIN {t_prod} pr ON pr.sku = i.sku AND {_ativo_sql(conn, 'pr')}
              WHERE p.status = 'armazenado'
                AND l.status = 'ocupada'
                AND (p.bloqueio_tipo IS NULL OR TRIM(COALESCE(p.bloqueio_tipo, '')) = '')
                AND {bloq_off}
                AND COALESCE(i.quantidade_caixas, 0) > 0'''
    params = []
    cat = (categoria or '').strip().upper()
    if cat:
        sql += ' AND UPPER(TRIM(COALESCE(pr.categoria, \'\'))) = ?'
        params.append(cat)
    sql += ' GROUP BY i.sku ORDER BY validade_min ASC NULLS LAST, i.sku'
    if not _is_pg(conn):
        sql = sql.replace(' NULLS LAST', '')
    rows = conn.execute(sql, tuple(params)).fetchall()
    hoje = date.today()
    out = []
    resumo = {'Verde': 0, 'Amarelo': 0, 'Laranja': 0, 'Vermelho': 0, 'Sem dado': 0}
    for r in rows or []:
        rd = _row_dict(r) or {}
        sku = (rd.get('sku') or '').strip()
        dv = _parse_data_iso_br(rd.get('validade_min'))
        shelf_dias = int(rd.get('shelf_dias_item') or 0) or None
        dias_para_vencer = (dv - hoje).days if dv else None
        pct = None
        if dv and shelf_dias and shelf_dias > 0 and dias_para_vencer is not None:
            pct = round(100.0 * dias_para_vencer / shelf_dias, 1)
        status, pct_out = _status_shelf_pct(pct)
        resumo[status] = resumo.get(status, 0) + 1
        out.append({
            'sku': sku,
            'descricao': rd.get('descricao') or '',
            'categoria': (rd.get('categoria') or '').strip().upper(),
            'quantidade': int(rd.get('quantidade') or 0),
            'data_validade': dv.isoformat() if dv else '',
            'dias_para_vencer': dias_para_vencer,
            'shelf_dias': shelf_dias,
            'shelf_pct': pct_out,
            'status': status,
        })
    return {'itens': out, 'resumo_status': resumo, 'total': len(out)}


def _nivel_shelf_status(status):
    if not status or status == 'Sem dado':
        return 'sem'
    if status == 'Verde':
        return 'boa'
    if status == 'Amarelo':
        return 'atencao'
    return 'ruim'


def _nivel_estoque_cond(st):
    s = (st or '').strip()
    if s == 'Excedido':
        return 'muito'
    if s == 'Vermelho':
        return 'pouco'
    if s in ('Verde', 'Amarelo', 'Analisar'):
        return 'ok'
    return 'sem'


def _prioridade_cruzada_wms(cond, shelf):
    shelf_ruim = shelf in ('Laranja', 'Vermelho')
    if not cond and shelf and shelf != 'Sem dado':
        return 'sem_estoque'
    if cond and (not shelf or shelf == 'Sem dado'):
        return 'sem_shelf'
    if cond == 'Vermelho' and shelf_ruim:
        return 'critico'
    if cond == 'Excedido' and shelf_ruim:
        return 'desperdicio'
    if cond == 'Vermelho':
        return 'produzir'
    if cond == 'Excedido' and shelf == 'Verde':
        return 'excedente_ok'
    if cond in ('Verde', 'Analisar') and shelf_ruim:
        return 'validade'
    if cond == 'Amarelo':
        return 'avaliar'
    return 'ok'


def _acao_cruzada_wms(p):
    acoes = {
        'critico': 'Crítico: pouco estoque e validade curta — conferir lote, FIFO.',
        'desperdicio': 'Desperdício: muito estoque e validade curta — priorizar consumo.',
        'produzir': 'Produzir / reabastecer — estoque baixo com shelf aceitável.',
        'validade': 'Priorizar giro — shelf em atenção ou crítico.',
        'excedente_ok': 'Não produzir — excedente com data boa.',
        'avaliar': 'Avaliar manualmente — semáforo Amarelo.',
        'sem_shelf': 'Sem shelf no WMS — conferir validade nos lotes.',
        'sem_estoque': 'Shelf sem estoque cadastrado no planejamento.',
        'ok': 'Ok — estoque e validade dentro das faixas.',
    }
    return acoes.get(p, acoes['ok'])


def _listar_visao_cruzada_wms(conn, categoria=None, sync=False):
    est = _listar_estoque_seguranca_wms(conn, categoria=categoria, sync=sync)
    shelf = _listar_shelf_life_wms(conn, categoria=categoria)
    shelf_map = {(i.get('sku') or '').strip(): i for i in shelf.get('itens') or []}
    linhas = []
    vistos = set()
    prio_ordem = ['critico', 'desperdicio', 'produzir', 'validade', 'avaliar', 'excedente_ok', 'sem_shelf', 'sem_estoque', 'ok']
    prio_labels = {
        'critico': 'Crítico', 'desperdicio': 'Desperdício', 'produzir': 'Produzir', 'validade': 'Validade',
        'excedente_ok': 'Excedente OK', 'avaliar': 'Avaliar', 'sem_shelf': 'Sem shelf', 'sem_estoque': 'Só shelf', 'ok': 'Ok',
    }
    for e in est.get('itens') or []:
        sku = (e.get('sku') or '').strip()
        vistos.add(sku)
        sh = shelf_map.get(sku) or {}
        cond = e.get('para_condicional') or 'Verde'
        shelf_st = sh.get('status') or 'Sem dado'
        prio = _prioridade_cruzada_wms(cond, shelf_st)
        linhas.append({
            'sku': sku,
            'descricao': e.get('descricao') or sh.get('descricao') or '',
            'condicional': cond,
            'shelf_status': shelf_st,
            'shelf_pct': sh.get('shelf_pct'),
            'dias_para_vencer': sh.get('dias_para_vencer'),
            'estoque_atual': e.get('estoque_atual') or 0,
            'nivel_estoque': _nivel_estoque_cond(cond),
            'nivel_shelf': _nivel_shelf_status(shelf_st),
            'prioridade': prio,
            'prioridade_label': prio_labels.get(prio, prio),
            'acao': _acao_cruzada_wms(prio),
        })
    for sku, sh in shelf_map.items():
        if sku in vistos or not sku:
            continue
        shelf_st = sh.get('status') or 'Sem dado'
        prio = _prioridade_cruzada_wms(None, shelf_st)
        linhas.append({
            'sku': sku,
            'descricao': sh.get('descricao') or '',
            'condicional': None,
            'shelf_status': shelf_st,
            'shelf_pct': sh.get('shelf_pct'),
            'dias_para_vencer': sh.get('dias_para_vencer'),
            'estoque_atual': sh.get('quantidade') or 0,
            'nivel_estoque': 'sem',
            'nivel_shelf': _nivel_shelf_status(shelf_st),
            'prioridade': prio,
            'prioridade_label': prio_labels.get(prio, prio),
            'acao': _acao_cruzada_wms(prio),
        })
    linhas.sort(key=lambda x: (prio_ordem.index(x['prioridade']) if x['prioridade'] in prio_ordem else 99, x.get('sku') or ''))
    contagem_prio = {k: 0 for k in prio_labels}
    for l in linhas:
        contagem_prio[l['prioridade']] = contagem_prio.get(l['prioridade'], 0) + 1
    matriz_keys = [
        'pouco-boa', 'pouco-atencao', 'pouco-ruim',
        'ok-boa', 'ok-atencao', 'ok-ruim',
        'muito-boa', 'muito-atencao', 'muito-ruim',
    ]
    matriz = {k: 0 for k in matriz_keys}
    for l in linhas:
        ne = l.get('nivel_estoque')
        ns = l.get('nivel_shelf')
        if ne in ('sem', None) or ns in ('sem', None):
            continue
        key = f'{ne}-{ns}'
        if key in matriz:
            matriz[key] += 1
    return {
        'linhas': linhas,
        'contagem_prioridade': contagem_prio,
        'matriz': matriz,
        'urgentes': sum(1 for l in linhas if l['prioridade'] in ('critico', 'desperdicio')),
        'total': len(linhas),
    }


def _coletar_mapa_destinos_fixos(conn):
    """Mapa câmara → finalidade (área) → endereços reservados no layout."""
    cfg = _layout_camaras_config()
    labels = _destinos_acao_labels()
    nomes = _map_nomes_camaras(conn)
    por_codigo = {}
    if _wms_tabelas_existem(conn):
        t_loc = _tbl(conn, 'wms_localizacao')
        t_pal = _tbl(conn, 'wms_palete')
        t_item = _tbl(conn, 'wms_palete_item')
        rows = conn.execute(
            f'''SELECT l.camara, l.rua, l.posicao, l.nivel, l.codigo_endereco, l.status, l.area, l.tipo,
                       p.etiqueta, p.id AS palete_id,
                       (SELECT COALESCE(SUM(i.quantidade_caixas), 0) FROM {t_item} i WHERE i.palete_id = p.id) AS qtd_caixas
                FROM {t_loc} l
                LEFT JOIN {t_pal} p ON p.localizacao_id = l.id
                    AND p.status IN ('armazenado', 'bloqueado', 'em_stage', 'separado')
                WHERE l.camara IN ({_WMS_CAMARAS_ESTOQUE_SQL})
                  AND (
                    COALESCE(LOWER(TRIM(l.tipo)), '') = 'destino_fixo'
                    OR LOWER(COALESCE(l.area, '')) IN (
                        'envio_mg', 'retrabalho', 'descarte_perdas', 'palete_bloqueado', 'avaria', 'reentregas'
                    )
                  )''',
        ).fetchall()
        for r in rows or []:
            rd = _row_dict(r) or {}
            cod = (rd.get('codigo_endereco') or '').strip().upper()
            if cod:
                por_codigo[cod] = rd

    grupos_map = {}
    ordem_area = list(labels.keys())
    for bloco in cfg.get('camaras') or []:
        cod_cam = int(bloco.get('codigo') or 0)
        if cod_cam not in _WMS_CAMARAS_ESTOQUE:
            continue
        for _c, rua, pos, niv, dest_acao, dest_lbl, _apenas_rotulo in _coords_from_bloco_layout(bloco):
            if not dest_acao:
                continue
            key = (dest_acao, cod_cam)
            grupos_map.setdefault(key, {
                'area': dest_acao,
                'label': dest_lbl or labels.get(dest_acao, dest_acao.upper()),
                'camara': cod_cam,
                'camara_nome': _nome_camara_label(conn, cod_cam, nomes) or f'Câmara {cod_cam}',
                'ruas': list(bloco.get('ruas') or []),
                'enderecos': [],
            })
            cod_end = _codigo_endereco(cod_cam, rua, pos, niv).upper()
            loc = por_codigo.get(cod_end, {})
            st = (loc.get('status') or 'vazia').strip().lower()
            apto = _rua_para_apto(cod_cam, rua)
            grupos_map[key]['enderecos'].append({
                'codigo_endereco': cod_end,
                'barcode_longarina': _barcode_longarina(cod_cam, pos, niv, apto=apto),
                'rua': rua,
                'posicao': pos,
                'nivel': niv,
                'apto': apto,
                'status': st,
                'etiqueta': loc.get('etiqueta'),
                'palete_id': loc.get('palete_id'),
                'qtd_caixas': int(loc.get('qtd_caixas') or 0),
            })

    grupos = []
    for key in sorted(grupos_map.keys(), key=lambda k: (
        ordem_area.index(k[0]) if k[0] in ordem_area else 99,
        k[1],
    )):
        g = grupos_map[key]
        ends = sorted(g['enderecos'], key=lambda e: (e['rua'], e['posicao'], e['nivel']))
        ocup = sum(1 for e in ends if e.get('status') == 'ocupada')
        g['enderecos'] = ends
        g['total'] = len(ends)
        g['slots'] = len(ends)
        g['ocupadas'] = ocup
        g['livres'] = max(0, len(ends) - ocup)
        g['percentual_ocupacao'] = round(100.0 * ocup / len(ends), 1) if ends else 0
        g['rua'] = ' / '.join(g.get('ruas') or [])
        g['posicoes'] = [
            {
                'posicao': i + 1,
                'codigo_endereco': e.get('codigo_endereco'),
                'barcode_longarina': e.get('barcode_longarina'),
                'rua': e.get('rua'),
                'coluna': e.get('posicao'),
                'nivel': e.get('nivel'),
                'status': (e.get('status') or 'vazia').strip().lower(),
                'etiqueta': e.get('etiqueta'),
                'palete_id': e.get('palete_id'),
                'qtd_caixas': int(e.get('qtd_caixas') or 0),
            }
            for i, e in enumerate(ends)
        ]
        grupos.append(g)

    return {
        'descricao': 'Endereços com finalidade fixa nas câmaras frias (definidos no layout)',
        'grupos': grupos,
        'total_enderecos': sum(g['total'] for g in grupos),
        'total_ocupadas': sum(g['ocupadas'] for g in grupos),
        'total_livres': sum(g['livres'] for g in grupos),
        'labels': labels,
    }


def _obter_vaga_stage_doca(conn, doca):
    t_loc = _tbl(conn, 'wms_localizacao')
    rua = f'D{int(doca)}'
    row = conn.execute(
        f'''SELECT * FROM {t_loc}
            WHERE camara = ? AND area = 'stage'
              AND UPPER(TRIM(rua)) = ?
              AND status = 'vazia'
              AND {_bloqueio_off_sql(conn, 'bloqueio_entrada')}
            ORDER BY posicao ASC
            LIMIT 1''',
        (_WMS_CAMARA_STAGE, rua),
    ).fetchone()
    if not row:
        return None, f'Sem vaga livre na área stage da doca {doca}.'
    return _row_dict(row), None


def _resolver_palete_separacao_bip(conn, codigo):
    """Resolve palete pela etiqueta (22) ou pelo endereço armazenado."""
    raw = (codigo or '').strip()
    if not raw:
        return None, 'Informe a etiqueta do palete ou o endereço de origem.'
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    etiqueta = raw[:22].ljust(22, '0') if len(raw) >= 18 else raw
    if len(raw) >= 18:
        pal = conn.execute(
            f'SELECT * FROM {t_pal} WHERE etiqueta = ? OR etiqueta = ?',
            (raw, etiqueta),
        ).fetchone()
        if pal:
            return _row_dict(pal), None
    cod_resolvido = _resolver_codigo_endereco_bip(raw) or raw.upper()
    loc = conn.execute(
        f'''SELECT id, codigo_endereco, area FROM {t_loc}
            WHERE codigo_endereco IN (?, ?) OR UPPER(codigo_endereco) = ?''',
        (cod_resolvido, raw.upper(), raw.upper()),
    ).fetchone()
    if loc:
        ld = _row_dict(loc) or {}
        if (ld.get('area') or '').lower() == 'stage':
            return None, 'Este endereço é da área stage — bip o palete pela etiqueta.'
        loc_id = ld.get('id')
        pal = conn.execute(
            f'''SELECT * FROM {t_pal}
                WHERE localizacao_id = ? AND status = 'armazenado'
                ORDER BY id DESC LIMIT 1''',
            (loc_id,),
        ).fetchone()
        if pal:
            return _row_dict(pal), None
        return None, 'Nenhum palete armazenado neste endereço.'
    return None, 'Palete ou endereço não reconhecido.'


def _palete_ja_separado_viagem(conn, palete_id, id_roteiro, id_viagem):
    t_mov = _tbl(conn, 'wms_movimentacao')
    row = conn.execute(
        f'''SELECT id, status FROM {t_mov}
            WHERE palete_id = ? AND tipo = 'separacao_stage'
              AND id_roteiro = ? AND id_viagem = ?
              AND status IN ('aguardando_validacao', 'concluida')
            ORDER BY id DESC LIMIT 1''',
        (int(palete_id), str(id_roteiro).strip(), str(id_viagem).strip()),
    ).fetchone()
    return _row_dict(row) if row else None


def _bip_separacao_para_stage(conn, id_roteiro, id_viagem, doca, codigo_bip):
    """Retira palete do endereço e envia para área stage (aguarda validação de saída)."""
    id_roteiro = str(id_roteiro or '').strip()
    id_viagem = str(id_viagem or '').strip()
    doca = str(doca or '1').strip()
    if doca not in ('1', '2', '3', '4'):
        return None, 'Selecione a doca (1 a 4).'
    if not id_roteiro or not id_viagem:
        return None, 'Informe roteiro e viagem antes de bipar a saída.'
    _ensure_movimentacao_expedicao_columns(conn)
    _ensure_stage_localizacoes(conn)

    pal, err = _resolver_palete_separacao_bip(conn, codigo_bip)
    if err:
        return None, err
    pid = int(pal['id'])
    if (pal.get('status') or '').lower() != 'armazenado':
        return None, f'Palete {pal.get("etiqueta")} não está armazenado (status: {pal.get("status")}).'
    if pal.get('bloqueio_tipo'):
        return None, 'Palete bloqueado — não pode ser separado.'
    dup = _palete_ja_separado_viagem(conn, pid, id_roteiro, id_viagem)
    if dup:
        st = dup.get('status') or ''
        return None, f'Palete já enviado ao stage nesta viagem (mov. #{dup.get("id")}, {st}).'

    orig_id = pal.get('localizacao_id')
    if not orig_id:
        return None, 'Palete sem endereço de origem.'

    stage_loc, err2 = _obter_vaga_stage_doca(conn, doca)
    if err2:
        return None, err2
    dest_id = stage_loc['id']

    t_mov = _tbl(conn, 'wms_movimentacao')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_pal = _tbl(conn, 'wms_palete')
    now = _now_iso()

    orig_row = conn.execute(f'SELECT codigo_endereco FROM {t_loc} WHERE id = ?', (orig_id,)).fetchone()
    orig_cod = (_row_dict(orig_row) or {}).get('codigo_endereco') or ''
    obs = (
        f'Separação doca {doca} → stage {stage_loc.get("codigo_endereco")} '
        f'| roteiro {id_roteiro} viagem {id_viagem} | origem {orig_cod}'
    )

    if _is_pg(conn):
        cur = conn.execute(
            f'''INSERT INTO {t_mov}
                (tipo, palete_id, origem_localizacao_id, destino_localizacao_id, status, prioridade,
                 observacao, id_roteiro, id_viagem, criado_em, criado_por)
                VALUES ('separacao_stage', ?, ?, ?, 'aguardando_validacao', 1, ?, ?, ?, NOW(), ?)
                RETURNING id''',
            (pid, orig_id, dest_id, obs, id_roteiro, id_viagem, _usuario()),
        )
        mov_id = (_row_dict(cur.fetchone()) or {}).get('id')
        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (orig_id,))
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = NOW() WHERE id = ?", (dest_id,))
        conn.execute(
            f"UPDATE {t_pal} SET localizacao_id = ?, status = 'em_stage', atualizado_em = NOW() WHERE id = ?",
            (dest_id, pid),
        )
    else:
        conn.execute(
            f'''INSERT INTO {t_mov}
                (tipo, palete_id, origem_localizacao_id, destino_localizacao_id, status, prioridade,
                 observacao, id_roteiro, id_viagem, criado_em, criado_por)
                VALUES ('separacao_stage', ?, ?, ?, 'aguardando_validacao', 1, ?, ?, ?, ?, ?)''',
            (pid, orig_id, dest_id, obs, id_roteiro, id_viagem, now, _usuario()),
        )
        mov_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, orig_id))
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = ? WHERE id = ?", (now, dest_id))
        conn.execute(
            f'UPDATE {t_pal} SET localizacao_id = ?, status = ?, atualizado_em = ? WHERE id = ?',
            (dest_id, 'em_stage', now, pid),
        )

    _ensure_wms_palete_controle_table(conn)
    _registrar_controle_palete(
        conn, pid, 'entrada',
        subtipo='area_stage',
        localizacao_id=dest_id,
        codigo_endereco=stage_loc.get('codigo_endereco'),
        observacao=f'Palete retirado de {orig_cod} → stage doca {doca}',
    )
    for sku in _skus_do_palete(conn, pid):
        _sync_produto_estoque_cache(conn, sku)

    itens = _itens_resumo_palete(conn, pid)
    return {
        'movimentacao_id': mov_id,
        'palete_id': pid,
        'etiqueta': pal.get('etiqueta'),
        'origem': orig_cod,
        'stage': stage_loc.get('codigo_endereco'),
        'doca': doca,
        'status': 'aguardando_validacao',
        'itens': itens,
    }, None


def _itens_resumo_palete(conn, palete_id):
    t_item = _tbl(conn, 'wms_palete_item')
    rows = conn.execute(
        f'''SELECT sku, lote, quantidade_caixas, data_producao
            FROM {t_item} WHERE palete_id = ? ORDER BY sku''',
        (int(palete_id),),
    ).fetchall()
    out = []
    for r in rows or []:
        rd = _row_dict(r) or {}
        out.append({
            'sku': rd.get('sku'),
            'lote': rd.get('lote'),
            'quantidade_caixas': int(rd.get('quantidade_caixas') or 0),
            'data_producao': rd.get('data_producao'),
        })
    return out


def _listar_separacao_stage(conn, id_roteiro, id_viagem, status=None):
    id_roteiro = str(id_roteiro or '').strip()
    id_viagem = str(id_viagem or '').strip()
    if not id_roteiro or not id_viagem:
        return None, 'Informe roteiro e viagem.'
    _ensure_movimentacao_expedicao_columns(conn)
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    params = [id_roteiro, id_viagem]
    filtro_st = ''
    if status:
        filtro_st = ' AND m.status = ?'
        params.append(status)
    rows = conn.execute(
        f'''SELECT m.id, m.status, m.criado_em, m.concluida_em, m.observacao,
                   p.etiqueta, p.id AS palete_id,
                   lo.codigo_endereco AS origem, ld.codigo_endereco AS stage
            FROM {t_mov} m
            JOIN {t_pal} p ON p.id = m.palete_id
            LEFT JOIN {t_loc} lo ON lo.id = m.origem_localizacao_id
            LEFT JOIN {t_loc} ld ON ld.id = m.destino_localizacao_id
            WHERE m.tipo = 'separacao_stage'
              AND m.id_roteiro = ? AND m.id_viagem = ? {filtro_st}
            ORDER BY m.id DESC
            LIMIT 500''',
        tuple(params),
    ).fetchall()
    out = []
    for r in rows or []:
        rd = _row_dict(r) or {}
        out.append({
            'movimentacao_id': rd.get('id'),
            'status': rd.get('status'),
            'etiqueta': rd.get('etiqueta'),
            'palete_id': rd.get('palete_id'),
            'origem': rd.get('origem'),
            'stage': rd.get('stage'),
            'criado_em': rd.get('criado_em'),
            'concluida_em': rd.get('concluida_em'),
        })
    pendentes = sum(1 for x in out if x.get('status') == 'aguardando_validacao')
    return {
        'itens': out,
        'total': len(out),
        'pendentes_validacao': pendentes,
        'id_roteiro': id_roteiro,
        'id_viagem': id_viagem,
    }, None


def _validar_saida_expedicao_stage(conn, id_roteiro, id_viagem):
    """Confirma saída dos paletes que já estão na área stage para esta viagem."""
    id_roteiro = str(id_roteiro or '').strip()
    id_viagem = str(id_viagem or '').strip()
    if not id_roteiro or not id_viagem:
        return None, 'Informe roteiro e viagem.'
    _ensure_movimentacao_expedicao_columns(conn)
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_pal = _tbl(conn, 'wms_palete')
    now = _now_iso()
    rows = conn.execute(
        f'''SELECT id, palete_id FROM {t_mov}
            WHERE tipo = 'separacao_stage' AND status = 'aguardando_validacao'
              AND id_roteiro = ? AND id_viagem = ?''',
        (id_roteiro, id_viagem),
    ).fetchall()
    if not rows:
        return None, 'Nenhum palete aguardando validação de saída nesta viagem.'
    validados = 0
    pids = []
    for r in rows:
        rd = _row_dict(r) or {}
        mov_id = rd.get('id')
        pid = rd.get('palete_id')
        if not mov_id or not pid:
            continue
        if _is_pg(conn):
            conn.execute(
                f'''UPDATE {t_mov} SET status = 'concluida', concluida_em = NOW(), concluida_por = ?
                    WHERE id = ?''',
                (_usuario(), mov_id),
            )
            conn.execute(
                f"UPDATE {t_pal} SET status = 'separado', atualizado_em = NOW() WHERE id = ?",
                (pid,),
            )
        else:
            conn.execute(
                f'''UPDATE {t_mov} SET status = 'concluida', concluida_em = ?, concluida_por = ? WHERE id = ?''',
                (now, _usuario(), mov_id),
            )
            conn.execute(
                f'UPDATE {t_pal} SET status = ?, atualizado_em = ? WHERE id = ?',
                ('separado', now, pid),
            )
        pids.append(pid)
        validados += 1
    for pid in pids:
        for sku in _skus_do_palete(conn, pid):
            _sync_produto_estoque_cache(conn, sku)
    return {
        'validados': validados,
        'id_roteiro': id_roteiro,
        'id_viagem': id_viagem,
        'mensagem': f'Saída validada — {validados} palete(s) liberado(s) para expedição (stage).',
    }, None


def _liberar_palete_para_exclusao(conn, palete_id):
    """Libera endereço e remove vínculo do palete antes de excluir o recebimento."""
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    pal = conn.execute(
        f'SELECT id, localizacao_id, status FROM {t_pal} WHERE id = ?', (int(palete_id),)
    ).fetchone()
    if not pal:
        return
    rd = _row_dict(pal) or {}
    loc_id = rd.get('localizacao_id')
    st = (rd.get('status') or '').lower()
    now = _now_iso()
    if loc_id and st == 'armazenado':
        if _is_pg(conn):
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (loc_id,))
        else:
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, loc_id))


def _excluir_recebimento_wms(conn, recebimento_id, permitir_finalizado=False):
    """Remove recebimento e paletes vinculados. Libera endereços de paletes armazenados."""
    t_rec = _tbl(conn, 'wms_recebimento')
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_cqr = _tbl(conn, 'wms_check_qualidade_resposta')
    _ensure_wms_palete_controle_table(conn)
    t_ctrl = _tbl(conn, 'wms_palete_controle')

    rec = conn.execute(
        f'SELECT id, status, terceiros_documento_id, numero_nf FROM {t_rec} WHERE id = ?',
        (recebimento_id,),
    ).fetchone()
    if not rec:
        return None, 'Recebimento não encontrado.'
    rec_rd = _row_dict(rec) or {}
    doc_ter = rec_rd.get('terceiros_documento_id')
    st_rec = (rec_rd.get('status') or '').lower()
    if st_rec == 'finalizado' and not permitir_finalizado:
        return None, 'Recebimento já finalizado — use Reiniciar ou Excluir na busca da NF para recomeçar.'

    pals = conn.execute(
        f'''SELECT DISTINCT p.id, p.etiqueta, p.status
            FROM {t_pal} p
            WHERE p.recebimento_id = ?
               OR p.id IN (SELECT palete_id FROM {t_rp} WHERE recebimento_id = ?)''',
        (recebimento_id, recebimento_id),
    ).fetchall()

    palete_ids = []
    armazenados = []
    for p in pals:
        rd = _row_dict(p) or {}
        pid = rd.get('id')
        if pid:
            palete_ids.append(pid)
        if (rd.get('status') or '').lower() == 'armazenado':
            armazenados.append(rd.get('etiqueta') or str(pid))

    for pid in palete_ids:
        _liberar_palete_para_exclusao(conn, pid)
        ctrl_rows = conn.execute(f'SELECT id FROM {t_ctrl} WHERE palete_id = ?', (pid,)).fetchall()
        ctrl_ids = [(_row_dict(r) or {}).get('id') for r in ctrl_rows or []]
        ctrl_ids = [i for i in ctrl_ids if i is not None]
        if ctrl_ids:
            ph = ','.join('?' * len(ctrl_ids))
            try:
                conn.execute(
                    f'UPDATE {t_ctrl} SET registro_saida_id = NULL WHERE registro_saida_id IN ({ph})',
                    ctrl_ids,
                )
            except Exception:
                pass
        try:
            conn.execute(f'UPDATE {t_ctrl} SET registro_saida_id = NULL WHERE palete_id = ?', (pid,))
        except Exception:
            pass
        conn.execute(f'DELETE FROM {t_ctrl} WHERE palete_id = ?', (pid,))
        conn.execute(f'DELETE FROM {t_mov} WHERE palete_id = ?', (pid,))
        conn.execute(f'DELETE FROM {t_item} WHERE palete_id = ?', (pid,))

    conn.execute(f'DELETE FROM {t_rp} WHERE recebimento_id = ?', (recebimento_id,))
    for pid in palete_ids:
        conn.execute(f'DELETE FROM {t_pal} WHERE id = ?', (pid,))
    conn.execute(f'DELETE FROM {t_cqr} WHERE recebimento_id = ?', (recebimento_id,))
    conn.execute(f'DELETE FROM {t_rec} WHERE id = ?', (recebimento_id,))

    terceiros_reaberto = False
    if doc_ter:
        ok_ter, _err_ter = _reabrir_terceiros_recebimento_wms(
            conn, int(doc_ter), motivo='exclusao_recebimento_wms',
        )
        terceiros_reaberto = bool(ok_ter)

    return {
        'ok': True,
        'paletes_removidos': len(palete_ids),
        'enderecos_liberados': len(armazenados),
        'terceiros_reaberto': terceiros_reaberto,
        'terceiros_documento_id': int(doc_ter) if doc_ter else None,
    }, None


def _mov_pendente_putaway(conn, palete_id):
    t_mov = _tbl(conn, 'wms_movimentacao')
    row = conn.execute(
        f'''SELECT * FROM {t_mov}
            WHERE palete_id = ? AND status = 'pendente' AND tipo = 'putaway'
            ORDER BY id DESC LIMIT 1''',
        (int(palete_id),),
    ).fetchone()
    return _row_dict(row)


def _mov_row_para_api(rd):
    if not rd:
        return {}
    d = dict(rd) if hasattr(rd, 'keys') else {}
    for k in ('criado_em', 'concluida_em'):
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d


def _listar_movimentacoes_historico(conn, limite=100):
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    limite = max(1, min(int(limite or 100), 500))
    rows = conn.execute(
        f'''SELECT m.id, m.tipo, m.status, m.prioridade, m.observacao,
                   m.criado_em, m.concluida_em, m.criado_por, m.concluida_por,
                   p.etiqueta, p.id AS palete_id,
                   lo.codigo_endereco AS origem,
                   ld.codigo_endereco AS destino
            FROM {t_mov} m
            JOIN {t_pal} p ON p.id = m.palete_id
            LEFT JOIN {t_loc} lo ON lo.id = m.origem_localizacao_id
            LEFT JOIN {t_loc} ld ON ld.id = m.destino_localizacao_id
            ORDER BY COALESCE(m.concluida_em, m.criado_em) DESC, m.id DESC
            LIMIT ?''',
        (limite,),
    ).fetchall()
    return [_mov_row_para_api(_row_dict(r)) for r in (rows or [])]


def _transferir_palete_armazem(conn, codigo_palete, codigo_destino, observacao=None):
    """Move palete armazenado para outro endereço (transferência manual no armazém)."""
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_mov = _tbl(conn, 'wms_movimentacao')
    now = _now_iso()

    pal, err = _resolver_palete_separacao_bip(conn, codigo_palete)
    if err:
        return None, err
    pid = int(pal['id'])
    st = (pal.get('status') or '').lower()
    if st not in ('armazenado', 'bloqueado'):
        return None, (
            f'Palete não está no armazém para transferência (status: {st or "—"}). '
            'Bipe a etiqueta de um palete já guardado em endereço.'
        )
    orig_id = pal.get('localizacao_id')
    if not orig_id:
        return None, 'Palete sem endereço de origem — não é possível transferir.'

    cod_resolvido = _resolver_codigo_endereco_bip(codigo_destino, conn=conn) or (codigo_destino or '').strip().upper()
    if not cod_resolvido:
        return None, 'Endereço de destino inválido. Bipe a etiqueta da longarina (ex.: 7.14.1*23).'
    loc = conn.execute(
        f'''SELECT * FROM {t_loc}
            WHERE codigo_endereco = ? OR UPPER(codigo_endereco) = ?''',
        (cod_resolvido, cod_resolvido),
    ).fetchone()
    if not loc:
        return None, 'Endereço de destino não encontrado.'
    ld = _row_dict(loc) or {}
    if (ld.get('area') or '').lower() == 'stage':
        return None, 'Destino não pode ser área stage — use endereço de pulmão.'
    if (ld.get('status') or '').lower() != 'vazia':
        return None, 'Endereço de destino não está vazio.'
    dest_id = int(ld['id'])
    if int(orig_id) == dest_id:
        return None, 'O palete já está neste endereço.'

    orig_row = conn.execute(f'SELECT codigo_endereco FROM {t_loc} WHERE id = ?', (orig_id,)).fetchone()
    orig_cod = (_row_dict(orig_row) or {}).get('codigo_endereco') or ''
    dest_cod = ld.get('codigo_endereco') or cod_resolvido
    obs_user = (observacao or '').strip()
    obs = obs_user or f'Transferência manual {orig_cod} → {dest_cod}'

    mov_pend = _mov_pendente_putaway(conn, pid)
    if mov_pend:
        mid_p = mov_pend.get('id')
        if _is_pg(conn):
            conn.execute(
                f"""UPDATE {t_mov} SET status = 'cancelada',
                    observacao = COALESCE(observacao, '') || ' | cancelada: transferência manual'
                    WHERE id = ?""",
                (mid_p,),
            )
        else:
            conn.execute(
                f"""UPDATE {t_mov} SET status = 'cancelada',
                    observacao = COALESCE(observacao, '') || ' | cancelada: transferência manual'
                    WHERE id = ?""",
                (mid_p,),
            )

    if _is_pg(conn):
        cur = conn.execute(
            f'''INSERT INTO {t_mov}
                (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                 status, prioridade, observacao, criado_em, criado_por, concluida_em, concluida_por)
                VALUES ('transferencia', ?, ?, ?, 'concluida', 1, ?, NOW(), ?, NOW(), ?)
                RETURNING id''',
            (pid, orig_id, dest_id, obs, _usuario(), _usuario()),
        )
        mov_id = (_row_dict(cur.fetchone()) or {}).get('id')
        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (orig_id,))
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = NOW() WHERE id = ?", (dest_id,))
        conn.execute(
            f'''UPDATE {t_pal} SET localizacao_id = ?,
                status = CASE WHEN bloqueio_tipo IS NOT NULL AND TRIM(COALESCE(bloqueio_tipo, '')) != ''
                              THEN 'bloqueado' ELSE 'armazenado' END,
                atualizado_em = NOW() WHERE id = ?''',
            (dest_id, pid),
        )
    else:
        conn.execute(
            f'''INSERT INTO {t_mov}
                (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                 status, prioridade, observacao, criado_em, criado_por, concluida_em, concluida_por)
                VALUES ('transferencia', ?, ?, ?, 'concluida', 1, ?, ?, ?, ?, ?)''',
            (pid, orig_id, dest_id, obs, now, _usuario(), now, _usuario()),
        )
        mov_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, orig_id))
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = ? WHERE id = ?", (now, dest_id))
        pal_st = conn.execute(f'SELECT bloqueio_tipo FROM {t_pal} WHERE id = ?', (pid,)).fetchone()
        pst = (_row_dict(pal_st) or {}).get('bloqueio_tipo')
        novo_st = 'bloqueado' if pst and str(pst).strip() else 'armazenado'
        conn.execute(
            f'UPDATE {t_pal} SET localizacao_id = ?, status = ?, atualizado_em = ? WHERE id = ?',
            (dest_id, novo_st, now, pid),
        )

    _ensure_wms_palete_controle_table(conn)
    _registrar_controle_palete(
        conn, pid, 'saida', subtipo='transferencia',
        localizacao_id=orig_id, codigo_endereco=orig_cod,
        observacao=f'Saída para transferência → {dest_cod}',
    )
    _registrar_controle_palete(
        conn, pid, 'entrada', subtipo='transferencia',
        localizacao_id=dest_id, codigo_endereco=dest_cod,
        observacao=f'Entrada por transferência (origem {orig_cod})',
    )
    for sku in _skus_do_palete(conn, pid):
        _sync_produto_estoque_cache(conn, sku)

    return {
        'movimentacao_id': mov_id,
        'palete_id': pid,
        'etiqueta': pal.get('etiqueta'),
        'origem': orig_cod,
        'destino': dest_cod,
        'status': 'concluida',
    }, None


def _criar_mov_pendente_putaway(conn, palete_id, sug, obs_extra=None):
    """Gera tarefa de putaway pendente para aparecer na fila até bipar a longarina."""
    if not sug or not sug.get('localizacao_id'):
        return None
    existente = _mov_pendente_putaway(conn, palete_id)
    if existente:
        return existente.get('id')
    t_mov = _tbl(conn, 'wms_movimentacao')
    obs_parts = list(sug.get('motivo') or [])
    if obs_extra:
        obs_parts.insert(0, obs_extra)
    obs = '; '.join(obs_parts) or 'Putaway pendente — aguardando bip da longarina'
    now = _now_iso()
    dest_id = sug['localizacao_id']
    if _is_pg(conn):
        cur = conn.execute(
            f'''INSERT INTO {t_mov} (tipo, palete_id, destino_localizacao_id, status, prioridade, observacao, criado_em, criado_por)
                VALUES ('putaway', ?, ?, 'pendente', 1, ?, NOW(), ?) RETURNING id''',
            (int(palete_id), dest_id, obs, _usuario()),
        )
        return (cur.fetchone() or {}).get('id')
    conn.execute(
        f'''INSERT INTO {t_mov} (tipo, palete_id, destino_localizacao_id, status, prioridade, observacao, criado_em, criado_por)
            VALUES ('putaway', ?, ?, 'pendente', 1, ?, ?, ?)''',
        (int(palete_id), dest_id, obs, now, _usuario()),
    )
    return conn.execute('SELECT last_insert_rowid()').fetchone()[0]


def _sync_recebimento_status_armazenagem(conn, recebimento_id):
    """Atualiza status do recebimento conforme paletes armazenados."""
    if not recebimento_id:
        return None
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_rec = _tbl(conn, 'wms_recebimento')
    rows = conn.execute(
        f'''SELECT p.status FROM {t_rp} rp
            JOIN {t_pal} p ON p.id = rp.palete_id
            WHERE rp.recebimento_id = ?''',
        (int(recebimento_id),),
    ).fetchall()
    if not rows:
        return None
    statuses = [((_row_dict(r) or {}).get('status') or '').lower() for r in rows]
    if all(s == 'armazenado' for s in statuses):
        novo = 'concluido'
    elif any(s == 'armazenado' for s in statuses):
        novo = 'aguardando_armazenagem'
    else:
        return None
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(f"UPDATE {t_rec} SET status = ?, atualizado_em = NOW() WHERE id = ?", (novo, int(recebimento_id)))
    else:
        conn.execute(f"UPDATE {t_rec} SET status = ?, atualizado_em = ? WHERE id = ?", (novo, now, int(recebimento_id)))
    return novo


def _resumo_finalizacao_recebimento(conn, recebimento_id):
    """Indica se o recebimento pode ser finalizado (todos paletes guardados, NF ok)."""
    rec = _resolver_recebimento_wms(conn, recebimento_id=recebimento_id)
    if not rec:
        return None
    rid = int(rec['id'])
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_mov = _tbl(conn, 'wms_movimentacao')

    pals = conn.execute(
        f'''SELECT p.id, p.etiqueta, p.status
            FROM {t_rp} rp JOIN {t_pal} p ON p.id = rp.palete_id
            WHERE rp.recebimento_id = ?''',
        (rid,),
    ).fetchall()

    paletes_total = 0
    paletes_armazenados = 0
    paletes_pendentes = []
    pid_list = []
    for p in pals or []:
        rd = _row_dict(p) or {}
        pid = rd.get('id')
        status = (rd.get('status') or '').lower()
        cnt = conn.execute(f'SELECT COUNT(*) AS n FROM {t_item} WHERE palete_id = ?', (pid,)).fetchone()
        n_items = int((_row_dict(cnt) or {}).get('n') or 0)
        if n_items == 0 and status != 'armazenado':
            continue
        paletes_total += 1
        pid_list.append(pid)
        if status == 'armazenado':
            paletes_armazenados += 1
        else:
            paletes_pendentes.append({'etiqueta': rd.get('etiqueta'), 'status': status})

    mov_pendentes = 0
    if pid_list:
        ph = ','.join('?' * len(pid_list))
        row_mov = conn.execute(
            f"SELECT COUNT(*) AS n FROM {t_mov} WHERE palete_id IN ({ph}) AND LOWER(COALESCE(status, '')) = 'pendente'",
            pid_list,
        ).fetchone()
        mov_pendentes = int((_row_dict(row_mov) or {}).get('n') or 0)

    itens_nf_ok = True
    itens_nf_pendentes = 0
    numero_nf = rec.get('numero_nf')
    doc_id = rec.get('terceiros_documento_id')
    if doc_id and numero_nf:
        doc_nf, _err = _buscar_documento_terceiros_por_nf(conn, numero_nf)
        if doc_nf:
            doc_enr = _enriquecer_documento_nf_wms(conn, doc_nf)
            for it in doc_enr.get('itens') or []:
                if it.get('status_wms') != 'concluido':
                    itens_nf_ok = False
                    itens_nf_pendentes += 1

    st_rec = (rec.get('status') or '').lower()
    motivos = []
    if st_rec == 'finalizado':
        motivos.append('Recebimento já finalizado.')
    elif st_rec == 'cancelado':
        motivos.append('Recebimento cancelado.')
    if paletes_total == 0:
        motivos.append('Nenhum palete conferido ainda.')
    elif paletes_pendentes:
        motivos.append(f'{len(paletes_pendentes)} palete(s) ainda não guardado(s).')
    if mov_pendentes:
        motivos.append(f'{mov_pendentes} movimentação(ões) pendente(s).')
    if not itens_nf_ok:
        motivos.append(f'{itens_nf_pendentes} item(ns) da NF ainda pendente(s).')

    pode = (
        st_rec not in ('finalizado', 'cancelado')
        and paletes_total > 0
        and paletes_armazenados == paletes_total
        and mov_pendentes == 0
        and itens_nf_ok
    )
    return {
        'pode_finalizar': pode,
        'motivo': ' · '.join(motivos) if motivos else 'Pronto para finalizar.',
        'motivos': motivos,
        'paletes_total': paletes_total,
        'paletes_armazenados': paletes_armazenados,
        'mov_pendentes': mov_pendentes,
        'itens_nf_ok': itens_nf_ok,
        'itens_nf_pendentes': itens_nf_pendentes,
        'status_recebimento': st_rec,
    }


def _confirmar_armazenagem_palete(conn, palete_id, codigo_endereco):
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_mov = _tbl(conn, 'wms_movimentacao')
    now = _now_iso()
    pal = conn.execute(f'SELECT * FROM {t_pal} WHERE id = ?', (palete_id,)).fetchone()
    if not pal:
        return None, 'Palete não encontrado.'
    cod_resolvido = _resolver_codigo_endereco_bip(codigo_endereco, conn=conn) or (codigo_endereco or '').strip().upper()
    loc = conn.execute(
        f'''SELECT * FROM {t_loc} WHERE codigo_endereco = ? OR codigo_endereco = ?''',
        (cod_resolvido, cod_resolvido.upper()),
    ).fetchone()
    if not loc:
        return None, 'Endereço não encontrado. Bipe a etiqueta da longarina (ex.: 15.7.1).'
    ld = _row_dict(loc) or {}
    if ld.get('status') != 'vazia':
        return None, 'Endereço não está vazio.'
    pid = pal['id'] if isinstance(pal, dict) else pal[0]
    dest_id = ld.get('id')
    orig = pal.get('localizacao_id') if isinstance(pal, dict) else None
    obs = f'Armazenagem confirmada em {ld.get("codigo_endereco")}'
    mov_pend = _mov_pendente_putaway(conn, pid)
    mov_id = mov_pend.get('id') if mov_pend else None
    if mov_pend:
        if _is_pg(conn):
            conn.execute(
                f'''UPDATE {t_mov} SET status = 'concluida', destino_localizacao_id = ?,
                    origem_localizacao_id = COALESCE(origem_localizacao_id, ?),
                    observacao = ?, concluida_em = NOW(), concluida_por = ?
                    WHERE id = ?''',
                (dest_id, orig, obs, _usuario(), mov_id),
            )
        else:
            conn.execute(
                f'''UPDATE {t_mov} SET status = 'concluida', destino_localizacao_id = ?,
                    origem_localizacao_id = COALESCE(origem_localizacao_id, ?),
                    observacao = ?, concluida_em = ?, concluida_por = ? WHERE id = ?''',
                (dest_id, orig, obs, now, _usuario(), mov_id),
            )
    elif _is_pg(conn):
        conn.execute(
            f'''INSERT INTO {t_mov} (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                status, prioridade, observacao, criado_em, criado_por, concluida_em, concluida_por)
                VALUES ('putaway', ?, ?, ?, 'concluida', 1, ?, NOW(), ?, NOW(), ?)''',
            (pid, orig, dest_id, obs, _usuario(), _usuario()),
        )
    else:
        conn.execute(
            f'''INSERT INTO {t_mov} (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                status, prioridade, observacao, criado_em, criado_por, concluida_em, concluida_por)
                VALUES ('putaway', ?, ?, ?, 'concluida', 1, ?, ?, ?, ?, ?)''',
            (pid, orig, dest_id, obs, now, _usuario(), now, _usuario()),
        )
    if _is_pg(conn):
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = NOW() WHERE id = ?", (dest_id,))
        if orig:
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (orig,))
        conn.execute(
            f'''UPDATE {t_pal} SET localizacao_id = ?,
                status = CASE WHEN bloqueio_tipo IS NOT NULL AND TRIM(COALESCE(bloqueio_tipo, '')) != ''
                              THEN 'bloqueado' ELSE 'armazenado' END,
                atualizado_em = NOW() WHERE id = ?''',
            (dest_id, pid),
        )
    else:
        conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = ? WHERE id = ?", (now, dest_id))
        if orig:
            conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, orig))
        pal_st = conn.execute(f'SELECT bloqueio_tipo FROM {t_pal} WHERE id = ?', (pid,)).fetchone()
        pst = (_row_dict(pal_st) or {}).get('bloqueio_tipo')
        novo_st = 'bloqueado' if pst and str(pst).strip() else 'armazenado'
        conn.execute(
            f'UPDATE {t_pal} SET localizacao_id = ?, status = ?, atualizado_em = ? WHERE id = ?',
            (dest_id, novo_st, now, pid),
        )
    pal_rd = _row_dict(pal) or {}
    rid = pal_rd.get('recebimento_id')
    if not rid:
        t_rp = _tbl(conn, 'wms_recebimento_palete')
        rp = conn.execute(
            f'SELECT recebimento_id FROM {t_rp} WHERE palete_id = ? ORDER BY id DESC LIMIT 1', (pid,),
        ).fetchone()
        rid = (_row_dict(rp) or {}).get('recebimento_id')
    rec_status = _sync_recebimento_status_armazenagem(conn, rid)
    _ensure_wms_palete_controle_table(conn)
    _registrar_controle_palete(
        conn, pid, 'entrada',
        subtipo='armazenagem',
        localizacao_id=dest_id,
        codigo_endereco=ld.get('codigo_endereco'),
        observacao='Entrada no endereço do armazém',
    )
    loc_fmt = _format_locacao(loc)
    if loc_fmt is not None and isinstance(loc_fmt, dict):
        loc_fmt['movimentacao_id'] = mov_id
        loc_fmt['movimentacao_status'] = 'concluida'
        loc_fmt['recebimento_status'] = rec_status
        try:
            n_lanc = _registrar_entrada_classificada_estoque_sp(conn, palete_id)
            if n_lanc:
                loc_fmt['estoque_sp_classificados'] = n_lanc
        except Exception:
            pass
    return loc_fmt, None


def _aplicar_bloqueios_palete(conn, palete_id, estado_fisico, data_validade, temperatura):
    bloqueios = []
    t_pal = _tbl(conn, 'wms_palete')
    disp = _estado_recebimento_para_disposicao(estado_fisico)
    if disp == 'avaria':
        bloqueios.append('avaria')
        conn.execute(
            f'UPDATE {t_pal} SET bloqueio_tipo = ?, bloqueio_motivo = ?, status = ?, estado_fisico = ? WHERE id = ?',
            ('QC', 'Entrada classificada: avaria (descarte avariado)', 'bloqueado', 'avaria', palete_id),
        )
    elif disp == 'descarte_perdas':
        bloqueios.append('descarte_perdas')
        conn.execute(
            f'UPDATE {t_pal} SET bloqueio_tipo = ?, bloqueio_motivo = ?, status = ?, estado_fisico = ? WHERE id = ?',
            ('descarte_perdas', 'Entrada classificada: descarte / perdas', 'bloqueado', 'descarte_perdas', palete_id),
        )
    elif disp == 'palete_bloqueado':
        bloqueios.append('palete_bloqueado')
        conn.execute(
            f'UPDATE {t_pal} SET bloqueio_tipo = ?, bloqueio_motivo = ?, status = ?, estado_fisico = ? WHERE id = ?',
            ('palete_bloqueado', 'Entrada classificada: palete bloqueado', 'bloqueado', 'palete_bloqueado', palete_id),
        )
    elif (estado_fisico or '').lower() == 'deteriorado':
        bloqueios.append('descarte_perdas')
        conn.execute(
            f'UPDATE {t_pal} SET bloqueio_tipo = ?, bloqueio_motivo = ?, status = ?, estado_fisico = ? WHERE id = ?',
            ('deteriorado', 'Estado palete: deteriorado', 'bloqueado', 'deteriorado', palete_id),
        )
    if data_validade:
        try:
            if isinstance(data_validade, str):
                dv = date.fromisoformat(data_validade[:10])
            else:
                dv = data_validade
            if dv < date.today():
                bloqueios.append('vencimento')
                conn.execute(
                    f'UPDATE {t_pal} SET bloqueio_tipo = ?, bloqueio_motivo = ?, status = ? WHERE id = ?',
                    ('vencimento', 'Data de validade expirada', 'bloqueado', palete_id),
                )
        except Exception:
            pass
    return bloqueios


def _sql_filtro_periodo(conn, col, data_inicio, data_fim):
    parts = []
    params = []
    if data_inicio:
        di = str(data_inicio)[:10]
        if _is_pg(conn):
            parts.append(f'({col}::date >= ?::date)')
        else:
            parts.append(f'(date({col}) >= date(?))')
        params.append(di)
    if data_fim:
        df = str(data_fim)[:10]
        if _is_pg(conn):
            parts.append(f'({col}::date <= ?::date)')
        else:
            parts.append(f'(date({col}) <= date(?))')
        params.append(df)
    return (' AND '.join(parts) if parts else ''), params


def _parse_dt_iso(val):
    if val is None or val == '':
        return None
    s = str(val).strip().replace('Z', '+00:00')
    if not s:
        return None
    try:
        if len(s) <= 10:
            return datetime.fromisoformat(s[:10] + 'T00:00:00')
        return datetime.fromisoformat(s[:19])
    except Exception:
        return None


def _duracao_minutos_entre(inicio, fim):
    d1, d2 = _parse_dt_iso(inicio), _parse_dt_iso(fim)
    if not d1 or not d2 or d2 < d1:
        return None
    return int((d2 - d1).total_seconds() // 60)


def _resolver_recebimento_wms(conn, recebimento_id=None, numero_nf=None):
    t_rec = _tbl(conn, 'wms_recebimento')
    if recebimento_id:
        row = conn.execute(f'SELECT * FROM {t_rec} WHERE id = ?', (int(recebimento_id),)).fetchone()
        if row:
            return _row_dict(row)
    nf = (numero_nf or '').strip()
    if nf:
        row = conn.execute(
            f'SELECT * FROM {t_rec} WHERE numero_nf = ? ORDER BY id DESC LIMIT 1',
            (nf,),
        ).fetchone()
        if row:
            return _row_dict(row)
    return None


def _mapa_destino_paletes_historico(pals, movs):
    """Etiqueta do palete → endereço onde foi/será guardado."""
    by_etq = {}
    for p in pals or []:
        rd = _row_dict(p) or {}
        etq = rd.get('etiqueta')
        if not etq:
            continue
        loc = (rd.get('codigo_endereco') or '').strip()
        if not loc and rd.get('loc_camara'):
            loc = _codigo_endereco(
                rd.get('loc_camara'), rd.get('loc_rua'),
                rd.get('loc_posicao'), rd.get('loc_nivel'),
            )
        if loc:
            by_etq[etq] = {
                'endereco': loc,
                'status': (rd.get('status') or '').lower() or '—',
            }
    for m in movs or []:
        rd = _row_dict(m) or {}
        etq = rd.get('palete_etiqueta')
        dest = (rd.get('destino_codigo') or '').strip()
        if not etq or not dest:
            continue
        cur = by_etq.get(etq)
        st_mov = (rd.get('status') or '').lower()
        if not cur:
            by_etq[etq] = {'endereco': dest, 'status': st_mov or 'pendente'}
        elif cur.get('status') != 'armazenado' and st_mov == 'concluida':
            by_etq[etq] = {'endereco': dest, 'status': 'armazenado'}
    return by_etq


def _filtrar_lista_historico_por_data(lista, campo_data, data_inicio=None, data_fim=None):
    if not data_inicio and not data_fim:
        return lista
    di = _parse_dt_iso(data_inicio)
    df = _parse_dt_iso(data_fim)
    if df and len(str(data_fim or '')) <= 10:
        df = df.replace(hour=23, minute=59, second=59)
    out = []
    for it in lista or []:
        dt = _parse_dt_iso((it or {}).get(campo_data))
        if not dt:
            continue
        if di and dt < di:
            continue
        if df and dt > df:
            continue
        out.append(it)
    return out


def _aplicar_filtros_historico_nf(data, filtros=None):
    filtros = filtros or {}
    sku_f = (filtros.get('sku') or '').strip().upper()
    prod_f = (filtros.get('produto') or filtros.get('descricao') or '').strip().lower()
    pal_f = (filtros.get('palete') or '').strip().upper()
    dest_f = (filtros.get('destino') or '').strip().upper()
    st_f = (filtros.get('status') or '').strip().lower()
    di = (filtros.get('data_inicio') or '').strip() or None
    df = (filtros.get('data_fim') or '').strip() or None

    if st_f and st_f not in ('', 'todos', 'all'):
        st_rec = ((data.get('recebimento') or {}).get('status') or '').lower()
        if st_f == 'finalizado' and st_rec != 'finalizado':
            data['filtro_sem_resultado'] = 'Nenhum recebimento finalizado para os critérios informados.'
            data['itens_bipados'] = []
            data['itens_nf'] = []
            data['movimentacoes'] = []
            data['paletes'] = []
            return data
        if st_f == 'andamento' and st_rec in ('finalizado', 'cancelado', 'concluido'):
            data['filtro_sem_resultado'] = 'Recebimento já encerrado — não está em andamento.'
            data['itens_bipados'] = []
            data['itens_nf'] = []
            data['movimentacoes'] = []
            data['paletes'] = []
            return data

    def _match_bip(it):
        if not it:
            return False
        if sku_f and sku_f not in (it.get('sku') or '').upper():
            return False
        if prod_f and prod_f not in (it.get('descricao') or '').lower():
            return False
        if pal_f and pal_f not in (it.get('palete_etiqueta') or '').upper():
            return False
        if dest_f:
            blob = ' '.join([
                str(it.get('endereco_destino') or ''),
                str(it.get('disposicao_rotulo') or ''),
                str(it.get('destino_resumo') or ''),
            ]).upper()
            if dest_f not in blob:
                return False
        return True

    tem_item_filtro = bool(sku_f or prod_f or pal_f or dest_f or di or df)
    if tem_item_filtro:
        bip = _filtrar_lista_historico_por_data(data.get('itens_bipados') or [], 'bipado_em', di, df)
        bip = [it for it in bip if _match_bip(it)]
        data['itens_bipados'] = bip
        etqs = {it.get('palete_etiqueta') for it in bip if it.get('palete_etiqueta')}
        if etqs:
            data['paletes'] = [p for p in (data.get('paletes') or []) if p.get('etiqueta') in etqs]
            data['movimentacoes'] = [
                m for m in (data.get('movimentacoes') or [])
                if m.get('palete_etiqueta') in etqs
            ]
        if sku_f:
            data['itens_nf'] = [
                it for it in (data.get('itens_nf') or [])
                if sku_f in (it.get('sku') or '').upper()
            ]
    data['filtros_aplicados'] = {k: v for k, v in filtros.items() if v}
    return data


def _historico_recebimento_nf(conn, recebimento_id=None, numero_nf=None, filtros=None):
    rec = _resolver_recebimento_wms(conn, recebimento_id=recebimento_id, numero_nf=numero_nf)
    if not rec:
        return None, 'Recebimento WMS não encontrado para esta NF.'
    rid = int(rec['id'])
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_loc = _tbl(conn, 'wms_localizacao')

    pals = conn.execute(
        f'''SELECT p.*, rp.estado_palete, rp.conferencia_cega,
                   l.codigo_endereco, l.camara AS loc_camara, l.rua AS loc_rua,
                   l.posicao AS loc_posicao, l.nivel AS loc_nivel
            FROM {t_rp} rp
            JOIN {t_pal} p ON p.id = rp.palete_id
            LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
            WHERE rp.recebimento_id = ?
            ORDER BY p.id''',
        (rid,),
    ).fetchall()

    itens = conn.execute(
        f'''SELECT i.*, p.etiqueta AS palete_etiqueta, p.status AS palete_status,
                   p.criado_por AS palete_criado_por
            FROM {t_item} i
            JOIN {t_pal} p ON p.id = i.palete_id
            JOIN {t_rp} rp ON rp.palete_id = p.id
            WHERE rp.recebimento_id = ?
            ORDER BY i.criado_em, i.id''',
        (rid,),
    ).fetchall()

    movs = conn.execute(
        f'''SELECT m.*, p.etiqueta AS palete_etiqueta,
                   lo.codigo_endereco AS origem_codigo,
                   ld.codigo_endereco AS destino_codigo
            FROM {t_mov} m
            JOIN {t_pal} p ON p.id = m.palete_id
            JOIN {t_rp} rp ON rp.palete_id = p.id
            LEFT JOIN {t_loc} lo ON lo.id = m.origem_localizacao_id
            LEFT JOIN {t_loc} ld ON ld.id = m.destino_localizacao_id
            WHERE rp.recebimento_id = ?
            ORDER BY m.criado_em, m.id''',
        (rid,),
    ).fetchall()

    _ensure_wms_palete_item_disposicao(conn)
    pal_dest_map = _mapa_destino_paletes_historico(pals, movs)

    paletes_out = []
    eventos = []
    ts_inicio = []
    ts_fim = []
    operadores = set()

    for p in pals or []:
        rd = _row_dict(p) or {}
        if rd.get('criado_por'):
            operadores.add(str(rd['criado_por']))
        if rd.get('criado_em'):
            ts_inicio.append(rd['criado_em'])
            eventos.append({
                'quando': rd['criado_em'],
                'tipo': 'palete_criado',
                'descricao': f"Palete {rd.get('etiqueta') or rd.get('id')} vinculado ao recebimento",
                'detalhe': f"Status: {rd.get('status') or '-'}",
                'usuario': rd.get('criado_por'),
            })
        loc_txt = rd.get('codigo_endereco') or ''
        if not loc_txt and rd.get('loc_camara'):
            loc_txt = f"{rd.get('loc_camara')}-{rd.get('loc_rua')}-{rd.get('loc_posicao')}-{rd.get('loc_nivel')}"
        paletes_out.append({
            'id': rd.get('id'),
            'etiqueta': rd.get('etiqueta'),
            'status': rd.get('status'),
            'estado_fisico': rd.get('estado_palete') or rd.get('estado_fisico'),
            'bloqueio_tipo': rd.get('bloqueio_tipo'),
            'endereco': loc_txt or None,
            'criado_em': rd.get('criado_em'),
            'atualizado_em': rd.get('atualizado_em'),
            'criado_por': rd.get('criado_por'),
        })
        if rd.get('status') == 'armazenado' and rd.get('atualizado_em'):
            ts_fim.append(rd['atualizado_em'])

    itens_out = []
    total_caixas = 0
    skus_unicos = set()
    for it in itens or []:
        rd = _row_dict(it) or {}
        q = int(rd.get('quantidade_caixas') or 0)
        total_caixas += q
        sku = (rd.get('sku') or '').strip()
        if sku:
            skus_unicos.add(sku.upper())
        if rd.get('criado_em'):
            ts_inicio.append(rd['criado_em'])
            ts_fim.append(rd['criado_em'])
        if rd.get('palete_criado_por'):
            operadores.add(str(rd['palete_criado_por']))
        etq = rd.get('palete_etiqueta')
        dest_info = pal_dest_map.get(etq) or {}
        endereco = dest_info.get('endereco')
        disp = rd.get('disposicao_estoque')
        disp_rot = _rotulo_disposicao_entrada(disp)
        dest_st = dest_info.get('status') or ''
        if endereco:
            dest_resumo = endereco
            if dest_st and dest_st not in ('armazenado', '—'):
                dest_resumo += f' ({dest_st})'
        elif disp and disp not in ('', 'normal', 'bom'):
            dest_resumo = disp_rot
        else:
            dest_resumo = '—'
        itens_out.append({
            'id': rd.get('id'),
            'n_item_nf': rd.get('n_item_nf'),
            'sku': sku,
            'descricao': rd.get('descricao'),
            'lote': rd.get('lote'),
            'data_producao': rd.get('data_producao'),
            'data_validade': rd.get('data_validade'),
            'quantidade_caixas': q,
            'rg_caixa': rd.get('rg_caixa'),
            'palete_etiqueta': etq,
            'palete_status': rd.get('palete_status'),
            'bipado_em': rd.get('criado_em'),
            'endereco_destino': endereco,
            'destino_status': dest_st or None,
            'disposicao': disp,
            'disposicao_rotulo': disp_rot,
            'destino_resumo': dest_resumo,
        })
        eventos.append({
            'quando': rd.get('criado_em'),
            'tipo': 'produto_bipado',
            'descricao': f"SKU {sku} — {q} cx no palete {rd.get('palete_etiqueta') or '-'}",
            'detalhe': f"Lote {rd.get('lote') or '-'} · Prod. {rd.get('data_producao') or '-'} · Val. {rd.get('data_validade') or '-'}",
            'usuario': rd.get('palete_criado_por'),
        })

    movs_out = []
    for m in movs or []:
        rd = _row_dict(m) or {}
        if rd.get('criado_por'):
            operadores.add(str(rd['criado_por']))
        if rd.get('concluida_por'):
            operadores.add(str(rd['concluida_por']))
        when = rd.get('concluida_em') or rd.get('criado_em')
        if rd.get('concluida_em'):
            ts_fim.append(rd['concluida_em'])
        movs_out.append({
            'id': rd.get('id'),
            'tipo': rd.get('tipo'),
            'status': rd.get('status'),
            'palete_etiqueta': rd.get('palete_etiqueta'),
            'origem': rd.get('origem_codigo'),
            'destino': rd.get('destino_codigo'),
            'observacao': rd.get('observacao'),
            'criado_em': rd.get('criado_em'),
            'concluida_em': rd.get('concluida_em'),
            'criado_por': rd.get('criado_por'),
            'concluida_por': rd.get('concluida_por'),
        })
        eventos.append({
            'quando': when,
            'tipo': 'movimentacao',
            'descricao': f"{rd.get('tipo') or 'mov.'} palete {rd.get('palete_etiqueta') or '-'} → {rd.get('destino_codigo') or '-'}",
            'detalhe': rd.get('observacao') or f"Status: {rd.get('status') or '-'}",
            'usuario': rd.get('concluida_por') or rd.get('criado_por'),
        })

    inicio_bip = min(ts_inicio) if ts_inicio else rec.get('criado_em')
    fim_bip = max(ts_fim) if ts_fim else rec.get('atualizado_em')
    dur_min = _duracao_minutos_entre(inicio_bip, fim_bip)

    terceiros = None
    doc_nf = None
    doc_id = rec.get('terceiros_documento_id')
    if doc_id:
        try:
            doc_nf, _err = _buscar_documento_terceiros_por_nf(conn, rec.get('numero_nf') or numero_nf)
            if doc_nf:
                terceiros = {
                    'documento_id': doc_nf.get('documento_id'),
                    'area': doc_nf.get('area'),
                    'motorista': doc_nf.get('motorista'),
                    'recebimento_concluido': doc_nf.get('recebimento_concluido'),
                    'quantidade_total_xml': doc_nf.get('quantidade_total_xml'),
                }
        except Exception:
            pass

    t_ctrl = _tbl(conn, 'wms_palete_controle')
    ctrl_rows = conn.execute(
        f'''SELECT c.*, p.etiqueta AS palete_etiqueta
            FROM {t_ctrl} c
            JOIN {t_pal} p ON p.id = c.palete_id
            JOIN {t_rp} rp ON rp.palete_id = p.id
            WHERE rp.recebimento_id = ?
            ORDER BY c.criado_em, c.id''',
        (rid,),
    ).fetchall()
    controle_out = []
    _lbl_ctrl = {'entrada': 'Entrada palete', 'saida': 'Saída palete', 'retorno': 'Retorno palete'}
    for c in ctrl_rows or []:
        rd = _row_dict(c) or {}
        controle_out.append(rd)
        tipo_c = rd.get('tipo') or ''
        det = []
        if rd.get('subtipo'):
            det.append(str(rd.get('subtipo')))
        if rd.get('motivo'):
            det.append('Motivo: ' + str(rd.get('motivo')))
        if rd.get('destino_externo'):
            det.append('Destino: ' + str(rd.get('destino_externo')))
        if rd.get('codigo_endereco'):
            det.append('Endereço: ' + str(rd.get('codigo_endereco')))
        eventos.append({
            'quando': rd.get('criado_em'),
            'tipo': 'controle_palete_' + tipo_c,
            'descricao': (_lbl_ctrl.get(tipo_c) or tipo_c) + ' — ' + str(rd.get('palete_etiqueta') or ''),
            'detalhe': ' · '.join(det) if det else (rd.get('observacao') or ''),
            'usuario': rd.get('criado_por'),
        })

    eventos = [e for e in eventos if e.get('quando')]
    eventos.sort(key=lambda e: str(e.get('quando') or ''))

    resumo_nf = []
    situacao = None
    if terceiros and doc_id:
        doc_enr = _enriquecer_documento_nf_wms(conn, doc_nf) if doc_nf else None
        if doc_enr:
            situacao = doc_enr.get('situacao_recebimento')
            for it in doc_enr.get('itens') or []:
                resumo_nf.append({
                    'n_item': it.get('n_item'),
                    'sku': it.get('sku'),
                    'descricao': it.get('descricao'),
                    'quantidade_xml': it.get('quantidade_xml'),
                    'quantidade_wms': it.get('quantidade_wms'),
                    'quantidade_armazenada': it.get('quantidade_armazenada'),
                    'pendente_wms': it.get('pendente_wms'),
                    'status_wms': it.get('status_wms'),
                    'codigo_ean': it.get('codigo_ean'),
                    'resumo_andamento': it.get('resumo_andamento'),
                    'destinos_wms': it.get('destinos_wms') or [],
                })

    out = {
        'recebimento': rec,
        'terceiros': terceiros,
        'situacao_recebimento': situacao,
        'periodo': {
            'inicio_bipagem': inicio_bip,
            'fim_bipagem': fim_bip,
            'duracao_minutos': dur_min,
            'criado_em': rec.get('criado_em'),
            'atualizado_em': rec.get('atualizado_em'),
            'criado_por': rec.get('criado_por'),
            'operadores': sorted(operadores),
        },
        'totais': {
            'paletes': len(paletes_out),
            'linhas_bipagem': len(itens_out),
            'skus_unicos': len(skus_unicos),
            'caixas_bipadas': total_caixas,
            'movimentacoes': len(movs_out),
        },
        'itens_nf': resumo_nf,
        'paletes': paletes_out,
        'itens_bipados': itens_out,
        'movimentacoes': movs_out,
        'controle_paletes': controle_out,
        'linha_do_tempo': eventos,
    }
    out = _aplicar_filtros_historico_nf(out, filtros)
    return out, None


def _relatorio_wms(conn, tipo, data_inicio=None, data_fim=None, extra=None):
    extra = extra or {}
    t_rec = _tbl(conn, 'wms_recebimento')
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_loc = _tbl(conn, 'wms_localizacao')
    tipo = (tipo or 'recebimentos').strip().lower()

    if tipo == 'recebimentos':
        filtro, params = _sql_filtro_periodo(conn, 'r.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT r.id, r.numero_nf, r.fornecedor, r.placa, r.status, r.origem,
                       r.criado_em, r.atualizado_em, r.criado_por,
                       COUNT(DISTINCT rp.palete_id) AS qtd_paletes,
                       COALESCE(SUM(i.quantidade_caixas), 0) AS qtd_caixas
                FROM {t_rec} r
                LEFT JOIN {t_rp} rp ON rp.recebimento_id = r.id
                LEFT JOIN {t_item} i ON i.palete_id = rp.palete_id
                {where}
                GROUP BY r.id
                ORDER BY r.id DESC
                LIMIT 500''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Recebimentos WMS por período', 'colunas': [
            'id', 'numero_nf', 'fornecedor', 'placa', 'status', 'origem', 'qtd_paletes', 'qtd_caixas',
            'criado_em', 'atualizado_em', 'criado_por',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'bipagem_itens':
        filtro, params = _sql_filtro_periodo(conn, 'i.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT i.criado_em AS bipado_em, r.numero_nf, r.fornecedor, p.etiqueta AS palete,
                       i.sku, i.descricao, i.lote, i.data_producao, i.data_validade,
                       i.quantidade_caixas, p.criado_por
                FROM {t_item} i
                JOIN {t_pal} p ON p.id = i.palete_id
                LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
                {where}
                ORDER BY i.criado_em DESC
                LIMIT 2000''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Itens bipados (detalhe)', 'colunas': [
            'bipado_em', 'numero_nf', 'fornecedor', 'palete', 'sku', 'descricao', 'lote',
            'data_producao', 'data_validade', 'quantidade_caixas', 'criado_por',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'paletes':
        filtro, params = _sql_filtro_periodo(conn, 'p.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT p.etiqueta, p.status, r.numero_nf, l.codigo_endereco AS endereco,
                       p.criado_em, p.atualizado_em, p.criado_por, p.bloqueio_tipo
                FROM {t_pal} p
                LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
                LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
                {where}
                ORDER BY p.id DESC
                LIMIT 2000''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Paletes criados / armazenados', 'colunas': [
            'etiqueta', 'status', 'numero_nf', 'endereco', 'criado_em', 'atualizado_em', 'criado_por', 'bloqueio_tipo',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'movimentacoes':
        filtro, params = _sql_filtro_periodo(conn, 'm.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT m.tipo, m.status, p.etiqueta AS palete, lo.codigo_endereco AS origem,
                       ld.codigo_endereco AS destino, m.criado_em, m.concluida_em,
                       m.criado_por, m.concluida_por, m.observacao
                FROM {t_mov} m
                JOIN {t_pal} p ON p.id = m.palete_id
                LEFT JOIN {t_loc} lo ON lo.id = m.origem_localizacao_id
                LEFT JOIN {t_loc} ld ON ld.id = m.destino_localizacao_id
                {where}
                ORDER BY m.id DESC
                LIMIT 2000''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Movimentações WMS', 'colunas': [
            'tipo', 'status', 'palete', 'origem', 'destino', 'criado_em', 'concluida_em',
            'criado_por', 'concluida_por', 'observacao',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'produtos_recebidos':
        filtro, params = _sql_filtro_periodo(conn, 'i.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT i.sku, MAX(i.descricao) AS descricao,
                       SUM(COALESCE(i.quantidade_caixas, 0)) AS total_caixas,
                       COUNT(*) AS linhas_bipagem,
                       COUNT(DISTINCT p.id) AS paletes,
                       MIN(i.data_producao) AS prod_mais_antiga,
                       MAX(i.data_validade) AS validade_max
                FROM {t_item} i
                JOIN {t_pal} p ON p.id = i.palete_id
                {where}
                GROUP BY i.sku
                ORDER BY total_caixas DESC
                LIMIT 500''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Produtos recebidos (consolidado por SKU)', 'colunas': [
            'sku', 'descricao', 'total_caixas', 'linhas_bipagem', 'paletes',
            'prod_mais_antiga', 'validade_max',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'operadores':
        filtro, params = _sql_filtro_periodo(conn, 'i.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT COALESCE(p.criado_por, '—') AS operador,
                       COUNT(DISTINCT i.id) AS itens_bipados,
                       SUM(COALESCE(i.quantidade_caixas, 0)) AS caixas,
                       COUNT(DISTINCT p.id) AS paletes
                FROM {t_item} i
                JOIN {t_pal} p ON p.id = i.palete_id
                {where}
                GROUP BY COALESCE(p.criado_por, '—')
                ORDER BY itens_bipados DESC''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Produtividade por operador', 'colunas': [
            'operador', 'itens_bipados', 'caixas', 'paletes',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'ocupacao':
        camaras = _ocupacao_camara(conn)
        return {'tipo': tipo, 'titulo': 'Ocupação por câmara (snapshot)', 'colunas': [
            'camara', 'descricao', 'total_posicoes', 'cadastradas', 'ocupadas', 'vazias', 'ocupacao_pct',
        ], 'linhas': camaras}

    if tipo == 'nfs_pendentes':
        rows = conn.execute(
            f'''SELECT r.id, r.numero_nf, r.fornecedor, r.placa, r.status, r.criado_em,
                       COALESCE(SUM(i.quantidade_caixas), 0) AS qtd_bipada
                FROM {t_rec} r
                LEFT JOIN {t_rp} rp ON rp.recebimento_id = r.id
                LEFT JOIN {t_item} i ON i.palete_id = rp.palete_id
                WHERE r.status NOT IN ('finalizado', 'concluido')
                GROUP BY r.id
                ORDER BY r.id DESC
                LIMIT 200''',
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'NFs / recebimentos em aberto', 'colunas': [
            'id', 'numero_nf', 'fornecedor', 'placa', 'status', 'qtd_bipada', 'criado_em',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    t_ctrl = _tbl(conn, 'wms_palete_controle')
    if tipo == 'controle_paletes':
        filtro, params = _sql_filtro_periodo(conn, 'c.criado_em', data_inicio, data_fim)
        where = ('WHERE ' + filtro) if filtro else ''
        rows = conn.execute(
            f'''SELECT c.criado_em, c.tipo, c.subtipo, c.motivo, c.destino_externo,
                       c.codigo_endereco, c.observacao, c.criado_por,
                       p.etiqueta AS palete, p.status AS status_palete, r.numero_nf
                FROM {t_ctrl} c
                JOIN {t_pal} p ON p.id = c.palete_id
                LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
                {where}
                ORDER BY c.id DESC
                LIMIT 3000''',
            tuple(params),
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Entrada / saída / retorno de paletes', 'colunas': [
            'criado_em', 'tipo', 'subtipo', 'palete', 'status_palete', 'numero_nf',
            'motivo', 'destino_externo', 'codigo_endereco', 'observacao', 'criado_por',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    if tipo == 'paletes_fora':
        rows = conn.execute(
            f'''SELECT p.etiqueta, p.status, l.codigo_endereco AS ultimo_endereco,
                       s.criado_em AS saida_em, s.motivo AS motivo_saida,
                       s.destino_externo, s.criado_por AS operador_saida, r.numero_nf
                FROM {t_pal} p
                JOIN {t_ctrl} s ON s.id = (
                    SELECT c.id FROM {t_ctrl} c
                    WHERE c.palete_id = p.id AND c.tipo = 'saida'
                      AND NOT EXISTS (
                        SELECT 1 FROM {t_ctrl} r2
                        WHERE r2.tipo = 'retorno' AND r2.registro_saida_id = c.id
                      )
                    ORDER BY c.id DESC LIMIT 1
                )
                LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
                LEFT JOIN {t_rec} r ON r.id = p.recebimento_id
                ORDER BY s.criado_em DESC
                LIMIT 500''',
        ).fetchall()
        return {'tipo': tipo, 'titulo': 'Paletes fora do armazém (saída sem retorno)', 'colunas': [
            'etiqueta', 'status', 'numero_nf', 'ultimo_endereco', 'saida_em',
            'motivo_saida', 'destino_externo', 'operador_saida',
        ], 'linhas': [_row_dict(r) for r in rows or []]}

    return None


def _painel_shell_layout():
    """Estrutura imediata (câmaras + zoneamento) a partir do layout JSON — sem DB."""
    refs = _map_totais_ref_camaras()
    camaras = []
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cod = int(bloco.get('codigo') or 0)
        if cod not in _WMS_CAMARAS_ESTOQUE:
            continue
        tot = int(refs.get(cod) or bloco.get('total_posicoes') or 0)
        camaras.append({
            'camara': cod,
            'descricao': bloco.get('descricao') or ('Câmara %s' % cod),
            'total_posicoes': tot,
            'cadastradas': 0,
            'ocupadas': 0,
            'vazias': tot,
            'ocupacao_pct': 0.0,
        })
    for cod, desc, tot in ((98, 'Quarentena', 0), (99, 'Stage', 0)):
        camaras.append({
            'camara': cod,
            'descricao': desc,
            'total_posicoes': tot,
            'cadastradas': 0,
            'ocupadas': 0,
            'vazias': 0,
            'ocupacao_pct': 0.0,
        })
    nomes = {c['camara']: c['descricao'] for c in camaras}
    zone = []
    for cat, cam, pri in (
        ('A', 6, 1), ('A', 7, 2),
        ('B', 6, 1), ('B', 7, 2),
        ('C', 7, 1), ('C', 14, 2),
        ('D', 14, 1), ('D', 15, 2),
    ):
        zone.append({
            'categoria': cat,
            'camara': cam,
            'prioridade': pri,
            'camara_descricao': nomes.get(cam) or ('Câmara %s' % cam),
        })
    return camaras, zone


def _painel_payload_shell(**extra):
    cams, zone = _painel_shell_layout()
    base = {
        'ok': True,
        'camaras': cams,
        'distribuicao_categoria': [],
        'zoneamento': zone,
        'sequencia_rota': _listar_sequencia_rota(None),
        'pesos_categoria': {'A': 1, 'B': 1, 'C': 1, 'D': 1},
        'pesos_posicoes_categoria': {'A': 1, 'B': 1, 'C': 1, 'D': 1},
        'resumo_status_planejamento': {},
        'fonte_estoque': 'wms',
        'movimentacoes_pendentes': 0,
        'recebimentos_abertos': 0,
        'inventarios_ativos': 0,
        'paletes_fora_armazem': 0,
        'cache_ttl_sec': _WMS_PAINEL_TTL_SEC,
        'shell': True,
    }
    base.update(extra or {})
    return base


@bp.route('/painel', methods=['GET'])
def api_wms_painel():
    import time as _time

    force = str(request.args.get('force') or '').strip().lower() in ('1', 'true', 'sim')
    leve = str(request.args.get('leve') or '').strip().lower() in ('1', 'true', 'sim')
    now = _time.time()
    cached = _WMS_PAINEL_CACHE.get('payload')
    if (
        not force
        and not leve
        and cached
        and (cached.get('camaras') or cached.get('zoneamento'))
        and (now - float(_WMS_PAINEL_CACHE.get('ts') or 0)) < _WMS_PAINEL_TTL_SEC
    ):
        return jsonify(cached)

    # leve=1: cache útil ou shell de layout (nunca resposta vazia).
    if leve:
        if cached and (cached.get('camaras') or cached.get('zoneamento')):
            out = dict(cached)
            out['ok'] = True
            out['leve'] = True
            return jsonify(out)
        shell = _painel_payload_shell(leve=True)
        return jsonify(shell)

    conn = None
    try:
        conn = _db()
    except Exception as e:
        shell = _painel_payload_shell(aviso='db_indisponivel: %s' % e)
        return jsonify(shell)

    # NÃO roda ensure_wms_schema pesado aqui — só marca ready se tabelas já existem.
    global _WMS_SCHEMA_READY
    try:
        if not _WMS_SCHEMA_READY and _wms_tabelas_existem(conn):
            _WMS_SCHEMA_READY = True
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass

    def _safe(label, fn, default):
        try:
            return fn()
        except Exception as exc:
            try:
                print('[wms/painel] %s falhou: %s' % (label, exc), flush=True)
            except Exception:
                pass
            try:
                conn.rollback()
            except Exception:
                pass
            return default

    try:
        if not _wms_tabelas_existem(conn):
            try:
                conn.close()
            except Exception:
                pass
            return jsonify(_painel_payload_shell(aviso='schema_pendente'))

        pair = _safe('ocup_dist', lambda: _painel_ocupacao_e_dist(conn), ([], []))
        camaras = pair[0] if isinstance(pair, (list, tuple)) and len(pair) == 2 else []
        dist_cat = pair[1] if isinstance(pair, (list, tuple)) and len(pair) == 2 else []
        zoneamento = _safe('zoneamento', lambda: _listar_zoneamento(conn), [])
        shell_cams, shell_zone = _painel_shell_layout()
        if not camaras:
            camaras = shell_cams
        if not zoneamento:
            zoneamento = shell_zone

        t_mov = _tbl(conn, 'wms_movimentacao')
        t_rec = _tbl(conn, 'wms_recebimento')
        t_inv = _tbl(conn, 'wms_inventario')
        t_prod = _tbl(conn, 'wms_produto_enderecamento')

        pesos_pos_rows = _safe(
            'pesos_pos',
            lambda: conn.execute(
                f'''SELECT UPPER(SUBSTR(categoria, 1, 1)) AS cat,
                           SUM(COALESCE(NULLIF(posicoes_med, 0), 1)) AS posicoes
                    FROM {t_prod} WHERE {_ativo_sql(conn)}
                    GROUP BY UPPER(SUBSTR(categoria, 1, 1))'''
            ).fetchall(),
            [],
        )
        pesos_pos = {}
        for r in pesos_pos_rows or []:
            rd = _row_dict(r) or {}
            cat = (rd.get('cat') or '').strip().upper()
            if cat in ('A', 'B', 'C', 'D'):
                pesos_pos[cat] = int(rd.get('posicoes') or 0)
        if not pesos_pos:
            pesos_pos = {'A': 1, 'B': 1, 'C': 1, 'D': 1}

        kpi_row = _safe(
            'kpis',
            lambda: conn.execute(
                f'''SELECT
                        (SELECT COUNT(*) FROM {t_mov} WHERE status = 'pendente') AS mov_pend,
                        (SELECT COUNT(*) FROM {t_rec}
                         WHERE status NOT IN ('finalizado', 'cancelado')) AS rec_abertos,
                        (SELECT COUNT(*) FROM {t_inv}
                         WHERE status IN ('ativo', 'em_andamento')) AS inv_ativos'''
            ).fetchone(),
            None,
        )
        kpi = _row_dict(kpi_row) or {}
        completo = str(request.args.get('completo') or '').strip().lower() in ('1', 'true', 'sim')
        paletes_fora = (
            _safe('paletes_fora', lambda: _contar_paletes_fora(conn), 0) if completo else 0
        )
        resumo_status = _safe('resumo_status', lambda: _resumo_status_planejamento(conn), {})
        sequencia_rota = _safe('sequencia_rota', lambda: _listar_sequencia_rota(conn), [])

        try:
            conn.close()
        except Exception:
            pass
        payload = {
            'ok': True,
            'camaras': camaras,
            'distribuicao_categoria': dist_cat,
            'zoneamento': zoneamento,
            'sequencia_rota': sequencia_rota,
            'pesos_categoria': dict(pesos_pos),
            'pesos_posicoes_categoria': pesos_pos,
            'resumo_status_planejamento': resumo_status,
            'fonte_estoque': 'wms',
            'movimentacoes_pendentes': int(kpi.get('mov_pend') or 0),
            'recebimentos_abertos': int(kpi.get('rec_abertos') or 0),
            'inventarios_ativos': int(kpi.get('inv_ativos') or 0),
            'paletes_fora_armazem': paletes_fora,
            'cache_ttl_sec': _WMS_PAINEL_TTL_SEC,
            'shell': False,
        }
        _WMS_PAINEL_CACHE['ts'] = now
        _WMS_PAINEL_CACHE['payload'] = payload
        return jsonify(payload)
    except Exception as e:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass
        shell = _painel_payload_shell(aviso=str(e))
        return jsonify(shell)


@bp.route('/layout/gerar', methods=['POST'])
def api_wms_layout_gerar():
    conn = _db()
    ensure_wms_schema(conn)
    data = request.get_json() or {}
    force = bool(data.get('force'))
    try:
        result = gerar_layout_enderecos(conn, force=force)
        _invalidate_wms_painel_cache()
        conn.close()
        return jsonify(result)
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


def _format_locacao_leve(loc):
    """Formatação rápida para lista (sem ler layout JSON por linha)."""
    d = _row_dict(loc) or {}
    cam = int(d.get('camara') or 0)
    pos = int(d.get('posicao') or 0)
    niv = int(d.get('nivel') or 1)
    rua = str(d.get('rua') or '').strip().upper()
    zona = (d.get('zona_armazenagem') or ('picking' if niv == 1 else 'pulmao')).strip().lower()
    cod = (d.get('codigo_endereco') or _codigo_endereco(cam, rua or 'A', pos or 1, niv)).upper()
    return {
        'camara': cam,
        'rua': rua,
        'posicao': pos,
        'nivel': niv,
        'codigo_endereco': cod,
        'codigo_wms': cod,
        'barcode_longarina': _barcode_longarina(cam, pos, niv, rua=rua),
        'status': (d.get('status') or 'vazia'),
        'area': d.get('area') or '',
        'categoria_zona': (d.get('categoria_zona') or '').strip().upper(),
        'zona_armazenagem': zona,
        'tipo': (d.get('tipo') or 'porta_palete'),
    }


def _localizacoes_fallback_layout(camara=None, limite=200):
    """Lista a partir do layout JSON quando o banco falha ou está vazio."""
    out = []
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cod = int(bloco.get('codigo') or 0)
        if cod not in _WMS_CAMARAS_ESTOQUE:
            continue
        if camara and cod != int(camara):
            continue
        try:
            coords = _coords_from_bloco_layout(bloco)
        except Exception:
            coords = []
        for _c, rua, pos, niv, dest_acao, _lbl, _ar in coords:
            if dest_acao:
                continue
            out.append(_format_locacao_leve({
                'camara': cod,
                'rua': rua,
                'posicao': pos,
                'nivel': niv,
                'codigo_endereco': _codigo_endereco(cod, rua, pos, niv),
                'status': 'vazia',
                'zona_armazenagem': 'picking' if int(niv) == 1 else 'pulmao',
                'tipo': 'porta_palete',
            }))
            if len(out) >= limite:
                return out
    return out


@bp.route('/localizacoes', methods=['GET'])
def api_wms_localizacoes():
    """Lista endereços — path leve (sem schema/seed/regeneração de layout)."""
    camara = request.args.get('camara', type=int)
    status = (request.args.get('status') or '').strip()
    categoria = (request.args.get('categoria') or '').strip().upper()
    q = (request.args.get('q') or '').strip()
    limite = request.args.get('limite', type=int) or 200
    limite = max(1, min(int(limite), 400))
    conn = None
    try:
        conn = _db()
        t = _tbl(conn, 'wms_localizacao')
        sql = (
            f'SELECT camara, rua, posicao, nivel, codigo_endereco, status, area, '
            f'categoria_zona, zona_armazenagem, tipo FROM {t} WHERE 1=1'
        )
        params = []
        if camara:
            sql += ' AND camara = ?'
            params.append(camara)
        if categoria:
            sql += ' AND UPPER(TRIM(categoria_zona)) = ?'
            params.append(categoria)
        if status:
            sql += ' AND status = ?'
            params.append(status)
        if q:
            like = f'%{q}%'
            if _is_pg(conn):
                sql += ' AND (codigo_endereco ILIKE ? OR rua ILIKE ?)'
            else:
                sql += ' AND (codigo_endereco LIKE ? OR rua LIKE ?)'
            params.extend([like, like])
        # LIMIT literal — evita problemas de bind em alguns adapters.
        sql += ' ORDER BY camara, rua, posicao, nivel LIMIT %d' % limite
        try:
            rows = conn.execute(sql, tuple(params)).fetchall()
        except Exception as qerr:
            try:
                print('[wms/localizacoes] query:', qerr, flush=True)
            except Exception:
                pass
            try:
                conn.rollback()
            except Exception:
                pass
            rows = []

        locs = [_format_locacao_leve(r) for r in (rows or [])]
        fonte = 'banco'
        if not locs:
            locs = _localizacoes_fallback_layout(camara=camara, limite=limite)
            fonte = 'layout'
            if status:
                locs = [x for x in locs if (x.get('status') or '') == status]
            if categoria:
                locs = [x for x in locs if (x.get('categoria_zona') or '') == categoria]
            if q:
                qq = q.upper()
                locs = [
                    x for x in locs
                    if qq in (x.get('codigo_endereco') or '') or qq in (x.get('rua') or '')
                ]
            locs = locs[:limite]

        return jsonify({
            'ok': True,
            'localizacoes': locs,
            'total': len(locs),
            'limite': limite,
            'fonte': fonte,
        })
    except Exception as e:
        try:
            print('[wms/localizacoes] erro:', e, flush=True)
        except Exception:
            pass
        # Último recurso: layout puro, sem banco.
        try:
            locs = _localizacoes_fallback_layout(camara=camara, limite=limite)
            return jsonify({
                'ok': True,
                'localizacoes': locs,
                'total': len(locs),
                'limite': limite,
                'fonte': 'layout',
                'aviso': str(e),
            })
        except Exception:
            return jsonify({'erro': str(e)}), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _build_mapa_layout_payload(por_codigo=None, camara_filtro=None):
    """Monta JSON de layout (câmaras + slots). por_codigo opcional: status do banco."""
    por_codigo = por_codigo or {}
    cfg = _layout_camaras_config()
    camaras_out = []
    for bloco in (cfg.get('camaras') or []):
        cod_cam = int(bloco.get('codigo') or 0)
        if cod_cam not in _WMS_CAMARAS_ESTOQUE:
            continue
        if camara_filtro and cod_cam != camara_filtro:
            continue
        slots = []
        for c, rua, pos, niv, dest_acao, dest_lbl, apenas_rotulo in _coords_from_bloco_layout(bloco):
            cod_end = _codigo_endereco(c, rua, pos, niv)
            loc = por_codigo.get(cod_end, {})
            flex_reent = _slot_reentrega_ou_estoque_flexivel(dest_acao, apenas_rotulo)
            dest = dest_acao
            lbl = dest_lbl
            if flex_reent:
                dest = None
                lbl = None
                apenas_rotulo = False
            if not lbl and dest:
                lbl = _destinos_acao_labels().get(dest)
            slots.append({
                'rua': rua,
                'posicao': pos,
                'nivel': niv,
                'codigo_endereco': cod_end,
                'barcode_longarina': _barcode_longarina(cod_cam, pos, niv, rua=rua),
                'status': (loc.get('status') or 'vazia').strip().lower(),
                'categoria_zona': (loc.get('categoria_zona') or '').strip().upper() or None,
                'zona_armazenagem': (loc.get('zona_armazenagem') or _zona_por_nivel(niv)).lower(),
                'destino_acao': dest,
                'destino_label': lbl,
                'destino_apenas_rotulo': bool(apenas_rotulo and dest),
                'zona_reentrega_ou_estoque': flex_reent,
                'tipo': 'destino_fixo' if dest else 'porta_palete',
            })
        pool = bloco.get('pool_reentrega_ou_estoque')
        camaras_out.append({
            'codigo': cod_cam,
            'descricao': bloco.get('descricao') or f'Câmara {cod_cam}',
            'ruas': list(bloco.get('ruas') or []),
            'niveis': int(bloco.get('niveis') or 5),
            'portas': _portas_bloco(bloco),
            'pool_reentrega_ou_estoque': pool,
            'slots': slots,
        })
    return {
        'camaras': camaras_out,
        'destinos_acao': cfg.get('destinos_acao') or _destinos_acao_labels(),
        'bloqueios_fisicos': cfg.get('bloqueios_fisicos') or _layout_bloqueios_fisicos(),
    }


@bp.route('/mapa-3d/layout', methods=['GET'])
def api_wms_mapa_3d_layout():
    """Layout físico sem banco — resposta rápida para planta 2D (status vazia até merge)."""
    try:
        camara_filtro = request.args.get('camara', type=int)
        return jsonify(_sanitize_json(_build_mapa_layout_payload(camara_filtro=camara_filtro)))
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@bp.route('/mapa-3d', methods=['GET'])
def api_wms_mapa_3d():
    """Layout físico + ocupação para visualização 3D (JSON + merge com banco)."""
    conn = _db()
    try:
        _ensure_wms_schema_safe(conn)
        _seed_wms_defaults(conn)
        camara_filtro = request.args.get('camara', type=int)
        t = _tbl(conn, 'wms_localizacao')
        sql = (
            f'SELECT camara, rua, posicao, nivel, codigo_endereco, status, area, '
            f'categoria_zona, zona_armazenagem, tipo FROM {t} WHERE camara IN ({_WMS_CAMARAS_ESTOQUE_SQL})'
        )
        params = []
        if camara_filtro:
            sql += ' AND camara = ?'
            params.append(camara_filtro)
        rows = conn.execute(sql, tuple(params)).fetchall()
        por_codigo = {}
        for r in rows:
            d = _row_dict(r) or {}
            cod = (d.get('codigo_endereco') or '').strip()
            if cod:
                por_codigo[cod] = d
        conn.close()
        return jsonify(_sanitize_json(_build_mapa_layout_payload(por_codigo, camara_filtro)))
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


def _vencimento_por_shelf(data_producao, shelf_dias):
    """Calcula vencimento a partir da fabricação + shelf_dias quando não há data_validade."""
    if not data_producao or shelf_dias is None:
        return None
    try:
        dias = int(shelf_dias)
    except (TypeError, ValueError):
        return None
    if dias <= 0:
        return None
    txt = str(data_producao).strip()[:10]
    if not txt:
        return None
    try:
        from datetime import datetime, timedelta
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
            try:
                base = datetime.strptime(txt, fmt)
                return (base + timedelta(days=dias)).strftime('%Y-%m-%d')
            except ValueError:
                continue
    except Exception:
        pass
    return None


def _listar_estoque_armazenado_wms(conn, categoria=None, q=None, camara=None, limite=5000):
    """Linhas de estoque real: palete armazenado + item + endereço (câmara/rua/coluna/nível)."""
    _ensure_wms_palete_item_disposicao(conn)
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    t_prod = _tbl(conn, 'wms_produto_enderecamento')
    bloq_off = _bloqueio_off_sql(conn, 'l.bloqueio_saida')
    sql = f'''SELECT i.sku, i.descricao, i.lote, i.rg_caixa, i.data_producao, i.data_validade,
                     i.shelf_dias, i.quantidade_caixas,
                     l.camara, l.rua, l.posicao, l.nivel, l.codigo_endereco,
                     p.etiqueta AS palete_etiqueta,
                     pr.categoria
              FROM {t_item} i
              INNER JOIN {t_pal} p ON p.id = i.palete_id
              INNER JOIN {t_loc} l ON l.id = p.localizacao_id
              LEFT JOIN {t_prod} pr ON pr.sku = i.sku AND {_ativo_sql(conn, 'pr')}
              WHERE p.status = 'armazenado'
                AND l.status = 'ocupada'
                AND (p.bloqueio_tipo IS NULL OR TRIM(COALESCE(p.bloqueio_tipo, '')) = '')
                AND {bloq_off}
                AND COALESCE(i.quantidade_caixas, 0) > 0'''
    params = []
    if camara is not None:
        sql += ' AND l.camara = ?'
        params.append(int(camara))
    cat = (categoria or '').strip().upper()
    if cat:
        sql += ' AND UPPER(TRIM(COALESCE(pr.categoria, \'\'))) = ?'
        params.append(cat)
    qtxt = (q or '').strip()
    if qtxt:
        like = f'%{qtxt}%'
        if _is_pg(conn):
            sql += ''' AND (i.sku ILIKE ? OR i.descricao ILIKE ? OR i.lote ILIKE ?
                     OR COALESCE(i.rg_caixa, '') ILIKE ? OR l.codigo_endereco ILIKE ?)'''
        else:
            sql += ''' AND (i.sku LIKE ? OR i.descricao LIKE ? OR i.lote LIKE ?
                     OR COALESCE(i.rg_caixa, '') LIKE ? OR l.codigo_endereco LIKE ?)'''
        params.extend([like, like, like, like, like])
    sql += ' ORDER BY l.camara, l.rua, l.posicao, l.nivel, i.sku, i.lote'
    sql += f' LIMIT {int(limite)}'
    rows = conn.execute(sql, tuple(params)).fetchall()
    out = []
    for r in rows or []:
        rd = _row_dict(r) or {}
        loc = _format_locacao(rd)
        data_validade = rd.get('data_validade')
        data_vencimento = data_validade or _vencimento_por_shelf(rd.get('data_producao'), rd.get('shelf_dias'))
        pos = rd.get('posicao')
        out.append({
            'camara': rd.get('camara'),
            'rua': str(rd.get('rua') or '').upper(),
            'posicao': pos,
            'coluna': pos,
            'nivel': rd.get('nivel'),
            'codigo_endereco': loc.get('codigo_wms') or rd.get('codigo_endereco'),
            'sku': rd.get('sku') or '',
            'codigo': rd.get('sku') or '',
            'descricao': rd.get('descricao') or '',
            'quantidade': int(rd.get('quantidade_caixas') or 0),
            'data_fabricacao': rd.get('data_producao'),
            'data_validade': data_validade,
            'data_vencimento': data_vencimento,
            'up': rd.get('rg_caixa') or '',
            'lote': rd.get('lote') or '',
            'categoria': rd.get('categoria') or '',
            'palete': rd.get('palete_etiqueta') or '',
        })
    return out


@bp.route('/camara/<int:codigo>/itens', methods=['GET'])
def api_wms_camara_itens(codigo):
    """Itens armazenados em uma câmara (paletes armazenados com endereço)."""
    conn = _db()
    ensure_wms_schema(conn)
    try:
        itens = _listar_estoque_armazenado_wms(conn, camara=codigo, limite=10000)
        total_qtd = sum(int(i.get('quantidade') or 0) for i in itens)
        conn.close()
        return jsonify({
            'camara': codigo,
            'itens': itens,
            'total_linhas': len(itens),
            'total_quantidade': total_qtd,
            'fonte_estoque': 'wms',
        })
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/produtos', methods=['GET'])
def api_wms_produtos():
    cat = (request.args.get('categoria') or '').strip().upper()
    q = (request.args.get('q') or '').strip()
    sync = (request.args.get('sync') or '').strip().lower() in ('1', 'sim', 'true', 'yes')
    conn = None
    try:
        conn = _db()
        if not _WMS_SCHEMA_READY:
            try:
                ensure_wms_schema(conn)
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        if sync:
            try:
                _sync_all_produtos_estoque_cache(conn)
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        estoque = _listar_estoque_armazenado_wms(conn, categoria=cat or None, q=q or None)
        return jsonify({
            'ok': True,
            'estoque': estoque,
            'total_linhas': len(estoque),
            'fonte_estoque': 'wms',
        })
    except Exception as e:
        return jsonify({'ok': True, 'estoque': [], 'total_linhas': 0, 'fonte_estoque': 'wms', 'aviso': str(e)})
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


@bp.route('/analise/ocupacao', methods=['GET'])
def api_wms_analise_ocupacao():
    conn = _db()
    ensure_wms_schema(conn)
    try:
        camaras = request.args.get('camaras', ','.join(str(c) for c in _WMS_CAMARAS_PRINCIPAIS))
        cam_list = tuple(int(x.strip()) for x in str(camaras).split(',') if x.strip().isdigit()) or _WMS_CAMARAS_PRINCIPAIS
        data = _coletar_resumo_ocupacao_wms(conn, camaras=cam_list)
        conn.close()
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/analise/estoque-seguranca', methods=['GET'])
def api_wms_analise_estoque_seguranca():
    conn = _db()
    ensure_wms_schema(conn)
    try:
        cat = (request.args.get('categoria') or '').strip().upper() or None
        sync = (request.args.get('sync') or '1').strip().lower() in ('1', 'sim', 'true', 'yes')
        data = _listar_estoque_seguranca_wms(conn, categoria=cat, sync=sync)
        data['fonte'] = 'wms'
        conn.close()
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/analise/shelf-life', methods=['GET'])
def api_wms_analise_shelf_life():
    conn = _db()
    ensure_wms_schema(conn)
    try:
        cat = (request.args.get('categoria') or '').strip().upper() or None
        data = _listar_shelf_life_wms(conn, categoria=cat)
        data['fonte'] = 'wms'
        conn.close()
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/analise/visao-cruzada', methods=['GET'])
def api_wms_analise_visao_cruzada():
    conn = _db()
    ensure_wms_schema(conn)
    try:
        cat = (request.args.get('categoria') or '').strip().upper() or None
        sync = (request.args.get('sync') or '1').strip().lower() in ('1', 'sim', 'true', 'yes')
        data = _listar_visao_cruzada_wms(conn, categoria=cat, sync=sync)
        data['fonte'] = 'wms'
        conn.close()
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/paletes', methods=['GET', 'POST'])
def api_wms_paletes():
    conn = _db()
    ensure_wms_schema(conn)
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_loc = _tbl(conn, 'wms_localizacao')

    if request.method == 'GET':
        etiqueta = (request.args.get('etiqueta') or '').strip()
        try:
            if etiqueta:
                pal = conn.execute(f'SELECT * FROM {t_pal} WHERE etiqueta = ?', (etiqueta,)).fetchone()
                if not pal:
                    conn.close()
                    return jsonify({'erro': 'Palete não encontrado.'}), 404
                itens = conn.execute(f'SELECT * FROM {t_item} WHERE palete_id = ?', (pal['id'],)).fetchall()
                loc = None
                if pal.get('localizacao_id'):
                    loc = conn.execute(f'SELECT * FROM {t_loc} WHERE id = ?', (pal['localizacao_id'],)).fetchone()
                conn.close()
                return jsonify({'palete': dict(pal), 'itens': [dict(i) for i in itens], 'localizacao': dict(loc) if loc else None})
            rows = conn.execute(
                f'''SELECT p.*, l.codigo_endereco
                    FROM {t_pal} p
                    LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
                    ORDER BY p.id DESC LIMIT 200'''
            ).fetchall()
            conn.close()
            return jsonify({'paletes': [dict(r) for r in rows]})
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({'erro': str(e)}), 500

    data = request.get_json() or {}
    now = _now_iso()
    etiqueta = (data.get('etiqueta') or '').strip() or _gerar_etiqueta_palete()
    if len(etiqueta) != 22:
        conn.close()
        return jsonify({'erro': 'Etiqueta deve ter exatamente 22 caracteres.'}), 400
    try:
        if _is_pg(conn):
            cur = conn.execute(
                f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, criado_em, atualizado_em, criado_por)
                    VALUES (?, ?, ?, NOW(), NOW(), ?) RETURNING id''',
                (etiqueta, data.get('status') or 'em_conferencia', data.get('estado_fisico') or 'bom', _usuario()),
            )
            pid = cur.fetchone()['id']
        else:
            conn.execute(
                f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, criado_em, atualizado_em, criado_por)
                    VALUES (?, ?, ?, ?, ?, ?)''',
                (etiqueta, data.get('status') or 'em_conferencia', data.get('estado_fisico') or 'bom', now, now, _usuario()),
            )
            pid = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        for item in data.get('itens') or []:
            conn.execute(
                f'''INSERT INTO {t_item}
                    (palete_id, sku, descricao, lote, data_producao, data_validade, sif,
                     quantidade_caixas, peso_liquido, rg_caixa, criado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    pid,
                    item.get('sku'),
                    item.get('descricao'),
                    item.get('lote'),
                    item.get('data_producao'),
                    item.get('data_validade'),
                    item.get('sif'),
                    int(item.get('quantidade_caixas') or 0),
                    item.get('peso_liquido'),
                    item.get('rg_caixa'),
                    now if not _is_pg(conn) else None,
                ),
            )
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'palete_id': pid, 'etiqueta': etiqueta})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/movimentacoes', methods=['GET', 'POST'])
def api_wms_movimentacoes():
    conn = _db()
    ensure_wms_schema(conn)
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')

    if request.method == 'GET':
        historico = (request.args.get('historico') or '').strip().lower() in ('1', 'sim', 'true', 'yes')
        try:
            if historico:
                limite = request.args.get('limite') or 100
                rows = _listar_movimentacoes_historico(conn, limite)
                conn.close()
                return jsonify({'historico': rows})
            status = (request.args.get('status') or 'pendente').strip()
            rows = conn.execute(
                f'''SELECT m.*, p.etiqueta,
                           lo.codigo_endereco AS origem,
                           ld.codigo_endereco AS destino
                    FROM {t_mov} m
                    JOIN {t_pal} p ON p.id = m.palete_id
                    LEFT JOIN {t_loc} lo ON lo.id = m.origem_localizacao_id
                    LEFT JOIN {t_loc} ld ON ld.id = m.destino_localizacao_id
                    WHERE m.status = ?
                    ORDER BY m.prioridade ASC, m.id ASC LIMIT 300''',
                (status,),
            ).fetchall()
            conn.close()
            return jsonify({'movimentacoes': [_mov_row_para_api(_row_dict(r)) for r in (rows or [])]})
        except Exception as e:
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
            return jsonify({'erro': str(e)}), 500

    data = request.get_json() or {}
    acao = (data.get('acao') or 'criar').strip()
    now = _now_iso()

    try:
        if acao == 'transferir':
            cod_pal = (data.get('codigo_palete') or data.get('etiqueta') or data.get('palete') or '').strip()
            cod_dest = (data.get('destino') or data.get('codigo_destino') or data.get('endereco_destino') or '').strip()
            obs = (data.get('observacao') or '').strip() or None
            if not cod_pal or not cod_dest:
                conn.close()
                return jsonify({'erro': 'Informe o palete (etiqueta ou endereço atual) e o novo endereço.'}), 400
            res, err = _transferir_palete_armazem(conn, cod_pal, cod_dest, observacao=obs)
            if err:
                conn.rollback()
                conn.close()
                return jsonify({'erro': err}), 400
            conn.commit()
            conn.close()
            return jsonify({'ok': True, 'transferencia': res})

        if acao == 'concluir':
            mov_id = data.get('id')
            if _is_pg(conn):
                conn.execute(
                    f'''UPDATE {t_mov} SET status = 'concluida', concluida_em = NOW(), concluida_por = ?
                        WHERE id = ?''',
                    (_usuario(), mov_id),
                )
            else:
                conn.execute(
                    f'''UPDATE {t_mov} SET status = 'concluida', concluida_em = ?, concluida_por = ? WHERE id = ?''',
                    (now, _usuario(), mov_id),
                )
            mov = _row_dict(conn.execute(f'SELECT * FROM {t_mov} WHERE id = ?', (mov_id,)).fetchone())
            if mov and mov.get('destino_localizacao_id'):
                dest = mov['destino_localizacao_id']
                pid = mov['palete_id']
                orig = mov.get('origem_localizacao_id')
                if orig:
                    if _is_pg(conn):
                        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = NOW() WHERE id = ?", (orig,))
                    else:
                        conn.execute(f"UPDATE {t_loc} SET status = 'vazia', atualizado_em = ? WHERE id = ?", (now, orig))
                if _is_pg(conn):
                    conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = NOW() WHERE id = ?", (dest,))
                    conn.execute(
                        f"UPDATE {t_pal} SET localizacao_id = ?, status = 'armazenado', atualizado_em = NOW() WHERE id = ?",
                        (dest, pid),
                    )
                else:
                    conn.execute(f"UPDATE {t_loc} SET status = 'ocupada', atualizado_em = ? WHERE id = ?", (now, dest))
                    conn.execute(
                        f'UPDATE {t_pal} SET localizacao_id = ?, status = ?, atualizado_em = ? WHERE id = ?',
                        (dest, 'armazenado', now, pid),
                    )
                if pid:
                    for sku in _skus_do_palete(conn, pid):
                        _sync_produto_estoque_cache(conn, sku)
            conn.commit()
            conn.close()
            return jsonify({'ok': True})

        palete_id = data.get('palete_id')
        sku = (data.get('sku') or '').strip()
        lote = (data.get('lote') or '').strip() or None
        dp = (data.get('data_producao') or '').strip() or None
        zona = (data.get('zona') or 'pulmao').strip().lower()
        sugestao = _sugerir_putaway(conn, sku, lote, dp, zona) if sku else {}
        dest_id = data.get('destino_localizacao_id') or sugestao.get('localizacao_id')
        if not palete_id or not dest_id:
            conn.close()
            return jsonify({'erro': 'Informe palete_id e destino (ou SKU para indicação automática).', 'sugestao': sugestao}), 400
        if _is_pg(conn):
            conn.execute(
                f'''INSERT INTO {t_mov} (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                    status, prioridade, observacao, criado_em, criado_por)
                    VALUES (?, ?, ?, ?, 'pendente', ?, ?, NOW(), ?)''',
                (
                    data.get('tipo') or 'putaway',
                    palete_id,
                    data.get('origem_localizacao_id'),
                    dest_id,
                    int(data.get('prioridade') or 5),
                    data.get('observacao') or ('; '.join(sugestao.get('motivo') or [])),
                    _usuario(),
                ),
            )
        else:
            conn.execute(
                f'''INSERT INTO {t_mov} (tipo, palete_id, origem_localizacao_id, destino_localizacao_id,
                    status, prioridade, observacao, criado_em, criado_por)
                    VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?, ?)''',
                (
                    data.get('tipo') or 'putaway',
                    palete_id,
                    data.get('origem_localizacao_id'),
                    dest_id,
                    int(data.get('prioridade') or 5),
                    data.get('observacao') or ('; '.join(sugestao.get('motivo') or [])),
                    now,
                    _usuario(),
                ),
            )
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'sugestao': sugestao})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/putaway/sugerir', methods=['POST'])
def api_wms_putaway_sugerir():
    data = request.get_json() or {}
    sku = (data.get('sku') or '').strip()
    if not sku:
        return jsonify({'erro': 'Informe SKU.'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    try:
        sug = _sugerir_putaway(
            conn,
            sku,
            (data.get('lote') or '').strip() or None,
            (data.get('data_producao') or '').strip() or None,
            (data.get('zona') or 'pulmao').strip().lower(),
        )
        conn.close()
        return jsonify(sug)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/pesquisa-sku', methods=['GET'])
def api_wms_pesquisa_sku():
    q = (request.args.get('q') or '').strip()
    lote = (request.args.get('lote') or '').strip()
    conn = _db()
    ensure_wms_schema(conn)
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    sql = f'''SELECT i.*, p.etiqueta, p.status AS palete_status, p.bloqueio_tipo, p.bloqueio_motivo,
                     p.temperatura, l.codigo_endereco, l.camara, l.status AS loc_status
              FROM {t_item} i
              JOIN {t_pal} p ON p.id = i.palete_id
              LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
              WHERE 1=1'''
    params = []
    if q:
        if _is_pg(conn):
            sql += ' AND (i.sku ILIKE ? OR i.descricao ILIKE ? OR p.etiqueta ILIKE ? OR i.rg_caixa ILIKE ?)'
        else:
            sql += ' AND (i.sku LIKE ? OR i.descricao LIKE ? OR p.etiqueta LIKE ? OR i.rg_caixa LIKE ?)'
        params.extend([f'%{q}%'] * 4)
    if lote:
        sql += ' AND i.lote = ?'
        params.append(lote)
    sql += ' ORDER BY i.data_validade ASC NULLS LAST LIMIT 500' if _is_pg(conn) else ' ORDER BY i.data_validade ASC LIMIT 500'
    try:
        rows = conn.execute(sql, tuple(params)).fetchall()
        resultados = [dict(r) for r in rows]
        resumo = None
        if q and len(q) >= 3:
            sku_exato = None
            for r in resultados:
                s = (r.get('sku') or '').strip()
                if s and s.upper() == q.upper():
                    sku_exato = s
                    break
            if not sku_exato and resultados:
                sku_exato = (resultados[0].get('sku') or '').strip()
            if sku_exato:
                resumo = _aplicar_estoque_real_dict(conn, {'sku': sku_exato}, sku_exato)
        conn.close()
        return jsonify({'resultados': resultados, 'resumo_estoque_real': resumo, 'fonte_estoque': 'wms'})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/recebimentos/buscar-nf', methods=['GET'])
def api_wms_recebimentos_buscar_nf():
    """Busca NF no módulo descarga/recebimento (carreta) para preencher recebimento WMS."""
    numero_nf = (request.args.get('numero_nf') or request.args.get('nf') or '').strip()
    completo = str(request.args.get('completo') or '').strip().lower() in ('1', 'true', 'sim')
    conn = _db()
    try:
        try:
            _ensure_wms_recebimento_terceiros_columns(conn)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        doc, err = _buscar_documento_terceiros_por_nf(conn, numero_nf)
        if err:
            conn.close()
            return jsonify({
                'erro': err,
                'nf_nao_encontrada': True,
                'numero_nf': numero_nf,
            }), 404
        try:
            # Padrão: enrich leve (sem write/reabrir). Completo só com ?completo=1.
            if completo:
                doc = _enriquecer_documento_nf_wms(conn, doc, reabrir_descarga=False)
            else:
                doc = _enriquecer_documento_nf_wms_leve(conn, doc)
        except Exception as exc:
            try:
                print('[wms/buscar-nf] enriquecer falhou: %s' % exc, flush=True)
            except Exception:
                pass
            try:
                conn.rollback()
            except Exception:
                pass
            doc = dict(doc or {})
            doc.setdefault('situacao_recebimento', {
                'situacao': 'pendente',
                'rotulo': 'NF na descarga',
                'detalhe': 'Dados da descarga carregados. Situação WMS indisponível no momento.',
                'cor': '#1565c0',
            })
        conn.close()
        return jsonify({'ok': True, 'documento': doc, 'leve': not completo})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/recebimentos/iniciar-bipagem', methods=['POST'])
def api_wms_recebimentos_iniciar_bipagem():
    """Endpoint dedicado e leve para abrir o passo a passo (evita 502 do POST pesado)."""
    data = request.get_json(silent=True) or {}
    conn = None
    try:
        # Timeout curto de conexão — falha rápido em vez de segurar o worker.
        try:
            conn = _get_db(connect_timeout=5) if _get_db else _db()
        except TypeError:
            conn = _db()
        except Exception as e:
            return jsonify({
                'erro': 'Banco acordando. Aguarde alguns segundos e tente de novo.',
                '_falhaGateway': True,
            }), 503
        # ALTER só na 1ª vez (flag em memória); não bloquear o caminho feliz.
        try:
            _ensure_wms_recebimento_terceiros_columns(conn)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        payload, err_pair = _iniciar_bipagem_wms_leve(conn, data)
        try:
            conn.close()
        except Exception:
            pass
        if err_pair:
            msg, code = err_pair
            return jsonify({'erro': msg}), code
        return jsonify(payload)
    except Exception as e:
        try:
            if conn:
                conn.close()
        except Exception:
            pass
        return jsonify({'erro': 'Falha ao abrir bipagem: %s' % e}), 500


@bp.route('/recebimentos', methods=['GET', 'POST'])
def api_wms_recebimentos():
    conn = _db()

    if request.method == 'GET':
        # GET leve: sem ensure_wms_schema / seed (mesmo padrão do painel — evita timeout na aba).
        rid = request.args.get('id', type=int)
        try:
            if not _wms_tabelas_existem(conn):
                conn.close()
                if rid:
                    return jsonify({
                        'recebimento': None,
                        'paletes': [],
                        'perguntas': [],
                        'respostas': [],
                        'finalizacao': None,
                        'aviso': 'schema_pendente',
                    })
                return jsonify({
                    'recebimentos': [],
                    'somente_andamento': True,
                    'aviso': 'schema_pendente',
                })
            try:
                _ensure_wms_recebimento_terceiros_columns(conn)
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            t_rec = _tbl(conn, 'wms_recebimento')
            t_rp = _tbl(conn, 'wms_recebimento_palete')
            t_pal = _tbl(conn, 'wms_palete')
            t_cq = _tbl(conn, 'wms_check_qualidade')
            t_cqr = _tbl(conn, 'wms_check_qualidade_resposta')
            if rid:
                rec = conn.execute(f'SELECT * FROM {t_rec} WHERE id = ?', (rid,)).fetchone()
                pals = conn.execute(
                    f'''SELECT rp.*, p.etiqueta, p.status
                        FROM {t_rp} rp JOIN {t_pal} p ON p.id = rp.palete_id
                        WHERE rp.recebimento_id = ?''',
                    (rid,),
                ).fetchall()
                perg = conn.execute(
                    f'SELECT * FROM {t_cq} WHERE contexto = ? AND {_ativo_sql(conn)} ORDER BY ordem',
                    ('recebimento',),
                ).fetchall()
                resp = conn.execute(f'SELECT * FROM {t_cqr} WHERE recebimento_id = ?', (rid,)).fetchall()
                finalizacao = _resumo_finalizacao_recebimento(conn, rid)
                conn.close()
                return jsonify({
                    'recebimento': dict(rec) if rec else None,
                    'paletes': [dict(p) for p in pals],
                    'perguntas': [dict(p) for p in perg],
                    'respostas': [dict(r) for r in resp],
                    'finalizacao': finalizacao,
                })
            somente_andamento = request.args.get('andamento', '1').strip().lower() not in ('0', 'false', 'nao', 'não', 'all', 'todos')
            # Colunas mínimas da lista (evita SELECT * lento / payload grande).
            cols_lista = (
                'id, numero_nf, fornecedor, placa, status, origem, terceiros_documento_id'
            )
            try:
                if somente_andamento:
                    rows = conn.execute(
                        f'''SELECT {cols_lista} FROM {t_rec}
                            WHERE {_sql_recebimento_wms_ativo()}
                            ORDER BY id DESC LIMIT 50''',
                    ).fetchall()
                else:
                    rows = conn.execute(
                        f'''SELECT {cols_lista} FROM {t_rec}
                            ORDER BY id DESC LIMIT 50''',
                    ).fetchall()
            except Exception:
                # Fallback se alguma coluna de vínculo ainda não existir.
                try:
                    conn.rollback()
                except Exception:
                    pass
                if somente_andamento:
                    rows = conn.execute(
                        f'''SELECT id, numero_nf, fornecedor, placa, status, origem
                            FROM {t_rec}
                            WHERE {_sql_recebimento_wms_ativo()}
                            ORDER BY id DESC LIMIT 50''',
                    ).fetchall()
                else:
                    rows = conn.execute(
                        f'''SELECT id, numero_nf, fornecedor, placa, status, origem
                            FROM {t_rec} ORDER BY id DESC LIMIT 50''',
                    ).fetchall()
            conn.close()
            return jsonify({
                'recebimentos': [dict(r) for r in rows],
                'somente_andamento': somente_andamento,
                'leve': True,
            })
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({'recebimentos': [], 'erro': str(e), 'aviso': 'falha_lista'}), 200

    data = request.get_json() or {}
    acao = (data.get('acao') or 'criar').strip()
    # Passo a passo (bipagem): sem seed/schema pesado — senão o botão fica em "Conferindo…".
    if acao in _WMS_ACOES_BIP_LEVES:
        if not _wms_tabelas_existem(conn):
            ensure_wms_schema(conn)
            _seed_wms_defaults(conn)
        try:
            _ensure_wms_recebimento_terceiros_columns(conn)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
    else:
        ensure_wms_schema(conn)
        _seed_wms_defaults(conn)
        _ensure_wms_recebimento_terceiros_columns(conn)
    t_rec = _tbl(conn, 'wms_recebimento')
    t_rp = _tbl(conn, 'wms_recebimento_palete')
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    t_mov = _tbl(conn, 'wms_movimentacao')
    t_cq = _tbl(conn, 'wms_check_qualidade')
    t_cqr = _tbl(conn, 'wms_check_qualidade_resposta')

    now = _now_iso()

    try:
        if acao == 'bip_palete':
            rid = data.get('recebimento_id')
            if not rid:
                conn.close()
                return jsonify({'erro': 'Informe recebimento_id.'}), 400
            etiqueta = (data.get('etiqueta') or '').strip()
            if etiqueta and len(etiqueta) != 22:
                conn.close()
                return jsonify({'erro': 'Etiqueta deve ter 22 caracteres.'}), 400
            if not etiqueta:
                etiqueta = _gerar_etiqueta_palete()
            existente = conn.execute(f'SELECT * FROM {t_pal} WHERE etiqueta = ?', (etiqueta,)).fetchone()
            palete_novo = False
            if existente:
                pid = existente['id'] if isinstance(existente, dict) else existente[0]
                if _is_pg(conn):
                    conn.execute(f"UPDATE {t_pal} SET recebimento_id = ?, atualizado_em = NOW() WHERE id = ?", (rid, pid))
                else:
                    conn.execute(f'UPDATE {t_pal} SET recebimento_id = ?, atualizado_em = ? WHERE id = ?', (rid, now, pid))
            else:
                palete_novo = True
                if _is_pg(conn):
                    cur = conn.execute(
                        f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, recebimento_id, criado_em, atualizado_em, criado_por)
                            VALUES (?, 'em_conferencia', 'bom', ?, NOW(), NOW(), ?) RETURNING id''',
                        (etiqueta, rid, _usuario()),
                    )
                    pid = cur.fetchone()['id']
                else:
                    conn.execute(
                        f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, recebimento_id, criado_em, atualizado_em, criado_por)
                            VALUES (?, 'em_conferencia', 'bom', ?, ?, ?, ?)''',
                        (etiqueta, rid, now, now, _usuario()),
                    )
                    pid = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
            vinc = conn.execute(
                f'SELECT 1 FROM {t_rp} WHERE recebimento_id = ? AND palete_id = ?', (rid, pid)
            ).fetchone()
            if not vinc:
                conn.execute(
                    f'INSERT INTO {t_rp} (recebimento_id, palete_id, estado_palete, conferencia_cega) VALUES (?, ?, ?, ?)',
                    (rid, pid, 'bom', _bind_bool(conn, True)),
                )
            if _is_pg(conn):
                conn.execute(f"UPDATE {t_rec} SET status = 'em_conferencia', atualizado_em = NOW() WHERE id = ?", (rid,))
            else:
                conn.execute(f"UPDATE {t_rec} SET status = 'em_conferencia', atualizado_em = ? WHERE id = ?", (now, rid))
            if palete_novo:
                _ensure_wms_palete_controle_table(conn)
                _registrar_controle_palete(
                    conn, pid, 'entrada',
                    subtipo='recebimento',
                    observacao='Palete criado na bipagem do recebimento',
                )
            conn.commit()
            conn.close()
            return jsonify({'ok': True, 'palete_id': pid, 'etiqueta': etiqueta})

        if acao == 'bip_produto':
            pid = data.get('palete_id')
            if not pid:
                conn.close()
                return jsonify({'erro': 'Informe palete_id (bipe o palete primeiro).'}), 400
            item = data.get('item') or {}
            sku = (item.get('sku') or '').strip()
            if not sku:
                conn.close()
                return jsonify({'erro': 'Informe SKU do produto.'}), 400
            dp = (item.get('data_producao') or '').strip() or None
            dv = (item.get('data_validade') or '').strip() or None
            err_dp = _validar_data_producao_fifo(dp)
            if err_dp:
                conn.close()
                return jsonify({'erro': err_dp}), 400
            if not dv:
                conn.close()
                return jsonify({'erro': 'Informe a data de validade na bipagem.'}), 400
            estado = data.get('estado_palete') or 'bom'
            disposicao = _estado_recebimento_para_disposicao(estado)
            lote = (item.get('lote') or '').strip() or None
            rg_up = (item.get('rg_caixa') or item.get('up') or '').strip() or None
            n_item_nf = item.get('n_item_nf')
            if n_item_nf is not None and str(n_item_nf).strip() != '':
                n_item_nf = str(n_item_nf).strip()
            else:
                n_item_nf = None
            qtd_cx = int(item.get('quantidade_caixas') or 0)
            if qtd_cx < 1:
                conn.close()
                return jsonify({'erro': 'Informe a quantidade de caixas (mínimo 1).'}), 400
            pal_rec = conn.execute(f'SELECT recebimento_id FROM {t_pal} WHERE id = ?', (pid,)).fetchone()
            rid_bip = (_row_dict(pal_rec) or {}).get('recebimento_id')
            # Se o cliente já mandou n_item_nf (validado na UI), não refaz enrich pesado da NF.
            if rid_bip and not n_item_nf:
                try:
                    doc_nf = _documento_nf_do_recebimento(conn, rid_bip, completo=False)
                    linha_nf = _resolver_linha_nf_bipagem(doc_nf, sku, n_item_nf)
                    if not linha_nf:
                        conn.close()
                        return jsonify({
                            'erro': 'Nenhuma linha pendente de bipagem para este produto nesta NF.',
                        }), 400
                    n_item_nf = str(linha_nf.get('n_item')) if linha_nf.get('n_item') is not None else n_item_nf
                    if not item.get('descricao') and linha_nf.get('descricao'):
                        item = dict(item)
                        item['descricao'] = linha_nf.get('descricao')
                except Exception as exc:
                    try:
                        print('[wms/bip_produto] validacao NF leve falhou: %s' % exc, flush=True)
                    except Exception:
                        pass
                    try:
                        conn.rollback()
                    except Exception:
                        pass
            try:
                _ensure_wms_palete_item_nf_columns(conn)
                _ensure_wms_palete_item_disposicao(conn)
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            existentes = conn.execute(
                f'SELECT id, n_item_nf, sku FROM {t_item} WHERE palete_id = ?', (pid,)
            ).fetchall()
            for ex in existentes or []:
                ex_rd = _row_dict(ex) or {}
                ex_n = ex_rd.get('n_item_nf')
                if ex_n is not None and str(ex_n).strip() != '' and n_item_nf and str(ex_n).strip() != str(n_item_nf):
                    conn.close()
                    return jsonify({
                        'erro': 'Este palete já tem outro item da NF. Use «Próximo palete» para conferir o próximo item.',
                    }), 400
            conn.execute(
                f'''INSERT INTO {t_item}
                    (palete_id, sku, descricao, lote, data_producao, data_validade, sif,
                     quantidade_caixas, peso_liquido, rg_caixa, n_item_nf, disposicao_estoque, criado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    pid, sku, item.get('descricao'), lote, dp,
                    dv, item.get('sif'),
                    qtd_cx, item.get('peso_liquido'),
                    rg_up, n_item_nf, disposicao, now,
                ),
            )
            try:
                bloqueios = _aplicar_bloqueios_palete(conn, pid, estado, dv, item.get('temperatura'))
            except Exception:
                bloqueios = []
            t_rp = _tbl(conn, 'wms_recebimento_palete')
            conn.execute(
                f'UPDATE {t_rp} SET estado_palete = ? WHERE palete_id = ?',
                (estado if disposicao else 'bom', pid),
            )
            sug = {}
            # Putaway fica no passo «Guardar» (sugerir_destino). Aqui só grava o item — senão o
            # Confirmar produto estoura timeout/429 no Render enquanto calcula endereço.
            pal = conn.execute(f'SELECT etiqueta FROM {t_pal} WHERE id = ?', (pid,)).fetchone()
            etiqueta = (pal['etiqueta'] if isinstance(pal, dict) else pal[0]) if pal else None
            mov_id = None
            pal_rec = conn.execute(f'SELECT recebimento_id FROM {t_pal} WHERE id = ?', (pid,)).fetchone()
            rid = (_row_dict(pal_rec) or {}).get('recebimento_id')
            if rid:
                if _is_pg(conn):
                    conn.execute(
                        f"UPDATE {t_rec} SET status = 'aguardando_armazenagem', atualizado_em = NOW() WHERE id = ? AND status NOT IN ('concluido', 'finalizado', 'cancelado')",
                        (rid,),
                    )
                else:
                    conn.execute(
                        f"UPDATE {t_rec} SET status = 'aguardando_armazenagem', atualizado_em = ? WHERE id = ? AND status NOT IN ('concluido', 'finalizado', 'cancelado')",
                        (now, rid),
                    )
            conn.commit()
            conn.close()
            return jsonify({
                'ok': True,
                'palete_id': pid,
                'etiqueta': etiqueta,
                'bloqueios': bloqueios,
                'disposicao_estoque': disposicao,
                'sugestao': sug,
                'movimentacao_id': mov_id,
                'movimentacao_status': 'pendente' if mov_id else None,
                'mensagem': (
                    'Produto classificado como ' + disposicao.replace('_', ' ') + '. Será lançado no Estoque SP ao guardar.'
                    if disposicao else
                    'Datas registradas na bipagem. Status será atualizado após confirmar armazenagem.'
                ),
            })

        if acao == 'sugerir_destino':
            pid = data.get('palete_id')
            it = conn.execute(
                f'SELECT sku, lote, data_producao FROM {t_item} WHERE palete_id = ? ORDER BY id DESC LIMIT 1',
                (pid,),
            ).fetchone()
            if not it:
                conn.close()
                return jsonify({'erro': 'Palete sem produto conferido.'}), 400
            rd = _row_dict(it) or {}
            sug = _sugerir_putaway(conn, rd.get('sku'), rd.get('lote'), rd.get('data_producao'), 'pulmao')
            if not sug.get('codigo_endereco'):
                sug_pick = _sugerir_putaway(conn, rd.get('sku'), rd.get('lote'), rd.get('data_producao'), 'picking')
                if sug_pick.get('codigo_endereco'):
                    sug = sug_pick
            mov_id = _criar_mov_pendente_putaway(conn, pid, sug, 'Aguardando bip da longarina')
            conn.close()
            out = dict(sug)
            out['movimentacao_id'] = mov_id
            out['movimentacao_status'] = 'pendente' if mov_id else None
            return jsonify(out)

        if acao == 'confirmar_armazenagem':
            pid = data.get('palete_id')
            usar_sugestao = data.get('usar_sugestao', True)
            if usar_sugestao in (False, 0, '0', 'false', 'nao', 'não'):
                usar_sugestao = False
            else:
                usar_sugestao = True
            cod_bip = (data.get('codigo_endereco') or data.get('barcode_longarina') or '').strip()
            sug_aplicada = None
            if not pid or not cod_bip:
                conn.close()
                return jsonify({
                    'erro': 'Bipe a etiqueta da longarina ou coluna para validar a entrada.',
                    'sugestao': sug_aplicada,
                }), 400
            cod_resolvido = _resolver_codigo_endereco_bip(cod_bip, conn=conn) or None
            if not cod_resolvido:
                err_bip = _erro_bip_endereco(cod_bip) or (
                    'Bipe a etiqueta da longarina (com dígito verificador) ou o código WMS.'
                )
                conn.close()
                return jsonify({'erro': err_bip, 'sugestao': sug_aplicada}), 400
            cod_resolvido = str(cod_resolvido).upper()
            if usar_sugestao and pid:
                it_sug = conn.execute(
                    f'SELECT sku, lote, data_producao FROM {t_item} WHERE palete_id = ? ORDER BY id DESC LIMIT 1',
                    (pid,),
                ).fetchone()
                if it_sug:
                    rd_sug = _row_dict(it_sug) or {}
                    sug_aplicada = _sugerir_putaway(
                        conn, rd_sug.get('sku'), rd_sug.get('lote'), rd_sug.get('data_producao'), 'pulmao',
                    )
                    if not sug_aplicada.get('codigo_endereco'):
                        sug_pick = _sugerir_putaway(
                            conn, rd_sug.get('sku'), rd_sug.get('lote'), rd_sug.get('data_producao'), 'picking',
                        )
                        if sug_pick.get('codigo_endereco'):
                            sug_aplicada = sug_pick
                    if sug_aplicada and sug_aplicada.get('codigo_endereco'):
                        sug_cod = (sug_aplicada.get('codigo_endereco') or '').strip().upper()
                        sug_bc = (sug_aplicada.get('barcode_longarina') or '').strip()
                        bip_norm = cod_bip.strip()
                        bip_base = _barcode_longarina_base(bip_norm)
                        sug_base = _barcode_longarina_base(sug_bc)
                        if (cod_resolvido.upper() != sug_cod
                                and bip_norm != sug_bc
                                and bip_norm.upper() != (sug_bc or '').upper()
                                and bip_base != sug_base):
                            conn.close()
                            return jsonify({
                                'erro': f'Bipe a longarina indicada ({sug_bc or sug_cod}), não {cod_bip}.',
                                'sugestao': sug_aplicada,
                            }), 400
                        elif bip_base == sug_base:
                            cod_resolvido = sug_cod
            cod = cod_resolvido
            loc, err = _confirmar_armazenagem_palete(conn, pid, cod)
            if err:
                try:
                    conn.rollback()
                    conn.close()
                except Exception:
                    pass
                return jsonify({'erro': err}), 400
            status_skus = {}
            for sku in _skus_do_palete(conn, pid):
                status_skus[sku] = _sync_produto_estoque_cache(conn, sku)
            conn.commit()
            conn.close()
            resp_arm = {
                'ok': True,
                'localizacao': loc,
                'movimentacao_status': 'concluida',
                'movimentacao_id': (loc or {}).get('movimentacao_id'),
                'recebimento_status': (loc or {}).get('recebimento_status'),
                'status_atualizado': {k: v.get('status_condicional') for k, v in status_skus.items()},
            }
            if sug_aplicada:
                resp_arm['sugestao_aplicada'] = sug_aplicada
            return jsonify(resp_arm)

        if acao == 'conferir_palete':
            rid = data.get('recebimento_id')
            etiqueta = (data.get('etiqueta') or '').strip() or _gerar_etiqueta_palete()
            if len(etiqueta) != 22:
                etiqueta = _gerar_etiqueta_palete()
            estado = data.get('estado_palete') or 'bom'
            item = data.get('item') or {}
            if _is_pg(conn):
                cur = conn.execute(
                    f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, recebimento_id, criado_em, atualizado_em, criado_por)
                        VALUES (?, 'em_conferencia', ?, ?, NOW(), NOW(), ?) RETURNING id''',
                    (etiqueta, estado, rid, _usuario()),
                )
                pid = cur.fetchone()['id']
            else:
                conn.execute(
                    f'''INSERT INTO {t_pal} (etiqueta, status, estado_fisico, recebimento_id, criado_em, atualizado_em, criado_por)
                        VALUES (?, 'em_conferencia', ?, ?, ?, ?, ?)''',
                    (etiqueta, estado, rid, now, now, _usuario()),
                )
                pid = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
            conn.execute(
                f'''INSERT INTO {t_rp} (recebimento_id, palete_id, estado_palete, conferencia_cega)
                    VALUES (?, ?, ?, ?)''',
                (rid, pid, estado, _bind_bool(conn, True)),
            )
            sku = (item.get('sku') or '').strip()
            dp_conf = (item.get('data_producao') or '').strip() or None
            err_dp_conf = _validar_data_producao_fifo(dp_conf) if dp_conf else None
            if err_dp_conf:
                conn.close()
                return jsonify({'erro': err_dp_conf}), 400
            conn.execute(
                f'''INSERT INTO {t_item}
                    (palete_id, sku, descricao, lote, data_producao, data_validade, sif,
                     quantidade_caixas, peso_liquido, rg_caixa, criado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    pid, sku, item.get('descricao'), item.get('lote'),
                    dp_conf, item.get('data_validade'), item.get('sif'),
                    int(item.get('quantidade_caixas') or 0), item.get('peso_liquido'),
                    item.get('rg_caixa'), now,
                ),
            )
            bloqueios = _aplicar_bloqueios_palete(conn, pid, estado, item.get('data_validade'), item.get('temperatura'))
            if _is_pg(conn):
                conn.execute(f"UPDATE {t_rec} SET status = 'em_conferencia', atualizado_em = NOW() WHERE id = ?", (rid,))
            else:
                conn.execute(f"UPDATE {t_rec} SET status = 'em_conferencia', atualizado_em = ? WHERE id = ?", (now, rid))
            conn.commit()
            conn.close()
            return jsonify({'ok': True, 'palete_id': pid, 'etiqueta': etiqueta, 'bloqueios': bloqueios})

        if acao == 'iniciar_bipagem':
            payload, err_pair = _iniciar_bipagem_wms_leve(conn, data)
            conn.close()
            if err_pair:
                msg, code = err_pair
                return jsonify({'erro': msg}), code
            return jsonify(payload)

        if acao == 'reabrir_descarga':
            doc_ter = data.get('terceiros_documento_id') or data.get('documento_id')
            numero_nf = (data.get('numero_nf') or '').strip()
            if not doc_ter and numero_nf:
                found, _err_nf = _buscar_documento_terceiros_por_nf(conn, numero_nf)
                if found:
                    doc_ter = found.get('documento_id')
            if not doc_ter:
                conn.close()
                return jsonify({'erro': 'Informe terceiros_documento_id ou numero_nf.'}), 400
            rec_wms = _buscar_recebimento_wms_por_nf(conn, documento_id=doc_ter, numero_nf=numero_nf)
            if rec_wms and (rec_wms.get('status') or '').lower() == 'finalizado':
                conn.close()
                return jsonify({
                    'erro': 'NF já finalizada no WMS — não é possível reabrir a descarga.',
                }), 400
            ok_ter, err_ter = _reabrir_terceiros_recebimento_wms(
                conn, int(doc_ter), motivo='reabertura_wms_manual',
            )
            if not ok_ter:
                conn.close()
                return jsonify({'erro': err_ter or 'Não foi possível reabrir a descarga.'}), 400
            conn.commit()
            conn.close()
            return jsonify({
                'ok': True,
                'terceiros_documento_id': int(doc_ter),
                'recebimento_concluido': False,
            })

        if acao == 'excluir':
            rid = data.get('recebimento_id')
            if not rid:
                conn.close()
                return jsonify({'erro': 'Informe recebimento_id.'}), 400
            forcar = bool(data.get('forcar') or data.get('permitir_finalizado'))
            result, err = _excluir_recebimento_wms(conn, int(rid), permitir_finalizado=forcar)
            if err:
                try:
                    conn.rollback()
                    conn.close()
                except Exception:
                    pass
                return jsonify({'erro': err}), 400
            conn.commit()
            conn.close()
            return jsonify(result)

        if acao == 'reiniciar':
            rid = data.get('recebimento_id')
            if not rid:
                conn.close()
                return jsonify({'erro': 'Informe recebimento_id.'}), 400
            result, err = _excluir_recebimento_wms(conn, int(rid), permitir_finalizado=True)
            if err:
                try:
                    conn.rollback()
                    conn.close()
                except Exception:
                    pass
                return jsonify({'erro': err}), 400
            conn.commit()
            conn.close()
            result = dict(result or {})
            result['reiniciado'] = True
            return jsonify(result)

        if acao == 'finalizar':
            rid = data.get('recebimento_id')
            if not rid:
                conn.close()
                return jsonify({'erro': 'Informe recebimento_id.'}), 400
            resumo_fin = _resumo_finalizacao_recebimento(conn, rid)
            if not resumo_fin or not resumo_fin.get('pode_finalizar'):
                conn.close()
                msg = (resumo_fin or {}).get('motivo') or 'Recebimento ainda não está pronto para finalizar.'
                return jsonify({'erro': msg, 'finalizacao': resumo_fin}), 400
            for resp in data.get('respostas') or []:
                conn.execute(
                    f'''INSERT INTO {t_cqr} (recebimento_id, pergunta_id, resposta, valor_numerico, respondido_em, respondido_por)
                        VALUES (?, ?, ?, ?, ?, ?)''',
                    (rid, resp.get('pergunta_id'), resp.get('resposta'), resp.get('valor_numerico'), now, _usuario()),
                )
            if _is_pg(conn):
                conn.execute(
                    f"UPDATE {t_rec} SET status = 'finalizado', check_qualidade_ok = TRUE, atualizado_em = NOW() WHERE id = ?",
                    (rid,),
                )
            else:
                conn.execute(
                    f"UPDATE {t_rec} SET status = 'finalizado', check_qualidade_ok = 1, atualizado_em = ? WHERE id = ?",
                    (now, rid),
                )
            rec_vinc = conn.execute(
                f'SELECT terceiros_documento_id FROM {t_rec} WHERE id = ?', (rid,)
            ).fetchone()
            terceiros_sync = None
            doc_ter = (_row_dict(rec_vinc) or {}).get('terceiros_documento_id')
            if doc_ter:
                _sincronizar_terceiros_itens_desde_wms(conn, int(doc_ter), recebimento_id=rid)
                ok_t, err_t = _concluir_terceiros_recebimento_wms(conn, doc_ter)
                if ok_t:
                    terceiros_sync = {
                        'documento_id': int(doc_ter),
                        'recebimento_concluido': True,
                        'mensagem': 'Pendência de recebimento atualizada no módulo de descarga.',
                    }
                else:
                    terceiros_sync = {'documento_id': int(doc_ter), 'erro': err_t}
            conn.commit()
            conn.close()
            return jsonify({'ok': True, 'status': 'finalizado', 'finalizacao': resumo_fin, 'terceiros': terceiros_sync})

        ter_doc_id = data.get('terceiros_documento_id')
        ter_area = (data.get('terceiros_area') or '').strip().lower()
        numero_nf = (data.get('numero_nf') or '').strip()
        if not ter_doc_id and numero_nf:
            found, _err_nf = _buscar_documento_terceiros_por_nf(conn, numero_nf)
            if found and not found.get('recebimento_concluido'):
                ter_doc_id = found.get('documento_id')
                ter_area = found.get('area') or ter_area
        origem = (data.get('origem') or '').strip()
        if not origem:
            if ter_area == 'carreta':
                origem = 'carreta'
            elif ter_doc_id:
                origem = 'terceiros'
            else:
                origem = 'manual'
        fornecedor = data.get('fornecedor')
        placa = data.get('placa')
        if ter_doc_id and numero_nf:
            found, _ = _buscar_documento_terceiros_por_nf(conn, numero_nf)
            if found:
                if not fornecedor:
                    fornecedor = found.get('fornecedor')
                if not placa:
                    placa = found.get('placa')
                if not ter_area:
                    ter_area = found.get('area') or ''

        new_id, reutilizado, st_rec = _obter_ou_criar_recebimento_wms(
            conn,
            numero_nf=numero_nf or data.get('numero_nf'),
            fornecedor=fornecedor,
            placa=placa,
            doca=data.get('doca'),
            origem=origem,
            ter_doc_id=ter_doc_id,
            ter_area=ter_area or None,
            now=now,
        )
        conn.commit()
        conn.close()
        return jsonify({
            'ok': True,
            'id': new_id,
            'reutilizado': reutilizado,
            'status': st_rec,
            'terceiros_documento_id': ter_doc_id,
            'origem': origem,
            'mensagem': 'Recebimento em andamento reutilizado.' if reutilizado else None,
        })
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


def _ensure_wms_inventario_linha_produto_columns(conn):
    cols = [
        ('palete_item_id', 'INTEGER'),
        ('descricao', 'TEXT'),
        ('lote', 'TEXT'),
        ('data_producao', 'TEXT'),
        ('data_validade', 'TEXT'),
        ('quantidade_esperada', 'INTEGER'),
        ('rg_caixa', 'TEXT'),
        ('codigo_endereco', 'TEXT'),
        ('status_linha', "TEXT DEFAULT 'pendente'"),
        ('bip_lote', 'TEXT'),
        ('bip_data_producao', 'TEXT'),
        ('bip_data_validade', 'TEXT'),
        ('bip_quantidade', 'INTEGER'),
        ('bip_rg_caixa', 'TEXT'),
        ('bip_sku', 'TEXT'),
    ]
    t = _tbl(conn, 'wms_inventario_linha')
    if _is_pg(conn):
        for name, typ in cols:
            try:
                conn.execute(f'ALTER TABLE {t} ADD COLUMN IF NOT EXISTS {name} {typ}')
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
        try:
            conn.commit()
        except Exception:
            pass
    else:
        try:
            existing = conn.execute('PRAGMA table_info(wms_inventario_linha)').fetchall()
            names = {c[1] if not isinstance(c, dict) else c.get('name') for c in (existing or [])}
            for name, typ in cols:
                if name not in names:
                    conn.execute(f'ALTER TABLE wms_inventario_linha ADD COLUMN {name} {typ}')
            conn.commit()
        except Exception:
            pass


def _norm_data_cmp_inv(val):
    if val is None or val == '':
        return ''
    raw = str(val).strip()[:10]
    if len(raw) == 10 and raw[4] == '-':
        return raw
    if len(raw) == 10 and raw[2] == '/':
        return f'{raw[6:10]}-{raw[3:5]}-{raw[0:2]}'
    return raw.upper()


def _norm_txt_inv(val):
    return (str(val or '').strip().upper())


def _inventario_dados_iguais(linha, bip):
    sku_ok = _norm_txt_inv(linha.get('sku')) == _norm_txt_inv(bip.get('sku'))
    lote_ok = _norm_txt_inv(linha.get('lote')) == _norm_txt_inv(bip.get('lote'))
    dp_ok = _norm_data_cmp_inv(linha.get('data_producao')) == _norm_data_cmp_inv(bip.get('data_producao'))
    dv_ok = _norm_data_cmp_inv(linha.get('data_validade')) == _norm_data_cmp_inv(bip.get('data_validade'))
    qtd_ok = int(linha.get('quantidade_esperada') or 0) == int(bip.get('quantidade_caixas') or 0)
    up_bip = (bip.get('up') or bip.get('rg_caixa') or '').strip()
    up_ok = _norm_txt_inv(linha.get('rg_caixa')) == _norm_txt_inv(up_bip)
    if up_bip and linha.get('rg_caixa'):
        return sku_ok and lote_ok and dp_ok and dv_ok and qtd_ok and up_ok
    return sku_ok and lote_ok and dp_ok and dv_ok and qtd_ok


def _inventario_linha_dict(row):
    d = _row_dict(row) or {}
    st = (d.get('status_linha') or '').strip().lower()
    if not st:
        st = 'pendente'
    d['status_linha'] = st
    d['quantidade'] = d.get('quantidade_esperada')
    d['up'] = d.get('rg_caixa')
    return d


def _inventario_snapshot_estoque(conn, camara=None):
    _ensure_wms_inventario_linha_produto_columns(conn)
    t_item = _tbl(conn, 'wms_palete_item')
    t_pal = _tbl(conn, 'wms_palete')
    t_loc = _tbl(conn, 'wms_localizacao')
    sql = f'''SELECT i.id AS palete_item_id, i.sku, i.descricao, i.lote, i.data_producao, i.data_validade,
                     i.quantidade_caixas, i.rg_caixa, p.etiqueta AS palete_etiqueta, p.id AS palete_id,
                     l.id AS localizacao_id, l.codigo_endereco, l.camara
              FROM {t_item} i
              JOIN {t_pal} p ON p.id = i.palete_id
              LEFT JOIN {t_loc} l ON l.id = p.localizacao_id
              WHERE p.status IN ('armazenado', 'bloqueado', 'em_stage', 'separado')'''
    params = []
    if camara:
        sql += ' AND l.camara = ?'
        params.append(int(camara))
    sql += ' ORDER BY COALESCE(l.camara, 0), l.rua, l.posicao, i.sku, i.lote'
    return [_row_dict(r) or {} for r in conn.execute(sql, tuple(params)).fetchall()]


def _inventario_buscar_linha_pendente(conn, t_lin, inventario_id, bip):
    up = (bip.get('up') or bip.get('rg_caixa') or '').strip()
    sku = (bip.get('sku') or '').strip()
    if up:
        row = conn.execute(
            f'''SELECT * FROM {t_lin}
                WHERE inventario_id = ? AND COALESCE(status_linha, 'pendente') = 'pendente' AND rg_caixa = ?
                LIMIT 1''',
            (inventario_id, up),
        ).fetchone()
        if row:
            return _row_dict(row)
    rows = conn.execute(
        f'''SELECT * FROM {t_lin}
            WHERE inventario_id = ? AND COALESCE(status_linha, 'pendente') = 'pendente'
            ORDER BY id''',
        (inventario_id,),
    ).fetchall()
    for r in rows or []:
        ld = _row_dict(r) or {}
        if _inventario_dados_iguais(ld, bip):
            return ld
    if sku:
        for r in rows or []:
            ld = _row_dict(r) or {}
            if (ld.get('sku') or '').strip().upper() == sku.upper():
                return ld
    return None


def _inventario_registrar_bip(conn, inventario_id, bip):
    _ensure_wms_inventario_linha_produto_columns(conn)
    t_lin = _tbl(conn, 'wms_inventario_linha')
    t_inv = _tbl(conn, 'wms_inventario')
    inv = conn.execute(f'SELECT id, status FROM {t_inv} WHERE id = ?', (inventario_id,)).fetchone()
    if not inv:
        return None, 'Inventário não encontrado.'
    inv_d = _row_dict(inv) or {}
    if (inv_d.get('status') or '').lower() not in ('ativo', 'em_andamento'):
        return None, 'Inventário não está ativo.'
    sku = (bip.get('sku') or '').strip()
    if not sku:
        return None, 'Informe o código (EAN/SKU) do produto.'
    dv = (bip.get('data_validade') or '').strip()
    if not dv:
        return None, 'Informe a data de validade.'
    dp = (bip.get('data_producao') or '').strip() or None
    if dp:
        err_dp = _validar_data_producao_fifo(dp)
        if err_dp:
            return None, err_dp
    qtd = int(bip.get('quantidade_caixas') or 0)
    if qtd < 1:
        return None, 'Informe a quantidade de caixas (mínimo 1).'
    lote = (bip.get('lote') or '').strip() or None
    up = (bip.get('up') or bip.get('rg_caixa') or '').strip() or None
    now = _now_iso()
    candidato = _inventario_buscar_linha_pendente(conn, t_lin, inventario_id, bip)
    status_linha = 'conferido' if candidato and _inventario_dados_iguais(candidato, bip) else 'divergente'
    if candidato:
        conn.execute(
            f'''UPDATE {t_lin}
                SET status_linha = ?, bip_sku = ?, bip_lote = ?, bip_data_producao = ?, bip_data_validade = ?,
                    bip_quantidade = ?, bip_rg_caixa = ?, quantidade_contada = ?, divergencia = ?,
                    contado_em = ?, contado_por = ?
                WHERE id = ?''',
            (
                status_linha, sku, lote, dp, dv, qtd, up, qtd,
                1 if status_linha == 'divergente' else 0,
                now, _usuario(), candidato.get('id'),
            ),
        )
        linha_id = candidato.get('id')
    else:
        if _is_pg(conn):
            cur = conn.execute(
                f'''INSERT INTO {t_lin}
                    (inventario_id, sku, descricao, status_linha, bip_sku, bip_lote, bip_data_producao,
                     bip_data_validade, bip_quantidade, bip_rg_caixa, quantidade_contada, divergencia,
                     contado_em, contado_por)
                    VALUES (?, ?, ?, 'extra', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING id''',
                (
                    inventario_id, sku, bip.get('descricao'), sku, lote, dp, dv, qtd, up, qtd,
                    now, _usuario(),
                ),
            )
            linha_id = (_row_dict(cur.fetchone()) or {}).get('id')
        else:
            conn.execute(
                f'''INSERT INTO {t_lin}
                    (inventario_id, sku, descricao, status_linha, bip_sku, bip_lote, bip_data_producao,
                     bip_data_validade, bip_quantidade, bip_rg_caixa, quantidade_contada, divergencia,
                     contado_em, contado_por)
                    VALUES (?, ?, ?, 'extra', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)''',
                (
                    inventario_id, sku, bip.get('descricao'), sku, lote, dp, dv, qtd, up, qtd,
                    now, _usuario(),
                ),
            )
            linha_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    if (inv_d.get('status') or '').lower() == 'ativo':
        conn.execute(
            f"UPDATE {t_inv} SET status = 'em_andamento' WHERE id = ?",
            (inventario_id,),
        )
    row = conn.execute(f'SELECT * FROM {t_lin} WHERE id = ?', (linha_id,)).fetchone()
    return _inventario_linha_dict(row), None


def _inventario_aplicar_base(conn, inventario_id):
    _ensure_wms_inventario_linha_produto_columns(conn)
    t_lin = _tbl(conn, 'wms_inventario_linha')
    t_item = _tbl(conn, 'wms_palete_item')
    t_inv = _tbl(conn, 'wms_inventario')
    inv = conn.execute(f'SELECT id, status FROM {t_inv} WHERE id = ?', (inventario_id,)).fetchone()
    if not inv:
        return None, 'Inventário não encontrado.'
    linhas = conn.execute(
        f'''SELECT * FROM {t_lin}
            WHERE inventario_id = ? AND status_linha IN ('divergente', 'extra')
              AND palete_item_id IS NOT NULL''',
        (inventario_id,),
    ).fetchall()
    atualizados = 0
    for r in linhas or []:
        ld = _row_dict(r) or {}
        pid_item = ld.get('palete_item_id')
        if not pid_item:
            continue
        conn.execute(
            f'''UPDATE {t_item}
                SET sku = COALESCE(?, sku),
                    lote = COALESCE(?, lote),
                    data_producao = COALESCE(?, data_producao),
                    data_validade = COALESCE(?, data_validade),
                    quantidade_caixas = COALESCE(?, quantidade_caixas),
                    rg_caixa = COALESCE(?, rg_caixa)
                WHERE id = ?''',
            (
                ld.get('bip_sku') or ld.get('sku'),
                ld.get('bip_lote'),
                ld.get('bip_data_producao'),
                ld.get('bip_data_validade'),
                ld.get('bip_quantidade'),
                ld.get('bip_rg_caixa'),
                pid_item,
            ),
        )
        atualizados += 1
    _sync_all_produtos_estoque_cache(conn)
    now = _now_iso()
    if _is_pg(conn):
        conn.execute(
            f"UPDATE {t_inv} SET status = 'finalizado', finalizado_em = NOW() WHERE id = ?",
            (inventario_id,),
        )
    else:
        conn.execute(
            f"UPDATE {t_inv} SET status = 'finalizado', finalizado_em = ? WHERE id = ?",
            (now, inventario_id),
        )
    return {'atualizados': atualizados, 'inventario_id': inventario_id}, None


def _inventario_resumo_linhas(conn, inventario_id):
    t_lin = _tbl(conn, 'wms_inventario_linha')
    rows = conn.execute(
        f'''SELECT COALESCE(status_linha, 'pendente') AS st, COUNT(*) AS n
            FROM {t_lin} WHERE inventario_id = ? GROUP BY COALESCE(status_linha, 'pendente')''',
        (inventario_id,),
    ).fetchall()
    out = {'total': 0, 'pendente': 0, 'conferido': 0, 'divergente': 0, 'extra': 0}
    for r in rows or []:
        d = _row_dict(r) or {}
        st = (d.get('st') or 'pendente').lower()
        n = int(d.get('n') or 0)
        out['total'] += n
        if st in out:
            out[st] = n
    return out


@bp.route('/inventarios', methods=['GET', 'POST'])
def api_wms_inventarios():
    conn = _db()
    ensure_wms_schema(conn)
    _ensure_wms_inventario_linha_produto_columns(conn)
    t_inv = _tbl(conn, 'wms_inventario')
    t_lin = _tbl(conn, 'wms_inventario_linha')
    t_loc = _tbl(conn, 'wms_localizacao')

    if request.method == 'GET':
        iid = request.args.get('id', type=int)
        try:
            if iid:
                inv = conn.execute(f'SELECT * FROM {t_inv} WHERE id = ?', (iid,)).fetchone()
                if not inv:
                    conn.close()
                    return jsonify({'erro': 'Inventário não encontrado.'}), 404
                linhas = conn.execute(
                    f'''SELECT il.*, l.codigo_endereco AS loc_codigo
                        FROM {t_lin} il
                        LEFT JOIN {t_loc} l ON l.id = il.localizacao_id
                        WHERE il.inventario_id = ?
                        ORDER BY COALESCE(il.status_linha, 'pendente'), il.id''',
                    (iid,),
                ).fetchall()
                resumo = _inventario_resumo_linhas(conn, iid)
                conn.close()
                linhas_out = [_inventario_linha_dict(x) for x in linhas]
                pendentes = [x for x in linhas_out if x.get('status_linha') == 'pendente']
                conferidos = [x for x in linhas_out if x.get('status_linha') == 'conferido']
                divergentes = [x for x in linhas_out if x.get('status_linha') in ('divergente', 'extra')]
                return jsonify({
                    'inventario': dict(inv) if inv else None,
                    'linhas': linhas_out,
                    'pendentes': pendentes,
                    'conferidos': conferidos,
                    'divergentes': divergentes,
                    'resumo': resumo,
                })
            rows = conn.execute(
                f'''SELECT i.*,
                           (SELECT COUNT(*) FROM {t_lin} il WHERE il.inventario_id = i.id) AS total_linhas,
                           (SELECT COUNT(*) FROM {t_lin} il WHERE il.inventario_id = i.id AND COALESCE(il.status_linha, 'pendente') = 'conferido') AS conferidas,
                           (SELECT COUNT(*) FROM {t_lin} il WHERE il.inventario_id = i.id AND COALESCE(il.status_linha, 'pendente') = 'pendente') AS pendentes
                    FROM {t_inv} i ORDER BY i.id DESC LIMIT 50'''
            ).fetchall()
            conn.close()
            invs = []
            for r in rows:
                d = _row_dict(r) or {}
                invs.append(d)
            return jsonify({'inventarios': invs})
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({'erro': str(e)}), 500

    data = request.get_json() or {}
    acao = (data.get('acao') or 'criar').strip()
    now = _now_iso()
    try:
        if acao == 'bip':
            iid = data.get('inventario_id')
            if not iid:
                conn.close()
                return jsonify({'erro': 'Informe inventario_id.'}), 400
            linha, err = _inventario_registrar_bip(conn, int(iid), data.get('item') or data)
            if err:
                conn.close()
                return jsonify({'erro': err}), 400
            conn.commit()
            resumo = _inventario_resumo_linhas(conn, int(iid))
            conn.close()
            return jsonify({
                'ok': True,
                'linha': linha,
                'status_linha': linha.get('status_linha'),
                'resumo': resumo,
                'mensagem': 'Conferido com sucesso.' if linha.get('status_linha') == 'conferido'
                else ('Divergência registrada — item separado na lista de divergências.'
                      if linha.get('status_linha') == 'divergente' else 'Item não estava na lista — registrado como extra.'),
            })

        if acao == 'aplicar_base':
            iid = data.get('inventario_id')
            if not iid:
                conn.close()
                return jsonify({'erro': 'Informe inventario_id.'}), 400
            result, err = _inventario_aplicar_base(conn, int(iid))
            if err:
                conn.close()
                return jsonify({'erro': err}), 400
            conn.commit()
            conn.close()
            return jsonify({
                'ok': True,
                'atualizados': result.get('atualizados', 0),
                'mensagem': f'Base atualizada com {result.get("atualizados", 0)} item(ns) divergente(s). Inventário finalizado.',
            })

        if acao == 'finalizar':
            iid = data.get('inventario_id')
            if not iid:
                conn.close()
                return jsonify({'erro': 'Informe inventario_id.'}), 400
            if _is_pg(conn):
                conn.execute(
                    f"UPDATE {t_inv} SET status = 'finalizado', finalizado_em = NOW() WHERE id = ?",
                    (int(iid),),
                )
            else:
                conn.execute(
                    f"UPDATE {t_inv} SET status = 'finalizado', finalizado_em = ? WHERE id = ?",
                    (now, int(iid)),
                )
            conn.commit()
            conn.close()
            return jsonify({'ok': True})

        if acao == 'excluir':
            iid = data.get('inventario_id')
            if not iid:
                conn.close()
                return jsonify({'erro': 'Informe inventario_id.'}), 400
            inv = conn.execute(f'SELECT id FROM {t_inv} WHERE id = ?', (int(iid),)).fetchone()
            if not inv:
                conn.close()
                return jsonify({'erro': 'Inventário não encontrado.'}), 404
            conn.execute(f'DELETE FROM {t_lin} WHERE inventario_id = ?', (int(iid),))
            conn.execute(f'DELETE FROM {t_inv} WHERE id = ?', (int(iid),))
            conn.commit()
            conn.close()
            return jsonify({'ok': True, 'mensagem': 'Inventário excluído.'})

        if acao == 'contar':
            conn.execute(
                f'''INSERT INTO {t_lin}
                    (inventario_id, localizacao_id, palete_etiqueta, sku, status_esperado, status_informado,
                     quantidade_contada, divergencia, contado_em, contado_por)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    data.get('inventario_id'), data.get('localizacao_id'), data.get('palete_etiqueta'),
                    data.get('sku'), data.get('status_esperado'), data.get('status_informado'),
                    data.get('quantidade_contada'), 1 if data.get('divergencia') else 0,
                    now, _usuario(),
                ),
            )
            conn.commit()
            conn.close()
            return jsonify({'ok': True})

        tipo = data.get('tipo') or 'produto'
        desc = (data.get('descricao') or '').strip() or f'Inventário {now[:10]}'
        filtro_cam = data.get('camara')
        if filtro_cam in ('', None):
            filtro_cam = None
        else:
            filtro_cam = int(filtro_cam)

        if _is_pg(conn):
            cur = conn.execute(
                f"INSERT INTO {t_inv} (tipo, descricao, status, criado_em, criado_por) VALUES (?, ?, 'ativo', NOW(), ?) RETURNING id",
                (tipo, desc, _usuario()),
            )
            iid = cur.fetchone()['id']
        else:
            conn.execute(
                f"INSERT INTO {t_inv} (tipo, descricao, status, criado_em, criado_por) VALUES (?, ?, 'ativo', ?, ?)",
                (tipo, desc, now, _usuario()),
            )
            iid = conn.execute('SELECT last_insert_rowid()').fetchone()[0]

        if tipo == 'produto':
            estoque = _inventario_snapshot_estoque(conn, filtro_cam)
            for row in estoque:
                conn.execute(
                    f'''INSERT INTO {t_lin}
                        (inventario_id, localizacao_id, palete_item_id, palete_etiqueta, sku, descricao,
                         lote, data_producao, data_validade, quantidade_esperada, rg_caixa, codigo_endereco,
                         status_linha, status_esperado)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'ocupada')''',
                    (
                        iid,
                        row.get('localizacao_id'),
                        row.get('palete_item_id'),
                        row.get('palete_etiqueta'),
                        row.get('sku'),
                        row.get('descricao'),
                        row.get('lote'),
                        row.get('data_producao'),
                        row.get('data_validade'),
                        int(row.get('quantidade_caixas') or 0),
                        row.get('rg_caixa'),
                        row.get('codigo_endereco'),
                    ),
                )
            n_linhas = len(estoque)
        else:
            sql_loc = f"SELECT id, status FROM {t_loc} WHERE 1=1"
            params = []
            if filtro_cam:
                sql_loc += ' AND camara = ?'
                params.append(filtro_cam)
            if tipo == 'vazio_ocupado_vazio':
                sql_loc += " AND status = 'vazia'"
            elif tipo == 'vazio_ocupado_ocupado':
                sql_loc += " AND status = 'ocupada'"
            locs = conn.execute(sql_loc, tuple(params)).fetchall()
            for loc in locs:
                ld = _row_dict(loc) or {}
                conn.execute(
                    f'''INSERT INTO {t_lin} (inventario_id, localizacao_id, status_esperado, status_linha)
                        VALUES (?, ?, ?, 'pendente')''',
                    (iid, ld.get('id'), ld.get('status')),
                )
            n_linhas = len(locs)

        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'id': iid, 'linhas': n_linhas})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/zoneamento', methods=['GET'])
def api_wms_zoneamento():
    conn = _db()
    ensure_wms_schema(conn)
    _seed_wms_defaults(conn)
    try:
        zona = _listar_zoneamento(conn)
        conn.close()
        return jsonify({'zoneamento': zona})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/sequencia-rota', methods=['GET'])
def api_wms_sequencia_rota_get():
    conn = None
    try:
        conn = _db()
        ensure_wms_schema(conn)
        linhas = _listar_sequencia_rota(conn)
        conn.close()
        return jsonify({'ok': True, 'sequencia_rota': linhas})
    except Exception as e:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass
        return jsonify({'ok': True, 'sequencia_rota': _listar_sequencia_rota(None), 'aviso': str(e)})


@bp.route('/sequencia-rota', methods=['POST'])
def api_wms_sequencia_rota_post():
    conn = _db()
    ensure_wms_schema(conn)
    data = request.get_json() or {}
    linhas = data.get('linhas') or data.get('sequencia_rota') or []
    try:
        n = _salvar_sequencia_rota(conn, linhas)
        _invalidate_wms_painel_cache()
        out = _listar_sequencia_rota(conn)
        conn.close()
        return jsonify({'ok': True, 'salvas': n, 'sequencia_rota': out})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


def _loc_etiqueta_data(loc, nomes_camara=None):
    """Dados para etiqueta de longarina (Câmara · Coluna · Nível + barcode 12.14.1*DV)."""
    d = _row_dict(loc) or {}
    cam = int(d.get('camara') or 0)
    rua = str(d.get('rua') or '').strip().upper()
    pos = int(d.get('posicao') or 0)
    niv = int(d.get('nivel') or 1)
    apto = _rua_para_apto(cam, rua)
    cod = (d.get('codigo_endereco') or _codigo_endereco(cam, rua, pos, niv)).upper()
    bc_long = _barcode_longarina(cam, pos, niv, apto=apto)
    tipo = (d.get('tipo') or '').strip().lower()
    area = (d.get('area') or '').strip().lower()
    labels = _destinos_acao_labels()
    destino_label = labels.get(area) if tipo == 'destino_fixo' and area else None
    picking = (niv == 1 or (d.get('zona_armazenagem') or '').lower() == 'picking') and not destino_label
    cam_nome = _nome_camara_label(None, cam, nomes_camara)
    return {
        'rua_num': str(cam),
        'rua_letra': rua,
        'predio': str(pos),
        'nivel': str(niv),
        'apto': str(apto),
        'camara': str(cam),
        'camara_nome': cam_nome,
        'codigo': cod,
        'codigo_wms': cod,
        'barcode': bc_long,
        'dotted': bc_long,
        'picking': picking,
        'destino_fixo': bool(destino_label),
        'destino_label': destino_label,
        'zona': destino_label or ('PICKING' if picking else 'PULMÃO'),
        'cat': (d.get('categoria_zona') or d.get('area') or '').strip().upper(),
        'texto_humano': _texto_endereco_humanizado(
            cam, rua, pos, niv,
            zona_label='PICKING' if picking else ('PULMÃO' if not destino_label else None),
            destino_label=destino_label,
        ),
    }


def _agrupar_etiquetas_faixas(loc_rows, nomes_camara=None):
    """Agrupa localizações em faixas (coluna = mesma rua+prédio+apto, níveis ordenados)."""
    grupos = {}
    for loc in loc_rows:
        e = _loc_etiqueta_data(loc, nomes_camara=nomes_camara)
        chave = (e['rua_num'], e.get('rua_letra') or '', e['predio'], e['apto'])
        grupos.setdefault(chave, []).append(e)
    faixas = []
    for (rua_num, rua_letra, predio, apto), etiquetas in sorted(
        grupos.items(), key=lambda x: (int(x[0][0]), str(x[0][1]), int(x[0][2]), int(x[0][3])),
    ):
        etiquetas.sort(key=lambda x: int(x['nivel']))
        letra_txt = f' · Rua {rua_letra}' if rua_letra else ''
        faixas.append({
            'titulo': f'Câmara {rua_num}{letra_txt} · Col {predio}',
            'camara': rua_num,
            'etiquetas': etiquetas,
        })
    total = sum(len(f['etiquetas']) for f in faixas)
    return faixas, total


def _agrupar_faixas_por_camara(faixas, nomes_camara=None):
    blocos = {}
    for f in faixas:
        cam = str((f.get('camara') or (f.get('etiquetas') or [{}])[0].get('rua_num') or ''))
        if cam not in blocos:
            cam_i = int(cam) if str(cam).isdigit() else 0
            blocos[cam] = {
                'camara': cam,
                'camara_nome': _nome_camara_label(None, cam_i, nomes_camara) if cam_i else ('Câmara %s' % cam),
                'faixas': [],
                'total_niveis': 0,
            }
        blocos[cam]['faixas'].append(f)
        blocos[cam]['total_niveis'] += len(f.get('etiquetas') or [])
    return [blocos[k] for k in sorted(blocos.keys(), key=lambda x: int(x) if str(x).isdigit() else x)]


def _opcoes_impressao_longarina(conn):
    """Câmaras, ruas e colunas do layout para filtros de impressão de etiquetas."""
    # Opções vêm do layout JSON — não regenera banco aqui (evita 502).
    nomes = {}
    db_cols = {}
    if conn is not None:
        try:
            nomes = _map_nomes_camaras(conn)
        except Exception:
            nomes = {}
        try:
            t_loc = _tbl(conn, 'wms_localizacao')
            rows_db = conn.execute(
                f'''SELECT camara, UPPER(TRIM(rua)) AS rua, posicao, COUNT(DISTINCT nivel) AS niveis
                    FROM {t_loc}
                    WHERE camara IN ({_WMS_CAMARAS_ESTOQUE_SQL})
                    GROUP BY camara, UPPER(TRIM(rua)), posicao''',
            ).fetchall()
            for r in rows_db or []:
                rd = _row_dict(r) or {}
                key = (int(rd.get('camara') or 0), str(rd.get('rua') or '').upper(), int(rd.get('posicao') or 0))
                db_cols[key] = int(rd.get('niveis') or 0)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            db_cols = {}

    camaras_out = []
    for bloco in (_layout_camaras_config().get('camaras') or []):
        cod = int(bloco['codigo'])
        if cod not in _WMS_CAMARAS_ESTOQUE:
            continue
        niveis = max(1, int(bloco.get('niveis') or 5))
        ruas_map = {}
        try:
            coords = _coords_from_bloco_layout(bloco)
        except Exception:
            coords = []
        # Inclui estoque e destinos — etiqueta longarina existe em ambos.
        for _cam, rua, pos, _niv, _dest_acao, _dest_lbl, _apenas_rotulo in coords:
            rua = str(rua or '').strip().upper()
            if not rua:
                continue
            try:
                pos_i = int(pos)
            except Exception:
                continue
            if pos_i <= 0:
                continue
            ruas_map.setdefault(rua, set()).add(pos_i)
        # Fallback: banco
        if not ruas_map:
            for (c_cam, c_rua, c_pos), _nb in db_cols.items():
                if c_cam != cod or not c_rua:
                    continue
                ruas_map.setdefault(c_rua, set()).add(int(c_pos))
        # Fallback: gera a partir de ruas/níveis/total do JSON (nunca deixa select vazio).
        if not ruas_map:
            try:
                total = _total_posicoes_ref(cod, bloco)
                for _c, r, p, _n in _gerar_coordenadas_camara(
                    cod, bloco.get('ruas'), niveis, total,
                ):
                    ruas_map.setdefault(str(r).upper(), set()).add(int(p))
            except Exception:
                pass
        if not ruas_map:
            for r in (bloco.get('ruas') or []):
                ru = str(r or '').strip().upper()
                if ru:
                    ruas_map[ru] = set(range(1, 16))
        ruas_out = []
        for rua in sorted(ruas_map.keys()):
            colunas = []
            for pos in sorted(ruas_map[rua]):
                n_banco = db_cols.get((cod, rua, pos), 0)
                colunas.append({
                    'posicao': pos,
                    'niveis': niveis,
                    'niveis_banco': n_banco,
                })
            ruas_out.append({
                'letra': rua,
                'colunas': colunas,
                'total_colunas': len(colunas),
            })
        camaras_out.append({
            'codigo': cod,
            'nome': _nome_camara_label(conn, cod, nomes),
            'niveis': niveis,
            'ruas': ruas_out,
            'total_colunas': sum(r['total_colunas'] for r in ruas_out),
        })
    camaras_out.sort(key=lambda x: x['codigo'])
    return {
        'ok': True,
        'camaras': camaras_out,
        'niveis_padrao': max((c['niveis'] for c in camaras_out), default=5),
    }


def _resumo_etiquetas_longarina(conn, sincronizar=False):
    """Contagem de endereços/longarinas para impressão em lote."""
    niveis_cfg = _layout_niveis_esperados()
    n_esp = max(niveis_cfg.values()) if niveis_cfg else 5
    # Só regenera com sync=1 explícito (Atualizar resumo). GET normal não pode derrubar o Render.
    if sincronizar:
        try:
            _ensure_layout_enderecos_atualizado(conn)
        except Exception as exc:
            try:
                print('[wms/etq-resumo] sync falhou:', exc, flush=True)
            except Exception:
                pass
            try:
                conn.rollback()
            except Exception:
                pass
    t_loc = _tbl(conn, 'wms_localizacao')
    try:
        total = _int_col(conn.execute(f'SELECT COUNT(*) AS c FROM {t_loc}').fetchone(), 'c')
        mx = _int_col(conn.execute(f'SELECT MAX(nivel) AS mx FROM {t_loc}').fetchone(), 'mx')
        incompletas = _int_col(conn.execute(
            f'''SELECT COUNT(*) AS c FROM (
                    SELECT camara, posicao, rua FROM {t_loc}
                    GROUP BY camara, posicao, rua
                    HAVING COUNT(DISTINCT nivel) < ?
                ) t''',
            (n_esp,),
        ).fetchone(), 'c')
        rows_cam = conn.execute(
            f'''SELECT camara, COUNT(*) AS etiquetas
                FROM {t_loc} GROUP BY camara ORDER BY camara''',
        ).fetchall()
        colunas = conn.execute(
            f'''SELECT camara, rua, posicao, COUNT(*) AS niveis
                FROM {t_loc}
                GROUP BY camara, rua, posicao
                ORDER BY camara, rua, posicao''',
        ).fetchall()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return {
            'ok': True,
            'total_etiquetas': 0,
            'total_colunas': 0,
            'max_nivel_banco': 0,
            'niveis_config': n_esp,
            'colunas_incompletas': 0,
            'por_camara': [],
        }
    por_camara = []
    cols_por_cam = {}
    for c in colunas or []:
        rd = _row_dict(c) or {}
        cam = int(rd.get('camara') or 0)
        cols_por_cam[cam] = cols_por_cam.get(cam, 0) + 1
    for r in rows_cam or []:
        rd = _row_dict(r) or {}
        cam = int(rd.get('camara') or 0)
        por_camara.append({
            'camara': cam,
            'etiquetas': int(rd.get('etiquetas') or 0),
            'colunas': cols_por_cam.get(cam, 0),
        })
    return {
        'total_etiquetas': total,
        'total_colunas': len(colunas or []),
        'niveis_config': n_esp,
        'max_nivel_banco': mx,
        'colunas_incompletas': incompletas,
        'por_camara': por_camara,
    }


def _sintetizar_loc_rows_coluna(camara, rua, posicao, niveis=None):
    """Gera linhas virtuais de etiqueta a partir do layout (sem depender do banco)."""
    cam = int(camara)
    rua_u = str(rua or '').strip().upper()
    pos = int(posicao)
    if not cam or not rua_u or pos <= 0:
        return []
    n_esp = int(niveis or 0) or int(_layout_niveis_esperados().get(cam) or 5)
    n_esp = max(1, min(n_esp, 10))
    rows = []
    for niv in range(1, n_esp + 1):
        rows.append({
            'camara': cam,
            'rua': rua_u,
            'posicao': pos,
            'nivel': niv,
            'codigo_endereco': _codigo_endereco(cam, rua_u, pos, niv),
            'zona_armazenagem': 'picking' if niv == 1 else 'pulmao',
            'tipo': 'porta_palete',
            'area': '',
            'categoria_zona': '',
            'status': 'vazia',
        })
    return rows


def _sintetizar_loc_row_codigo(codigo):
    """Uma etiqueta virtual a partir de 11-A-01-1 ou 11.1.1."""
    raw = (codigo or '').strip()
    if not raw:
        return None
    cod = _resolver_codigo_endereco_bip(raw) or raw
    up = str(cod).strip().upper().replace(' ', '')
    m = re.match(r'^(\d{1,2})-([A-Z]{1,3})-(\d{1,2})-(\d{1,2})$', up)
    if m:
        cam, rua_l, pos, niv = m.groups()
        return {
            'camara': int(cam),
            'rua': rua_l,
            'posicao': int(pos),
            'nivel': int(niv),
            'codigo_endereco': _codigo_endereco(int(cam), rua_l, int(pos), int(niv)),
            'zona_armazenagem': 'picking' if int(niv) == 1 else 'pulmao',
            'tipo': 'porta_palete',
            'area': '',
            'categoria_zona': '',
            'status': 'vazia',
        }
    m3 = re.match(r'^(\d+)\.(\d+)\.(\d+)$', raw.replace(' ', ''))
    if m3:
        cam, pos, niv = (int(x) for x in m3.groups())
        rua_l = _apto_para_rua(cam, 1)
        return {
            'camara': cam,
            'rua': rua_l,
            'posicao': pos,
            'nivel': niv,
            'codigo_endereco': _codigo_endereco(cam, rua_l, pos, niv),
            'zona_armazenagem': 'picking' if niv == 1 else 'pulmao',
            'tipo': 'porta_palete',
            'area': '',
            'categoria_zona': '',
            'status': 'vazia',
        }
    return None


def _buscar_rows_etiquetas_endereco(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    """Linhas de wms_localizacao para impressão de longarina.

    Não regenera layout aqui — force/sync de níveis estoura timeout (502) no Render.
    Se o banco não tiver a coluna/endereço, sintetiza a partir do layout/código.
    """
    try:
        _ensure_zona_armazenagem_column(conn)
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass

    t_loc = _tbl(conn, 'wms_localizacao')

    def _buscar():
        if codigo:
            cod_busca = _resolver_codigo_endereco_bip(codigo, conn=conn) or codigo
            cod_u = str(cod_busca).strip().upper()
            # Aceita código WMS (11-A-01-1) e bip longarina (11.1.1).
            try:
                row = conn.execute(
                    f'''SELECT * FROM {t_loc}
                        WHERE UPPER(TRIM(codigo_endereco)) = ?
                           OR UPPER(TRIM(codigo_endereco)) = ?''',
                    (cod_u, str(codigo).strip().upper()),
                ).fetchone()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                row = None
            if row:
                return [row]
            # Fallback por partes do endereço WMS.
            m = re.match(r'^(\d{1,2})-([A-Z]{1,3})-(\d{1,2})-(\d{1,2})$', cod_u)
            if m:
                cam, rua_l, pos, niv = m.groups()
                try:
                    row = conn.execute(
                        f'''SELECT * FROM {t_loc}
                            WHERE camara = ? AND UPPER(TRIM(rua)) = ?
                              AND posicao = ? AND nivel = ?''',
                        (int(cam), rua_l, int(pos), int(niv)),
                    ).fetchone()
                except Exception:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    row = None
                if row:
                    return [row]
            synth = _sintetizar_loc_row_codigo(codigo)
            return [synth] if synth else []
        sql = f'SELECT * FROM {t_loc} WHERE 1=1'
        params = []
        if not todas:
            if camara:
                sql += ' AND camara = ?'
                params.append(int(camara))
            if rua:
                sql += ' AND UPPER(TRIM(rua)) = ?'
                params.append(str(rua).strip().upper())
            if posicao:
                sql += ' AND posicao = ?'
                params.append(int(posicao))
        sql += ' ORDER BY camara, rua, posicao, nivel'
        try:
            return conn.execute(sql, tuple(params)).fetchall()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            return []

    rows = _buscar()
    if rows:
        return rows

    # Dropdowns vêm do layout JSON — imprimir mesmo sem linhas no banco.
    if codigo:
        synth = _sintetizar_loc_row_codigo(codigo)
        return [synth] if synth else []
    if camara and rua and posicao and not todas:
        return _sintetizar_loc_rows_coluna(camara, rua, posicao)
    if camara and not todas and not rua and not posicao:
        out = []
        for bloco in (_layout_camaras_config().get('camaras') or []):
            if int(bloco.get('codigo') or 0) != int(camara):
                continue
            niveis = max(1, int(bloco.get('niveis') or 5))
            try:
                coords = _coords_from_bloco_layout(bloco)
            except Exception:
                coords = []
            seen = set()
            for _cam, rua_c, pos_c, _niv, dest_acao, _dest_lbl, _apenas in coords:
                if dest_acao:
                    continue
                rua_u = str(rua_c or '').strip().upper()
                pos_i = int(pos_c or 0)
                key = (rua_u, pos_i)
                if not rua_u or pos_i <= 0 or key in seen:
                    continue
                seen.add(key)
                out.extend(_sintetizar_loc_rows_coluna(camara, rua_u, pos_i, niveis=niveis))
            break
        return out
    return []


def _zpl_escape(texto):
    return (str(texto or '')
            .replace('\\', '\\\\')
            .replace('^', '\\^')
            .replace('~', '\\~'))


def _zpl_cabecalho():
    """Cabeçalho ZPL ZD220 — dots, sem ^MUm (quebra barcode)."""
    pw, ll = zpl_dimensoes_dots()
    return [
        '^XA',
        '^MMT',
        f'^PW{pw}',
        f'^LL{ll}',
        '^LH0,0',
        '^LS0',
        '^LT0',
        '^CI28',
    ]


def _zpl_calibrar_media():
    """Calibra gap/sensor antes do lote (uma etiqueta em branco pode sair)."""
    return '^XA^JMA^XZ'


def _zpl_etiqueta_longarina(e, dpi=203):
    """ZPL longarina 60×40 — template validado ZD220 (472×315 dots)."""
    w, h = zpl_dimensoes_dots()
    y2, y3, col_w = zpl_longarina_grid_dots()

    cam = _zpl_escape(e.get('camara') or e.get('rua_num') or '')
    rua = _zpl_escape(e.get('rua_letra') or '-')
    col = _zpl_escape(e.get('predio') or '')
    niv = _zpl_escape(e.get('nivel') or '')
    bc = _zpl_escape(e.get('barcode') or '')
    cod = _zpl_escape(e.get('codigo_wms') or e.get('codigo') or bc)

    partes = _zpl_cabecalho()
    partes += [
        f'^FO0,0^GB{w},{h},5^FS',
        f'^FO0,{y2}^GB{w},3,3^FS',
        f'^FO0,{y3}^GB{w},3,3^FS',
    ]
    cols = [
        ('CAMARA', cam),
        ('RUA', rua),
        ('COLUNA', col),
        ('NIVEL', niv),
    ]
    for i, (lbl, val) in enumerate(cols):
        x = i * col_w
        val_len = len(str(val or ''))
        fs_val = 44 if val_len > 2 else 58
        if lbl == 'RUA' and val_len == 1:
            fs_val = 54
        partes.append(f'^FO{x},6^FB{col_w},1,0,C^A0N,15,15^FD{lbl}^FS')
        partes.append(f'^FO{x},28^FB{col_w},1,0,C^A0N,{fs_val},{fs_val}^FD{val}^FS')
        if i < 3:
            partes.append(f'^FO{x + col_w},0^GB3,{y2},3^FS')

    bc_h = max(72, min(108, y3 - y2 - 44))
    bc_y = y2 + 4
    bc_x = max(28, (w - int(len(bc or '') * 14 + 80)) // 2)
    partes.append(f'^FO{bc_x},{bc_y}^BY2,3,{bc_h}^BCN,{bc_h},N,N,N^FD{bc}^FS')
    cod_y = y2 + bc_h + 10
    if cod_y < y3 - 6:
        partes.append(f'^FO0,{cod_y}^FB{w},1,0,C^A0N,22,22^FD{cod}^FS')

    foot_y = y3 + max(10, (h - y3 - 28) // 2)
    if e.get('destino_fixo'):
        zona = _zpl_escape(e.get('destino_label') or e.get('zona') or '')
        partes.append(f'^FO0,{foot_y}^FB{w},1,0,C^A0N,26,26^FD{zona}^FS')
    elif e.get('picking'):
        partes.append(f'^FO18,{foot_y}^A0N,34,34^FDPICKING^FS')
        partes.append(f'^FO{w - 44},{foot_y - 2}^A0N,38,38^FDv^FS')
    else:
        partes.append(f'^FO18,{foot_y}^A0N,34,34^FDPULMAO^FS')
        partes.append(f'^FO{w - 44},{foot_y - 2}^A0N,38,38^FD\\^FS')

    partes.append('^XZ')
    return '\n'.join(partes)


def _zpl_etiqueta_palete(
    etiqueta, sku=None, lote=None, qtd=None, descricao=None,
    data_producao=None, data_validade=None, codigo_wms=None,
    endereco_barcode=None, camara=None, up=None,
):
    """ZPL palete 60×40 — layout simples em dots (472×315)."""
    w, h = zpl_dimensoes_dots()
    etq = _zpl_escape(etiqueta or '')
    top = 0
    partes = _zpl_cabecalho()
    partes.append(f'^FO0,0^GB{w},{h},4^FS')

    dest = (codigo_wms or endereco_barcode or '').strip()
    if dest:
        head_h = 55
        partes.append(f'^FO0,0^GB{w},{head_h},{head_h}^FS')
        partes.append(f'^FO8,10^A0N,14,14^FR^FDGUARDAR EM^FS')
        partes.append(f'^FO72,8^A0N,28,28^FR^FD{_zpl_escape(dest)}^FS')
        if camara:
            partes.append(f'^FO{w - 100},10^A0N,18,18^FR^FDCam {_zpl_escape(camara)}^FS')
        top = head_h

    y = top + 8
    partes.append(f'^FO8,{y}^A0N,16,16^FDULTRAPAO - WMS^FS')
    bc_h = 72
    bc_y = y + 22
    partes.append(f'^FO8,{bc_y}^BY2,3,{bc_h}^BCN,{bc_h},N,N,N^FD{etq}^FS')
    partes.append(f'^FO8,{bc_y + bc_h + 6}^A0N,16,16^FD{etq}^FS')

    x = 190
    y2 = top + 10
    lh = 18
    partes.append(f'^FO{x},{y2}^A0N,{lh},{lh}^FDSKU {_zpl_escape(sku or "-")}^FS')
    partes.append(f'^FO{x},{y2 + 28}^A0N,{lh},{lh}^FDLOTE {_zpl_escape(lote or "-")}^FS')
    qtd_txt = str(qtd) if qtd is not None else '-'
    if up:
        qtd_txt += f' UP {up}'
    partes.append(f'^FO{x},{y2 + 56}^A0N,{lh},{lh}^FDCX {_zpl_escape(qtd_txt)}^FS')
    partes.append(f'^FO{x},{y2 + 84}^A0N,{lh},{lh}^FDPROD {_zpl_escape((data_producao or "-")[:10])}^FS')
    partes.append(f'^FO{x},{y2 + 112}^A0N,{lh},{lh}^FDVAL {_zpl_escape((data_validade or "-")[:10])}^FS')
    desc = _zpl_escape((descricao or '-')[:48])
    partes.append(f'^FO8,{top + 200}^A0N,{lh},{lh}^FD{desc}^FS')

    partes.append('^XZ')
    return '\n'.join(partes)


def _zpl_api_url_longarina(codigo=None, todas=False, camara=None, rua=None, posicao=None):
    if codigo:
        return f'/api/wms/etiqueta/endereco/zpl?codigo={quote(codigo)}'
    if todas:
        return '/api/wms/etiqueta/enderecos/zpl?todas=1'
    if camara and rua and posicao:
        return (
            f'/api/wms/etiqueta/enderecos/zpl?camara={camara}&rua={quote(rua)}&posicao={posicao}'
        )
    if camara:
        return f'/api/wms/etiqueta/enderecos/zpl?camara={camara}'
    return '/api/wms/etiqueta/enderecos/zpl'


def _zpl_api_url_palete(etiqueta, sku=None, lote=None, qtd=None, descricao=None,
                        data_producao=None, data_validade=None, codigo_wms=None,
                        endereco_barcode=None, camara=None, up=None):
    params = {
        'etiqueta': etiqueta,
        'sku': sku,
        'lote': lote,
        'qtd': qtd,
        'descricao': descricao,
        'data_producao': data_producao,
        'data_validade': data_validade,
        'codigo_wms': codigo_wms,
        'barcode_longarina': endereco_barcode,
        'camara': camara,
        'up': up,
    }
    clean = {k: v for k, v in params.items() if v is not None and v != ''}
    return '/api/wms/etiqueta/zpl?' + urlencode(clean)


def _zpl_etiqueta_teste_calibracao(swap=False):
    """Etiqueta teste — borda deve encostar nos 4 lados."""
    w, h = zpl_dimensoes_dots()
    if swap:
        w, h = h, w
    rot = ' (40x60)' if swap else ''
    return '\n'.join([
        '^XA', '^MMT', f'^PW{w}', f'^LL{h}', '^LH0,0', '^LS0', '^LT0', '^CI28',
        f'^FO0,0^GB{w},{h},6^FS',
        f'^FO0,{int(h * 0.32)}^FB{w},1,0,C^A0N,36,36^FDTESTE{rot}^FS',
        f'^FO0,{int(h * 0.52)}^FB{w},1,0,C^A0N,22,22^FDBorda = etiqueta^FS',
        '^XZ',
    ])


def _list_etiquetas_endereco(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    rows = _buscar_rows_etiquetas_endereco(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if not rows:
        return None, 'Nenhum endereço encontrado. Use o painel WMS → «Recalcular distribuição» ou clique em Atualizar resumo na aba Etiquetas.'
    nomes_camara = _map_nomes_camaras(conn)
    etiquetas = [_loc_etiqueta_data(loc, nomes_camara=nomes_camara) for loc in rows]
    return etiquetas, None


def _render_etiquetas_endereco_zpl(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    etiquetas, err = _list_etiquetas_endereco(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if err:
        return None, err
    labels = [_zpl_etiqueta_longarina(e) for e in etiquetas]
    zpl = '\n'.join(labels)
    return zpl, None


def _render_etiquetas_endereco_csv(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    """CSV para vincular dados no ZebraDesigner (campos: camara, rua, coluna, nivel, barcode, codigo_wms, zona)."""
    etiquetas, err = _list_etiquetas_endereco(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if err:
        return None, err
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator='\n')
    writer.writerow(['camara', 'rua', 'coluna', 'nivel', 'barcode', 'codigo_wms', 'zona', 'picking'])
    for e in etiquetas:
        picking = '1' if e.get('picking') else '0'
        zona = (e.get('zona') or '').strip().upper()
        writer.writerow([
            e.get('camara') or e.get('rua_num') or '',
            e.get('rua_letra') or '',
            e.get('predio') or '',
            e.get('nivel') or '',
            e.get('barcode') or '',
            e.get('codigo_wms') or e.get('codigo') or '',
            zona,
            picking,
        ])
    return buf.getvalue(), None


def _resposta_csv_longarina(csv_text, nome_arquivo='longarinas'):
    safe = re.sub(r'[^\w\-.]+', '_', str(nome_arquivo or 'longarinas'))[:80]
    return make_response('\ufeff' + csv_text, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': f'attachment; filename="{safe}.csv"',
    })


def _formato_longarina_request():
    fmt = (request.args.get('formato') or 'html').strip().lower()
    return fmt if fmt in ('xlsx', 'html') else 'html'


def _etiquetas_endereco_ordenadas(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    rows = _buscar_rows_etiquetas_endereco(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if not rows:
        return None, 'Nenhum endereço encontrado. Use o painel WMS → «Recalcular distribuição» ou clique em Atualizar resumo na aba Etiquetas.'
    nomes_camara = _map_nomes_camaras(conn)
    etiquetas = [_loc_etiqueta_data(r, nomes_camara=nomes_camara) for r in rows]
    etiquetas.sort(key=lambda e: (
        int(e.get('camara') or e.get('rua_num') or 0),
        str(e.get('rua_letra') or ''),
        int(e.get('predio') or 0),
        int(e.get('nivel') or 0),
    ))
    return etiquetas, None


def _render_etiquetas_endereco_xlsx(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False):
    etiquetas, err = _etiquetas_endereco_ordenadas(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if err:
        return None, err
    try:
        return gerar_workbook_longarina(etiquetas), None
    except FileNotFoundError as e:
        return None, str(e)
    except Exception as e:
        return None, f'Erro ao gerar Excel: {e}'


def _nome_arquivo_xlsx_longarina(codigo=None, todas=False, camara=None, rua=None, posicao=None):
    if codigo:
        return re.sub(r'[^\w\-.]+', '_', str(codigo))[:80]
    if todas:
        return 'longarinas_armazem'
    if camara and rua and posicao:
        return f'longarinas_{camara}_{rua}_{posicao}'
    if camara:
        return f'longarinas_camara_{camara}'
    return 'longarinas_lote'


def _resposta_xlsx_longarina(xlsx_bytes, nome_arquivo='longarinas'):
    safe = re.sub(r'[^\w\-.]+', '_', str(nome_arquivo or 'longarinas'))[:80]
    return make_response(xlsx_bytes, 200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': f'attachment; filename="{safe}.xlsx"',
    })


def _rows_etiqueta_layout(codigo=None, camara=None, rua=None, posicao=None, todas=False):
    """Gera linhas de etiqueta só pelo layout/código — sem abrir banco (evita 502)."""
    if codigo:
        row = _sintetizar_loc_row_codigo(codigo)
        return [row] if row else []
    if camara and rua and posicao:
        return _sintetizar_loc_rows_coluna(camara, rua, posicao)
    if camara and not todas:
        out = []
        for bloco in (_layout_camaras_config().get('camaras') or []):
            if int(bloco.get('codigo') or 0) != int(camara):
                continue
            niveis = max(1, int(bloco.get('niveis') or 5))
            try:
                coords = _coords_from_bloco_layout(bloco)
            except Exception:
                coords = []
            seen = set()
            for _cam, rua_c, pos_c, _niv, dest_acao, _dest_lbl, _apenas in coords:
                if dest_acao:
                    continue
                rua_u = str(rua_c or '').strip().upper()
                pos_i = int(pos_c or 0)
                key = (rua_u, pos_i)
                if not rua_u or pos_i <= 0 or key in seen:
                    continue
                seen.add(key)
                out.extend(_sintetizar_loc_rows_coluna(camara, rua_u, pos_i, niveis=niveis))
            break
        return out
    if todas:
        out = []
        for bloco in (_layout_camaras_config().get('camaras') or []):
            cod = int(bloco.get('codigo') or 0)
            if cod not in _WMS_CAMARAS_ESTOQUE:
                continue
            out.extend(_rows_etiqueta_layout(camara=cod))
            # Limite de segurança para não estourar memória no Render.
            if len(out) >= 2500:
                break
        return out
    return []


def _render_etiquetas_endereco(
    conn=None, camara=None, rua=None, posicao=None, codigo=None,
    auto_print=False, todas=False, rows=None, so_layout=False,
):
    """Render HTML das etiquetas. Preferir so_layout=True (sem banco)."""
    if rows is None:
        if so_layout or conn is None:
            rows = _rows_etiqueta_layout(
                codigo=codigo, camara=camara, rua=rua, posicao=posicao, todas=todas,
            )
        else:
            try:
                rows = _buscar_rows_etiquetas_endereco(
                    conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
                )
            except Exception:
                rows = []
            if not rows:
                rows = _rows_etiqueta_layout(
                    codigo=codigo, camara=camara, rua=rua, posicao=posicao, todas=todas,
                )
    if not rows:
        return None, 'Nenhum endereço para imprimir. Verifique câmara/rua/coluna ou o código informado.'
    nomes_camara = {}
    if conn is not None and not so_layout:
        try:
            nomes_camara = _map_nomes_camaras(conn)
        except Exception:
            nomes_camara = {}
    faixas, total = _agrupar_etiquetas_faixas(rows, nomes_camara=nomes_camara)
    if codigo:
        titulo = codigo
    elif todas:
        titulo = 'Armazém completo'
    elif camara and rua and posicao:
        titulo = f'Coluna câm {camara} · rua {rua} · pos {posicao}'
    elif camara:
        titulo = _nome_camara_label(None, camara, nomes_camara)
    else:
        titulo = 'Lote'
    agrupado = _agrupar_faixas_por_camara(faixas, nomes_camara=nomes_camara) if (todas or (camara and not rua and not posicao)) else None
    html = render_template(
        'wms/etiquetas_endereco.html',
        faixas=faixas,
        agrupado_por_camara=agrupado,
        total=total,
        titulo=titulo,
        auto_print=auto_print,
        **ctx_etiqueta_zebra(),
    )
    return html, None


def _texto_destino_etiqueta(sug):
    """Texto do endereço para etiqueta de palete e UI."""
    if not sug or not sug.get('codigo_endereco'):
        return None, None, None, None
    bc = (sug.get('barcode_longarina') or '').strip()
    cod_wms = (sug.get('codigo_wms') or sug.get('codigo_endereco') or '').strip().upper()
    if not bc and sug.get('camara') and sug.get('rua_letra'):
        bc = _barcode_longarina(
            sug['camara'], sug.get('predio') or sug.get('posicao'),
            sug.get('nivel'), rua=sug.get('rua_letra'),
        )
    elif not bc and cod_wms:
        res = _resolver_codigo_endereco_bip(cod_wms)
        if res:
            parts = res.split('-')
            if len(parts) == 4:
                bc = _barcode_longarina(int(parts[0]), int(parts[2]), int(parts[3]), rua=parts[1])
    txt = (sug.get('texto') or '').strip()
    zona = (sug.get('zona_label') or '').strip()
    linha = bc or cod_wms
    if txt:
        linha = f'{bc or cod_wms} — {txt}'
    elif zona:
        linha = f'{bc or cod_wms} ({zona})'
    return linha, bc or None, txt or None, cod_wms or None


def _html_etiqueta_palete(etiqueta, sku=None, lote=None, qtd=None, descricao=None, data_producao=None, data_validade=None, destino=None, endereco_barcode=None, endereco_texto=None, codigo_wms=None, up=None, auto_print=False, camara=None, rua=None, coluna=None, nivel=None, zona=None, zpl_api_url=None):
    return render_template(
        'wms/etiqueta_palete.html',
        etiqueta=etiqueta,
        sku=sku,
        lote=lote,
        qtd=qtd,
        descricao=descricao,
        data_producao=_formatar_data_etiqueta(data_producao),
        data_validade=_formatar_data_etiqueta(data_validade),
        destino=destino,
        endereco_barcode=endereco_barcode,
        endereco_texto=endereco_texto,
        codigo_wms=codigo_wms,
        up=up,
        auto_print=auto_print,
        camara=camara,
        rua=rua,
        coluna=coluna,
        nivel=nivel,
        zona=zona,
        **ctx_etiqueta_zebra(),
    )


@bp.route('/etiqueta', methods=['GET'])
def api_wms_etiqueta():
    etiqueta = (request.args.get('etiqueta') or '').strip()
    if not etiqueta:
        return jsonify({'erro': 'Informe etiqueta.'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    t_pal = _tbl(conn, 'wms_palete')
    t_item = _tbl(conn, 'wms_palete_item')
    try:
        pal = conn.execute(f'SELECT id FROM {t_pal} WHERE etiqueta = ?', (etiqueta,)).fetchone()
        sku = lote = descricao = data_producao = data_validade = up = None
        qtd = None
        destino = (request.args.get('destino') or '').strip() or None
        endereco_barcode = (request.args.get('barcode_longarina') or '').strip() or None
        endereco_texto = (request.args.get('endereco_texto') or '').strip() or None
        codigo_wms = (request.args.get('codigo_wms') or '').strip().upper() or None
        sug_putaway = None
        if pal:
            pid = pal['id'] if isinstance(pal, dict) else pal[0]
            it = conn.execute(
                f'''SELECT sku, descricao, lote, data_producao, data_validade, quantidade_caixas, rg_caixa
                    FROM {t_item} WHERE palete_id = ? ORDER BY id DESC LIMIT 1''',
                (pid,),
            ).fetchone()
            if it:
                rd = _row_dict(it) or {}
                sku = rd.get('sku')
                lote = rd.get('lote')
                qtd = rd.get('quantidade_caixas')
                descricao = rd.get('descricao')
                data_producao = rd.get('data_producao')
                data_validade = rd.get('data_validade')
                up = rd.get('rg_caixa')
                if not destino and sku:
                    sug_putaway = _sugerir_putaway(conn, sku, lote, data_producao, 'pulmao')
                    if not sug_putaway.get('codigo_endereco'):
                        sug_pick = _sugerir_putaway(conn, sku, lote, data_producao, 'picking')
                        if sug_pick.get('codigo_endereco'):
                            sug_putaway = sug_pick
                    destino, endereco_barcode, endereco_texto, cod_wms_sug = _texto_destino_etiqueta(sug_putaway)
                    if not codigo_wms:
                        codigo_wms = cod_wms_sug
        auto_print = request.args.get('auto_print', '0') == '1'
        conn.close()
        campos_end = _campos_etiqueta_palete_endereco(
            sug=sug_putaway,
            codigo_wms=codigo_wms,
            endereco_texto=endereco_texto,
        )
        if campos_end.get('endereco_texto'):
            endereco_texto = campos_end['endereco_texto']
        html = _html_etiqueta_palete(
            etiqueta, sku, lote, qtd, descricao, data_producao, data_validade,
            destino=destino,
            endereco_barcode=endereco_barcode,
            endereco_texto=endereco_texto,
            codigo_wms=codigo_wms,
            up=up,
            auto_print=auto_print,
            camara=campos_end.get('camara'),
            rua=campos_end.get('rua'),
            coluna=campos_end.get('coluna'),
            nivel=campos_end.get('nivel'),
            zona=campos_end.get('zona'),
        )
        return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/zpl', methods=['GET'])
def api_wms_etiqueta_palete_zpl():
    """ZPL nativo — etiqueta de palete 60×40 mm."""
    etiqueta = (request.args.get('etiqueta') or '').strip()
    if not etiqueta:
        return jsonify({'erro': 'Informe etiqueta.'}), 400
    qtd = request.args.get('qtd', type=int)
    if qtd is None and request.args.get('qtd'):
        try:
            qtd = int(request.args.get('qtd'))
        except (TypeError, ValueError):
            qtd = None
    zpl = _zpl_etiqueta_palete(
        etiqueta,
        sku=(request.args.get('sku') or '').strip() or None,
        lote=(request.args.get('lote') or '').strip() or None,
        qtd=qtd,
        descricao=(request.args.get('descricao') or '').strip() or None,
        data_producao=(request.args.get('data_producao') or '').strip() or None,
        data_validade=(request.args.get('data_validade') or '').strip() or None,
        codigo_wms=(request.args.get('codigo_wms') or '').strip().upper() or None,
        endereco_barcode=(request.args.get('barcode_longarina') or '').strip() or None,
        camara=(request.args.get('camara') or '').strip() or None,
        up=(request.args.get('up') or '').strip() or None,
    )
    return make_response(zpl, 200, {'Content-Type': 'text/plain; charset=utf-8'})


@bp.route('/etiqueta/teste-driver', methods=['GET'])
def api_wms_etiqueta_teste_driver():
    """Página mínima — teste de impressão HTML 60×40."""
    html = render_template(
        'wms/etiqueta_teste_driver.html',
        **ctx_etiqueta_zebra(),
    )
    return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})


@bp.route('/etiqueta/modelo', methods=['GET'])
def api_wms_etiqueta_modelo():
    """Preview dos modelos de etiqueta (sem depender do banco)."""
    tipo = (request.args.get('tipo') or 'endereco').strip().lower()
    if tipo == 'palete':
        html = _html_etiqueta_palete(
            'UP2506021430ABCD1234',
            sku='1234567',
            lote='L202501',
            qtd=48,
            descricao='Pão de forma integral 500g',
            data_producao='01/06/2025',
            data_validade='01/12/2025',
            destino='7.14.1*23 — Câmara 7 · Rua C · Col 14 · Nív 1 (PICKING)',
            endereco_barcode=_barcode_longarina(7, 14, 1, rua='C'),
            endereco_texto='Câmara 7 · Rua C · Col 14 · Nív 1 (PICKING)',
            codigo_wms='07-C-14-1',
            up='5020',
            auto_print=False,
            camara='7',
            rua='C',
            coluna='14',
            nivel='1',
            zona='PICKING',
        )
        return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
    faixas = [{
        'titulo': 'Câm 7 · Rua C · Col 14 · Apto 1 — exemplo (5 níveis)',
        'etiquetas': [
            {'rua_num': '7', 'rua_letra': 'C', 'predio': '14', 'nivel': str(n), 'apto': '1',
             'camara': '7', 'camara_nome': 'Câmara 7',
             'codigo_wms': f'07-C-14-{n}', 'codigo': f'07-C-14-{n}',
             'barcode': _barcode_longarina(7, 14, n, rua='C'),
             'dotted': _barcode_longarina(7, 14, n, rua='C'),
             'picking': n == 1, 'destino_fixo': False, 'destino_label': None,
             'zona': 'PICKING' if n == 1 else 'PULMÃO',
             'texto_humano': f'Câmara 7 · Rua C · Col 14 · Nív {n} ({("PICKING" if n == 1 else "PULMÃO")})'}
            for n in range(1, 6)
        ],
    }]
    if _formato_longarina_request() == 'xlsx':
        try:
            xlsx_bytes = gerar_workbook_longarina(faixas[0]['etiquetas'])
            return _resposta_xlsx_longarina(xlsx_bytes, 'modelo_longarina')
        except Exception as e:
            return jsonify({'erro': str(e)}), 500
    html = render_template(
        'wms/etiquetas_endereco.html',
        faixas=faixas,
        total=5,
        titulo='Modelo',
        auto_print=False,
        **ctx_etiqueta_zebra(),
    )
    return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})


def _quer_formato_html_longarina():
    return (request.args.get('formato') or '').strip().lower() == 'html'


def _url_html_longarina(codigo=None, todas=False, camara=None, rua=None, posicao=None, auto_print=False):
    """URL da prévia HTML (impressão Chrome)."""
    ap = '1' if auto_print else '0'
    if codigo:
        return f'/api/wms/etiqueta/endereco?codigo={quote(codigo)}&auto_print={ap}'
    if todas:
        return f'/api/wms/etiqueta/enderecos?todas=1&auto_print={ap}'
    if camara and rua and posicao:
        return (
            f'/api/wms/etiqueta/enderecos?camara={camara}&rua={quote(rua)}'
            f'&posicao={posicao}&auto_print={ap}'
        )
    if camara:
        return f'/api/wms/etiqueta/enderecos?camara={camara}&auto_print={ap}'
    return f'/api/wms/etiqueta/enderecos?auto_print={ap}'


def _redirect_etiqueta_zebra(**params):
    """Legado — redireciona Browser Print para HTML."""
    codigo = params.get('codigo') or params.get('endereco')
    todas = params.get('todas')
    camara = params.get('camara')
    rua = params.get('rua')
    posicao = params.get('posicao')
    return redirect(_url_html_longarina(
        codigo=codigo,
        todas=str(todas).lower() in ('1', 'true', 'sim', 'all') if todas else False,
        camara=camara,
        rua=rua,
        posicao=posicao,
        auto_print=False,
    ))


def _resposta_zpl_longarina(zpl, nome_arquivo='longarinas', ext='prn'):
    safe = re.sub(r'[^\w\-.]+', '_', str(nome_arquivo or 'longarinas'))[:80]
    ext = str(ext or 'prn').lower()
    if ext not in ('txt', 'prn'):
        ext = 'prn'
    ctype = 'text/plain; charset=utf-8' if ext == 'txt' else 'application/octet-stream'
    if not safe.lower().endswith(f'.{ext}'):
        safe = f'{safe}.{ext}'
    return make_response(zpl, 200, {
        'Content-Type': ctype,
        'Content-Disposition': f'attachment; filename="{safe}"',
    })


def _pagina_zebra_longarina(conn, camara=None, rua=None, posicao=None, codigo=None, todas=False, auto_download=False):
    """Página auxiliar: download ZPL + script Windows (alternativa ao HTML/Chrome)."""
    etiquetas, err = _list_etiquetas_endereco(
        conn, camara=camara, rua=rua, posicao=posicao, codigo=codigo, todas=todas,
    )
    if err:
        return None, err
    total = len(etiquetas)
    if codigo:
        titulo = codigo
        nome_arquivo = f'longarina_{codigo}.txt'
        zpl_api_url = f'/api/wms/etiqueta/endereco/zpl?codigo={quote(codigo)}&ext=txt'
        html_url = f'/api/wms/etiqueta/endereco?codigo={quote(codigo)}&formato=html'
    elif todas:
        titulo = 'Armazém completo'
        nome_arquivo = 'longarinas_armazem.txt'
        zpl_api_url = '/api/wms/etiqueta/enderecos/zpl?todas=1&ext=txt'
        html_url = '/api/wms/etiqueta/enderecos?todas=1&formato=html'
    elif camara and rua and posicao:
        titulo = f'Câm {camara} · {rua} · col {posicao}'
        nome_arquivo = f'longarinas_{camara}_{rua}_{posicao}.txt'
        zpl_api_url = (
            f'/api/wms/etiqueta/enderecos/zpl?camara={camara}&rua={quote(rua)}&posicao={posicao}&ext=txt'
        )
        html_url = f'/api/wms/etiqueta/enderecos?camara={camara}&rua={quote(rua)}&posicao={posicao}&formato=html'
    elif camara:
        titulo = f'Câmara {camara}'
        nome_arquivo = f'longarinas_camara_{camara}.txt'
        zpl_api_url = f'/api/wms/etiqueta/enderecos/zpl?camara={camara}&ext=txt'
        html_url = f'/api/wms/etiqueta/enderecos?camara={camara}&formato=html'
    else:
        titulo = 'Lote'
        nome_arquivo = 'longarinas_lote.txt'
        zpl_api_url = '/api/wms/etiqueta/enderecos/zpl?ext=txt'
        html_url = None
    html = render_template(
        'wms/etiqueta_longarina_zebra.html',
        total=total,
        titulo=titulo,
        zpl_api_url=zpl_api_url,
        nome_arquivo=nome_arquivo,
        html_url=html_url,
        auto_download=auto_download,
        **ctx_etiqueta_zebra(),
    )
    return html, None


@bp.route('/etiqueta/zebra/teste/zpl', methods=['GET'])
def api_wms_etiqueta_zebra_teste_zpl():
    """Etiqueta teste — borda deve encostar nos 4 lados. ?swap=1 testa 40×60 (rótulo na impressora)."""
    swap = (request.args.get('swap') or '').strip().lower() in ('1', 'true', 'sim')
    nome = 'teste_40x60' if swap else 'teste_60x40'
    zpl = _zpl_etiqueta_teste_calibracao(swap=swap)
    ext = request.args.get('ext')
    if ext:
        return _resposta_zpl_longarina(zpl, nome, ext=ext)
    return make_response(zpl, 200, {'Content-Type': 'text/plain; charset=utf-8'})


@bp.route('/etiqueta/zebra', methods=['GET'])
def api_wms_etiqueta_zebra_page():
    """Legado — abre prévia HTML (não usa mais Browser Print)."""
    codigo = (request.args.get('codigo') or request.args.get('endereco') or '').strip() or None
    todas = (request.args.get('todas') or '').strip().lower() in ('1', 'true', 'sim', 'all')
    camara = request.args.get('camara', type=int)
    rua = (request.args.get('rua') or '').strip() or None
    posicao = request.args.get('posicao', type=int)
    if not codigo and not todas and not camara and not rua and not posicao:
        return jsonify({'erro': 'Informe codigo, todas=1, camara, ou coluna (camara+rua+posicao).'}), 400
    return redirect(_url_html_longarina(
        codigo=codigo, todas=todas, camara=camara, rua=rua, posicao=posicao, auto_print=False,
    ))
@bp.route('/etiqueta/endereco/zpl', methods=['GET'])
def api_wms_etiqueta_endereco_zpl():
    """Download ZPL nativo (Zebra ZD220) — uma etiqueta."""
    codigo = (request.args.get('codigo') or request.args.get('endereco') or '').strip()
    if not codigo:
        return jsonify({'erro': 'Informe codigo/endereco (ex.: 7.14.1*23 ou 07-C-14-1).'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    try:
        zpl, err = _render_etiquetas_endereco_zpl(conn, codigo=codigo)
        conn.close()
        if err:
            return jsonify({'erro': err}), 404
        return _resposta_zpl_longarina(zpl, f'longarina_{codigo}', ext=request.args.get('ext'))
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/enderecos/zpl', methods=['GET'])
def api_wms_etiqueta_enderecos_zpl():
    """Download ZPL em lote."""
    conn = _db()
    ensure_wms_schema(conn)
    todas = (request.args.get('todas') or '').strip().lower() in ('1', 'true', 'sim', 'all')
    camara = request.args.get('camara', type=int)
    rua = (request.args.get('rua') or '').strip() or None
    posicao = request.args.get('posicao', type=int)
    if not todas and not camara and not rua and not posicao:
        return jsonify({'erro': 'Informe todas=1, camara, ou coluna (camara+rua+posicao).'}), 400
    try:
        zpl, err = _render_etiquetas_endereco_zpl(
            conn, camara=camara, rua=rua, posicao=posicao, todas=todas,
        )
        conn.close()
        if err:
            return jsonify({'erro': err}), 404
        if todas:
            nome = 'longarinas_armazem'
        elif camara and rua and posicao:
            nome = f'longarinas_{camara}_{rua}_{posicao}'
        elif camara:
            nome = f'longarinas_camara_{camara}'
        else:
            nome = 'longarinas_lote'
        return _resposta_zpl_longarina(zpl, nome, ext=request.args.get('ext'))
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/endereco/csv', methods=['GET'])
def api_wms_etiqueta_endereco_csv():
    """CSV para ZebraDesigner — uma etiqueta."""
    codigo = (request.args.get('codigo') or request.args.get('endereco') or '').strip()
    if not codigo:
        return jsonify({'erro': 'Informe codigo/endereco.'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    try:
        csv_text, err = _render_etiquetas_endereco_csv(conn, codigo=codigo)
        conn.close()
        if err:
            return jsonify({'erro': err}), 404
        return _resposta_csv_longarina(csv_text, f'longarina_{codigo}')
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/enderecos/csv', methods=['GET'])
def api_wms_etiqueta_enderecos_csv():
    """CSV em lote para ZebraDesigner."""
    conn = _db()
    ensure_wms_schema(conn)
    todas = (request.args.get('todas') or '').strip().lower() in ('1', 'true', 'sim', 'all')
    camara = request.args.get('camara', type=int)
    rua = (request.args.get('rua') or '').strip() or None
    posicao = request.args.get('posicao', type=int)
    if not todas and not camara and not rua and not posicao:
        return jsonify({'erro': 'Informe todas=1, camara, ou coluna (camara+rua+posicao).'}), 400
    try:
        csv_text, err = _render_etiquetas_endereco_csv(
            conn, camara=camara, rua=rua, posicao=posicao, todas=todas,
        )
        conn.close()
        if err:
            return jsonify({'erro': err}), 404
        if todas:
            nome = 'longarinas_armazem'
        elif camara and rua and posicao:
            nome = f'longarinas_{camara}_{rua}_{posicao}'
        elif camara:
            nome = f'longarinas_camara_{camara}'
        else:
            nome = 'longarinas_lote'
        return _resposta_csv_longarina(csv_text, nome)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/endereco', methods=['GET'])
def api_wms_etiqueta_endereco():
    """Uma etiqueta — path rápido sem banco (layout/código). Evita 502 no Render."""
    codigo = (request.args.get('codigo') or request.args.get('endereco') or '').strip()
    if not codigo:
        return jsonify({'erro': 'Informe codigo/endereco (ex.: 7.14.1*23 ou 07-C-14-1).'}), 400
    auto_print = request.args.get('auto_print', '0') == '1'
    fmt = _formato_longarina_request()
    # HTML padrão: só layout — não abre conexão com o banco.
    if fmt != 'xlsx':
        try:
            html, err = _render_etiquetas_endereco(
                None, codigo=codigo, auto_print=auto_print, so_layout=True,
            )
            if err:
                return jsonify({'erro': err}), 404
            return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
        except Exception as e:
            try:
                print('[wms/etiqueta/endereco] layout:', e, flush=True)
            except Exception:
                pass
            return jsonify({'erro': 'Falha ao gerar etiqueta: %s' % e}), 500

    conn = None
    try:
        conn = _db()
        xlsx_bytes, err = _render_etiquetas_endereco_xlsx(conn, codigo=codigo)
        if err:
            # Fallback: gera a partir do layout e tenta Excel de novo.
            rows = _rows_etiqueta_layout(codigo=codigo)
            if not rows:
                return jsonify({'erro': err}), 404
            etiquetas = [_loc_etiqueta_data(r) for r in rows]
            try:
                xlsx_bytes = gerar_workbook_longarina(etiquetas)
            except Exception as ex:
                return jsonify({'erro': str(ex)}), 500
        return _resposta_xlsx_longarina(xlsx_bytes, _nome_arquivo_xlsx_longarina(codigo=codigo))
    except Exception as e:
        return jsonify({'erro': 'Falha ao gerar Excel: %s' % e}), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


@bp.route('/etiqueta/enderecos/opcoes', methods=['GET'])
def api_wms_etiqueta_enderecos_opcoes():
    """Câmaras/ruas/colunas — layout JSON puro (sem abrir DB; evita select vazio/502)."""
    try:
        data = _opcoes_impressao_longarina(None)
        return jsonify(data)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500


@bp.route('/etiqueta/enderecos/resumo', methods=['GET'])
def api_wms_etiqueta_enderecos_resumo():
    """Resumo para instalação: quantas longarinas imprimir por câmara."""
    sincronizar = (request.args.get('sync') or '').strip().lower() in ('1', 'true', 'sim')
    conn = None
    try:
        conn = _db()
        if sincronizar and not _WMS_SCHEMA_READY:
            ensure_wms_schema(conn)
        data = _resumo_etiquetas_longarina(conn, sincronizar=sincronizar)
        return jsonify(data)
    except Exception as e:
        return jsonify({
            'ok': True,
            'total_etiquetas': 0,
            'total_colunas': 0,
            'max_nivel_banco': 0,
            'niveis_config': 5,
            'colunas_incompletas': 0,
            'por_camara': [],
            'aviso': str(e),
        })
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


@bp.route('/etiqueta/enderecos', methods=['GET'])
def api_wms_etiqueta_enderecos():
    """Impressão em lote — HTML via layout (sem banco) para coluna/câmara (evita 502)."""
    todas = (request.args.get('todas') or '').strip().lower() in ('1', 'true', 'sim', 'all')
    camara = request.args.get('camara', type=int)
    rua = (request.args.get('rua') or '').strip() or None
    posicao = request.args.get('posicao', type=int)
    if not todas and not camara and not rua and not posicao:
        return jsonify({'erro': 'Informe todas=1, camara, ou coluna (camara+rua+posicao).'}), 400
    auto_print = request.args.get('auto_print', '0') == '1'
    fmt = _formato_longarina_request()

    # HTML: gera só com layout — zero dependência de DB (evita 502).
    if fmt != 'xlsx':
        try:
            html, err = _render_etiquetas_endereco(
                None,
                camara=camara,
                rua=rua,
                posicao=posicao,
                auto_print=auto_print,
                todas=todas,
                so_layout=True,
            )
            if err:
                return jsonify({'erro': err}), 404
            return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
        except Exception as e:
            try:
                print('[wms/etiqueta/enderecos] layout:', e, flush=True)
            except Exception:
                pass
            return jsonify({'erro': 'Falha ao gerar etiquetas: %s' % e}), 500

    conn = None
    try:
        conn = _db()
        if fmt == 'xlsx':
            xlsx_bytes, err = _render_etiquetas_endereco_xlsx(
                conn, camara=camara, rua=rua, posicao=posicao, todas=todas,
            )
            if err:
                return jsonify({'erro': err}), 404
            nome = _nome_arquivo_xlsx_longarina(
                todas=todas, camara=camara, rua=rua, posicao=posicao,
            )
            return _resposta_xlsx_longarina(xlsx_bytes, nome)
        html, err = _render_etiquetas_endereco(
            conn,
            camara=camara,
            rua=rua,
            posicao=posicao,
            auto_print=auto_print,
            todas=todas,
            so_layout=True,
        )
        if err:
            return jsonify({'erro': err}), 404
        return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
    except Exception as e:
        try:
            print('[wms/etiqueta/enderecos] erro:', e, flush=True)
        except Exception:
            pass
        return jsonify({'erro': 'Falha ao gerar etiquetas: %s' % e}), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


@bp.route('/etiqueta/nf-itens', methods=['GET'])
def api_wms_etiqueta_nf_itens():
    """Etiquetas de produto (SKU/EAN) dos itens da NF — impressão Zebra antes da bipagem."""
    documento_id = request.args.get('documento_id', type=int)
    numero_nf = (request.args.get('numero_nf') or request.args.get('nf') or '').strip()
    sku = (request.args.get('sku') or '').strip() or None
    n_item = request.args.get('n_item')
    auto_print = request.args.get('auto_print', '0') == '1'
    if not documento_id and not numero_nf:
        return jsonify({'erro': 'Informe documento_id ou numero_nf.'}), 400
    conn = _db()
    try:
        _ensure_wms_recebimento_terceiros_columns(conn)
        if documento_id:
            t_doc = _tbl_terceiros_doc(conn)
            row = conn.execute(
                f'''SELECT id, area, numero_nf, serie_nf, remetente_nome, recebimento_concluido
                    FROM {t_doc} WHERE id = ?''',
                (int(documento_id),),
            ).fetchone()
            if not row:
                conn.close()
                return jsonify({'erro': 'Documento não encontrado.'}), 404
            doc, err = _buscar_documento_terceiros_por_nf(conn, (_row_dict(row) or {}).get('numero_nf') or numero_nf)
        else:
            doc, err = _buscar_documento_terceiros_por_nf(conn, numero_nf)
        if err or not doc:
            conn.close()
            return jsonify({'erro': err or 'NF não encontrada.'}), 404
        itens = _itens_para_etiquetas_nf(doc, sku_filtro=sku, n_item_filtro=n_item)
        if not itens:
            conn.close()
            return jsonify({'erro': 'Nenhum item para imprimir.'}), 404
        conn.close()
        html = _html_etiquetas_produto_nf(doc, auto_print=auto_print, sku_filtro=sku, n_item_filtro=n_item)
        return make_response(html, 200, {'Content-Type': 'text/html; charset=utf-8'})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/paletes/controle', methods=['GET', 'POST'])
def api_wms_paletes_controle():
    conn = _db()
    ensure_wms_schema(conn)
    try:
        if request.method == 'GET':
            if (request.args.get('lista') or '').strip().lower() == 'fora':
                linhas = _listar_paletes_fora(conn)
                conn.close()
                return jsonify({'paletes_fora': linhas, 'total': len(linhas)})
            etiqueta = (request.args.get('etiqueta') or '').strip()
            palete_id = request.args.get('palete_id', type=int)
            if not etiqueta and not palete_id:
                return jsonify({'erro': 'Informe etiqueta, palete_id ou lista=fora.'}), 400
            if etiqueta:
                pal = _obter_palete_por_etiqueta(conn, etiqueta)
                if not pal:
                    conn.close()
                    return jsonify({'erro': 'Palete não encontrado para esta etiqueta.'}), 404
                palete_id = pal['id']
            info = _info_palete_controle(conn, palete_id)
            conn.close()
            if not info:
                return jsonify({'erro': 'Palete não encontrado.'}), 404
            return jsonify(info)

        data = request.get_json() or {}
        acao = (data.get('acao') or '').strip().lower()
        etiqueta = (data.get('etiqueta') or '').strip()
        palete_id = data.get('palete_id')
        if etiqueta:
            pal = _obter_palete_por_etiqueta(conn, etiqueta)
            if not pal:
                conn.close()
                return jsonify({'erro': 'Palete não encontrado para esta etiqueta.'}), 404
            palete_id = pal['id']
        if not palete_id:
            conn.close()
            return jsonify({'erro': 'Informe etiqueta ou palete_id.'}), 400
        palete_id = int(palete_id)

        if acao == 'saida':
            motivo = (data.get('motivo') or 'nao_informado').strip()
            destino = (data.get('destino_externo') or '').strip() or None
            obs = (data.get('observacao') or '').strip() or None
            result, err = _registrar_saida_palete(conn, palete_id, motivo, destino_externo=destino, observacao=obs)
            if err:
                conn.rollback()
                conn.close()
                return jsonify({'erro': err}), 400
            conn.commit()
            info = _info_palete_controle(conn, palete_id)
            conn.close()
            return jsonify({'ok': True, 'acao': 'saida', 'resultado': result, **(info or {})})

        if acao == 'retorno':
            motivo = (data.get('motivo') or 'retorno').strip()
            cod_end = (data.get('codigo_endereco') or '').strip() or None
            obs = (data.get('observacao') or '').strip() or None
            result, err = _registrar_retorno_palete(
                conn, palete_id, motivo=motivo, codigo_endereco=cod_end, observacao=obs,
            )
            if err:
                conn.rollback()
                conn.close()
                return jsonify({'erro': err}), 400
            conn.commit()
            info = _info_palete_controle(conn, palete_id)
            conn.close()
            return jsonify({'ok': True, 'acao': 'retorno', 'resultado': result, **(info or {})})

        conn.close()
        return jsonify({'erro': 'Ação inválida. Use saida ou retorno.'}), 400
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/historico-nf', methods=['GET'])
def api_wms_historico_nf():
    recebimento_id = request.args.get('recebimento_id', type=int)
    numero_nf = (request.args.get('numero_nf') or '').strip()
    if not recebimento_id and not numero_nf:
        return jsonify({'erro': 'Informe numero_nf ou recebimento_id.'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    _ensure_wms_recebimento_terceiros_columns(conn)
    try:
        filtros = {
            'sku': (request.args.get('sku') or '').strip(),
            'produto': (request.args.get('produto') or request.args.get('descricao') or '').strip(),
            'palete': (request.args.get('palete') or '').strip(),
            'destino': (request.args.get('destino') or '').strip(),
            'data_inicio': (request.args.get('data_inicio') or '').strip(),
            'data_fim': (request.args.get('data_fim') or '').strip(),
            'status': (request.args.get('status') or '').strip(),
        }
        data, err = _historico_recebimento_nf(
            conn, recebimento_id=recebimento_id, numero_nf=numero_nf, filtros=filtros,
        )
        conn.close()
        if err:
            return jsonify({'erro': err}), 404
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/relatorios', methods=['GET'])
def api_wms_relatorios():
    tipo = (request.args.get('tipo') or 'recebimentos').strip().lower()
    data_inicio = (request.args.get('data_inicio') or '').strip() or None
    data_fim = (request.args.get('data_fim') or '').strip() or None
    conn = _db()
    ensure_wms_schema(conn)
    try:
        data = _relatorio_wms(conn, tipo, data_inicio=data_inicio, data_fim=data_fim)
        conn.close()
        if not data:
            return jsonify({'erro': f'Tipo de relatório inválido: {tipo}'}), 400
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/areas-especiais', methods=['GET'])
@bp.route('/enderecamento', methods=['GET'])
def api_wms_areas_especiais():
    """Ocupação do endereçamento: estoque normal, destinos fixos e câm. 98."""
    import time as _time

    leve = (request.args.get('leve') or '').strip().lower() in ('1', 'sim', 'true', 'yes')
    force = (request.args.get('force') or '').strip().lower() in ('1', 'sim', 'true', 'yes')
    now = _time.time()
    if leve and not force:
        cached = _WMS_ENDERECA_LEVE_CACHE.get('payload')
        if (
            cached
            and (now - float(_WMS_ENDERECA_LEVE_CACHE.get('ts') or 0)) < _WMS_ENDERECA_LEVE_TTL_SEC
        ):
            return jsonify(cached)
    conn = _db()
    try:
        _ensure_wms_schema_safe(conn)
        data = _coletar_ocupacao_areas_especiais(conn)
        data['estoque_normal'] = _coletar_ocupacao_estoque_normal(conn, incluir_posicoes=not leve)
        if not leve:
            data['destinos_fixos'] = _coletar_mapa_destinos_fixos(conn)
        data['modo_leve'] = leve
        conn.close()
        payload = _sanitize_json(data)
        if leve:
            _WMS_ENDERECA_LEVE_CACHE['ts'] = now
            _WMS_ENDERECA_LEVE_CACHE['payload'] = payload
        return jsonify(payload)
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/separacao/bip-stage', methods=['POST'])
def api_wms_separacao_bip_stage():
    data = request.get_json() or {}
    conn = _db()
    ensure_wms_schema(conn)
    try:
        result, err = _bip_separacao_para_stage(
            conn,
            data.get('id_roteiro'),
            data.get('id_viagem'),
            data.get('doca'),
            data.get('codigo_bip') or data.get('codigo') or data.get('etiqueta'),
        )
        if err:
            conn.rollback()
            conn.close()
            return jsonify({'ok': False, 'erro': err}), 400
        conn.commit()
        conn.close()
        return jsonify({'ok': True, **result})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/separacao/validar-saida', methods=['POST'])
def api_wms_separacao_validar_saida():
    data = request.get_json() or {}
    conn = _db()
    ensure_wms_schema(conn)
    try:
        result, err = _validar_saida_expedicao_stage(
            conn, data.get('id_roteiro'), data.get('id_viagem'),
        )
        if err:
            conn.rollback()
            conn.close()
            return jsonify({'ok': False, 'erro': err}), 400
        conn.commit()
        conn.close()
        return jsonify({'ok': True, **result})
    except Exception as e:
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/separacao/stage', methods=['GET'])
def api_wms_separacao_stage_list():
    id_roteiro = (request.args.get('id_roteiro') or '').strip()
    id_viagem = (request.args.get('id_viagem') or '').strip()
    status = (request.args.get('status') or '').strip() or None
    conn = _db()
    ensure_wms_schema(conn)
    try:
        data, err = _listar_separacao_stage(conn, id_roteiro, id_viagem, status=status)
        conn.close()
        if err:
            return jsonify({'erro': err, 'itens': []}), 400
        return jsonify(data)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500


@bp.route('/picking', methods=['GET'])
def api_wms_picking():
    id_roteiro = (request.args.get('id_roteiro') or '').strip()
    id_viagem = (request.args.get('id_viagem') or '').strip()
    if not id_roteiro or not id_viagem:
        return jsonify({'erro': 'Informe id_roteiro e id_viagem.'}), 400
    conn = _db()
    ensure_wms_schema(conn)
    try:
        lista, err = _lista_picking_roteiro(conn, id_roteiro, id_viagem)
        conn.close()
        if err:
            return jsonify({'erro': err, 'itens': lista}), 404 if not lista else 200
        return jsonify({
            'id_roteiro': id_roteiro,
            'id_viagem': id_viagem,
            'itens': lista,
            'total_linhas': len(lista),
            'fonte_estoque': 'wms',
        })
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'erro': str(e)}), 500
