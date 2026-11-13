"""Enderecamento: camaras, enderecos, mapa 2D/3D e etiquetas de longarina."""
import io
import json
import os
import re

from flask import (Blueprint, abort, current_app, flash, jsonify, redirect, render_template, request, send_file,
                   url_for)
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy.exc import IntegrityError

from .codigo_endereco import codigo_bipagem, codigo_endereco, digito_verificador, interpretar
from .core import perm, pode_editar, registrar_log, usuario_atual
from .etiqueta_zebra import ctx_etiqueta_zebra
from .hierarquia import chaves_de_layout, empresas_do_usuario
from .models import Camara, Empresa, Endereco, LayoutSalvo, Palete, Vao, agora, db
from .paletes import NO_ARMAZEM

bp = Blueprint('enderecamento', __name__, url_prefix='/enderecamento')

TIPOS_CAMARA = ['Armazenagem', 'Stage', 'Área especial']
CATEGORIAS = ['Congelado', 'Resfriado', 'Seco']
MAX_GERAR = 5000
POR_PAGINA = 100


# ---------------------------------------------------------------- apoio

def _camara_ou_404(cid):
    camara = db.session.get(Camara, cid)
    if not camara:
        abort(404)
    return camara


def _numero(texto, rotulo, obrigatorio=False):
    """Converte temperatura digitada (aceita virgula e negativo). Devolve (valor, erro)."""
    texto = (texto or '').strip().replace(',', '.')
    if not texto:
        return None, (f'{rotulo}: preenchimento obrigatório.' if obrigatorio else None)
    try:
        return float(texto), None
    except ValueError:
        return None, f'{rotulo}: número inválido.'


def paletes_por_endereco(camara_id=None):
    """endereco_id -> lista de paletes que estao nele (o stage pode ter mais de um na mesma vaga)."""
    consulta = Palete.query.filter(Palete.endereco_id.isnot(None), Palete.status.in_(NO_ARMAZEM))
    if camara_id:
        consulta = consulta.join(Endereco, Palete.endereco_id == Endereco.id).filter(Endereco.camara_id == camara_id)
    mapa = {}
    for palete in consulta:
        mapa.setdefault(palete.endereco_id, []).append(palete)
    return mapa


def _status(endereco, ocupados=()):
    if endereco.id in ocupados:
        return 'ocupado'
    return 'bloqueado' if endereco.bloqueado else 'livre'


def resumo_camaras():
    """Uma linha por camara com totais de enderecos, para a lista e para a visao geral do mapa."""
    totais = dict(db.session.query(Endereco.camara_id, db.func.count(Endereco.id))
                  .group_by(Endereco.camara_id).all())
    ocupadas = dict(db.session.query(Endereco.camara_id, db.func.count(db.distinct(Endereco.id)))
                    .join(Palete, Palete.endereco_id == Endereco.id)
                    .filter(Palete.status.in_(NO_ARMAZEM)).group_by(Endereco.camara_id).all())
    bloqueados = dict(db.session.query(Endereco.camara_id, db.func.count(Endereco.id))
                      .filter(Endereco.bloqueado.is_(True)).group_by(Endereco.camara_id).all())
    ruas = {}
    for camara_id, rua in db.session.query(Endereco.camara_id, Endereco.rua).distinct():
        ruas.setdefault(camara_id, []).append(rua)
    linhas = []
    for camara in Camara.query.order_by(Camara.codigo).all():
        total = totais.get(camara.id, 0)
        bloq = bloqueados.get(camara.id, 0)
        ocupados = ocupadas.get(camara.id, 0)
        linhas.append({'camara': camara, 'total': total, 'bloqueados': bloq, 'ocupados': ocupados,
                       'livres': max(total - bloq - ocupados, 0), 'ruas': sorted(ruas.get(camara.id, [])),
                       'ocupacao': round(100 * ocupados / total) if total else 0})
    return linhas


# Climatizacao (categoria da camara): como aparece nos resumos. (chave, no feminino para camaras, no masculino
# para posicoes). Camara sem categoria entra como "sem climatizacao".
CLIMATIZACOES = [('Congelado', 'congelada', 'congeladas', 'congelado', 'congelados'),
                 ('Resfriado', 'resfriada', 'resfriadas', 'resfriado', 'resfriados'),
                 ('Seco', 'seca', 'secas', 'seco', 'secos'),
                 (None, 'sem climatização', 'sem climatização', 'sem climatização', 'sem climatização')]


def resumo_por_climatizacao(linhas):
    """Soma as linhas de resumo_camaras() por climatizacao (Congelado / Resfriado / Seco / sem climatizacao).
    So devolve as climatizacoes que tem camara."""
    grupos = []
    for chave, fem_um, fem_varios, masc_um, masc_varios in CLIMATIZACOES:
        do_grupo = [l for l in linhas if (l['camara'].categoria if l['camara'].categoria in CATEGORIAS else None) == chave]
        if not do_grupo:
            continue
        soma = {campo: sum(l[campo] for l in do_grupo) for campo in ('total', 'bloqueados', 'ocupados', 'livres')}
        grupos.append({'chave': chave or 'sem', 'nome': chave or 'Sem climatização', 'camaras': len(do_grupo), **soma,
                       'ocupacao': round(100.0 * soma['ocupados'] / soma['total'], 1) if soma['total'] else 0,
                       'rotulo_camaras': fem_um if len(do_grupo) == 1 else fem_varios,
                       'rotulo': lambda n, um=masc_um, varios=masc_varios: um if n == 1 else varios})
    return grupos


def _dados_etiqueta(endereco, camara):
    """Campos que o modelo de etiqueta de longarina (padrao do WMS Pro) espera."""
    fixo = bool(endereco.destino_fixo and endereco.destino)
    return {
        'camara': str(camara.codigo), 'rua_letra': endereco.rua, 'predio': str(endereco.coluna),
        'nivel': str(endereco.nivel), 'codigo_wms': endereco.codigo,
        'barcode': codigo_bipagem(camara.codigo, endereco.rua, endereco.coluna, endereco.nivel),
        'destino_fixo': fixo, 'destino_label': endereco.destino if fixo else None,
        'picking': endereco.tipo == 'Picking' and not fixo,
    }


def localizar_endereco(texto):
    """Acha o endereco pelo codigo (06-A-01-1) ou pela bipagem da longarina (6.1.1*DV).

    Devolve (endereco, erro). Na bipagem o DV e obrigatorio e precisa conferir.
    """
    partes = interpretar(texto)
    if not partes:
        return None, 'Código de endereço não reconhecido.'
    consulta = (Endereco.query.join(Camara)
                .filter(Camara.codigo == partes['camara'], Endereco.coluna == partes['coluna'],
                        Endereco.nivel == partes['nivel']))
    if partes['rua']:
        consulta = consulta.filter(Endereco.rua == partes['rua'])
    candidatos = consulta.all()
    if partes['dv']:
        candidatos = [e for e in candidatos
                      if digito_verificador(partes['camara'], e.rua, e.coluna, e.nivel) == partes['dv']]
        if not candidatos:
            return None, 'Dígito verificador inválido. Bipe a etiqueta da posição, não digite de memória.'
    elif not partes['rua']:
        return None, 'Bipagem sem dígito verificador. Bipe a etiqueta ou digite o código completo (ex.: 06-A-01-1).'
    if not candidatos:
        return None, 'Endereço não cadastrado.'
    return candidatos[0], None


# ---------------------------------------------------------------- camaras

