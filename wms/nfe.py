"""Leitura do XML da NF-e (so os campos que o recebimento usa)."""
import re
import xml.etree.ElementTree as ET
from datetime import date


class XmlInvalido(Exception):
    pass


def _nome(tag):
    return tag.rsplit('}', 1)[-1]


def _filho(elemento, nome):
    if elemento is None:
        return None
    return next((f for f in elemento if _nome(f.tag) == nome), None)


def _texto(elemento, *caminho):
    for nome in caminho:
        elemento = _filho(elemento, nome)
    return (elemento.text or '').strip() if elemento is not None and elemento.text else ''


def _data(texto):
    try:
        return date.fromisoformat(texto[:10]) if texto else None
    except ValueError:
        return None


def _numero(texto):
    try:
        return float(texto) if texto else None
    except ValueError:
        return None


def _peso_dos_volumes(inf, campo):
    """Soma o peso (kg) dos volumes do transporte. None quando a nota nao informa."""
    transp = _filho(inf, 'transp')
    pesos = [_numero(_texto(vol, campo)) for vol in (transp if transp is not None else []) if _nome(vol.tag) == 'vol']
    pesos = [p for p in pesos if p]
    return round(sum(pesos), 3) if pesos else None


def ler_nfe(conteudo):
    """Devolve dict(numero, serie, chave, emitente_nome, emitente_cnpj, emitente_cidade, emitente_uf,
    data_emissao, valor_total, itens=[dict(codigo, ean, descricao, unidade, quantidade, lote, fabricacao, validade)])."""
    # Entidades/DTD nao existem numa NF-e legitima e sao o caminho dos ataques de XML: recusa antes de ler.
    if b'<!DOCTYPE' in conteudo or b'<!ENTITY' in conteudo:
        raise XmlInvalido('XML com declaração não permitida.')
    try:
        raiz = ET.fromstring(conteudo)
    except ET.ParseError:
        raise XmlInvalido('O arquivo não é um XML válido.')
    inf = next((e for e in raiz.iter() if _nome(e.tag) == 'infNFe'), None)
    if inf is None:
        raise XmlInvalido('O arquivo não é uma NF-e (não tem o bloco infNFe).')

    emit = _filho(inf, 'emit')
    dest = _filho(inf, 'dest')
    chave = re.sub(r'\D', '', inf.get('Id') or '')
    nota = {
        'numero': _texto(inf, 'ide', 'nNF'),
        'serie': _texto(inf, 'ide', 'serie'),
        'chave': chave if len(chave) == 44 else None,
        'emitente_nome': _texto(emit, 'xNome'),
        'emitente_cnpj': re.sub(r'\D', '', _texto(emit, 'CNPJ')) or None,
        'emitente_cidade': _texto(emit, 'enderEmit', 'xMun') or None,
        'emitente_uf': _texto(emit, 'enderEmit', 'UF') or None,
        'destinatario_nome': _texto(dest, 'xNome') or None,
        'destinatario_cidade': _texto(dest, 'enderDest', 'xMun') or None,
        'data_emissao': _data(_texto(inf, 'ide', 'dhEmi') or _texto(inf, 'ide', 'dEmi')),
        'valor_total': _numero(_texto(inf, 'total', 'ICMSTot', 'vNF')),
        'peso_bruto': _peso_dos_volumes(inf, 'pesoB'),
        'peso_liquido': _peso_dos_volumes(inf, 'pesoL'),
        'itens': [],
    }
    if not nota['numero']:
        raise XmlInvalido('A NF-e não tem número.')
    for det in (f for f in inf if _nome(f.tag) == 'det'):
        prod = _filho(det, 'prod')
        quantidade = _numero(_texto(prod, 'qCom'))
        if prod is None or not quantidade:
            continue
        ean = re.sub(r'\D', '', _texto(prod, 'cEAN'))      # "SEM GTIN" vira vazio
        rastro = _filho(prod, 'rastro')
        nota['itens'].append({
            'codigo': _texto(prod, 'cProd'), 'ean': ean or None, 'descricao': _texto(prod, 'xProd'),
            'unidade': _texto(prod, 'uCom').upper()[:6] or 'UN', 'quantidade': quantidade,
            'lote': _texto(rastro, 'nLote')[:30] or None,
            'fabricacao': _data(_texto(rastro, 'dFab')), 'validade': _data(_texto(rastro, 'dVal')),
        })
    if not nota['itens']:
        raise XmlInvalido('A NF-e não tem itens com quantidade.')
    return nota
