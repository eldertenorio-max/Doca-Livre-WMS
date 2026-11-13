"""Cadastros: um motor unico (lista, formulario, exclusao, Excel) dirigido pela definicao de cada cadastro.

Para criar um cadastro novo: criar o modelo em models.py, acrescentar uma entrada em CADASTROS
e uma tela no catalogo. Nao precisa de rota nem de template novos.
"""
import io
import os
import re
import unicodedata

from flask import (Blueprint, abort, current_app, flash, jsonify, redirect, render_template, request, send_file,
                   send_from_directory, url_for)
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy.exc import IntegrityError

from .core import perm, registrar_log, tipo_da_imagem
from .core import apagar_arquivo, garantir_no_disco, guardar_arquivo
from .models import Empresa, Pessoa, Produto, Veiculo, agora, db

bp = Blueprint('cadastros', __name__, url_prefix='/cadastros')

POR_PAGINA = 50
TAMANHO_MAXIMO_IMAGEM = 2 * 1024 * 1024
UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
       'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

# Tipos de campo: texto, decimal, inteiro, opcao, empresa (vinculo), digitos (so numeros).
# "lista" = aparece como coluna na listagem; "col" = largura no formulario (grade de 12).
CADASTROS = {
    'produtos': {
        'modelo': Produto, 'titulo': 'Produtos', 'singular': 'produto', 'icone': 'box',
        'chave': 'sku', 'ordem': 'descricao', 'busca': ['sku', 'descricao', 'ean', 'dun'],
        'unicos': ['ean', 'dun'],
        'campos': [
            {'nome': 'sku', 'rotulo': 'SKU', 'tipo': 'texto', 'obrigatorio': True, 'max': 40,
             'maiusculo': True, 'lista': True, 'col': 3, 'ajuda': 'Código interno do produto.'},
            {'nome': 'descricao', 'rotulo': 'Descrição', 'tipo': 'texto', 'obrigatorio': True, 'max': 200,
             'lista': True, 'col': 9},
            {'nome': 'ean', 'rotulo': 'EAN', 'tipo': 'digitos', 'max': 14, 'lista': True, 'col': 3,
             'ajuda': 'Código de barras da unidade.'},
            {'nome': 'dun', 'rotulo': 'DUN', 'tipo': 'digitos', 'max': 14, 'lista': True, 'col': 3,
             'ajuda': 'Código de barras da caixa.'},
            {'nome': 'unidade', 'rotulo': 'Unidade', 'tipo': 'opcao', 'obrigatorio': True, 'lista': True,
             'col': 3, 'opcoes': ['UN', 'CX', 'KG', 'PCT', 'FD', 'SC', 'LT'], 'padrao': 'UN'},
            {'nome': 'fator_caixa', 'rotulo': 'Unidades por caixa', 'tipo': 'decimal', 'obrigatorio': True,
             'col': 3, 'padrao': 1, 'minimo': 0.001, 'ajuda': 'Quantidade somada ao bipar o DUN.'},
            {'nome': 'categoria', 'rotulo': 'Categoria', 'tipo': 'opcao', 'lista': True, 'col': 3,
             'opcoes': ['Congelado', 'Resfriado', 'Seco'], 'ajuda': 'Define a câmara sugerida na guarda.'},
            {'nome': 'familia', 'rotulo': 'Família', 'tipo': 'texto', 'max': 60, 'col': 3},
            {'nome': 'grupo', 'rotulo': 'Grupo', 'tipo': 'texto', 'max': 60, 'col': 3},
            {'nome': 'subgrupo', 'rotulo': 'Subgrupo', 'tipo': 'texto', 'max': 60, 'col': 3},
            {'nome': 'peso_kg', 'rotulo': 'Peso (kg)', 'tipo': 'decimal', 'col': 3},
            {'nome': 'shelf_dias', 'rotulo': 'Shelf life (dias)', 'tipo': 'inteiro', 'col': 3,
             'ajuda': 'Validade total do produto, em dias.'},
            {'nome': 'estoque_seguranca', 'rotulo': 'Estoque de segurança', 'tipo': 'decimal', 'col': 3,
             'ajuda': 'Mínimo. Abaixo dele o produto fica vermelho na análise.'},
            {'nome': 'estoque_ideal', 'rotulo': 'Estoque ideal', 'tipo': 'decimal', 'col': 3,
             'ajuda': 'Abaixo dele (e acima do mínimo), amarelo.'},
            {'nome': 'estoque_maximo', 'rotulo': 'Estoque máximo', 'tipo': 'decimal', 'col': 3,
             'ajuda': 'Acima dele, excedido.'},
            {'nome': 'depositante_id', 'rotulo': 'Depositante', 'tipo': 'empresa', 'rel': 'depositante',
             'lista': True, 'col': 6, 'ajuda': 'Dono da mercadoria (cliente da armazenagem).'},
        ],
    },
    'empresas': {
        'modelo': Empresa, 'titulo': 'Empresas', 'singular': 'empresa', 'icone': 'building',
        'chave': 'nome', 'ordem': 'nome', 'busca': ['nome', 'fantasia', 'cnpj', 'cidade'],
        'unicos': ['cnpj'],
        'imagem': 'logo',       # o formulario ganha o envio do logo (aparece no mapa, na posicao ocupada)
        'campos': [
            {'nome': 'nome', 'rotulo': 'Razão social', 'tipo': 'texto', 'obrigatorio': True, 'max': 150,
             'lista': True, 'col': 6},
            {'nome': 'fantasia', 'rotulo': 'Nome fantasia', 'tipo': 'texto', 'max': 150, 'col': 6},
            {'nome': 'cnpj', 'rotulo': 'CNPJ', 'tipo': 'digitos', 'max': 14, 'exato': 14, 'lista': True,
             'col': 4, 'ajuda': 'Só os 14 números.'},
            {'nome': 'tipo', 'rotulo': 'Tipo', 'tipo': 'opcao', 'obrigatorio': True, 'lista': True, 'col': 4,
             'opcoes': ['Fornecedor', 'Cliente', 'Depositante', 'Transportadora'], 'padrao': 'Fornecedor'},
            {'nome': 'telefone', 'rotulo': 'Telefone', 'tipo': 'texto', 'max': 30, 'col': 4},
            {'nome': 'cidade', 'rotulo': 'Cidade', 'tipo': 'texto', 'max': 80, 'lista': True, 'col': 5},
            {'nome': 'uf', 'rotulo': 'UF', 'tipo': 'opcao', 'opcoes': UFS, 'lista': True, 'col': 2},
            {'nome': 'email', 'rotulo': 'E-mail', 'tipo': 'texto', 'max': 120, 'col': 5},
        ],
    },
    'pessoas': {
        'modelo': Pessoa, 'titulo': 'Pessoas', 'singular': 'pessoa', 'icone': 'id-card',
        'chave': 'nome', 'ordem': 'nome', 'busca': ['nome', 'funcao', 'documento'],
        'campos': [
            {'nome': 'nome', 'rotulo': 'Nome completo', 'tipo': 'texto', 'obrigatorio': True, 'max': 120,
             'lista': True, 'col': 6},
            {'nome': 'funcao', 'rotulo': 'Função', 'tipo': 'opcao', 'obrigatorio': True, 'lista': True,
             'col': 3, 'padrao': 'Conferente',
             'opcoes': ['Conferente', 'Motorista', 'Auxiliar', 'Coordenador', 'Operador de empilhadeira']},
            {'nome': 'documento', 'rotulo': 'Documento (CPF/CNH)', 'tipo': 'texto', 'max': 20, 'lista': True,
             'col': 3},
            {'nome': 'telefone', 'rotulo': 'Telefone', 'tipo': 'texto', 'max': 30, 'lista': True, 'col': 4},
            {'nome': 'empresa_id', 'rotulo': 'Empresa', 'tipo': 'empresa', 'rel': 'empresa', 'lista': True,
             'col': 8, 'ajuda': 'Transportadora ou empresa em que a pessoa trabalha.'},
        ],
    },
    'veiculos': {
        'modelo': Veiculo, 'titulo': 'Veículos', 'singular': 'veículo', 'icone': 'truck',
        'chave': 'placa', 'ordem': 'placa', 'busca': ['placa', 'tipo', 'observacao'],
        'campos': [
            {'nome': 'placa', 'rotulo': 'Placa', 'tipo': 'texto', 'obrigatorio': True, 'max': 8,
             'maiusculo': True, 'sem_espaco': True, 'lista': True, 'col': 3},
            {'nome': 'tipo', 'rotulo': 'Tipo', 'tipo': 'opcao', 'obrigatorio': True, 'lista': True, 'col': 3,
             'padrao': 'Truck', 'opcoes': ['Carreta', 'Bitrem', 'Truck', 'Toco', '3/4', 'VUC', 'Van', 'Utilitário']},
            {'nome': 'transportadora_id', 'rotulo': 'Transportadora', 'tipo': 'empresa', 'rel': 'transportadora',
             'lista': True, 'col': 6},
            {'nome': 'observacao', 'rotulo': 'Observação', 'tipo': 'texto', 'max': 200, 'col': 12},
        ],
    },
}