def _pagina_camaras(reabrir=None):
    """Tela de camaras. "reabrir": o que a pessoa tinha preenchido na janela Nova camara + os erros,
    para a janela voltar aberta sem perder nada quando o servidor recusa a criacao."""
    linhas = resumo_camaras()
    return render_template('enderecamento_camaras.html', linhas=linhas, tipos=TIPOS_CAMARA,
                           categorias=CATEGORIAS, total_enderecos=sum(l['total'] for l in linhas),
                           climas=resumo_por_climatizacao(linhas),
                           ruas_em_uso=sorted({rua for l in linhas for rua in l['ruas']}), reabrir=reabrir,
                           # clientes para reservar espaco no desenho; cadastrar na hora so com permissao em Cadastros
                           empresas=[{'id': e.id, 'nome': e.fantasia or e.nome} for e in _empresas_para_reserva()],
                           pode_cadastrar_empresa=pode_editar('cadastros'),
                           layouts=_layouts_do_grupo().order_by(LayoutSalvo.nome).all())


@bp.route('/camaras')
@perm('enderecamento')
def camaras():
    return _pagina_camaras()


def _preenchido_na_nova_camara(erros):
    """Devolve ao formulario exatamente o que foi enviado (campos, ruas e marcacoes do desenho)."""
    ruas = []
    nomes = request.form.getlist('rua')
    for indice, nome in enumerate(nomes):
        def valor(campo):
            lista = request.form.getlist(campo)
            return lista[indice] if indice < len(lista) else ''
        ruas.append({'nome': nome.strip().upper()[:3], 'colunas': valor('rua_colunas'), 'niveis': valor('rua_niveis'),
                     'picking': valor('rua_picking'), 'vaos': {}, 'clientes': {}})
    por_nome = {r['nome']: r for r in ruas}
    for marca in request.form.getlist('cliente'):
        partes = marca.split('|')
        if len(partes) == 4 and partes[0] in por_nome and partes[3].isdigit():
            por_nome[partes[0]]['clientes'][f'{partes[1]}|{partes[2]}'] = int(partes[3])
    for marca in request.form.getlist('vao'):
        partes = marca.split('|')
        if len(partes) == 4 and partes[0] in por_nome and partes[3] in ('P', 'S'):
            por_nome[partes[0]]['vaos'][f'{partes[1]}|{partes[2]}'] = partes[3]
    return {'erros': erros, 'ruas': ruas,
            'campos': {c: request.form.get(c, '') for c in ('codigo', 'nome', 'tipo', 'categoria', 'temp_min', 'temp_max', 'ativo')}}


def _salvar_camara(camara):
    """Le o formulario de camara. Devolve a lista de erros (vazia = salvo no objeto)."""
    erros = []
    codigo = request.form.get('codigo', type=int)
    nome = (request.form.get('nome') or '').strip()
    tipo = request.form.get('tipo')
    categoria = request.form.get('categoria') or None
    temp_min, erro_min = _numero(request.form.get('temp_min'), 'Temperatura mínima')
    temp_max, erro_max = _numero(request.form.get('temp_max'), 'Temperatura máxima')
    if codigo is None or not 1 <= codigo <= 99:
        erros.append('O número da câmara precisa estar entre 1 e 99.')
    if not nome:
        erros.append('Informe o nome da câmara.')
    if tipo not in TIPOS_CAMARA:
        erros.append('Tipo de câmara inválido.')
    if categoria and categoria not in CATEGORIAS:
        erros.append('Categoria inválida.')
    erros += [e for e in (erro_min, erro_max) if e]
    if temp_min is not None and temp_max is not None and temp_min > temp_max:
        erros.append('A temperatura mínima não pode ser maior que a máxima.')
    if codigo is not None:
        outra = Camara.query.filter(Camara.codigo == codigo)
        if camara.id:
            outra = outra.filter(Camara.id != camara.id)
        if outra.first():
            erros.append(f'Já existe uma câmara com o número {codigo}.')
    if camara.id and codigo != camara.codigo and camara.enderecos.count():
        erros.append('Esta câmara já tem endereços; o número dela não pode mudar (ele faz parte do código e '
                     'das etiquetas de cada endereço).')
    if erros:
        return erros
    camara.codigo, camara.nome, camara.tipo, camara.categoria = codigo, nome, tipo, categoria
    camara.temp_min, camara.temp_max = temp_min, temp_max
    camara.ativo = request.form.get('ativo') == '1'
    return []


def _ler_faixa_enderecos():
    """Le do formulario as ruas, colunas e niveis a gerar. Devolve (faixa, erros).

    faixa = dict(ruas, col_de, col_ate, niv_de, niv_ate, picking_ate, total).
    """
    ruas = list(dict.fromkeys(r for r in re.split(r'[\s,;]+', (request.form.get('ruas') or '').upper()) if r))
    col_de = request.form.get('coluna_de', type=int)
    col_ate = request.form.get('coluna_ate', type=int)
    niv_de = request.form.get('nivel_de', type=int)
    niv_ate = request.form.get('nivel_ate', type=int)
    erros = []
    if not ruas:
        erros.append('Informe ao menos uma rua (ex.: A, B).')
    if any(not re.fullmatch(r'[A-Z0-9]{1,3}', r) for r in ruas):
        erros.append('Cada rua pode ter de 1 a 3 letras ou números (ex.: A, B, AV).')
    for rotulo, de, ate in (('colunas', col_de, col_ate), ('níveis', niv_de, niv_ate)):
        if de is None or ate is None or not 1 <= de <= ate <= 99:
            erros.append(f'Faixa de {rotulo} inválida: use números de 1 a 99, com o início menor ou igual ao fim.')
    total = len(ruas) * (col_ate - col_de + 1) * (niv_ate - niv_de + 1) if not erros else 0
    if total > MAX_GERAR:
        erros.append(f'São mais de {MAX_GERAR} endereços de uma vez. Gere em partes menores.')
    return {'ruas': ruas, 'col_de': col_de, 'col_ate': col_ate, 'niv_de': niv_de, 'niv_ate': niv_ate,
            'picking_ate': request.form.get('picking_ate', type=int) or 0, 'total': total}, erros


def _criar_enderecos(camara, faixa, pular=frozenset(), clientes=None):
    """Cria os enderecos da faixa que ainda nao existem na camara. Devolve quantos criou.

    "pular": posicoes (rua, coluna, nivel) que nao viram endereco (porta ou sem posicao).
    """
    existentes = {(e.rua, e.coluna, e.nivel) for e in camara.enderecos} if camara.id else set()
    criados = 0
    for rua in faixa['ruas']:
        for coluna in range(faixa['col_de'], faixa['col_ate'] + 1):
            for nivel in range(faixa['niv_de'], faixa['niv_ate'] + 1):
                if (rua, coluna, nivel) in existentes or (rua, coluna, nivel) in pular:
                    continue
                db.session.add(Endereco(camara=camara, rua=rua, coluna=coluna, nivel=nivel,
                                        codigo=codigo_endereco(camara.codigo, rua, coluna, nivel),
                                        tipo='Picking' if nivel <= faixa['picking_ate'] else 'Pulmão',
                                        cliente_id=(clientes or {}).get((rua, coluna, nivel))))
                criados += 1
    return criados


