# -*- coding: utf-8 -*-
"""
Cadastro único de câmaras do armazém (data/camaras.json) e ocupação real de cada uma.

Todas as câmaras ficam no mesmo CD. Hoje existem dois controles de estoque:
  - controle 'nf'     → câmaras 6 a 10: NF-e endereçadas no mapa das Câmaras Frias
                        (tabela ultrafrio_enderecamentos, uma linha por posição ocupada);
  - controle 'palete' → câmaras 11 a 21: paletes do Endereçamento WMS (wms_localizacao).
Este módulo junta os dois numa visão só, para todos os módulos usarem as mesmas câmaras.
"""
from __future__ import annotations

import json
import os
import re
import threading

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_ARQ_CADASTRO = os.path.join(_BASE_DIR, 'data', 'camaras.json')
_ARQ_LAYOUT_WMS = os.path.join(_BASE_DIR, 'data', 'wms_layout_camaras.json')

_cache = {'chave': None, 'camaras': None}
_lock = threading.Lock()


def _ler_json(caminho):
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def _mtime(caminho):
    try:
        return os.path.getmtime(caminho)
    except OSError:
        return 0


def _total_posicoes_inline(cam):
    """Posições utilizáveis (mesma regra do mapa das Câmaras Frias: porta, bloqueios e nível 5)."""
    niveis = int(cam.get('niveis') or 5)
    total = 0
    for rua in cam.get('ruas') or []:
        colunas = int(rua.get('colunas') or 0)
        porta = rua.get('porta') or {}
        pc = porta.get('colunas') or None
        pn = porta.get('niveis') or None
        bloq_cols = rua.get('colunas_bloqueadas') or None
        bloq_cel = {(int(c['coluna']), int(c['nivel'])) for c in (rua.get('celulas_bloqueadas') or [])}
        sem_nivel5 = rua.get('sem_nivel5_ultimas_colunas', True) is not False
        for nivel in range(1, niveis + 1):
            for col in range(1, colunas + 1):
                if pc and pn and pc[0] <= col <= pc[1] and pn[0] <= nivel <= pn[1]:
                    continue
                if (col, nivel) in bloq_cel:
                    continue
                if bloq_cols and bloq_cols[0] <= col <= bloq_cols[1]:
                    continue
                if sem_nivel5 and nivel == 5 and col >= colunas - 1:
                    continue
                total += 1
    return total


def _detalhe_wms(layout_wms, codigo):
    """Ruas/colunas/níveis/total de uma câmara do layout do WMS."""
    for bloco in layout_wms.get('camaras') or []:
        if int(bloco.get('codigo') or 0) != int(codigo):
            continue
        ruas = []
        for rua in bloco.get('ruas') or []:
            cod = rua if isinstance(rua, str) else (rua.get('rua') or rua.get('codigo'))
            cols = [int(e.get('posicao') or 0) for e in (bloco.get('enderecos') or []) if str(e.get('rua')) == str(cod)]
            ruas.append({'codigo': str(cod), 'colunas': max(cols) if cols else 0})
        return {
            'niveis': int(bloco.get('niveis') or 0),
            'ruas': ruas,
            'total_posicoes': int(bloco.get('total_posicoes') or len(bloco.get('enderecos') or [])),
            'portas': len(bloco.get('portas') or []),
        }
    return {'niveis': 0, 'ruas': [], 'total_posicoes': 0, 'portas': 0}


def listar_camaras():
    """Cadastro completo (lido de data/camaras.json + detalhes do layout do WMS), em cache por data do arquivo."""
    chave = (_mtime(_ARQ_CADASTRO), _mtime(_ARQ_LAYOUT_WMS))
    with _lock:
        if _cache['chave'] == chave and _cache['camaras'] is not None:
            return [dict(c) for c in _cache['camaras']]
    cadastro = _ler_json(_ARQ_CADASTRO)
    layout_wms = _ler_json(_ARQ_LAYOUT_WMS) if os.path.isfile(_ARQ_LAYOUT_WMS) else {}
    camaras = []
    for c in cadastro.get('camaras') or []:
        item = {
            'codigo': int(c['codigo']),
            'nome': c.get('nome') or ('Câmara %s' % c['codigo']),
            'tipo': c.get('tipo'),
            'controle': c.get('controle') or 'palete',
            'layout': c.get('layout') or 'wms',
        }
        if item['layout'] == 'inline':
            item['niveis'] = int(c.get('niveis') or 5)
            item['ruas'] = [{'codigo': str(r['codigo']), 'colunas': int(r.get('colunas') or 0)} for r in c.get('ruas') or []]
            item['total_posicoes'] = _total_posicoes_inline(c)
            item['portas'] = sum(1 for r in c.get('ruas') or [] if r.get('porta'))
        else:
            item.update(_detalhe_wms(layout_wms, item['codigo']))
        camaras.append(item)
    camaras.sort(key=lambda x: x['codigo'])
    with _lock:
        _cache['chave'] = chave
        _cache['camaras'] = camaras
    return [dict(c) for c in camaras]