# ---------------------------------------------------------------- conversao e validacao

def _normalizar(texto):
    """'Razão Social ' -> 'razao social' (comparar cabecalhos e opcoes sem acento nem caixa)."""
    sem_acento = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode()
    return ' '.join(sem_acento.lower().split())


def _texto_celula(valor):
    if valor is None:
        return ''
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))   # o Excel devolve 7891234567890.0 para codigos numericos
    return str(valor).strip()


def _converter(campo, bruto, de_planilha=False):
    """Devolve (valor, erro). Valor None = campo vazio."""
    texto = _texto_celula(bruto)
    tipo, rotulo = campo['tipo'], campo['rotulo']
    if texto == '':
        return None, (f'{rotulo}: preenchimento obrigatório.' if campo.get('obrigatorio') else None)

    if tipo == 'texto':
        if campo.get('maiusculo'):
            texto = texto.upper()
        if campo.get('sem_espaco'):
            texto = re.sub(r'[\s-]', '', texto)
        if len(texto) > campo.get('max', 255):
            return None, f'{rotulo}: máximo de {campo["max"]} caracteres.'
        return texto, None

    if tipo == 'digitos':
        digitos = re.sub(r'\D', '', texto)
        if not digitos:
            return None, f'{rotulo}: informe só números.'
        if campo.get('exato') and len(digitos) != campo['exato']:
            return None, f'{rotulo}: precisa ter {campo["exato"]} números.'
        if len(digitos) > campo.get('max', 30):
            return None, f'{rotulo}: máximo de {campo["max"]} números.'
        return digitos, None

    if tipo in ('decimal', 'inteiro'):
        numero_txt = texto.replace('.', '').replace(',', '.') if ',' in texto else texto
        try:
            numero = float(numero_txt)
        except ValueError:
            return None, f'{rotulo}: número inválido.'
        if numero < campo.get('minimo', 0):
            return None, f'{rotulo}: valor mínimo {campo.get("minimo", 0)}.'
        if tipo == 'inteiro':
            if not numero.is_integer():
                return None, f'{rotulo}: precisa ser um número inteiro.'
            return int(numero), None
        return round(numero, 3), None

    if tipo == 'opcao':
        for opcao in campo['opcoes']:
            if _normalizar(opcao) == _normalizar(texto):
                return opcao, None
        return None, f'{rotulo}: valor "{texto}" não é aceito ({", ".join(campo["opcoes"])}).'

    if tipo == 'empresa':
        if de_planilha:
            empresa = Empresa.query.filter(db.func.lower(Empresa.nome) == texto.lower()).first()
            if not empresa:
                return None, f'{rotulo}: empresa "{texto}" não está cadastrada.'
            return empresa.id, None
        empresa = db.session.get(Empresa, int(texto)) if texto.isdigit() else None
        if not empresa:
            return None, f'{rotulo}: empresa inválida.'
        return empresa.id, None

    raise ValueError(f'Tipo de campo desconhecido: {tipo}')