def _ler_ruas_da_nova_camara():
    """Le as ruas do formulario de nova camara: cada uma com as suas colunas, niveis e picking.

    Devolve (faixas, erros); cada faixa tem o mesmo formato de _ler_faixa_enderecos, com uma rua so.
    """
    def numero(texto):
        return int(texto) if (texto or '').strip().isdigit() else None

    nomes = [n.strip().upper() for n in request.form.getlist('rua')]
    colunas = request.form.getlist('rua_colunas')
    niveis = request.form.getlist('rua_niveis')
    picking = request.form.getlist('rua_picking')
    faixas, erros = [], []
    for indice, nome in enumerate(nomes):
        rotulo = f'Rua {nome or indice + 1}'
        cols = numero(colunas[indice]) if indice < len(colunas) else None
        nivs = numero(niveis[indice]) if indice < len(niveis) else None
        if not re.fullmatch(r'[A-Z0-9]{1,3}', nome):
            erros.append(f'{rotulo}: a rua precisa ter de 1 a 3 letras ou números.')
        elif nome in nomes[:indice]:
            erros.append(f'{rotulo}: está repetida na lista.')
        if cols is None or not 1 <= cols <= 99:
            erros.append(f'{rotulo}: colunas de 1 a 99.')
        if nivs is None or not 1 <= nivs <= 99:
            erros.append(f'{rotulo}: níveis de 1 a 99.')
        if not erros:
            faixas.append({'ruas': [nome], 'col_de': 1, 'col_ate': cols, 'niv_de': 1, 'niv_ate': nivs,
                           'picking_ate': (numero(picking[indice]) if indice < len(picking) else None) or 0,
                           'total': cols * nivs})
    if not erros and sum(f['total'] for f in faixas) > MAX_GERAR:
        erros.append(f'São mais de {MAX_GERAR} endereços de uma vez. Crie a câmara com menos ruas e gere o resto depois.')
    return faixas, erros


def _portas_no_ar(vaos):
    """Porta precisa comecar no chao: em cada coluna, os niveis de porta vao do 1 ate o topo da porta, sem buraco.

    Evita a "porta no ar" (porta nos niveis 2 e 3 com posicao de palete no 1), que aparecia quando um clique sem
    querer no desenho trocava parte da porta por posicao. Devolve as mensagens de erro (vazia = tudo certo).
    """
    por_coluna = {}
    for (rua, coluna, nivel), tipo in vaos.items():
        if tipo == 'Porta':
            por_coluna.setdefault((rua, coluna), set()).add(nivel)
    no_ar = {}      # rua -> (colunas, niveis que faltam para a porta chegar ao chao)
    for (rua, coluna), niveis in sorted(por_coluna.items()):
        faltam = set(range(1, max(niveis) + 1)) - niveis
        if faltam:
            colunas, todos = no_ar.setdefault(rua, ([], set()))
            colunas.append(coluna)
            todos.update(faltam)
    return [f'Rua {rua}: a porta da(s) coluna(s) {", ".join(map(str, colunas))} não começa no chão. Com a ferramenta '
            f'Porta, marque também o(s) nível(is) {", ".join(map(str, sorted(faltam)))} nessas colunas, ou tire a porta.'
            for rua, (colunas, faltam) in sorted(no_ar.items())]


def _ler_vaos(faixas):
    """Lugares marcados no desenho como porta ou sem posicao: campos "vao" = "RUA|coluna|nivel|P" ou "...|S".

    Devolve {(rua, coluna, nivel): 'Porta' | 'Sem posição'}, so com o que cabe no tamanho de cada rua.
    """
    tamanho = {f['ruas'][0]: (f['col_ate'], f['niv_ate']) for f in faixas}
    vaos = {}
    for marca in request.form.getlist('vao'):
        partes = marca.split('|')
        if len(partes) != 4 or partes[0] not in tamanho or not (partes[1].isdigit() and partes[2].isdigit()):
            continue
        rua, coluna, nivel = partes[0], int(partes[1]), int(partes[2])
        if 1 <= coluna <= tamanho[rua][0] and 1 <= nivel <= tamanho[rua][1]:
            vaos[(rua, coluna, nivel)] = 'Porta' if partes[3] == 'P' else 'Sem posição'
    return vaos


def _ler_clientes(faixas):
    """Espaco reservado por cliente, marcado no desenho: campos "cliente" = "RUA|coluna|nivel|id da empresa".

    Devolve ({(rua, coluna, nivel): empresa_id}, erros).
    """
    tamanho = {f['ruas'][0]: (f['col_ate'], f['niv_ate']) for f in faixas}
    clientes = {}
    for marca in request.form.getlist('cliente'):
        partes = marca.split('|')
        if len(partes) != 4 or partes[0] not in tamanho or not all(p.isdigit() for p in partes[1:]):
            continue
        rua, coluna, nivel = partes[0], int(partes[1]), int(partes[2])
        if 1 <= coluna <= tamanho[rua][0] and 1 <= nivel <= tamanho[rua][1]:
            clientes[(rua, coluna, nivel)] = int(partes[3])
    validos = {i for (i,) in db.session.query(Empresa.id).filter(Empresa.id.in_(set(clientes.values())))} if clientes else set()
    if set(clientes.values()) - validos:
        return {}, ['Uma das empresas escolhidas para reservar espaço não existe mais. Escolha de novo.']
    return clientes, []


def _enderecos_em_uso(camara):
    """Ids dos enderecos da camara que algum palete usa (guardado nele ou indicado para ele): nao podem sumir."""
    ids = set()
    for coluna in (Palete.endereco_id, Palete.sugerido_id):
        ids.update(i for (i,) in db.session.query(coluna).join(Endereco, coluna == Endereco.id)
                   .filter(Endereco.camara_id == camara.id).distinct())
    return ids


def _desenho_da_camara(camara):
    """A camara como a janela de edicao desenha: uma linha por rua com colunas, niveis, picking e marcacoes.

    Buraco na estante sem marcacao (layout importado) vira Porta quando comeca no chao e nao toma a coluna
    inteira — a mesma regra do mapa — e Sem posicao nos outros casos.
    """
    por_rua = {}
    for e in camara.enderecos:
        por_rua.setdefault(e.rua, {'celulas': {}, 'marcas': {}})['celulas'][(e.coluna, e.nivel)] = e
    for v in camara.vaos:
        por_rua.setdefault(v.rua, {'celulas': {}, 'marcas': {}})['marcas'][(v.coluna, v.nivel)] = 'P' if v.tipo == 'Porta' else 'S'
    em_uso = _enderecos_em_uso(camara)
    ruas = []
    for nome in sorted(por_rua):
        celulas, marcas = por_rua[nome]['celulas'], por_rua[nome]['marcas']
        colunas = max(c for c, _ in list(celulas) + list(marcas))
        niveis = max(n for _, n in list(celulas) + list(marcas))
        vaos = {}
        for coluna in range(1, colunas + 1):
            altura = 0      # quantos niveis vazios a partir do chao
            while altura < niveis and (coluna, altura + 1) not in celulas:
                altura += 1
            for nivel in range(1, niveis + 1):
                if (coluna, nivel) in celulas:
                    continue
                porta_automatica = not marcas and nivel <= altura < niveis
                vaos[f'{coluna}|{nivel}'] = marcas.get((coluna, nivel)) or ('P' if porta_automatica else 'S')
        ruas.append({'nome': nome, 'colunas': colunas, 'niveis': niveis, 'picking': _picking_ate(celulas.values()),
                     'vaos': vaos, 'existente': True,
                     'clientes': {f'{e.coluna}|{e.nivel}': e.cliente_id for e in celulas.values() if e.cliente_id},
                     'ocupadas': sorted(f'{e.coluna}|{e.nivel}' for e in celulas.values() if e.id in em_uso)})
    return ruas


def _picking_ate(enderecos):
    """Ate que nivel a rua e picking: o maior nivel N em que todo endereco ate N e Picking."""
    tipos = {}
    for e in enderecos:
        tipos.setdefault(e.nivel, set()).add(e.tipo)
    nivel = 0
    while tipos.get(nivel + 1) == {'Picking'}:
        nivel += 1
    return nivel


