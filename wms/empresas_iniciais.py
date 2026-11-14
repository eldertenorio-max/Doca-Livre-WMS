"""Empresas que operam no armazem, com o logo de cada uma (lista e logos enviados pelo Diego em 14/11/2026).

Roda uma unica vez em cada banco (marca em Configuracao): acha a empresa pelo CNPJ ou pelo nome, cadastra a que
faltar e poe o logo em quem ainda nao tem. Depois disso o que vale e o cadastro em Cadastros > Empresas: trocar ou
tirar um logo por la nao e desfeito aqui.
"""
import os

from flask import current_app

from .core import guardar_arquivo
from .models import Camara, Configuracao, Empresa, db

MARCA = 'empresas_iniciais'
VERSAO = '1'

# (nome, CNPJ, tipo, arquivo do logo em static/logos-iniciais ou None)
EMPRESAS = [
    ('Ultrafrio Log', '29288134000131', 'Depositante', None),
    ('Ultrapao Alimentos', '25448863000157', 'Depositante', None),
    ('Mega G', '19043440000235', 'Depositante', 'mega-g.png'),
    ('Eko Açaí', '54475588000169', 'Depositante', 'acai-ouro-negro.png'),
    ('Serramar', '48541510001093', 'Depositante', 'serramar.png'),
    ('AstraPlus', '08982321000302', 'Depositante', 'astraplus.png'),
    ('PlatLog', '02229804000869', 'Depositante', 'platlog.png'),
    ('Catupiry', '61087367000693', 'Depositante', 'catupiry.png'),
    ('Planalto Fish', '07253104000319', 'Depositante', 'planalto-fish.png'),
    ('Logística fora da Caixa', '29288134000134', 'Depositante', None),
    ('LD Food Service', '65216482000167', 'Depositante', None),
    ('Kabral Log', None, 'Transportadora', 'kabral-log.png'),
    ('Dalonso Transporte & Logística', None, 'Transportadora', 'dalonso.png'),
    ('Kona Transportes', None, 'Transportadora', 'kona-transportes.png'),
]


def _achar(nome, cnpj):
    empresa = Empresa.query.filter_by(cnpj=cnpj).first() if cnpj else None
    if not empresa:
        empresa = Empresa.query.filter(db.or_(db.func.lower(Empresa.nome) == nome.lower(),
                                              db.func.lower(Empresa.fantasia) == nome.lower())).first()
    return empresa


def garantir_empresas_iniciais():
    """Devolve (empresas criadas, logos colocados); (0, 0) quando ja rodou neste banco."""
    linha = db.session.get(Configuracao, MARCA)
    if linha is not None and linha.valor == VERSAO:
        return 0, 0
    if not Camara.query.first() and not Empresa.query.first():
        return 0, 0          # banco recem-criado (instalacao nova ou teste): estas empresas sao do armazem em operacao
    pasta = os.path.join(current_app.static_folder, 'logos-iniciais')
    criadas = logos = 0
    for nome, cnpj, tipo, arquivo in EMPRESAS:
        empresa = _achar(nome, cnpj)
        if empresa is None:
            empresa = Empresa(nome=nome, cnpj=cnpj, tipo=tipo, ativo=True)
            db.session.add(empresa)
            db.session.flush()
            criadas += 1
        elif not empresa.fantasia and empresa.nome.lower() != nome.lower():
            empresa.fantasia = nome              # veio da nota com a razao social: ganha o nome curto
        caminho = os.path.join(pasta, arquivo) if arquivo else None
        if caminho and not empresa.logo and os.path.exists(caminho):
            nome_arquivo = f'empresas-{empresa.id}-inicial.png'
            guardar_arquivo('logos', nome_arquivo, open(caminho, 'rb').read())
            empresa.logo = nome_arquivo
            logos += 1
    if linha is None:
        db.session.add(Configuracao(chave=MARCA, valor=VERSAO))
    else:
        linha.valor = VERSAO
    db.session.commit()
    return criadas, logos