def _duplicado(definicao, nome_campo, valor, ignorar_id=None):
    modelo = definicao['modelo']
    coluna = getattr(modelo, nome_campo)
    consulta = modelo.query.filter(db.func.lower(coluna) == str(valor).lower())
    if ignorar_id:
        consulta = consulta.filter(modelo.id != ignorar_id)
    return consulta.first()


def _validar_unicos(definicao, valores, ignorar_id=None):
    erros = []
    campos = {c['nome']: c for c in definicao['campos']}
    for nome in [definicao['chave']] + definicao.get('unicos', []):
        valor = valores.get(nome)
        if valor is None:
            continue
        outro = _duplicado(definicao, nome, valor, ignorar_id)
        if outro:
            dono = getattr(outro, definicao['chave'])
            erros.append(f'{campos[nome]["rotulo"]}: "{valor}" já está em uso por "{dono}".')
    return erros


def _definicao(slug):
    definicao = CADASTROS.get(slug)
    if not definicao:
        abort(404)
    return definicao


def _empresas_ativas():
    return Empresa.query.filter_by(ativo=True).order_by(Empresa.nome).all()


def _filtrar(definicao):
    """Consulta da listagem conforme ?q= e ?situacao= (ativos | inativos | todos)."""
    modelo = definicao['modelo']
    busca = (request.args.get('q') or '').strip()
    situacao = request.args.get('situacao') or 'ativos'
    consulta = modelo.query
    if situacao == 'ativos':
        consulta = consulta.filter(modelo.ativo.is_(True))
    elif situacao == 'inativos':
        consulta = consulta.filter(modelo.ativo.is_(False))
    if busca:
        like = f'%{busca.lower()}%'
        consulta = consulta.filter(db.or_(*[db.func.lower(getattr(modelo, c)).like(like)
                                            for c in definicao['busca']]))
    return consulta.order_by(getattr(modelo, definicao['ordem'])), busca, situacao