def _reabrir_edicao(cid, antes, erros):
    """A edicao foi recusada: a janela volta aberta, em modo de edicao, com o que a pessoa tinha preenchido."""
    preenchido = _preenchido_na_nova_camara(erros)
    for rua in preenchido['ruas']:
        original = antes.get(rua['nome'])
        rua['existente'] = bool(original)
        rua['ocupadas'] = original['ocupadas'] if original else []
    return {**preenchido, 'editar': cid, 'acao': url_for('enderecamento.camara_editar', cid=cid),
            'removidas': [r for nome, r in antes.items() if nome not in {x['nome'] for x in preenchido['ruas']}]}


@bp.route('/camaras/<int:cid>/desenho')
@perm('enderecamento')
def camara_desenho(cid):
    """Dados para abrir a janela de edicao (a mesma da Nova camara) ja preenchida."""
    camara = _camara_ou_404(cid)

    def numero(valor):
        return '' if valor is None else f'{valor:g}'.replace('.', ',')
    return jsonify(id=camara.id, acao=url_for('enderecamento.camara_editar', cid=camara.id),
                   campos={'codigo': camara.codigo, 'nome': camara.nome, 'tipo': camara.tipo,
                           'categoria': camara.categoria or '', 'temp_min': numero(camara.temp_min),
                           'temp_max': numero(camara.temp_max), 'ativo': '1' if camara.ativo else ''},
                   ruas=_desenho_da_camara(camara))


@bp.route('/camaras/<int:cid>/editar', methods=['POST'])
@perm('enderecamento')
def camara_editar(cid):
    """Salva a camara pela janela de desenho: dados, ruas (tamanho e picking), portas e pontos sem posicao.

    Posicao nova no desenho vira endereco; posicao que saiu do desenho e apagada — menos as que tem palete,
    que travam a alteracao. Enderecos que continuam nao mudam (codigo, bloqueio e destino ficam como estao).
    """
    camara = _camara_ou_404(cid)
    antes = {r['nome']: r for r in _desenho_da_camara(camara)}
    existentes = {(e.rua, e.coluna, e.nivel): e for e in camara.enderecos}
    em_uso = _enderecos_em_uso(camara)
    erros = _salvar_camara(camara)
    faixas, erros_ruas = _ler_ruas_da_nova_camara()
    erros += erros_ruas
    vaos = _ler_vaos(faixas) if not erros else {}
    erros += _portas_no_ar(vaos)
    clientes, erros_clientes = _ler_clientes(faixas) if not erros else ({}, [])
    erros += erros_clientes
    desejados = {(f['ruas'][0], coluna, nivel) for f in faixas
                 for coluna in range(1, f['col_ate'] + 1) for nivel in range(1, f['niv_ate'] + 1)} - set(vaos)
    remover = [e for chave, e in existentes.items() if chave not in desejados]
    if not erros:
        presos = sorted(e.codigo for e in remover if e.id in em_uso)
        if presos:
            erros.append(f'{len(presos)} posição(ões) que sairiam do desenho têm palete guardado ou indicado: '
                         + ', '.join(presos[:8]) + ('…' if len(presos) > 8 else '')
                         + '. Tire os paletes (Movimentação) antes de mudar esses lugares.')
    if erros:
        db.session.rollback()
        return _pagina_camaras(reabrir=_reabrir_edicao(cid, antes, erros))
    for e in remover:
        db.session.delete(e)
    Vao.query.filter_by(camara_id=camara.id).delete()
    for (rua, coluna, nivel), tipo in vaos.items():
        db.session.add(Vao(camara=camara, rua=rua, coluna=coluna, nivel=nivel, tipo=tipo))
    criados = 0
    for faixa in faixas:
        rua = faixa['ruas'][0]
        for coluna in range(1, faixa['col_ate'] + 1):
            for nivel in range(1, faixa['niv_ate'] + 1):
                if (rua, coluna, nivel) in vaos or (rua, coluna, nivel) in existentes:
                    continue
                db.session.add(Endereco(camara=camara, rua=rua, coluna=coluna, nivel=nivel,
                                        codigo=codigo_endereco(camara.codigo, rua, coluna, nivel),
                                        tipo='Picking' if nivel <= faixa['picking_ate'] else 'Pulmão',
                                        cliente_id=clientes.get((rua, coluna, nivel))))
                criados += 1
        # Picking: so reclassifica os enderecos que ja existiam se a pessoa mudou o "picking ate" da rua.
        if rua in antes and antes[rua]['picking'] != faixa['picking_ate']:
            for (r, _, nivel), e in existentes.items():
                if r == rua:
                    e.tipo = 'Picking' if nivel <= faixa['picking_ate'] else 'Pulmão'
    # Espaco por cliente: vale o que esta no desenho (posicao sem marca volta a ser de uso livre).
    for chave, e in existentes.items():
        if chave in desejados:
            e.cliente_id = clientes.get(chave)
    try:
        registrar_log('Alterou câmara (desenho)', f'{camara.codigo} · {camara.nome} · {criados} endereço(s) criado(s), '
                      f'{len(remover)} apagado(s)', modulo='enderecamento')
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        erro = 'Alguma posição que sairia do desenho está em uso no estoque. Nada foi alterado.'
        return _pagina_camaras(reabrir=_reabrir_edicao(cid, antes, [erro]))
    partes = [f'{criados} endereço(s) criado(s)' if criados else '', f'{len(remover)} apagado(s)' if remover else '']
    flash(f'Câmara {camara.nome} salva' + (': ' + ' e '.join(p for p in partes if p) if any(partes) else '')
          + '. Este é o mapa dela; use 2D / 3D para alternar.', 'success')
    if camara.enderecos.count():
        return redirect(url_for('enderecamento.mapa', camara=camara.id))
    return redirect(url_for('enderecamento.camaras'))


@bp.route('/camaras/nova', methods=['POST'])
@perm('enderecamento')
def camara_nova():
    """Cria a camara e, se vieram ruas, ja gera os enderecos de cada uma e abre o mapa dela."""
    camara = Camara()
    erros = _salvar_camara(camara)
    faixas, erros_ruas = _ler_ruas_da_nova_camara()
    erros += erros_ruas
    if not erros:
        erros += _portas_no_ar(_ler_vaos(faixas))
    clientes, erros_clientes = _ler_clientes(faixas) if not erros else ({}, [])
    erros += erros_clientes
    if erros:
        # Nada e gravado e a janela reabre com tudo o que a pessoa preencheu, mostrando o que corrigir.
        db.session.rollback()
        return _pagina_camaras(reabrir=_preenchido_na_nova_camara(erros))
    db.session.add(camara)
    vaos = _ler_vaos(faixas)
    for (rua, coluna, nivel), tipo in vaos.items():
        db.session.add(Vao(camara=camara, rua=rua, coluna=coluna, nivel=nivel, tipo=tipo))
    criados = sum(_criar_enderecos(camara, faixa, pular=vaos.keys(), clientes=clientes) for faixa in faixas)
    registrar_log('Criou câmara', f'{camara.codigo} · {camara.nome}' + (f' · {criados} endereço(s)' if criados else ''),
                  modulo='enderecamento')
    db.session.commit()
    if criados:
        flash(f'Câmara {camara.nome} criada com {criados} endereço(s). Este é o mapa dela; use 2D / 3D para alternar.', 'success')
        return redirect(url_for('enderecamento.mapa', camara=camara.id))
    flash('Câmara criada. Agora gere os endereços dela.', 'success')
    return redirect(url_for('enderecamento.camara', cid=camara.id))


