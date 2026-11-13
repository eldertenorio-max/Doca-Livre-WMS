"""Mascara do endereco e codigo de bipagem da longarina (mesma regra do WMS Pro).

Endereco:  CC-RUA-PP-N      ex.: 12-C-14-1  (camara 12, rua C, coluna 14, nivel 1)
Bipagem:   C.COL.NIV*DV     ex.: 12.14.1*47
O digito verificador (DV) nao e sequencial: impede "bipar de memoria" digitando o codigo.
"""
import re

_CANONICO = re.compile(r'^(\d{1,2})-([A-Z0-9]{1,3})-(\d{1,2})-(\d{1,2})$')
_BIPAGEM = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?:\*(\d{2}))?$')


def codigo_endereco(camara, rua, coluna, nivel):
    return f'{int(camara):02d}-{str(rua).strip().upper()}-{int(coluna):02d}-{int(nivel)}'


def digito_verificador(camara, rua, coluna, nivel):
    """Dois digitos de 00 a 96, calculados da camara + rua + coluna + nivel."""
    texto = f'{int(camara):02d}{str(rua).strip().upper()}{int(coluna):02d}{int(nivel)}'
    acumulado = 0
    for indice, caractere in enumerate(texto):
        acumulado = (acumulado * 33 + ord(caractere) + indice * 7) % 97
    return f'{acumulado:02d}'


def codigo_bipagem(camara, rua, coluna, nivel):
    return f'{int(camara)}.{int(coluna)}.{int(nivel)}*{digito_verificador(camara, rua, coluna, nivel)}'


def interpretar(texto):
    """Le um endereco digitado ou bipado.

    Devolve dict(camara, rua, coluna, nivel, dv): "rua" vem None na bipagem (so o DV a identifica)
    e "dv" vem None quando nao foi informado. Devolve None se o texto nao for um endereco.
    """
    limpo = (texto or '').strip().upper().replace(' ', '')
    achado = _BIPAGEM.match(limpo)
    if achado:
        camara, coluna, nivel, dv = achado.groups()
        return {'camara': int(camara), 'rua': None, 'coluna': int(coluna), 'nivel': int(nivel), 'dv': dv}
    base, _, dv = limpo.partition('*')
    achado = _CANONICO.match(base)
    if achado:
        camara, rua, coluna, nivel = achado.groups()
        return {'camara': int(camara), 'rua': rua, 'coluna': int(coluna), 'nivel': int(nivel), 'dv': dv or None}
    return None