def _valor_exibicao(registro, campo):
    if campo['tipo'] == 'empresa':
        relacionado = getattr(registro, campo['rel'])
        return relacionado.nome if relacionado else None
    return getattr(registro, campo['nome'])


# ---------------------------------------------------------------- telas

@bp.route('/<slug>')
@perm('cadastros')
def lista(slug):
    definicao = _definicao(slug)
    consulta, busca, situacao = _filtrar(definicao)
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    total = consulta.count()
    registros = consulta.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all()
    colunas = [c for c in definicao['campos'] if c.get('lista')]
    return render_template('cadastro_lista.html', slug=slug, d=definicao, registros=registros,
                           colunas=colunas, valor=_valor_exibicao, busca=busca, situacao=situacao,
                           pagina=pagina, total=total, paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1),
                           total_geral=definicao['modelo'].query.count())


@bp.route('/<slug>/novo', methods=['GET', 'POST'])
@bp.route('/<slug>/<int:rid>', methods=['GET', 'POST'])
@perm('cadastros')
def formulario(slug, rid=None):
    definicao = _definicao(slug)
    modelo = definicao['modelo']
    registro = db.session.get(modelo, rid) if rid else None
    if rid and not registro:
        abort(404)

    if request.method == 'POST':
        valores, erros = {}, []
        for campo in definicao['campos']:
            valor, erro = _converter(campo, request.form.get(campo['nome']))
            if erro:
                erros.append(erro)
            valores[campo['nome']] = valor
        # Imagem do cadastro (ex.: logo da empresa): conferida aqui, gravada so se o resto estiver certo.
        campo_imagem = definicao.get('imagem')
        imagem = extensao = None
        if campo_imagem:
            arquivo = request.files.get(campo_imagem)
            if arquivo and arquivo.filename:
                imagem = arquivo.read(TAMANHO_MAXIMO_IMAGEM + 1)
                extensao = tipo_da_imagem(imagem)
                if not extensao:
                    erros.append('Logo: use uma imagem JPG, PNG ou WEBP.')
                elif len(imagem) > TAMANHO_MAXIMO_IMAGEM:
                    erros.append('Logo: a imagem precisa ter no máximo 2 MB.')
        if not erros:
            erros = _validar_unicos(definicao, valores, ignorar_id=rid)
        if erros:
            for erro in erros:
                flash(erro, 'error')
            return render_template('cadastro_form.html', slug=slug, d=definicao, registro=registro,
                                   form=request.form, empresas=_empresas_ativas())
        novo = registro is None
        if novo:
            registro = modelo()
            db.session.add(registro)
        for nome, valor in valores.items():
            setattr(registro, nome, valor)
        registro.ativo = request.form.get('ativo') == '1'
        if campo_imagem:
            anterior = getattr(registro, campo_imagem)
            if imagem:
                db.session.flush()      # garante o id para o nome do arquivo
                # Nome novo a cada troca: o navegador nao fica com a imagem antiga em cache.
                nome_arquivo = f'{slug}-{registro.id}-{int(agora().timestamp())}.{extensao}'
                with open(os.path.join(_pasta_imagens(), nome_arquivo), 'wb') as destino:
                    destino.write(imagem)
                guardar_arquivo('logos', nome_arquivo, imagem)
                setattr(registro, campo_imagem, nome_arquivo)
            elif request.form.get('remover_imagem') == '1':
                setattr(registro, campo_imagem, None)
            if anterior and anterior != getattr(registro, campo_imagem):
                antigo = os.path.join(_pasta_imagens(), anterior)
                if os.path.exists(antigo):
                    os.remove(antigo)
                apagar_arquivo('logos', anterior)
        registrar_log(f'{"Criou" if novo else "Alterou"} {definicao["singular"]}',
                      str(valores[definicao['chave']]), modulo='cadastros')
        db.session.commit()
        flash(f'{definicao["singular"].capitalize()} salvo(a).', 'success')
        if request.form.get('acao') == 'salvar_novo':
            return redirect(url_for('cadastros.formulario', slug=slug))
        return redirect(url_for('cadastros.lista', slug=slug))

    return render_template('cadastro_form.html', slug=slug, d=definicao, registro=registro, form=None,
                           empresas=_empresas_ativas())