@bp.route('/camaras/<int:cid>')
@perm('enderecamento')
def camara(cid):
    camara = _camara_ou_404(cid)
    rua = (request.args.get('rua') or '').strip().upper()
    situacao = request.args.get('situacao') or ''
    busca = (request.args.get('q') or '').strip().upper()
    consulta = camara.enderecos
    if rua:
        consulta = consulta.filter(Endereco.rua == rua)
    if situacao == 'bloqueados':
        consulta = consulta.filter(Endereco.bloqueado.is_(True))
    elif situacao == 'picking':
        consulta = consulta.filter(Endereco.tipo == 'Picking')
    elif situacao == 'destino':
        consulta = consulta.filter(Endereco.destino.isnot(None))
    if busca:
        consulta = consulta.filter(Endereco.codigo.like(f'%{busca}%'))
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    enderecos = (consulta.order_by(Endereco.rua, Endereco.coluna, Endereco.nivel)
                 .offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all())
    ruas = [r for (r,) in db.session.query(Endereco.rua).filter_by(camara_id=camara.id)
            .distinct().order_by(Endereco.rua)]
    return render_template('enderecamento_camara.html', camara=camara, enderecos=enderecos, ruas=ruas,
                           rua=rua, situacao=situacao, busca=busca, total=total, pagina=pagina,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1),
                           total_camara=camara.enderecos.count(), tipos=TIPOS_CAMARA, categorias=CATEGORIAS,
                           ocupados=paletes_por_endereco(camara.id),
                           bip=lambda e: codigo_bipagem(camara.codigo, e.rua, e.coluna, e.nivel))


@bp.route('/camaras/<int:cid>/salvar', methods=['POST'])
@perm('enderecamento')
def camara_salvar(cid):
    camara = _camara_ou_404(cid)
    erros = _salvar_camara(camara)
    if erros:
        db.session.rollback()
        for erro in erros:
            flash(erro, 'error')
    else:
        registrar_log('Alterou câmara', f'{camara.codigo} · {camara.nome}', modulo='enderecamento')
        db.session.commit()
        flash('Câmara salva.', 'success')
    return redirect(url_for('enderecamento.camara', cid=cid))


@bp.route('/camaras/<int:cid>/excluir', methods=['POST'])
@perm('enderecamento')
def camara_excluir(cid):
    camara = _camara_ou_404(cid)
    # Exclusao e definitiva: so vale se a pessoa digitou o numero da camara (conferido aqui, nao so na tela).
    if request.form.get('confirmacao', type=int) != camara.codigo:
        flash(f'Exclusão não confirmada: para excluir, digite o número da câmara ({camara.codigo}).', 'error')
        return redirect(request.referrer or url_for('enderecamento.camaras'))
    descricao = f'{camara.codigo} · {camara.nome} ({camara.enderecos.count()} endereços)'
    try:
        db.session.delete(camara)
        registrar_log('Excluiu câmara', descricao, modulo='enderecamento')
        db.session.commit()
        flash(f'Câmara {descricao} excluída.', 'success')
    except IntegrityError:
        db.session.rollback()
        flash(f'A câmara {camara.codigo} tem endereços em uso no estoque e não pode ser excluída. Você pode inativá-la.', 'error')
        return redirect(request.referrer or url_for('enderecamento.camaras'))
    return redirect(url_for('enderecamento.camaras'))


@bp.route('/camaras/<int:cid>/gerar', methods=['POST'])
@perm('enderecamento')
def gerar_enderecos(cid):
    camara = _camara_ou_404(cid)
    voltar = redirect(url_for('enderecamento.camara', cid=cid))
    faixa, erros = _ler_faixa_enderecos()
    if erros:
        for erro in erros:
            flash(erro, 'error')
        return voltar
    criados = _criar_enderecos(camara, faixa)
    ja_existiam = faixa['total'] - criados
    if criados:
        registrar_log('Gerou endereços', f'Câmara {camara.codigo}: {criados} endereço(s), ruas {", ".join(faixa["ruas"])}, '
                      f'colunas {faixa["col_de"]}-{faixa["col_ate"]}, níveis {faixa["niv_de"]}-{faixa["niv_ate"]}',
                      modulo='enderecamento')
        db.session.commit()
    mensagem = f'{criados} endereço(s) criado(s).'
    if ja_existiam:
        mensagem += f' {ja_existiam} já existiam e foram mantidos.'
    flash(mensagem, 'success' if criados else 'error')
    return voltar


@bp.route('/camaras/<int:cid>/enderecos/acao', methods=['POST'])
@perm('enderecamento')
def acao_enderecos(cid):
    """Acao em lote sobre os enderecos marcados na lista."""
    camara = _camara_ou_404(cid)
    voltar = redirect(request.referrer or url_for('enderecamento.camara', cid=cid))
    ids = request.form.getlist('ids', type=int)
    acao = request.form.get('acao')
    enderecos = camara.enderecos.filter(Endereco.id.in_(ids)).all() if ids else []
    if not enderecos:
        flash('Marque ao menos um endereço na lista.', 'error')
        return voltar
    if acao == 'etiquetas':
        return redirect(url_for('enderecamento.etiquetas_imprimir', ids=','.join(str(e.id) for e in enderecos)))
    quantidade = len(enderecos)
    if acao == 'bloquear':
        motivo = (request.form.get('motivo') or '').strip()[:120] or None
        for e in enderecos:
            e.bloqueado, e.motivo_bloqueio = True, motivo
        descricao = f'Bloqueou {quantidade} endereço(s)' + (f' — {motivo}' if motivo else '')
    elif acao == 'liberar':
        for e in enderecos:
            e.bloqueado, e.motivo_bloqueio = False, None
        descricao = f'Liberou {quantidade} endereço(s)'
    elif acao in ('picking', 'pulmao'):
        for e in enderecos:
            e.tipo = 'Picking' if acao == 'picking' else 'Pulmão'
        descricao = f'Marcou {quantidade} endereço(s) como {"Picking" if acao == "picking" else "Pulmão"}'
    elif acao == 'excluir':
        for e in enderecos:
            db.session.delete(e)
        descricao = f'Excluiu {quantidade} endereço(s)'
    else:
        abort(400)
    registrar_log(descricao, f'Câmara {camara.codigo}: ' + ', '.join(e.codigo for e in enderecos[:30])
                  + (' …' if quantidade > 30 else ''), modulo='enderecamento')
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        flash('Há endereços em uso no estoque entre os marcados; nada foi excluído.', 'error')
        return voltar
    flash(descricao + '.', 'success')
    return voltar


@bp.route('/enderecos/<int:eid>/bloqueio', methods=['POST'])
@perm('enderecamento')
def bloqueio(eid):
    """Bloqueia ou libera um endereco (usado pelo mapa)."""
    endereco = db.session.get(Endereco, eid)
    if not endereco:
        abort(404)
    if endereco.bloqueado:
        endereco.bloqueado, endereco.motivo_bloqueio = False, None
        acao = 'Liberou endereço'
    else:
        endereco.bloqueado = True
        endereco.motivo_bloqueio = (request.form.get('motivo') or '').strip()[:120] or None
        acao = 'Bloqueou endereço'
    registrar_log(acao, endereco.codigo + (f' — {endereco.motivo_bloqueio}' if endereco.motivo_bloqueio else ''),
                  modulo='enderecamento')
    db.session.commit()
    flash(f'{acao.replace(" endereço", "")} {endereco.codigo}.', 'success')
    return redirect(request.referrer or url_for('enderecamento.mapa', camara=endereco.camara_id))


