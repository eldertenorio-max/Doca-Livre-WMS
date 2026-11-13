"""Entrada: recebimento de notas (XML, planilha ou manual), conferencia com montagem de paletes e guarda."""
import io
import re
from datetime import date, datetime

import json
import os
import threading
import time

from flask import (Blueprint, Response, abort, current_app, flash, g, redirect, render_template, request, send_file,
                   url_for)
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from .cadastros import _normalizar, _texto_celula
from .codigo_endereco import codigo_bipagem
from .core import exigir, perm, registrar_log, usuario_atual
from .danfe import (INTERVALO_APOS_FALHA, MAX_FALHAS_POR_DIA, busca_paga_ligada, chave_meu_danfe, pdf_espelho, pdf_oficial,
                    pdf_pela_chave)
from .enderecamento import localizar_endereco
from .etiqueta_zebra import ctx_etiqueta_zebra
from .models import Empresa, NfSaida, NotaFiscal, NotaItem, Palete, PaleteItem, Produto, agora, db
from .nfe import XmlInvalido, ler_nfe
from .paletes import (CLASSIFICACOES, CLASSIFICACOES_RETORNO, NO_ARMAZEM, colocar_em, gerar_etiqueta, registrar, resumo_itens,
                      sugerir_endereco, validar_destino)

bp = Blueprint('entrada', __name__, url_prefix='/entrada')

ABERTAS = ('Aguardando', 'Em conferência')
UNIDADES = ('UN', 'CX', 'KG', 'PCT', 'FD', 'SC', 'LT')
POR_PAGINA = 50
COLUNAS_PLANILHA = ['NF', 'Série', 'Remetente', 'CNPJ', 'Emissão', 'Código', 'Descrição', 'EAN', 'Unidade',
                    'Quantidade', 'Lote', 'Fabricação', 'Validade']


# ---------------------------------------------------------------- apoio

def _nota_ou_404(nid):
    """Nota de entrada ou de retorno: as duas usam esta mesma tela de conferencia e guarda."""
    nota = db.session.get(NotaFiscal, nid)
    if not nota or nota.tipo not in ('Entrada', 'Retorno'):
        abort(404)
    if nota.tipo == 'Retorno':
        exigir('devolucoes', editar=request.method != 'GET')
        g.menu_caminho = url_for('retornos.lista')       # no menu, fica marcado "Retornos e reentregas"
    return nota


def _lista_da(nota):
    return url_for('retornos.lista' if nota.tipo == 'Retorno' else 'entrada.notas')


def _modulo(nota):
    return 'devolucoes' if nota.tipo == 'Retorno' else 'recebimento'


def _palete_ou_404(pid):
    palete = db.session.get(Palete, pid)
    if not palete:
        abort(404)
    return palete


def _voltar_nota(nota):
    return redirect(url_for('entrada.nota', nid=nota.id))


def _data(valor):
    """Aceita date/datetime (celula do Excel), 'aaaa-mm-dd' (campo de data) ou 'dd/mm/aaaa'."""
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = str(valor or '').strip()
    for formato in ('%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y'):
        try:
            return datetime.strptime(texto[:10], formato).date()
        except ValueError:
            pass
    return None


def _quantidade(valor):
    """Numero positivo digitado (aceita virgula). None se invalido."""
    texto = _texto_celula(valor)
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    try:
        numero = round(float(texto), 3)
    except ValueError:
        return None
    return numero if numero > 0 else None


def conferido_por_item(nota):
    """item_id -> quantidade ja colocada em paletes desta nota (palete removido do estoque nao conta)."""
    linhas = (db.session.query(PaleteItem.nota_item_id, db.func.sum(PaleteItem.quantidade))
              .join(Palete).filter(Palete.nota_id == nota.id, Palete.status != 'Baixado')
              .group_by(PaleteItem.nota_item_id).all())
    return {item_id: round(total or 0, 3) for item_id, total in linhas}


def _empresa_para(nome, cnpj=None, cidade=None, uf=None):
    """Acha o remetente pelo CNPJ ou pelo nome; se nao existir, cadastra como fornecedor."""
    nome = (nome or '').strip()[:150]
    empresa = Empresa.query.filter_by(cnpj=cnpj).first() if cnpj else None
    if not empresa and nome:
        empresa = Empresa.query.filter(db.func.lower(Empresa.nome) == nome.lower()).first()
    if not empresa:
        if not nome:
            return None, False
        empresa = Empresa(nome=nome, cnpj=cnpj if cnpj and len(cnpj) == 14 else None, tipo='Fornecedor',
                          cidade=cidade, uf=uf)
        db.session.add(empresa)
        db.session.flush()
        return empresa, True
    return empresa, False


def _produto_para(codigo, ean=None, descricao=None, unidade=None):
    """Acha o produto pelo EAN ou pelo SKU; se nao existir, cadastra com os dados da nota."""
    codigo = (codigo or '').strip().upper()[:40]
    produto = None
    if ean:
        produto = Produto.query.filter(db.or_(Produto.ean == ean, Produto.dun == ean)).first()
    if not produto and codigo:
        produto = Produto.query.filter(db.func.upper(Produto.sku) == codigo).first()
    if produto:
        return produto, False
    if not codigo:
        return None, False
    ean_livre = ean if ean and len(ean) <= 14 else None
    produto = Produto(sku=codigo, descricao=(descricao or codigo).strip()[:200], ean=ean_livre,
                      unidade=unidade if unidade in UNIDADES else 'UN', fator_caixa=1)
    db.session.add(produto)
    db.session.flush()
    return produto, True


def _nota_repetida(numero, serie, empresa, tipo='Entrada'):
    return (NotaFiscal.query.filter(NotaFiscal.tipo == tipo, NotaFiscal.numero == numero,
                                    db.func.coalesce(NotaFiscal.serie, '') == (serie or ''),
                                    NotaFiscal.empresa_id == (empresa.id if empresa else None),
                                    NotaFiscal.status != 'Cancelada').first())