@bp.route('/empresas/rapido', methods=['POST'])
@perm('cadastros')
def empresa_rapida():
    """Cadastro curto de empresa, sem sair da tela em que a pessoa esta (ex.: reservar espaco na camara).

    Responde em JSON: {ok, id, nome} ou {ok: false, erro}. O resto dos dados e completado depois em Cadastros.
    """
    nome = ' '.join((request.form.get('nome') or '').split())[:150]
    cnpj = re.sub(r'\D', '', request.form.get('cnpj') or '')
    tipo = request.form.get('tipo') or 'Cliente'
    tipos = next(c['opcoes'] for c in CADASTROS['empresas']['campos'] if c['nome'] == 'tipo')
    erro = None
    if not nome:
        erro = 'Informe o nome da empresa.'
    elif tipo not in tipos:
        erro = 'Tipo de empresa inválido.'
    elif cnpj and len(cnpj) != 14:
        erro = 'O CNPJ precisa ter 14 números (ou fique em branco).'
    elif Empresa.query.filter(db.func.lower(Empresa.nome) == nome.lower()).first():
        erro = f'Já existe uma empresa chamada "{nome}". Escolha-a na lista.'
    elif cnpj and Empresa.query.filter_by(cnpj=cnpj).first():
        erro = 'Já existe uma empresa com este CNPJ. Escolha-a na lista.'
    if erro:
        return jsonify(ok=False, erro=erro), 400
    empresa = Empresa(nome=nome, cnpj=cnpj or None, tipo=tipo, ativo=True)
    db.session.add(empresa)
    registrar_log('Cadastrou empresa (cadastro rápido)', nome, modulo='cadastros')
    db.session.commit()
    return jsonify(ok=True, id=empresa.id, nome=empresa.nome)


def _pasta_imagens():
    pasta = os.path.join(current_app.instance_path, 'logos')
    os.makedirs(pasta, exist_ok=True)
    return pasta


@bp.route('/imagem/<nome>')
def imagem(nome):
    """Logo de um cadastro (qualquer usuario logado ve: o mapa mostra o logo da empresa em cada posicao)."""
    garantir_no_disco(_pasta_imagens(), 'logos', nome)
    return send_from_directory(_pasta_imagens(), nome, max_age=86400)


@bp.route('/<slug>/<int:rid>/excluir', methods=['POST'])
@perm('cadastros')
def excluir(slug, rid):
    definicao = _definicao(slug)
    registro = db.session.get(definicao['modelo'], rid)
    if not registro:
        abort(404)
    identificacao = str(getattr(registro, definicao['chave']))
    try:
        db.session.delete(registro)
        registrar_log(f'Excluiu {definicao["singular"]}', identificacao, modulo='cadastros')
        db.session.commit()
        flash(f'"{identificacao}" excluído(a).', 'success')
    except IntegrityError:
        # Ja usado em outro lugar do sistema: nao apaga o historico, so tira de uso.
        db.session.rollback()
        registro = db.session.get(definicao['modelo'], rid)
        registro.ativo = False
        registrar_log(f'Inativou {definicao["singular"]}', identificacao, modulo='cadastros')
        db.session.commit()
        flash(f'"{identificacao}" já está em uso no sistema e não pode ser excluído(a); ficou inativo(a).', 'success')
    return redirect(url_for('cadastros.lista', slug=slug))