@bp.route('/camaras/<int:cid>/exportar')
@perm('enderecamento')
def exportar(cid):
    camara = _camara_ou_404(cid)
    livro = Workbook()
    aba = livro.active
    aba.title = f'Camara {camara.codigo}'
    aba.append(['Endereço', 'Bipagem', 'Câmara', 'Rua', 'Coluna', 'Nível', 'Tipo', 'Destino', 'Situação', 'Motivo do bloqueio'])
    for celula in aba[1]:
        celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
    ocupados = paletes_por_endereco(camara.id)
    for e in camara.enderecos.order_by(Endereco.rua, Endereco.coluna, Endereco.nivel):
        aba.append([e.codigo, codigo_bipagem(camara.codigo, e.rua, e.coluna, e.nivel), camara.codigo, e.rua,
                    e.coluna, e.nivel, e.tipo, e.destino, _status(e, ocupados).capitalize(), e.motivo_bloqueio])
    for letra, largura in zip('ABCDEFGHIJ', (16, 16, 10, 8, 10, 8, 12, 30, 12, 34)):
        aba.column_dimensions[letra].width = largura
    aba.freeze_panes = 'A2'
    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name=f'enderecos_camara_{camara.codigo:02d}.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def _empresas_para_reserva():
    """Clientes que aparecem ao reservar espaco: os da hierarquia do usuario, mais quem ja tem espaco reservado
    (para o desenho continuar mostrando o nome)."""
    empresas = {e.id: e for e in empresas_do_usuario(usuario_atual())}
    reservados = [i for (i,) in db.session.query(Endereco.cliente_id).filter(Endereco.cliente_id.isnot(None)).distinct()
                  if i not in empresas]
    if reservados:
        empresas.update({e.id: e for e in Empresa.query.filter(Empresa.id.in_(reservados))})
    return sorted(empresas.values(), key=lambda e: (e.nome or '').lower())


def _grupo_do_usuario():
    """Grupo hierarquico em que o usuario salva layouts (Administracao > Hierarquia). Sem organizacao: o perfil."""
    return chaves_de_layout(usuario_atual())[0]


def _layouts_do_grupo():
    """Layouts salvos que o usuario enxerga: os dos grupos dele."""
    return LayoutSalvo.query.filter(LayoutSalvo.grupo.in_(chaves_de_layout(usuario_atual())))


def _aplicar_layout(camaras):
    """Cria as camaras, os enderecos e as marcacoes do layout que ainda nao existem. Nada e alterado nem apagado.

    Cada camara: {codigo, nome, tipo, categoria?, temp_min?, temp_max?, enderecos, vaos?}; endereco =
    [rua, coluna, nivel, destino, destino_fixo] (layout padrao) ou com mais [tipo, cliente_id] (layout salvo).
    Devolve (camaras novas, enderecos novos).
    """
    camaras_novas = enderecos_novos = 0
    empresas = {i for (i,) in db.session.query(Empresa.id)}
    for item in camaras:
        camara = Camara.query.filter_by(codigo=item['codigo']).first()
        if not camara:
            camara = Camara(codigo=item['codigo'], nome=item['nome'], tipo=item['tipo'], categoria=item.get('categoria'),
                            temp_min=item.get('temp_min'), temp_max=item.get('temp_max'), ativo=item.get('ativo', True))
            db.session.add(camara)
            db.session.flush()
            camaras_novas += 1
        existentes = {(e.rua, e.coluna, e.nivel) for e in camara.enderecos}
        for rua, coluna, nivel, destino, fixo, *resto in item['enderecos']:
            if (rua, coluna, nivel) in existentes:
                continue
            tipo = resto[0] if resto else ('Picking' if nivel == 1 else 'Pulmão')
            cliente = resto[1] if len(resto) > 1 and resto[1] in empresas else None      # empresa apagada: uso livre
            db.session.add(Endereco(camara_id=camara.id, rua=rua, coluna=coluna, nivel=nivel,
                                    codigo=codigo_endereco(camara.codigo, rua, coluna, nivel),
                                    tipo=tipo, destino=destino, destino_fixo=bool(fixo), cliente_id=cliente))
            existentes.add((rua, coluna, nivel))
            enderecos_novos += 1
        marcados = {(v.rua, v.coluna, v.nivel) for v in camara.vaos}
        for rua, coluna, nivel, tipo in item.get('vaos', []):
            if (rua, coluna, nivel) not in marcados and (rua, coluna, nivel) not in existentes:
                db.session.add(Vao(camara_id=camara.id, rua=rua, coluna=coluna, nivel=nivel, tipo=tipo))
    return camaras_novas, enderecos_novos


def _concluir_carga(nome, camaras_novas, enderecos_novos):
    if camaras_novas or enderecos_novos:
        registrar_log('Carregou layout', f'{nome}: {camaras_novas} câmara(s) e {enderecos_novos} endereço(s) novos',
                      modulo='enderecamento')
        db.session.commit()
        flash(f'{nome} carregado: {camaras_novas} câmara(s) e {enderecos_novos} endereço(s) criados.', 'success')
    else:
        db.session.rollback()
        flash(f'{nome} já estava todo cadastrado; nada foi alterado.', 'success')
    return redirect(url_for('enderecamento.camaras'))


@bp.route('/layout-padrao', methods=['POST'])
@perm('enderecamento')
def layout_padrao():
    """Carrega o layout fisico do CD (o mesmo do WMS Pro). Cria so o que ainda nao existe."""
    caminho = os.path.join(current_app.root_path, '..', 'data', 'layout_cd.json')
    with open(caminho, encoding='utf-8') as arq:
        layout = json.load(arq)
    return _concluir_carga('Layout do CD', *_aplicar_layout(layout['camaras']))


@bp.route('/layouts/salvar', methods=['POST'])
@perm('enderecamento')
def layout_salvar():
    """Guarda o layout de agora (todas as camaras) com um nome, para o grupo de quem salvou."""
    voltar = redirect(url_for('enderecamento.camaras'))
    nome = ' '.join((request.form.get('nome') or '').split())[:60]
    if not nome:
        flash('Dê um nome ao layout para salvar.', 'error')
        return voltar
    camaras = []
    total = 0
    for camara in Camara.query.order_by(Camara.codigo):
        enderecos = [[e.rua, e.coluna, e.nivel, e.destino, e.destino_fixo, e.tipo, e.cliente_id]
                     for e in camara.enderecos.order_by(Endereco.rua, Endereco.coluna, Endereco.nivel)]
        total += len(enderecos)
        camaras.append({'codigo': camara.codigo, 'nome': camara.nome, 'tipo': camara.tipo, 'categoria': camara.categoria,
                        'temp_min': camara.temp_min, 'temp_max': camara.temp_max, 'ativo': camara.ativo,
                        'enderecos': enderecos, 'vaos': [[v.rua, v.coluna, v.nivel, v.tipo] for v in camara.vaos]})
    if not camaras:
        flash('Não há câmaras para salvar.', 'error')
        return voltar
    layout = LayoutSalvo.query.filter(LayoutSalvo.grupo == _grupo_do_usuario(), db.func.lower(LayoutSalvo.nome) == nome.lower()).first()
    novo = layout is None
    if novo:
        layout = LayoutSalvo(nome=nome, grupo=_grupo_do_usuario())
        db.session.add(layout)
    elif request.form.get('substituir') != '1':
        flash(f'Já existe um layout salvo com o nome "{layout.nome}". Para trocar o conteúdo dele, salve de novo '
              'marcando "Substituir".', 'error')
        return voltar
    layout.dados = json.dumps({'camaras': camaras}, ensure_ascii=False)
    layout.camaras, layout.enderecos = len(camaras), total
    layout.criado_por, layout.criado_em = usuario_atual().username, agora()
    registrar_log('Salvou layout' if novo else 'Substituiu layout salvo', f'{nome}: {len(camaras)} câmara(s), {total} endereço(s)',
                  modulo='enderecamento')
    db.session.commit()
    flash(f'Layout "{nome}" salvo com {len(camaras)} câmara(s) e {total} endereço(s). Ele aparece em Carregar layout '
          'para o seu grupo.', 'success')
    return voltar