def _criar_nota(dados, origem, tipo='Entrada', motivo_retorno=None):
    """Cria a nota e os itens a partir de um dict no formato do leitor de XML. Devolve (nota, produtos_novos)."""
    empresa, _ = _empresa_para(dados.get('emitente_nome'), dados.get('emitente_cnpj'),
                               dados.get('emitente_cidade'), dados.get('emitente_uf'))
    nota = NotaFiscal(tipo=tipo, numero=str(dados['numero'])[:15], serie=(dados.get('serie') or None),
                      chave=dados.get('chave'), empresa=empresa, data_emissao=dados.get('data_emissao'),
                      valor_total=dados.get('valor_total'), origem=origem, criado_por=usuario_atual().username,
                      motivo_retorno=motivo_retorno, peso_bruto=dados.get('peso_bruto'), peso_liquido=dados.get('peso_liquido'))
    db.session.add(nota)
    novos = 0
    for item in dados['itens']:
        produto, criado = _produto_para(item.get('codigo'), item.get('ean'), item.get('descricao'), item.get('unidade'))
        novos += criado
        nota.itens.append(NotaItem(produto=produto, codigo=(item.get('codigo') or produto.sku)[:60],
                                   descricao=(item.get('descricao') or produto.descricao)[:200],
                                   unidade=(item.get('unidade') or produto.unidade)[:6],
                                   quantidade=item['quantidade'], lote=item.get('lote'),
                                   fabricacao=item.get('fabricacao'), validade=item.get('validade')))
    return nota, novos


# ---------------------------------------------------------------- recebimento (lista e importacoes)

@bp.route('/notas')
@perm('recebimento')
def notas():
    situacao = request.args.get('situacao') or 'abertas'
    busca = (request.args.get('q') or '').strip()
    consulta = NotaFiscal.query.filter_by(tipo='Entrada')
    if situacao == 'abertas':
        consulta = consulta.filter(NotaFiscal.status.in_(ABERTAS))
    elif situacao in ('Aguardando', 'Em conferência', 'Finalizada', 'Cancelada'):
        consulta = consulta.filter_by(status=situacao)
    if busca:
        like = f'%{busca.lower()}%'
        consulta = consulta.outerjoin(Empresa).filter(db.or_(NotaFiscal.numero.like(f'%{busca}%'),
                                                            db.func.lower(Empresa.nome).like(like),
                                                            NotaFiscal.chave.like(f'%{busca}%')))
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    lista = (consulta.order_by(NotaFiscal.criado_em.desc())
             .offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all())
    contagem = dict(db.session.query(NotaFiscal.status, db.func.count(NotaFiscal.id))
                    .filter_by(tipo='Entrada').group_by(NotaFiscal.status).all())
    return render_template('entrada_notas.html', notas=lista, situacao=situacao, busca=busca, total=total,
                           pagina=pagina, paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1),
                           contagem=contagem, empresas=Empresa.query.filter_by(ativo=True).order_by(Empresa.nome).all(),
                           aguardando_guarda=Palete.query.filter_by(status='Aguardando guarda').count())


@bp.route('/notas/xml', methods=['POST'])
@perm('recebimento')
def importar_xml():
    arquivos = [a for a in request.files.getlist('arquivos') if a and a.filename]
    if not arquivos:
        flash('Escolha ao menos um arquivo XML.', 'error')
        return redirect(url_for('entrada.notas'))
    criadas, erros, produtos_novos = [], [], 0
    for arquivo in arquivos:
        conteudo = arquivo.read()
        try:
            dados = ler_nfe(conteudo)
        except XmlInvalido as erro:
            erros.append(f'{arquivo.filename}: {erro}')
            continue
        if dados['chave'] and NotaFiscal.query.filter_by(chave=dados['chave']).first():
            erros.append(f'{arquivo.filename}: a NF {dados["numero"]} já foi importada.')
            continue
        nota, novos = _criar_nota(dados, 'XML')
        nota.xml = texto_do_xml(conteudo)        # guardado para gerar o PDF da nota (DANFE)
        db.session.flush()
        criadas.append(nota)
        produtos_novos += novos
    if criadas:
        registrar_log('Importou XML de entrada', ', '.join(f'NF {n.numero}' for n in criadas), modulo='recebimento')
        db.session.commit()
        mensagem = f'{len(criadas)} nota(s) importada(s): ' + ', '.join(n.numero for n in criadas) + '.'
        if preparar_danfes(criadas):
            mensagem += ' O XML já foi enviado ao Meu Danfe; o PDF da nota fica pronto em instantes.'
        if produtos_novos:
            mensagem += f' {produtos_novos} produto(s) novo(s) foram cadastrados com os dados da nota — revise em Cadastros › Produtos.'
        flash(mensagem, 'success')
    for erro in erros[:8]:
        flash(erro, 'error')
    if len(criadas) == 1 and not erros:
        return _voltar_nota(criadas[0])
    return redirect(url_for('entrada.notas'))