@bp.route('/<slug>/<int:rid>/situacao', methods=['POST'])
@perm('cadastros')
def situacao(slug, rid):
    definicao = _definicao(slug)
    registro = db.session.get(definicao['modelo'], rid)
    if not registro:
        abort(404)
    registro.ativo = not registro.ativo
    registrar_log(f'{"Reativou" if registro.ativo else "Inativou"} {definicao["singular"]}',
                  str(getattr(registro, definicao['chave'])), modulo='cadastros')
    db.session.commit()
    return redirect(request.referrer or url_for('cadastros.lista', slug=slug))


# ---------------------------------------------------------------- Excel

_FONTE_CABECALHO = Font(bold=True, color='FFD700')
_FUNDO_CABECALHO = PatternFill('solid', fgColor='1A1A1A')


def _planilha(definicao, linhas):
    livro = Workbook()
    aba = livro.active
    aba.title = definicao['titulo'][:31]
    cabecalho = [c['rotulo'] for c in definicao['campos']] + ['Ativo']
    aba.append(cabecalho)
    for celula in aba[1]:
        celula.font, celula.fill = _FONTE_CABECALHO, _FUNDO_CABECALHO
    for linha in linhas:
        aba.append(linha)
    for indice, titulo in enumerate(cabecalho, start=1):
        aba.column_dimensions[aba.cell(row=1, column=indice).column_letter].width = max(len(titulo) + 4, 16)
    aba.freeze_panes = 'A2'

    ajuda = livro.create_sheet('Como preencher')
    ajuda.append(['Coluna', 'Obrigatório', 'Como preencher'])
    for celula in ajuda[1]:
        celula.font, celula.fill = _FONTE_CABECALHO, _FUNDO_CABECALHO
    for campo in definicao['campos']:
        if campo['tipo'] == 'opcao':
            dica = 'Um destes valores: ' + ', '.join(campo['opcoes'])
        elif campo['tipo'] == 'empresa':
            dica = 'Razão social de uma empresa já cadastrada'
        elif campo['tipo'] == 'digitos':
            dica = 'Só números'
        elif campo['tipo'] in ('decimal', 'inteiro'):
            dica = 'Número'
        else:
            dica = 'Texto'
        if campo.get('ajuda'):
            dica += f' — {campo["ajuda"]}'
        ajuda.append([campo['rotulo'], 'Sim' if campo.get('obrigatorio') else 'Não', dica])
    ajuda.append(['Ativo', 'Não', 'Sim ou Não (em branco = Sim)'])
    ajuda.append([])
    ajuda.append([f'A coluna "{next(c["rotulo"] for c in definicao["campos"] if c["nome"] == definicao["chave"])}" '
                  'identifica o registro: se já existir, a linha atualiza o cadastro; se não, cria um novo.'])
    for letra, largura in (('A', 26), ('B', 14), ('C', 90)):
        ajuda.column_dimensions[letra].width = largura

    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return saida