def _layout_ou_404(lid):
    layout = _layouts_do_grupo().filter_by(id=lid).first()      # layout de outro grupo nao existe para este usuario
    if not layout:
        abort(404)
    return layout


@bp.route('/layouts/<int:lid>/carregar', methods=['POST'])
@perm('enderecamento')
def layout_carregar(lid):
    layout = _layout_ou_404(lid)
    return _concluir_carga(f'Layout "{layout.nome}"', *_aplicar_layout(json.loads(layout.dados)['camaras']))


@bp.route('/layouts/<int:lid>/excluir', methods=['POST'])
@perm('enderecamento')
def layout_excluir(lid):
    layout = _layout_ou_404(lid)
    registrar_log('Excluiu layout salvo', layout.nome, modulo='enderecamento')
    db.session.delete(layout)
    db.session.commit()
    flash(f'Layout salvo "{layout.nome}" excluído. As câmaras do sistema não foram alteradas.', 'success')
    return redirect(url_for('enderecamento.camaras'))


# ---------------------------------------------------------------- mapa 2D / 3D

def _enderecos_mapa(camara):
    ocupados = paletes_por_endereco(camara.id)

    def data(valor, formato='%d/%m/%Y'):
        return valor.strftime(formato) if valor else None

    def iniciais(nome):
        partes = [p for p in (nome or '').replace('.', ' ').split() if p[0].isalnum()]
        return ''.join(p[0] for p in partes[:2]).upper() or '?'

    def conteudo(palete):
        item = palete.itens[0] if palete.itens else None
        nota = palete.nota
        # Dono da mercadoria: quem emitiu a nota; palete sem nota usa o depositante do produto.
        empresa = (nota.empresa if nota else None) or (item.produto.depositante if item else None)
        nome_empresa = (empresa.fantasia or empresa.nome) if empresa else None
        return {'id': palete.id, 'etiqueta': palete.etiqueta, 'classificacao': palete.classificacao,
                'status': palete.status, 'up': palete.up,
                'nf': nota.numero if nota else None, 'serie': nota.serie if nota else None,
                'nota_id': nota.id if nota else None, 'emissao': data(nota.data_emissao) if nota else None,
                'chave': nota.chave if nota else None,
                'empresa': nome_empresa, 'razao': empresa.nome if empresa else None,
                'cnpj': empresa.cnpj if empresa else None,
                'logo': url_for('cadastros.imagem', nome=empresa.logo) if empresa and empresa.logo else None,
                'iniciais': iniciais(nome_empresa) if empresa else None,
                'criado_por': palete.criado_por, 'criado_em': data(palete.criado_em, '%d/%m/%Y %H:%M'),
                'armazenado_em': data(palete.armazenado_em, '%d/%m/%Y %H:%M'),
                # primeiro item repetido aqui em cima: e o que o quadrado, a dica e o 3D mostram
                'sku': item.produto.sku if item else None, 'descricao': item.produto.descricao if item else None,
                'quantidade': f'{item.quantidade:g} {item.produto.unidade}' if item else None,
                'lote': item.lote if item else None,
                'validade': data(item.validade) if item else None,
                'itens': [{'sku': i.produto.sku, 'descricao': i.produto.descricao,
                           'ean': i.produto.ean, 'dun': i.produto.dun,
                           'quantidade': f'{i.quantidade:g} {i.produto.unidade}', 'lote': i.lote,
                           'fabricacao': data(i.fabricacao), 'validade': data(i.validade)}
                          for i in palete.itens]}

    return [{'id': e.id, 'codigo': e.codigo, 'rua': e.rua, 'coluna': e.coluna, 'nivel': e.nivel,
             'bip': codigo_bipagem(camara.codigo, e.rua, e.coluna, e.nivel), 'tipo': e.tipo,
             'destino': e.destino, 'status': _status(e, ocupados), 'bloqueado': e.bloqueado,
             'motivo': e.motivo_bloqueio,
             'cliente': (e.cliente.fantasia or e.cliente.nome) if e.cliente_id else None,
             'paletes': [conteudo(p) for p in ocupados.get(e.id, [])]}
            for e in camara.enderecos.order_by(Endereco.rua, Endereco.coluna, Endereco.nivel)]


@bp.route('/mapa')
@perm('enderecamento')
def mapa():
    linhas = resumo_camaras()
    camara = None
    cid = request.args.get('camara', type=int)
    if cid:
        camara = _camara_ou_404(cid)
    elif len(linhas) == 1:
        camara = linhas[0]['camara']
    # Uma camara escolhida ou, na visao geral, todas empilhadas (como no mapa do WMS Plus).
    mostradas = [camara] if camara else [l['camara'] for l in linhas if l['total']]
    dados = {'unica': bool(camara),
             'camaras': [{'id': c.id, 'codigo': c.codigo, 'nome': c.nome, 'tipo': c.tipo,
                          'descricao': c.categoria or c.tipo, 'enderecos': _enderecos_mapa(c),
                          # portas e pontos sem posicao marcados na criacao da camara
                          'vaos': [{'rua': v.rua, 'coluna': v.coluna, 'nivel': v.nivel, 'tipo': v.tipo} for v in c.vaos]}
                         for c in mostradas]}
    return render_template('enderecamento_mapa.html', linhas=linhas, camara=camara, dados=dados,
                           tem_enderecos=any(c['enderecos'] for c in dados['camaras']))