@bp.route('/notas/modelo-planilha')
@perm('recebimento')
def modelo_planilha():
    livro = Workbook()
    aba = livro.active
    aba.title = 'Notas de entrada'
    aba.append(COLUNAS_PLANILHA)
    for celula in aba[1]:
        celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
    aba.append(['12345', '1', 'Fornecedor Exemplo Ltda', '12345678000190', '01/11/2026', 'P0001',
                'Pão de queijo 1kg', '7891234567890', 'CX', 120, 'L2311', '20/10/2026', '20/04/2027'])
    for indice in range(1, len(COLUNAS_PLANILHA) + 1):
        aba.column_dimensions[aba.cell(row=1, column=indice).column_letter].width = 18
    aba.freeze_panes = 'A2'
    ajuda = livro.create_sheet('Como preencher')
    for linha in (['Uma linha por item da nota. Linhas com o mesmo NF + Remetente formam a mesma nota.'],
                  ['Obrigatórios: NF, Remetente, Código e Quantidade.'],
                  ['Remetente e produto que ainda não existem são cadastrados automaticamente.'],
                  ['Datas no formato dd/mm/aaaa. Apague a linha de exemplo antes de enviar.']):
        ajuda.append(linha)
    ajuda.column_dimensions['A'].width = 100
    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name='modelo_notas_entrada.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def ler_planilha_de_notas(arquivo):
    """Le a planilha do modelo de notas. Devolve (notas, erros, erro_fatal).

    notas = lista de dicts no formato do leitor de XML; erro_fatal = mensagem quando o arquivo nao serve.
    """
    if not arquivo or not arquivo.filename.lower().endswith('.xlsx'):
        return [], [], 'Envie uma planilha no formato .xlsx (use o modelo).'
    try:
        linhas = list(load_workbook(arquivo, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    except Exception:
        return [], [], 'Não foi possível ler a planilha. Confira se o arquivo é um .xlsx válido.'
    if not linhas:
        return [], [], 'A planilha está vazia.'
    posicao = {_normalizar(titulo): indice for indice, titulo in enumerate(linhas[0])}
    faltando = [c for c in ('NF', 'Remetente', 'Código', 'Quantidade') if _normalizar(c) not in posicao]
    if faltando:
        return [], [], 'A planilha precisa ter as colunas: ' + ', '.join(faltando) + '. Baixe o modelo e preencha nele.'

    def celula(linha, coluna):
        indice = posicao.get(_normalizar(coluna))
        return linha[indice] if indice is not None and indice < len(linha) else None

    notas_lidas, erros = {}, []
    for numero_linha, linha in enumerate(linhas[1:], start=2):
        if not any(_texto_celula(v) for v in linha):
            continue
        numero, remetente = _texto_celula(celula(linha, 'NF')), _texto_celula(celula(linha, 'Remetente'))
        codigo, quantidade = _texto_celula(celula(linha, 'Código')), _quantidade(celula(linha, 'Quantidade'))
        problemas = [rotulo for rotulo, valor in (('NF', numero), ('Remetente', remetente), ('Código', codigo)) if not valor]
        if quantidade is None:
            problemas.append('Quantidade (número maior que zero)')
        if problemas:
            erros.append(f'Linha {numero_linha}: falta {", ".join(problemas)}.')
            continue
        cnpj = re.sub(r'\D', '', _texto_celula(celula(linha, 'CNPJ'))) or None
        nota = notas_lidas.setdefault((numero, remetente.lower()), {
            'numero': numero, 'serie': _texto_celula(celula(linha, 'Série'))[:5] or None,
            'emitente_nome': remetente, 'emitente_cnpj': cnpj, 'data_emissao': _data(celula(linha, 'Emissão')), 'itens': []})
        nota['itens'].append({
            'codigo': codigo, 'ean': re.sub(r'\D', '', _texto_celula(celula(linha, 'EAN'))) or None,
            'descricao': _texto_celula(celula(linha, 'Descrição')) or None,
            'unidade': _texto_celula(celula(linha, 'Unidade')).upper()[:6] or None, 'quantidade': quantidade,
            'lote': _texto_celula(celula(linha, 'Lote'))[:30] or None,
            'fabricacao': _data(celula(linha, 'Fabricação')), 'validade': _data(celula(linha, 'Validade'))})
    return list(notas_lidas.values()), erros, None


@bp.route('/notas/planilha', methods=['POST'])
@perm('recebimento')
def importar_planilha():
    voltar = redirect(url_for('entrada.notas'))
    notas_lidas, erros, fatal = ler_planilha_de_notas(request.files.get('arquivo'))
    if fatal:
        flash(fatal, 'error')
        return voltar
    criadas, produtos_novos = [], 0
    for dados in notas_lidas:
        empresa, _ = _empresa_para(dados['emitente_nome'], dados['emitente_cnpj'])
        if _nota_repetida(dados['numero'], dados['serie'], empresa):
            erros.append(f'NF {dados["numero"]} de {dados["emitente_nome"]}: já existe no sistema.')
            continue
        nota, novos = _criar_nota(dados, 'Planilha')
        criadas.append(nota)
        produtos_novos += novos
    if criadas:
        registrar_log('Importou planilha de entrada', ', '.join(f'NF {n.numero}' for n in criadas), modulo='recebimento')
        db.session.commit()
        mensagem = f'{len(criadas)} nota(s) criada(s) pela planilha.'
        if produtos_novos:
            mensagem += f' {produtos_novos} produto(s) novo(s) foram cadastrados — revise em Cadastros › Produtos.'
        flash(mensagem, 'success')
    else:
        db.session.rollback()
        if not erros:
            flash('Nenhuma linha preenchida na planilha.', 'error')
    if erros:
        flash(f'{len(erros)} problema(s): ' + ' | '.join(erros[:8]) + (' | …' if len(erros) > 8 else ''), 'error')
    return voltar


@bp.route('/notas/manual', methods=['POST'])
@perm('recebimento')
def nota_manual():
    voltar = redirect(url_for('entrada.notas'))
    numero = (request.form.get('numero') or '').strip()
    serie = (request.form.get('serie') or '').strip()[:5] or None
    empresa = db.session.get(Empresa, request.form.get('empresa_id', type=int) or 0)
    novo_remetente = (request.form.get('remetente_novo') or '').strip()
    if not empresa and novo_remetente:
        empresa, _ = _empresa_para(novo_remetente)
    if not numero or not empresa:
        flash('Informe o número da nota e o remetente.', 'error')
        return voltar
    if _nota_repetida(numero, serie, empresa):
        flash(f'A NF {numero} de {empresa.nome} já existe no sistema.', 'error')
        return voltar
    nota = NotaFiscal(tipo='Entrada', numero=numero[:15], serie=serie, empresa=empresa,
                      data_emissao=_data(request.form.get('data_emissao')), origem='Manual',
                      criado_por=usuario_atual().username)
    db.session.add(nota)
    registrar_log('Cadastrou NF manual', f'NF {numero} · {empresa.nome}', modulo='recebimento')
    db.session.commit()
    flash('Nota criada. Agora inclua os itens.', 'success')
    return _voltar_nota(nota)


# ---------------------------------------------------------------- nota: conferencia e guarda

@bp.route('/notas/<int:nid>')
@perm('recebimento')
def nota(nid):
    nota = _nota_ou_404(nid)
    conferido = conferido_por_item(nota)
    linhas = []
    for item in nota.itens:
        feito = conferido.get(item.id, 0)
        linhas.append({'item': item, 'conferido': feito, 'falta': round(item.quantidade - feito, 3),
                       'situacao': 'pendente' if not feito else 'ok' if feito == item.quantidade
                       else 'falta' if feito < item.quantidade else 'sobra'})
    # Dados dos itens para a bipagem resolver EAN / DUN / SKU na propria tela.
    bipagem = [{'id': l['item'].id, 'sku': l['item'].produto.sku, 'ean': l['item'].produto.ean,
                'dun': l['item'].produto.dun, 'codigo': l['item'].codigo, 'fator': l['item'].produto.fator_caixa,
                'falta': max(l['falta'], 0), 'lote': l['item'].lote,
                'fabricacao': l['item'].fabricacao.isoformat() if l['item'].fabricacao else '',
                'validade': l['item'].validade.isoformat() if l['item'].validade else ''} for l in linhas]
    return render_template('entrada_nota.html', nota=nota, linhas=linhas, bipagem=bipagem,
                           classificacoes=CLASSIFICACOES_RETORNO if nota.tipo == 'Retorno' else CLASSIFICACOES,
                           retorno=nota.tipo == 'Retorno', lista_url=_lista_da(nota), aberta=nota.status in ABERTAS,
                           tem_xml=bool(nota.xml), danfe_oficial=bool(chave_meu_danfe()),
                           pendentes=[p for p in nota.paletes if p.status == 'Aguardando guarda'],
                           divergentes=[l for l in linhas if l['situacao'] != 'ok'],
                           resumo_itens=resumo_itens,
                           bip=lambda e: codigo_bipagem(e.camara.codigo, e.rua, e.coluna, e.nivel))


@bp.route('/notas/<int:nid>/dados', methods=['POST'])
@perm('recebimento')
def nota_dados(nid):
    nota = _nota_ou_404(nid)
    for campo, tamanho in (('doca', 10), ('placa', 8), ('motorista', 120), ('conferente', 120), ('observacao', 300)):
        valor = (request.form.get(campo) or '').strip()[:tamanho] or None
        setattr(nota, campo, valor.upper() if valor and campo == 'placa' else valor)
    nota.conferencia_cega = request.form.get('conferencia_cega') == '1'
    db.session.commit()
    flash('Dados da descarga salvos.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/item', methods=['POST'])
@perm('recebimento')
def item_novo(nid):
    nota = _nota_ou_404(nid)
    if nota.status not in ABERTAS:
        flash('Esta nota não aceita mais itens.', 'error')
        return _voltar_nota(nota)
    codigo = (request.form.get('codigo') or '').strip().upper()
    quantidade = _quantidade(request.form.get('quantidade'))
    produto = Produto.query.filter(db.or_(db.func.upper(Produto.sku) == codigo, Produto.ean == codigo,
                                          Produto.dun == codigo)).first() if codigo else None
    if not produto:
        flash(f'Produto "{codigo}" não encontrado. Cadastre em Cadastros › Produtos ou informe o SKU / EAN correto.', 'error')
    elif quantidade is None:
        flash('Informe uma quantidade maior que zero.', 'error')
    else:
        nota.itens.append(NotaItem(produto=produto, codigo=produto.sku, descricao=produto.descricao,
                                   unidade=produto.unidade, quantidade=quantidade,
                                   lote=(request.form.get('lote') or '').strip()[:30] or None,
                                   fabricacao=_data(request.form.get('fabricacao')),
                                   validade=_data(request.form.get('validade'))))
        db.session.commit()
        flash(f'Item {produto.sku} incluído.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/item/<int:iid>/excluir', methods=['POST'])
@perm('recebimento')
def item_excluir(nid, iid):
    nota = _nota_ou_404(nid)
    item = db.session.get(NotaItem, iid)
    if not item or item.nota_id != nota.id:
        abort(404)
    if nota.status not in ABERTAS or PaleteItem.query.filter_by(nota_item_id=item.id).first():
        flash('Este item já tem palete montado e não pode ser excluído.', 'error')
    else:
        db.session.delete(item)
        db.session.commit()
        flash('Item excluído.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/palete', methods=['POST'])
@perm('recebimento')
def montar_palete(nid):
    nota = _nota_ou_404(nid)
    if nota.status not in ABERTAS:
        flash('Esta nota não está mais em conferência.', 'error')
        return _voltar_nota(nota)
    item = db.session.get(NotaItem, request.form.get('item_id', type=int) or 0)
    quantidade = _quantidade(request.form.get('quantidade'))
    classificacao = request.form.get('classificacao')
    if not item or item.nota_id != nota.id:
        flash('Escolha o item da nota (bipe o produto ou selecione na lista).', 'error')
        return _voltar_nota(nota)
    if quantidade is None:
        flash('Informe a quantidade do palete (maior que zero).', 'error')
        return _voltar_nota(nota)
    if classificacao not in (CLASSIFICACOES_RETORNO if nota.tipo == 'Retorno' else CLASSIFICACOES):
        abort(400)
    fabricacao, validade = _data(request.form.get('fabricacao')), _data(request.form.get('validade'))
    if fabricacao and validade and validade < fabricacao:
        flash('A validade não pode ser anterior à fabricação.', 'error')
        return _voltar_nota(nota)

    palete = Palete(etiqueta=gerar_etiqueta(), nota=nota, classificacao=classificacao,
                    up=(request.form.get('up') or '').strip()[:20] or None, criado_por=usuario_atual().username)
    db.session.add(palete)
    palete.itens.append(PaleteItem(produto=item.produto, nota_item_id=item.id, quantidade=quantidade,
                                   lote=(request.form.get('lote') or '').strip()[:30] or None,
                                   fabricacao=fabricacao, validade=validade))
    db.session.flush()
    if nota.tipo == 'Retorno':
        registrar(palete, 'Retorno', motivo=f'NF {nota.numero}' + (f' · {nota.motivo_retorno}' if nota.motivo_retorno else ''))
    else:
        registrar(palete, 'Entrada', motivo=f'NF {nota.numero}')
    motivos = []
    palete.sugerido = sugerir_endereco(palete, motivos)
    if nota.status == 'Aguardando':
        nota.status = 'Em conferência'
    db.session.commit()
    if palete.sugerido:
        flash(f'Palete {palete.etiqueta} montado. Guardar em {palete.sugerido.codigo}'
              + (f' ({"; ".join(motivos)})' if motivos else '') + '.', 'success')
    else:
        flash(f'Palete {palete.etiqueta} montado, mas não há endereço livre para indicar. '
              'Cadastre ou libere endereços e use "Indicar endereço".', 'error')
    # Como no WMS Pro: depois de montar o palete, a etiqueta de enderecamento dele ja abre para imprimir.
    return redirect(url_for('entrada.etiqueta_palete', pid=palete.id, novo=1))


@bp.route('/paletes/<int:pid>/indicar', methods=['POST'])
@perm('recebimento')
def indicar(pid):
    """Troca a indicacao de guarda: com codigo usa o endereco informado; em branco pede outra sugestao."""
    palete = _palete_ou_404(pid)
    if palete.status != 'Aguardando guarda':
        flash('Este palete já foi guardado.', 'error')
        return _voltar_nota(palete.nota)
    codigo = (request.form.get('codigo') or '').strip()
    if codigo:
        endereco, erro = localizar_endereco(codigo)
        erro = erro or validar_destino(endereco, palete)
        if erro:
            flash(erro, 'error')
            return _voltar_nota(palete.nota)
    else:
        endereco = sugerir_endereco(palete)
        if not endereco:
            flash('Não há endereço livre para indicar.', 'error')
            return _voltar_nota(palete.nota)
    palete.sugerido = endereco
    db.session.commit()
    flash(f'Indicação do palete {palete.etiqueta}: {endereco.codigo}.', 'success')
    return redirect(url_for('entrada.nota', nid=palete.nota_id) + f'#palete-{palete.id}')


@bp.route('/paletes/<int:pid>/guardar', methods=['POST'])
@perm('recebimento')
def guardar(pid):
    """Confirma a guarda pela bipagem da longarina. So aceita o endereco indicado."""
    palete = _palete_ou_404(pid)
    voltar = redirect(request.referrer or url_for('entrada.nota', nid=palete.nota_id))
    if palete.status != 'Aguardando guarda':
        flash('Este palete já foi guardado.', 'error')
        return voltar
    endereco, erro = localizar_endereco(request.form.get('codigo'))
    if not erro and palete.sugerido_id and endereco.id != palete.sugerido_id:
        erro = (f'Endereço bipado ({endereco.codigo}) é diferente do indicado ({palete.sugerido.codigo}). '
                'Para guardar em outro lugar, use "Indicar endereço" primeiro.')
    erro = erro or validar_destino(endereco, palete)
    if erro:
        flash(erro, 'error')
        return voltar
    colocar_em(palete, endereco, 'Guarda', motivo=f'NF {palete.nota.numero}' if palete.nota else None)
    db.session.commit()
    flash(f'Palete {palete.etiqueta} guardado em {endereco.codigo}.', 'success')
    return voltar


@bp.route('/paletes/<int:pid>/excluir', methods=['POST'])
@perm('recebimento')
def palete_excluir(pid):
    palete = _palete_ou_404(pid)
    nota = palete.nota
    if palete.status != 'Aguardando guarda':
        flash('Palete já guardado não pode ser excluído por aqui. Use Movimentação › Remover do estoque.', 'error')
    else:
        registrar_log('Excluiu palete da conferência', f'{palete.etiqueta} · NF {nota.numero if nota else "—"}',
                      modulo='recebimento')
        db.session.delete(palete)
        db.session.commit()
        flash('Palete excluído.', 'success')
    return _voltar_nota(nota) if nota else redirect(url_for('entrada.conferencia'))


@bp.route('/paletes/<int:pid>/etiqueta')
@perm('recebimento')
def etiqueta_palete(pid):
    """Etiqueta do palete no padrao do WMS Pro (faixa "Guardar em" + codigo de barras + dados do produto)."""
    palete = _palete_ou_404(pid)
    item = palete.itens[0] if palete.itens else None
    destino = palete.sugerido or palete.endereco

    def br(data):
        return data.strftime('%d/%m/%Y') if data else None

    # ?novo=1: veio direto da montagem do palete -> imprime sozinho e oferece "Etiqueta colada — ir guardar".
    recem_montado = request.args.get('novo') == '1' and palete.nota_id
    return render_template('etiquetas/palete.html', etiqueta=palete.etiqueta, auto_print=bool(recem_montado),
                           voltar_guarda=url_for('entrada.nota', nid=palete.nota_id) + f'#palete-{palete.id}'
                           if recem_montado else None,
                           codigo_wms=destino.codigo if destino else None, destino=destino.codigo if destino else None,
                           endereco_barcode=codigo_bipagem(destino.camara.codigo, destino.rua, destino.coluna, destino.nivel)
                           if destino else None,
                           sku=item.produto.sku if item else None, lote=item.lote if item else None,
                           data_producao=br(item.fabricacao) if item else None,
                           data_validade=br(item.validade) if item else None, up=palete.up,
                           descricao=item.produto.descricao if item else None, **ctx_etiqueta_zebra())


@bp.route('/notas/<int:nid>/finalizar', methods=['POST'])
@perm('recebimento')
def finalizar(nid):
    nota = _nota_ou_404(nid)
    if nota.status != 'Em conferência':
        flash('Só é possível finalizar uma nota em conferência (com ao menos um palete montado).', 'error')
        return _voltar_nota(nota)
    if any(p.status == 'Aguardando guarda' for p in nota.paletes):
        flash('Ainda há palete aguardando guarda. Guarde todos antes de finalizar.', 'error')
        return _voltar_nota(nota)
    conferido = conferido_por_item(nota)
    faltou_motivo = False
    for item in nota.itens:
        if conferido.get(item.id, 0) == item.quantidade:
            item.motivo_divergencia = None
            continue
        motivo = (request.form.get(f'motivo_{item.id}') or '').strip()[:200]
        if not motivo:
            faltou_motivo = True
        item.motivo_divergencia = motivo or None
    if faltou_motivo:
        db.session.rollback()
        flash('Informe o motivo de cada divergência (falta ou sobra) para finalizar.', 'error')
        return _voltar_nota(nota)
    nota.status, nota.finalizado_em = 'Finalizada', agora()
    registrar_log('Finalizou retorno' if nota.tipo == 'Retorno' else 'Finalizou recebimento',
                  f'NF {nota.numero} · {len(nota.paletes)} palete(s)', modulo=_modulo(nota))
    db.session.commit()
    flash(f'{"Retorno" if nota.tipo == "Retorno" else "Recebimento"} da NF {nota.numero} finalizado.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/reabrir', methods=['POST'])
@perm('recebimento')
def reabrir(nid):
    nota = _nota_ou_404(nid)
    if nota.status not in ('Finalizada', 'Cancelada'):
        abort(400)
    anterior = nota.status
    nota.status = 'Em conferência' if nota.paletes else 'Aguardando'
    nota.finalizado_em, nota.motivo_cancelamento = None, None
    registrar_log('Reabriu retorno' if nota.tipo == 'Retorno' else 'Reabriu recebimento',
                  f'NF {nota.numero} (estava {anterior})', modulo=_modulo(nota))
    db.session.commit()
    flash('Nota reaberta.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/cancelar', methods=['POST'])
@perm('recebimento')
def cancelar(nid):
    nota = _nota_ou_404(nid)
    motivo = (request.form.get('motivo') or '').strip()[:200]
    if nota.status not in ABERTAS:
        abort(400)
    if not motivo:
        flash('Informe o motivo do cancelamento.', 'error')
        return _voltar_nota(nota)
    if any(p.status in NO_ARMAZEM for p in nota.paletes):
        flash('Há paletes desta nota guardados no armazém. Remova-os do estoque em Movimentação antes de cancelar.', 'error')
        return _voltar_nota(nota)
    for palete in [p for p in nota.paletes if p.status == 'Aguardando guarda']:
        db.session.delete(palete)
    nota.status, nota.motivo_cancelamento, nota.finalizado_em = 'Cancelada', motivo, agora()
    registrar_log('Cancelou retorno' if nota.tipo == 'Retorno' else 'Cancelou entrada', f'NF {nota.numero} — {motivo}',
                  modulo=_modulo(nota))
    db.session.commit()
    flash('Retorno cancelado.' if nota.tipo == 'Retorno' else 'Entrada cancelada.', 'success')
    return _voltar_nota(nota)


@bp.route('/notas/<int:nid>/excluir', methods=['POST'])
@perm('recebimento')
def excluir(nid):
    nota = _nota_ou_404(nid)
    if nota.paletes:
        flash('Esta nota tem paletes e não pode ser excluída. Cancele a entrada.', 'error')
        return _voltar_nota(nota)
    registrar_log('Excluiu retorno' if nota.tipo == 'Retorno' else 'Excluiu NF de entrada', f'NF {nota.numero}',
                  modulo=_modulo(nota))
    destino = _lista_da(nota)
    db.session.delete(nota)
    db.session.commit()
    flash('Nota excluída.', 'success')
    return redirect(destino)


# ---------------------------------------------------------------- PDF da nota fiscal

def texto_do_xml(conteudo):
    """XML enviado, como texto (o arquivo pode vir em UTF-8 ou em latin-1)."""
    for codificacao in ('utf-8-sig', 'latin-1'):
        try:
            return conteudo.decode(codificacao)
        except UnicodeDecodeError:
            continue
    return None


@bp.route('/notas/<int:nid>/xml', methods=['POST'])
@perm('recebimento')
def anexar_xml(nid):
    """Guarda (ou troca) o XML da nota, para o PDF dela ser o DANFE oficial. Serve para notas digitadas, de planilha
    ou importadas antes de o sistema guardar o XML. So aceita o XML da mesma nota."""
    nota = _nota_ou_404(nid)
    arquivo = request.files.get('arquivo')
    conteudo = arquivo.read() if arquivo and arquivo.filename else b''
    if not conteudo:
        flash('Escolha o arquivo XML da nota.', 'error')
        return _voltar_nota(nota)
    try:
        dados = ler_nfe(conteudo)
    except XmlInvalido as erro:
        flash(f'{arquivo.filename}: {erro}', 'error')
        return _voltar_nota(nota)
    if str(dados['numero']).lstrip('0') != str(nota.numero).lstrip('0'):
        flash(f'Este XML é da NF {dados["numero"]}, não da NF {nota.numero}. Nada foi alterado.', 'error')
        return _voltar_nota(nota)
    if nota.chave and dados['chave'] and nota.chave != dados['chave']:
        flash('A chave de acesso deste XML é diferente da chave da nota. Nada foi alterado.', 'error')
        return _voltar_nota(nota)
    if not nota.chave and dados['chave']:
        outra = NotaFiscal.query.filter(NotaFiscal.chave == dados['chave'], NotaFiscal.id != nota.id).first()
        if outra:
            flash(f'Este XML já pertence a outra nota do sistema (NF {outra.numero}, {outra.tipo}). Nada foi alterado.', 'error')
            return _voltar_nota(nota)
        nota.chave = dados['chave']
    nota.xml = texto_do_xml(conteudo)
    nota.peso_bruto, nota.peso_liquido = dados.get('peso_bruto') or 0.0, dados.get('peso_liquido') or 0.0
    # o PDF guardado (se havia) e do XML antigo
    for sobra in (f'{nota.id}.pdf', f'{nota.id}.falha'):
        guardado = os.path.join(current_app.instance_path, 'danfe', sobra)
        if os.path.exists(guardado):
            os.remove(guardado)
    registrar_log('Anexou XML à nota', f'NF {nota.numero}', modulo=_modulo(nota))
    db.session.commit()
    preparar_danfes([nota])
    flash('XML guardado e enviado ao Meu Danfe. O botão "NF em PDF" agora abre o DANFE oficial.' if chave_meu_danfe()
          else 'XML guardado. O botão "NF em PDF" ainda abre o espelho: falta a chave do Meu Danfe (MEU_DANFE_API_KEY) no arquivo .env.',
          'success')
    return _voltar_nota(nota)


ESPERA_ENTRE_ENVIOS = 0.6          # o Meu Danfe pede volume baixo: no maximo ~2 notas por segundo
ultima_preparacao = None           # a ultima tarefa de envio iniciada (os testes esperam por ela)


def preparar_danfes(notas):
    """Manda o XML das notas recem-importadas para o Meu Danfe e deixa o PDF (DANFE) de cada uma ja guardado.

    Roda em segundo plano, para a importacao nao ficar esperando a internet; uma nota por vez, com intervalo.
    Se alguma falhar, nada se perde: o XML esta guardado e o PDF e gerado quando alguem abrir a nota.
    Devolve quantas notas foram para a fila (0 quando o Meu Danfe nao esta configurado).
    """
    global ultima_preparacao
    # aceita notas de entrada / retorno (NotaFiscal) e notas de saida (NfSaida)
    ids = [(type(n), n.id) for n in notas if n.xml]
    if not ids or not chave_meu_danfe():
        return 0
    app = current_app._get_current_object()

    def tarefa():
        with app.app_context():
            for posicao, (modelo, nota_id) in enumerate(ids):
                if posicao:
                    time.sleep(ESPERA_ENTRE_ENVIOS)
                try:
                    nota = db.session.get(modelo, nota_id)
                    if nota:
                        (danfe_da_saida if modelo is NfSaida else danfe_oficial_da_nota)(nota)
                except Exception:        # uma nota com problema nao pode parar as outras
                    app.logger.exception('Falha ao preparar o DANFE da nota %s', nota_id)
                finally:
                    db.session.remove()

    ultima_preparacao = threading.Thread(target=tarefa, name='preparar-danfes', daemon=True)
    ultima_preparacao.start()
    return len(ids)


def danfe_da_saida(nf):
    """DANFE oficial de uma NF de saida (XML guardado na importacao da carga). Devolve (pdf, None) ou (None, motivo)."""
    if not chave_meu_danfe():
        return None, 'A chave do Meu Danfe (MEU_DANFE_API_KEY) não está configurada no arquivo .env.'
    pasta = os.path.join(current_app.instance_path, 'danfe')
    os.makedirs(pasta, exist_ok=True)
    guardado = os.path.join(pasta, f'saida-{nf.id}.pdf')
    if os.path.exists(guardado):
        with open(guardado, 'rb') as arq:
            return arq.read(), None
    pdf, erro = pdf_oficial(nf.xml)
    if pdf:
        with open(guardado, 'wb') as arq:
            arq.write(pdf)
    return pdf, erro


def danfe_oficial_da_nota(nota):
    """DANFE oficial (Meu Danfe) da nota. Devolve (pdf, None), ou (None, aviso) quando so da para o espelho.

    Com o XML guardado: converte o XML (gratis). Sem XML mas com a chave de acesso: o Meu Danfe busca a nota na
    Receita (R$ 0,03, uma vez) e o XML que vier fica guardado na nota. O PDF fica em cache em instance/danfe.
    """
    if not chave_meu_danfe():
        return None, None
    if not nota.xml and not (nota.chave and busca_paga_ligada()):
        # caminho gratis do Meu Danfe = converter o XML; sem o XML guardado, fica o espelho ate alguem anexar
        return None, ('Esta nota não tem o XML guardado, por isso este é o espelho feito pelo WMS. Para abrir o DANFE oficial '
                      '(grátis), anexe o XML: abra a nota em Entrada > Recebimento e clique em "Anexar XML".')
    pasta = os.path.join(current_app.instance_path, 'danfe')
    os.makedirs(pasta, exist_ok=True)
    guardado = os.path.join(pasta, f'{nota.id}.pdf')
    if os.path.exists(guardado):
        with open(guardado, 'rb') as arq:
            return arq.read(), None
    # Limite de tentativas por nota: depois de uma falha, o Meu Danfe so e chamado de novo passado um intervalo
    # (e poucas vezes por dia). Insistir na mesma chave em pouco tempo bloqueia a conta.
    marca = os.path.join(pasta, f'{nota.id}.falha')
    falhas = []
    if os.path.exists(marca):
        try:
            with open(marca, encoding='utf-8') as arq:
                registro = json.load(arq)
            falhas = [f for f in registro.get('quando', []) if time.time() - f < 24 * 3600]
            erro_anterior = registro.get('erro') or ''
        except (ValueError, OSError):
            falhas, erro_anterior = [], ''
        if falhas:
            desde = time.time() - max(falhas)
            if len(falhas) >= MAX_FALHAS_POR_DIA:
                return None, (f'O DANFE oficial não foi gerado: {erro_anterior} Já foram {len(falhas)} tentativas nas últimas 24 horas; '
                              'o sistema só tenta de novo amanhã, para não bloquear a conta no Meu Danfe. Anexar o XML na tela da nota '
                              'resolve na hora. Este é o espelho da nota feito pelo WMS.')
            if desde < INTERVALO_APOS_FALHA:
                minutos = int((INTERVALO_APOS_FALHA - desde) // 60) + 1
                return None, (f'O DANFE oficial não foi gerado: {erro_anterior} Nova tentativa liberada em {minutos} minuto(s) '
                              '(o sistema espera para não bloquear a conta no Meu Danfe). Este é o espelho da nota feito pelo WMS.')
    if nota.xml:
        pdf, erro = pdf_oficial(nota.xml)
    else:
        pdf, xml, erro = pdf_pela_chave(nota.chave)
        if xml:
            nota.xml = xml
            registrar_log('Buscou a NF no Meu Danfe pela chave', f'NF {nota.numero}', modulo=_modulo(nota))
            db.session.commit()
    if pdf:
        with open(guardado, 'wb') as arq:
            arq.write(pdf)
        if os.path.exists(marca):
            os.remove(marca)
        return pdf, None
    with open(marca, 'w', encoding='utf-8') as arq:
        json.dump({'quando': falhas + [time.time()], 'erro': erro}, arq)
    return None, f'O DANFE oficial não pôde ser gerado agora: {erro} Este é o espelho da nota feito pelo WMS.'


@bp.route('/notas/<int:nid>/pdf')
@perm('recebimento')
def nota_pdf(nid):
    """Abre o PDF da nota. Com XML guardado e chave do Meu Danfe: o DANFE oficial (fica em cache em instance/danfe).
    Nos outros casos: um espelho da nota montado aqui, com o que o sistema tem."""
    return resposta_pdf_da_nota(_nota_ou_404(nid))


def resposta_pdf_da_nota(nota):
    """O PDF da nota (DANFE oficial ou espelho), ja como resposta. Quem chama confere antes se o usuario pode ver a nota."""
    nome = f'NF_{nota.numero}.pdf'

    def responder(pdf):
        return Response(pdf, mimetype='application/pdf', headers={'Content-Disposition': f'inline; filename="{nome}"',
                                                                  'Cache-Control': 'no-store'})

    pdf, aviso = danfe_oficial_da_nota(nota)
    if pdf:
        return responder(pdf)
    destinatario = None
    if nota.xml:
        try:
            dados = ler_nfe(nota.xml.encode('utf-8'))
            destinatario = {'nome': dados.get('destinatario_nome'), 'cidade': dados.get('destinatario_cidade')}
        except XmlInvalido:
            pass
    return responder(pdf_espelho(nota, destinatario=destinatario, usuario=usuario_atual().username, aviso=aviso))


# ---------------------------------------------------------------- extrato de recebimento

def _dados_extrato(nota):
    conferido = conferido_por_item(nota)
    itens = []
    for item in nota.itens:
        feito = conferido.get(item.id, 0)
        diferenca = round(feito - item.quantidade, 3)
        itens.append({'item': item, 'conferido': feito, 'diferenca': diferenca,
                      'situacao': 'Conferido' if diferenca == 0 else 'Pendente' if not feito
                      else f'Falta {-diferenca:g}' if diferenca < 0 else f'Sobra {diferenca:g}'})
    paletes = [p for p in nota.paletes if p.status != 'Baixado']
    return {'itens': itens, 'paletes': paletes, 'baixados': [p for p in nota.paletes if p.status == 'Baixado'],
            'total_nota': round(sum(i.quantidade for i in nota.itens), 3),
            'total_conferido': round(sum(l['conferido'] for l in itens), 3),
            'divergentes': sum(1 for l in itens if l['diferenca'] != 0)}


@bp.route('/notas/<int:nid>/extrato')
@perm('recebimento')
def extrato(nid):
    """Extrato do recebimento: para imprimir (ou salvar em PDF) ou, com ?formato=xlsx, em Excel."""
    nota = _nota_ou_404(nid)
    dados = _dados_extrato(nota)
    if request.args.get('formato') != 'xlsx':
        return render_template('entrada_extrato.html', nota=nota, emitido_em=agora(),
                               emitido_por=usuario_atual().nome, **dados)

    def br(data):
        return data.strftime('%d/%m/%Y') if data else None

    def titulo(aba, colunas, larguras):
        aba.append(colunas)
        for celula in aba[aba.max_row]:
            celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
        for indice, largura in enumerate(larguras, start=1):
            aba.column_dimensions[aba.cell(row=1, column=indice).column_letter].width = largura

    livro = Workbook()
    resumo = livro.active
    resumo.title = 'Resumo'
    for rotulo, valor in (
            ('Extrato de retorno' if nota.tipo == 'Retorno' else 'Extrato de recebimento',
             f'NF {nota.numero}' + (f' / {nota.serie}' if nota.serie else '')),
            ('Motivo do retorno', nota.motivo_retorno), ('Carga de origem', nota.carga.codigo if nota.carga else None),
            ('Situação', nota.status), ('Remetente', nota.empresa.nome if nota.empresa else None),
            ('CNPJ', nota.empresa.cnpj if nota.empresa else None), ('Chave de acesso', nota.chave),
            ('Emissão', br(nota.data_emissao)), ('Entrada no sistema', nota.criado_em.strftime('%d/%m/%Y %H:%M')),
            ('Finalizado em', nota.finalizado_em.strftime('%d/%m/%Y %H:%M') if nota.finalizado_em else None),
            ('Doca', nota.doca), ('Placa', nota.placa), ('Motorista', nota.motorista), ('Conferente', nota.conferente),
            ('Observação', nota.observacao), ('Itens', len(nota.itens)), ('Quantidade da nota', dados['total_nota']),
            ('Quantidade conferida', dados['total_conferido']), ('Itens com divergência', dados['divergentes']),
            ('Paletes', len(dados['paletes']))):
        resumo.append([rotulo, valor])
        resumo.cell(row=resumo.max_row, column=1).font = Font(bold=True)
    resumo.column_dimensions['A'].width, resumo.column_dimensions['B'].width = 26, 60

    aba = livro.create_sheet('Itens')
    titulo(aba, ['SKU', 'Descrição', 'EAN', 'Unidade', 'Qtd NF', 'Conferido', 'Diferença', 'Situação', 'Motivo da divergência',
                 'Lote', 'Validade'], (14, 44, 16, 9, 10, 11, 11, 14, 40, 14, 12))
    for l in dados['itens']:
        i = l['item']
        aba.append([i.produto.sku, i.produto.descricao, i.produto.ean, i.unidade, i.quantidade, l['conferido'],
                    l['diferenca'], l['situacao'], i.motivo_divergencia, i.lote, br(i.validade)])
    aba = livro.create_sheet('Paletes')
    titulo(aba, ['Etiqueta', 'SKU', 'Descrição', 'Quantidade', 'Unidade', 'UP', 'Lote', 'Fabricação', 'Validade',
                 'Classificação', 'Situação', 'Endereço', 'Montado em', 'Montado por'],
           (26, 14, 44, 11, 9, 8, 14, 12, 12, 18, 18, 14, 17, 16))
    for p in nota.paletes:
        for it in p.itens:
            destino = p.endereco or p.sugerido
            aba.append([p.etiqueta, it.produto.sku, it.produto.descricao, it.quantidade, it.produto.unidade, p.up, it.lote,
                        br(it.fabricacao), br(it.validade), p.classificacao, p.status,
                        destino.codigo if destino else None, p.criado_em.strftime('%d/%m/%Y %H:%M'), p.criado_por])
    for folha in livro.worksheets[1:]:
        folha.freeze_panes = 'A2'
    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name=f'extrato_{"retorno" if nota.tipo == "Retorno" else "recebimento"}_NF_{nota.numero}.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


# ---------------------------------------------------------------- conferencia (fila do operador)

@bp.route('/conferencia')
@perm('recebimento')
def conferencia():
    numero = (request.args.get('nf') or '').strip()
    if numero:
        achadas = NotaFiscal.query.filter_by(tipo='Entrada', numero=numero).order_by(NotaFiscal.criado_em.desc()).all()
        if len(achadas) == 1:
            return _voltar_nota(achadas[0])
        if not achadas:
            flash(f'NF {numero} não encontrada. Importe o XML ou cadastre a nota em Recebimento.', 'error')
    abertas = (NotaFiscal.query.filter(NotaFiscal.tipo == 'Entrada', NotaFiscal.status.in_(ABERTAS))
               .order_by(NotaFiscal.criado_em).all())
    if numero:
        abertas = [n for n in abertas if n.numero == numero] or abertas
    andamento = []
    for nota in abertas:
        conferido = conferido_por_item(nota)
        total = sum(i.quantidade for i in nota.itens)
        feito = sum(min(conferido.get(i.id, 0), i.quantidade) for i in nota.itens)
        andamento.append({'nota': nota, 'pct': round(100 * feito / total) if total else 0,
                          'pendentes': sum(1 for p in nota.paletes if p.status == 'Aguardando guarda')})
    pendentes = Palete.query.filter_by(status='Aguardando guarda').order_by(Palete.criado_em).all()
    return render_template('entrada_conferencia.html', andamento=andamento, pendentes=pendentes, numero=numero,
                           resumo_itens=resumo_itens)