def _enviar(saida, nome):
    return send_file(saida, as_attachment=True, download_name=nome,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@bp.route('/<slug>/exportar')
@perm('cadastros')
def exportar(slug):
    definicao = _definicao(slug)
    consulta, _, _ = _filtrar(definicao)
    linhas = [[_valor_exibicao(r, c) for c in definicao['campos']] + ['Sim' if r.ativo else 'Não']
              for r in consulta.all()]
    return _enviar(_planilha(definicao, linhas), f'{slug}.xlsx')


@bp.route('/<slug>/modelo')
@perm('cadastros')
def modelo_planilha(slug):
    definicao = _definicao(slug)
    return _enviar(_planilha(definicao, []), f'modelo_{slug}.xlsx')


@bp.route('/<slug>/importar', methods=['POST'])
@perm('cadastros')
def importar(slug):
    definicao = _definicao(slug)
    modelo = definicao['modelo']
    voltar = redirect(url_for('cadastros.lista', slug=slug))
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename.lower().endswith('.xlsx'):
        flash('Envie uma planilha no formato .xlsx (use o modelo).', 'error')
        return voltar
    try:
        aba = load_workbook(arquivo, read_only=True, data_only=True).worksheets[0]
        linhas = list(aba.iter_rows(values_only=True))
    except Exception:
        flash('Não foi possível ler a planilha. Confira se o arquivo é um .xlsx válido.', 'error')
        return voltar
    if not linhas:
        flash('A planilha está vazia.', 'error')
        return voltar

    # Liga cada coluna da planilha a um campo, pelo rotulo ou pelo nome interno.
    por_titulo = {}
    for campo in definicao['campos']:
        por_titulo[_normalizar(campo['rotulo'])] = campo
        por_titulo[_normalizar(campo['nome'])] = campo
    colunas, coluna_ativo = {}, None
    for indice, titulo in enumerate(linhas[0]):
        chave = _normalizar(titulo)
        if chave == 'ativo':
            coluna_ativo = indice
        elif chave in por_titulo:
            colunas[indice] = por_titulo[chave]
    campo_chave = next(c for c in definicao['campos'] if c['nome'] == definicao['chave'])
    if campo_chave not in colunas.values():
        flash(f'A planilha precisa ter a coluna "{campo_chave["rotulo"]}". Baixe o modelo e preencha nele.', 'error')
        return voltar

    criados = atualizados = 0
    erros = []
    for numero, linha in enumerate(linhas[1:], start=2):
        if not any(_texto_celula(v) for v in linha):
            continue
        valores, erros_linha = {}, []
        for indice, campo in colunas.items():
            bruto = linha[indice] if indice < len(linha) else None
            valor, erro = _converter(campo, bruto, de_planilha=True)
            if erro:
                erros_linha.append(erro)
            valores[campo['nome']] = valor
        registro = None
        if not erros_linha:
            registro = _duplicado(definicao, definicao['chave'], valores[definicao['chave']])
            unicos = {k: v for k, v in valores.items() if k in definicao.get('unicos', [])}
            erros_linha = _validar_unicos(definicao, unicos, ignorar_id=registro.id if registro else None)
        if not erros_linha and registro is None:
            # Linha nova: os obrigatorios que nao vieram na planilha usam o padrao do campo.
            for campo in definicao['campos']:
                if campo['nome'] not in valores and campo.get('obrigatorio'):
                    if 'padrao' in campo:
                        valores[campo['nome']] = campo['padrao']
                    else:
                        erros_linha.append(f'{campo["rotulo"]}: coluna obrigatória ausente.')
        if erros_linha:
            erros.append(f'Linha {numero}: ' + ' '.join(erros_linha))
            continue
        if registro is None:
            registro = modelo()
            db.session.add(registro)
            criados += 1
        else:
            atualizados += 1
        for nome, valor in valores.items():
            setattr(registro, nome, valor)
        if coluna_ativo is not None and coluna_ativo < len(linha):
            texto = _normalizar(linha[coluna_ativo])
            if texto:
                registro.ativo = texto in ('sim', 's', '1', 'true', 'ativo')
        elif registro.ativo is None:
            registro.ativo = True
        db.session.flush()

    if criados or atualizados:
        registrar_log(f'Importou planilha de {definicao["titulo"].lower()}',
                      f'{criados} novo(s), {atualizados} atualizado(s), {len(erros)} linha(s) com erro',
                      modulo='cadastros')
        db.session.commit()
        flash(f'Importação concluída: {criados} novo(s), {atualizados} atualizado(s).', 'success')
    elif not erros:
        flash('Nenhuma linha preenchida na planilha.', 'error')
    if erros:
        resumo = ' | '.join(erros[:8])
        if len(erros) > 8:
            resumo += f' | … e mais {len(erros) - 8} linha(s).'
        flash(f'{len(erros)} linha(s) não importada(s). {resumo}', 'error')
    return voltar


def contagens():
    """Total de registros ativos por cadastro, para o painel."""
    return [{'slug': slug, 'titulo': d['titulo'], 'icone': d['icone'],
             'total': d['modelo'].query.filter_by(ativo=True).count()}
            for slug, d in CADASTROS.items()]