@bp.route('/mapa/imprimir')
@perm('enderecamento')
def mapa_imprimir():
    """Mapa para imprimir no modelo do WMS Plus: uma folha A4 por rua, com os quadrados esticados para ocupar a folha."""
    ids = [int(i) for i in (request.args.get('camaras') or '').split(',') if i.isdigit()]
    retrato = request.args.get('orientacao') == 'retrato'
    consulta = Camara.query.order_by(Camara.codigo)
    if ids:
        consulta = consulta.filter(Camara.id.in_(ids))
    ocupados = paletes_por_endereco()
    # area util da folha (A4 menos as margens de 5 mm, o cabecalho e o rodape), em milimetros
    largura_util, altura_util = (200, 287 - 20 - 30) if retrato else (287, 200 - 20 - 30)
    paginas = []
    for camara in consulta.all():
        enderecos = {(e.rua, e.coluna, e.nivel): e for e in camara.enderecos}
        if not enderecos:
            continue
        ruas = _desenho_da_camara(camara)                    # colunas, niveis e o que e porta / sem posicao em cada rua
        topo = max(r['niveis'] for r in ruas)                # todas as ruas da camara mostram os mesmos niveis
        da_camara = []
        for r in ruas:
            colunas, niveis = list(range(1, r['colunas'] + 1)), list(range(topo, 0, -1))
            # Portas: colunas vizinhas com a mesma faixa de niveis formam uma porta so (a imagem e recortada por cima do bloco).
            faixa = {}
            for c in colunas:
                da_porta = [n for n in range(1, topo + 1) if r['vaos'].get(f'{c}|{n}') == 'P']
                if da_porta:
                    faixa[c] = (min(da_porta), max(da_porta))
            bloco = {}
            for c in colunas:
                if c in faixa:
                    inicio = bloco[c - 1][0] if faixa.get(c - 1) == faixa[c] else c
                    bloco[c] = [inicio, c]
                    for anterior in range(inicio, c):
                        bloco[anterior][1] = c
            celulas = {}
            for c in colunas:
                for n in niveis:
                    e = enderecos.get((r['nome'], c, n))
                    if e:
                        paletes = ocupados.get(e.id)
                        primeiro = paletes[0] if paletes else None
                        celulas[(c, n)] = {'tipo': 'posicao', 'bloqueado': e.bloqueado,
                                           'nf': (primeiro.nota.numero if primeiro.nota else '') if primeiro else None,
                                           'sku': primeiro.itens[0].produto.sku if primeiro and primeiro.itens else ''}
                    elif r['vaos'].get(f'{c}|{n}') == 'P':
                        c0, c1 = bloco[c]
                        n0, n1 = faixa[c]
                        cols, linhas = c1 - c0 + 1, n1 - n0 + 1
                        celulas[(c, n)] = {'tipo': 'porta', 'cols': cols, 'linhas': linhas, 'topo': n == n1, 'esquerda': c == c0,
                                           'x': 50 if cols == 1 else round((c - c0) / (cols - 1) * 100, 2),
                                           'y': 50 if linhas == 1 else round((n1 - n) / (linhas - 1) * 100, 2)}
                    else:
                        celulas[(c, n)] = {'tipo': 'sem'}
            # tamanho do quadrado: a largura cabe todas as colunas; a altura estica para preencher a folha
            cel_w = round((largura_util - 12) / len(colunas), 1)
            cel_h = round((altura_util - 8) / len(niveis), 1)
            menor = min(cel_w, cel_h)
            da_camara.append({
                'camara': camara, 'rua': r['nome'], 'colunas': colunas, 'niveis': niveis, 'celulas': celulas, 'cel_w': cel_w, 'cel_h': cel_h,
                'rotulo_w': max(6, round(cel_w * 0.3)), 'fonte_col': max(14, min(22, round(cel_w * 0.82))),
                'fonte_niv': max(14, min(28, round(cel_h * 0.36))),
                'fonte_nf': 11 if menor >= 14 else 9 if menor >= 11 else 7.5 if menor >= 9 else 6,
                'fonte_sku': 9 if menor >= 14 else 7.5 if menor >= 11 else 6.5 if menor >= 9 else 5.5,
                'corte_nf': 0 if menor >= 11 else 6 if menor >= 9 else 4,
                'corte_sku': 12 if menor >= 14 else 10 if menor >= 11 else 8 if menor >= 9 else 6,
                'frente': None, 'verso': None})
        # frente e verso: 1a rua na frente, 2a no verso, e assim por diante
        for indice, pagina in enumerate(da_camara):
            if indice % 2 == 0 and indice + 1 < len(da_camara):
                pagina['verso'] = da_camara[indice + 1]['rua']
            elif indice % 2 == 1:
                pagina['frente'] = da_camara[indice - 1]['rua']
        paginas += da_camara
    return render_template('enderecamento_mapa_imprimir.html', paginas=paginas, em_branco=request.args.get('modo') == 'branco',
                           retrato=retrato)


# ---------------------------------------------------------------- etiquetas de longarina

@bp.route('/etiquetas')
@perm('enderecamento')
def etiquetas():
    linhas = [l for l in resumo_camaras() if l['total']]
    # Arvore camara -> rua -> colunas, para os seletores encadeados.
    arvore = {}
    for camara_id, rua, coluna in (db.session.query(Endereco.camara_id, Endereco.rua, Endereco.coluna)
                                   .distinct().order_by(Endereco.rua, Endereco.coluna)):
        arvore.setdefault(str(camara_id), {}).setdefault(rua, []).append(coluna)
    return render_template('enderecamento_etiquetas.html', linhas=linhas, arvore=arvore,
                           total=sum(l['total'] for l in linhas), **ctx_etiqueta_zebra())


def _pagina_etiquetas(enderecos, titulo, **extra):
    """Monta a pagina de impressao no padrao do WMS Pro: agrupada por camara e por coluna."""
    camaras = {c.id: c for c in Camara.query.all()}
    blocos = {}
    for e in sorted(enderecos, key=lambda x: (camaras[x.camara_id].codigo, x.rua, x.coluna, x.nivel)):
        camara = camaras[e.camara_id]
        bloco = blocos.setdefault(camara.id, {'camara': camara.codigo, 'camara_nome': camara.nome,
                                              'faixas': {}, 'total_niveis': 0})
        faixa = bloco['faixas'].setdefault((e.rua, e.coluna), {'titulo': f'{e.rua}-{e.coluna:02d}', 'etiquetas': []})
        faixa['etiquetas'].append(_dados_etiqueta(e, camara))
        bloco['total_niveis'] += 1
    agrupado = [{**b, 'faixas': list(b['faixas'].values())} for b in blocos.values()]
    return render_template('etiquetas/longarina.html', titulo=titulo, agrupado_por_camara=agrupado,
                           faixas=[], auto_print=False, **ctx_etiqueta_zebra(), **extra)


@bp.route('/etiquetas/imprimir')
@perm('enderecamento')
def etiquetas_imprimir():
    """Etiquetas por: ?ids=1,2 | ?codigo=06-A-01-1 | ?camara=&rua=&coluna= | ?todas=1."""
    voltar = redirect(url_for('enderecamento.etiquetas'))
    ids = [int(i) for i in (request.args.get('ids') or '').split(',') if i.isdigit()]
    codigo = (request.args.get('codigo') or '').strip()
    camara_id = request.args.get('camara', type=int)
    if ids:
        enderecos, titulo = Endereco.query.filter(Endereco.id.in_(ids)).all(), f'{len(ids)} endereço(s)'
    elif codigo:
        endereco, erro = localizar_endereco(codigo)
        if erro:
            flash(f'{codigo}: {erro}', 'error')
            return voltar
        enderecos, titulo = [endereco], endereco.codigo
    elif camara_id:
        camara = _camara_ou_404(camara_id)
        consulta = camara.enderecos
        titulo = camara.nome
        rua = (request.args.get('rua') or '').strip().upper()
        coluna = request.args.get('coluna', type=int)
        if rua:
            consulta = consulta.filter(Endereco.rua == rua)
            titulo += f' · rua {rua}'
        if coluna:
            consulta = consulta.filter(Endereco.coluna == coluna)
            titulo += f' · coluna {coluna}'
        enderecos = consulta.all()
    elif request.args.get('todas') == '1':
        enderecos, titulo = Endereco.query.all(), 'Todas as longarinas'
    else:
        flash('Escolha o que imprimir.', 'error')
        return voltar
    if not enderecos:
        flash('Nenhum endereço encontrado para essa seleção.', 'error')
        return voltar
    return _pagina_etiquetas(enderecos, titulo)


@bp.route('/etiquetas/modelo')
@perm('enderecamento')
def etiqueta_modelo():
    """Etiquetas de demonstracao (uma de picking e uma de pulmao), sem depender do cadastro."""
    demo = []
    for nivel in (1, 2):
        demo.append({'camara': '12', 'rua_letra': 'C', 'predio': '14', 'nivel': str(nivel),
                     'codigo_wms': codigo_endereco(12, 'C', 14, nivel), 'barcode': codigo_bipagem(12, 'C', 14, nivel),
                     'picking': nivel == 1, 'destino_fixo': False, 'destino_label': None})
    return render_template('etiquetas/longarina.html', titulo='Modelo', agrupado_por_camara=None,
                           faixas=[{'titulo': 'C-14 (modelo)', 'etiquetas': demo}], auto_print=False,
                           **ctx_etiqueta_zebra())


@bp.route('/etiquetas/teste')
@perm('enderecamento')
def etiqueta_teste():
    return render_template('etiquetas/teste.html', **ctx_etiqueta_zebra())