_RE_ENDERECO_NF = re.compile(r'^C(\d+)-')
_RE_ENDERECO_CANON = re.compile(r'^(\d{1,2})-')


def _camara_do_endereco_nf(address_id):
    s = str(address_id or '').strip().upper()
    m = _RE_ENDERECO_NF.match(s) or _RE_ENDERECO_CANON.match(s)
    return int(m.group(1)) if m else None


def _consultar(conn, sql, params=()):
    try:
        return conn.execute(sql, params).fetchall()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None


def _valor(linha, chave, indice):
    if linha is None:
        return None
    if hasattr(linha, 'keys'):
        return linha[chave]
    return linha[indice]


def ocupacao_por_camara(conn):
    """{codigo: ocupadas} somando os dois controles (NF nas câmaras 'nf' e paletes nas câmaras 'palete')."""
    ocup = {}
    # Câmaras Frias (NF-e endereçadas): uma linha por posição ocupada.
    linhas = _consultar(conn, 'SELECT address_id FROM ultrafrio_enderecamentos')
    nf = {}
    for ln in linhas or []:
        cam = _camara_do_endereco_nf(_valor(ln, 'address_id', 0))
        if cam is not None:
            nf[cam] = nf.get(cam, 0) + 1
    # Endereçamento WMS (paletes).
    linhas = _consultar(
        conn,
        "SELECT camara, SUM(CASE WHEN status = 'ocupada' THEN 1 ELSE 0 END) AS ocupadas, COUNT(*) AS total "
        "FROM wms_localizacao GROUP BY camara",
    )
    wms = {}
    for ln in linhas or []:
        cam = _valor(ln, 'camara', 0)
        if cam is None:
            continue
        wms[int(cam)] = (int(_valor(ln, 'ocupadas', 1) or 0), int(_valor(ln, 'total', 2) or 0))
    return nf, wms, linhas is not None


def resumo(conn):
    """Cadastro + ocupação real (ocupadas, livres, taxa) de cada câmara e o total do armazém."""
    camaras = listar_camaras()
    nf, wms, wms_ok = ocupacao_por_camara(conn)
    tot_pos = tot_ocup = 0
    for c in camaras:
        if c['controle'] == 'nf':
            ocupadas = nf.get(c['codigo'], 0)
            total = c['total_posicoes']
            origem = 'Câmaras Frias (NF-e no mapa)'
        else:
            ocupadas, total_wms = wms.get(c['codigo'], (0, 0))
            total = c['total_posicoes'] or total_wms
            origem = 'Endereçamento WMS (paletes)'
        ocupadas = min(int(ocupadas), int(total)) if total else int(ocupadas)
        c['ocupadas'] = ocupadas
        c['livres'] = max(int(total) - ocupadas, 0)
        c['taxa_ocupacao'] = round(100.0 * ocupadas / total, 1) if total else 0.0
        c['origem_ocupacao'] = origem
        # Outra origem também ocupando a câmara (não deveria acontecer até a integração do estoque).
        c['ocupadas_outra_origem'] = (wms.get(c['codigo'], (0, 0))[0] if c['controle'] == 'nf'
                                      else nf.get(c['codigo'], 0))
        tot_pos += int(total)
        tot_ocup += ocupadas
    return {
        'camaras': camaras,
        'total_posicoes': tot_pos,
        'ocupadas': tot_ocup,
        'livres': max(tot_pos - tot_ocup, 0),
        'taxa_ocupacao': round(100.0 * tot_ocup / tot_pos, 1) if tot_pos else 0.0,
        'wms_disponivel': wms_ok,
    }
