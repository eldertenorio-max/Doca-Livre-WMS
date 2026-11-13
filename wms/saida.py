"""Saida (expedicao): cargas a partir de XML/planilha, separacao, conferencia de carga, extrato,
divergencias e painel. O romaneio (itens por nota fiscal) aparece dentro de cada carga."""
import io
import re
from datetime import datetime, timedelta

from flask import Blueprint, Response, abort, flash, redirect, render_template, request, send_file, url_for
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from .cadastros import _normalizar, _texto_celula
from .core import perm, registrar_log, usuario_atual
from .entrada import _data, _produto_para, _quantidade, danfe_da_saida, preparar_danfes, texto_do_xml
from .sistema import politica_separacao
from .models import Carga, CargaItem, Endereco, NfSaida, NotaFiscal, Palete, PaleteItem, Produto, Separacao, agora, db
from .nfe import XmlInvalido, ler_nfe
from .paletes import colocar_em, gerar_etiqueta, localizar_palete, registrar, tirar_do_armazem, vaga_no_stage

bp = Blueprint('saida', __name__, url_prefix='/saida')

MOTIVOS = ['Venda', 'Transferência', 'Descarte', 'Devolução de remessa', 'Acerto de estoque', 'Revenda']
ABERTAS = ('Aberta', 'Em separação', 'Em conferência')
MOTIVOS_DIVERGENCIA = ['Avaria durante o carregamento', 'Produto em falta no estoque', 'Produtos inseridos a mais que o pedido',
                       'Erro de separação', 'Outro']
COLUNAS_PLANILHA = ['Carga', 'NF', 'Série', 'Cliente', 'Cidade', 'Código', 'Descrição', 'EAN', 'Unidade', 'Quantidade']
POR_PAGINA = 50


# ---------------------------------------------------------------- apoio

def _carga_ou_404(cid):
    carga = db.session.get(Carga, cid)
    if not carga:
        abort(404)
    return carga


def _novo_codigo():
    ultimo = db.session.query(db.func.max(Carga.id)).scalar() or 0
    while True:
        ultimo += 1
        codigo = f'C{ultimo:06d}'
        if not Carga.query.filter_by(codigo=codigo).first():
            return codigo


def _carga_para(codigo, criar=True):
    """Acha a carga aberta pelo codigo; se nao existir (e criar=True), abre uma nova."""
    codigo = (codigo or '').strip().upper()[:20]
    carga = Carga.query.filter_by(codigo=codigo).first() if codigo else None
    if carga:
        return (carga, None) if carga.status in ABERTAS else (None, f'A carga {codigo} está {carga.status.lower()} e não aceita notas.')
    if not criar:
        return None, f'Carga {codigo} não encontrada.'
    carga = Carga(codigo=codigo or _novo_codigo(), criado_por=usuario_atual().username)
    db.session.add(carga)
    db.session.flush()
    return carga, None


def separado_por_item(carga):
    """item_id -> (pendente, separado) das tarefas de separacao."""
    linhas = (db.session.query(Separacao.carga_item_id, Separacao.status, db.func.sum(Separacao.quantidade))
              .join(CargaItem).filter(CargaItem.carga_id == carga.id)
              .group_by(Separacao.carga_item_id, Separacao.status).all())
    resumo = {}
    for item_id, status, total in linhas:
        atual = resumo.setdefault(item_id, [0, 0])
        atual[0 if status == 'Pendente' else 1] += total or 0
    return resumo


def resumo_carga(carga):
    separado = separado_por_item(carga)
    linhas = []
    for item in carga.itens:
        pendente, feito = separado.get(item.id, (0, 0))
        diferenca = round(item.conferido - item.quantidade, 3)
        linhas.append({'item': item, 'a_separar': round(pendente, 3), 'separado': round(feito, 3),
                       'sem_estoque': round(max(item.quantidade - pendente - feito, 0), 3), 'diferenca': diferenca,
                       'situacao': 'Conferido' if diferenca == 0 else 'Pendente' if not item.conferido
                       else f'Falta {-diferenca:g}' if diferenca < 0 else f'Sobra {diferenca:g}'})
    return {'linhas': linhas, 'total': round(sum(i.quantidade for i in carga.itens), 3),
            'conferido': round(sum(i.conferido for i in carga.itens), 3),
            'divergentes': [l for l in linhas if l['diferenca'] != 0],
            'notas': sorted({i.nf_numero for i in carga.itens if i.nf_numero}),
            'pct': round(100 * sum(min(i.conferido, i.quantidade) for i in carga.itens)
                         / sum(i.quantidade for i in carga.itens)) if carga.itens else 0}


def _titulo_planilha(aba, colunas, larguras):
    aba.append(colunas)
    for celula in aba[aba.max_row]:
        celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
    for indice, largura in enumerate(larguras, start=1):
        aba.column_dimensions[aba.cell(row=1, column=indice).column_letter].width = largura
    aba.freeze_panes = 'A2'


def _enviar_planilha(livro, nome):
    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name=nome,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def _periodo():
    """Datas do filtro (?de=&ate=); por padrao os ultimos 30 dias."""
    ate = _data(request.args.get('ate')) or agora().date()
    de = _data(request.args.get('de')) or ate - timedelta(days=30)
    return de, ate


# ---------------------------------------------------------------- cargas: saida por XML, planilha ou manual

@bp.route('/cargas')
@perm('expedicao')
def cargas():
    situacao = request.args.get('situacao') or 'abertas'
    busca = (request.args.get('q') or '').strip()
    consulta = Carga.query
    if situacao == 'abertas':
        consulta = consulta.filter(Carga.status.in_(ABERTAS))
    elif situacao in ABERTAS + ('Expedida', 'Cancelada'):
        consulta = consulta.filter_by(status=situacao)
    if busca:
        like = f'%{busca.upper()}%'
        com_nf = db.select(CargaItem.carga_id).where(db.or_(CargaItem.nf_numero.like(like),
                                                            db.func.upper(CargaItem.cliente).like(like)))
        consulta = consulta.filter(db.or_(Carga.codigo.like(like), Carga.placa.like(like), Carga.id.in_(com_nf)))
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    lista = consulta.order_by(Carga.id.desc()).offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all()
    contagem = dict(db.session.query(Carga.status, db.func.count(Carga.id)).group_by(Carga.status).all())
    return render_template('saida_cargas.html', cargas=[(c, resumo_carga(c)) for c in lista], situacao=situacao,
                           busca=busca, total=total, pagina=pagina, contagem=contagem, motivos=MOTIVOS,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1))


def _incluir_nota(carga, dados):
    """Poe os itens de uma NF de saida no romaneio da carga. Devolve quantos produtos novos foram cadastrados."""
    novos = 0
    for item in dados['itens']:
        produto, criado = _produto_para(item.get('codigo'), item.get('ean'), item.get('descricao'), item.get('unidade'))
        novos += criado
        carga.itens.append(CargaItem(nf_numero=str(dados['numero'])[:15], nf_serie=dados.get('serie') or None,
                                     nf_chave=dados.get('chave'), cliente=(dados.get('destinatario_nome') or '')[:150] or None,
                                     cidade=(dados.get('destinatario_cidade') or '')[:80] or None, produto=produto,
                                     unidade=(item.get('unidade') or produto.unidade)[:6], quantidade=item['quantidade']))
    return novos


@bp.route('/cargas/xml', methods=['POST'])
@perm('expedicao')
def importar_xml():
    voltar = redirect(url_for('saida.cargas'))
    arquivos = [a for a in request.files.getlist('arquivos') if a and a.filename]
    if not arquivos:
        flash('Escolha ao menos um arquivo XML.', 'error')
        return voltar
    carga, erro = _carga_para(request.form.get('carga'))
    if erro:
        flash(erro, 'error')
        return voltar
    incluidas, erros, novos, guardadas = [], [], 0, []
    for arquivo in arquivos:
        conteudo = arquivo.read()
        try:
            dados = ler_nfe(conteudo)
        except XmlInvalido as problema:
            erros.append(f'{arquivo.filename}: {problema}')
            continue
        repetida = CargaItem.query.join(Carga).filter(CargaItem.nf_chave == dados['chave'], Carga.status != 'Cancelada').first() \
            if dados['chave'] else None
        if repetida:
            # Reentrega: a NF que ja saiu e voltou (tem retorno aberto ou finalizado) pode entrar em outra carga.
            em_aberto = CargaItem.query.join(Carga).filter(CargaItem.nf_chave == dados['chave'],
                                                           Carga.status.notin_(('Cancelada', 'Expedida'))).first()
            voltou = NotaFiscal.query.filter(NotaFiscal.tipo == 'Retorno', NotaFiscal.numero == str(dados['numero']),
                                             NotaFiscal.status != 'Cancelada').first()
            if em_aberto or not voltou:
                erros.append(f'{arquivo.filename}: a NF {dados["numero"]} já está na carga {(em_aberto or repetida).carga.codigo}.'
                             + ('' if em_aberto else ' Se ela voltou da rua, abra o retorno em Retornos antes de colocá-la em outra carga.'))
                continue
        novos += _incluir_nota(carga, dados)
        incluidas.append(dados['numero'])
        if dados['chave']:
            # o XML da NF de saida fica guardado (uma vez por chave) para gerar o PDF dela
            nf = NfSaida.query.filter_by(chave=dados['chave']).first()
            if not nf:
                nf = NfSaida(chave=dados['chave'], numero=str(dados['numero'])[:15], xml=texto_do_xml(conteudo))
                db.session.add(nf)
                guardadas.append(nf)
    if not incluidas:
        db.session.rollback()
    else:
        registrar_log('Importou XML de saída', f'Carga {carga.codigo}: NF ' + ', '.join(incluidas), modulo='expedicao')
        db.session.commit()
        mensagem = f'{len(incluidas)} nota(s) incluída(s) na carga {carga.codigo}: ' + ', '.join(incluidas) + '.'
        if preparar_danfes(guardadas):
            mensagem += ' O XML já foi enviado ao Meu Danfe; o PDF da nota fica pronto em instantes.'
        if novos:
            mensagem += f' {novos} produto(s) novo(s) foram cadastrados com os dados da nota — revise em Cadastros › Produtos.'
        flash(mensagem, 'success')
    for erro in erros[:8]:
        flash(erro, 'error')
    return redirect(url_for('saida.carga', cid=carga.id)) if incluidas else voltar


def pdfs_da_carga(carga):
    """numero da NF -> id do XML guardado, para as telas mostrarem o botao do PDF so nas notas que vieram por XML."""
    chaves = {i.nf_chave for i in carga.itens if i.nf_chave}
    if not chaves:
        return {}
    return {nf.numero: nf.id for nf in NfSaida.query.filter(NfSaida.chave.in_(chaves))}


@bp.route('/nf/<int:nfid>/pdf')
@perm('expedicao')
def nf_pdf(nfid):
    """Abre o DANFE da NF de saida (gerado pelo Meu Danfe a partir do XML guardado)."""
    nf = db.session.get(NfSaida, nfid)
    if not nf:
        abort(404)
    pdf, erro = danfe_da_saida(nf)
    if not pdf:
        flash(f'Não foi possível abrir o PDF da NF {nf.numero}: {erro}', 'error')
        return redirect(request.referrer or url_for('saida.cargas'))
    return Response(pdf, mimetype='application/pdf', headers={'Content-Disposition': f'inline; filename="NF_{nf.numero}.pdf"',
                                                              'Cache-Control': 'no-store'})


@bp.route('/cargas/modelo-planilha')
@perm('expedicao')
def modelo_planilha():
    livro = Workbook()
    aba = livro.active
    aba.title = 'Romaneio'
    _titulo_planilha(aba, COLUNAS_PLANILHA, (14, 12, 8, 34, 20, 14, 40, 16, 10, 12))
    aba.append(['V1001', '5501', '1', 'Supermercado Exemplo', 'Guarulhos', 'P0001', 'Pão de queijo 1kg', '7891234567890', 'CX', 24])
    ajuda = livro.create_sheet('Como preencher')
    for linha in (['Uma linha por item de cada nota de saída. Linhas com a mesma Carga vão no mesmo veículo.'],
                  ['Obrigatórios: Código e Quantidade. Carga em branco: o sistema cria uma carga nova para a planilha.'],
                  ['Produto que ainda não existe é cadastrado automaticamente. Apague a linha de exemplo antes de enviar.']):
        ajuda.append(linha)
    ajuda.column_dimensions['A'].width = 110
    return _enviar_planilha(livro, 'modelo_romaneio_saida.xlsx')


@bp.route('/cargas/planilha', methods=['POST'])
@perm('expedicao')
def importar_planilha():
    voltar = redirect(url_for('saida.cargas'))
    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename.lower().endswith('.xlsx'):
        flash('Envie uma planilha no formato .xlsx (use o modelo).', 'error')
        return voltar
    try:
        linhas = list(load_workbook(arquivo, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
    except Exception:
        flash('Não foi possível ler a planilha. Confira se o arquivo é um .xlsx válido.', 'error')
        return voltar
    posicao = {_normalizar(t): i for i, t in enumerate(linhas[0])} if linhas else {}
    faltando = [c for c in ('Código', 'Quantidade') if _normalizar(c) not in posicao]
    if faltando:
        flash('A planilha precisa ter as colunas: ' + ', '.join(faltando) + '. Baixe o modelo e preencha nele.', 'error')
        return voltar

    def celula(linha, coluna):
        indice = posicao.get(_normalizar(coluna))
        return _texto_celula(linha[indice]) if indice is not None and indice < len(linha) else ''

    padrao, cargas_usadas, erros, itens, novos = None, {}, [], 0, 0
    for numero, linha in enumerate(linhas[1:], start=2):
        if not any(_texto_celula(v) for v in linha):
            continue
        codigo, quantidade = celula(linha, 'Código'), _quantidade(celula(linha, 'Quantidade'))
        if not codigo or quantidade is None:
            erros.append(f'Linha {numero}: falta ' + ('Código' if not codigo else 'Quantidade (número maior que zero)') + '.')
            continue
        codigo_carga = celula(linha, 'Carga').upper()[:20]
        if codigo_carga in cargas_usadas:
            carga = cargas_usadas[codigo_carga]
        elif not codigo_carga and padrao:
            carga = padrao
        else:
            carga, erro = _carga_para(codigo_carga)
            if erro:
                erros.append(f'Linha {numero}: {erro}')
                continue
            if codigo_carga:
                cargas_usadas[codigo_carga] = carga
            else:
                padrao = carga
        produto, criado = _produto_para(codigo, re.sub(r'\D', '', celula(linha, 'EAN')) or None,
                                        celula(linha, 'Descrição') or None, celula(linha, 'Unidade').upper()[:6] or None)
        novos += criado
        carga.itens.append(CargaItem(nf_numero=celula(linha, 'NF')[:15] or None, nf_serie=celula(linha, 'Série')[:5] or None,
                                     cliente=celula(linha, 'Cliente')[:150] or None, cidade=celula(linha, 'Cidade')[:80] or None,
                                     produto=produto, unidade=(celula(linha, 'Unidade').upper() or produto.unidade)[:6],
                                     quantidade=quantidade))
        itens += 1
    if itens:
        usadas = list(cargas_usadas.values()) + ([padrao] if padrao else [])
        registrar_log('Importou planilha de saída', f'{itens} item(ns) em ' + ', '.join(c.codigo for c in usadas), modulo='expedicao')
        db.session.commit()
        mensagem = f'{itens} item(ns) incluído(s) em {len(usadas)} carga(s): ' + ', '.join(c.codigo for c in usadas) + '.'
        if novos:
            mensagem += f' {novos} produto(s) novo(s) foram cadastrados — revise em Cadastros › Produtos.'
        flash(mensagem, 'success')
    else:
        db.session.rollback()
        if not erros:
            flash('Nenhuma linha preenchida na planilha.', 'error')
    if erros:
        flash(f'{len(erros)} problema(s): ' + ' | '.join(erros[:8]) + (' | …' if len(erros) > 8 else ''), 'error')
    return voltar


@bp.route('/cargas/nova', methods=['POST'])
@perm('expedicao')
def carga_nova():
    codigo = (request.form.get('codigo') or '').strip().upper()[:20]
    if codigo and Carga.query.filter_by(codigo=codigo).first():
        flash(f'Já existe uma carga com o código {codigo}.', 'error')
        return redirect(url_for('saida.cargas'))
    carga, _ = _carga_para(codigo)
    carga.motivo = request.form.get('motivo') if request.form.get('motivo') in MOTIVOS else 'Venda'
    carga.data_expedicao = _data(request.form.get('data_expedicao'))
    registrar_log('Abriu carga', carga.codigo, modulo='expedicao')
    db.session.commit()
    flash(f'Carga {carga.codigo} aberta. Inclua os itens.', 'success')
    return redirect(url_for('saida.carga', cid=carga.id))


@bp.route('/cargas/<int:cid>')
@perm('expedicao')
def carga(cid):
    carga = _carga_ou_404(cid)
    return render_template('saida_carga.html', carga=carga, aberta=carga.status in ABERTAS, motivos=MOTIVOS,
                           pdfs=pdfs_da_carga(carga), **resumo_carga(carga))


@bp.route('/cargas/<int:cid>/dados', methods=['POST'])
@perm('expedicao')
def carga_dados(cid):
    carga = _carga_ou_404(cid)
    if carga.status not in ABERTAS:
        abort(400)
    for campo, tamanho in (('doca', 10), ('placa', 8), ('motorista', 120), ('coordenador', 120), ('conferente', 120),
                           ('ajudantes', 200), ('observacao', 300)):
        if campo in request.form:
            valor = (request.form.get(campo) or '').strip()[:tamanho] or None
            setattr(carga, campo, valor.upper().replace('-', '') if valor and campo == 'placa' else valor)
    if 'motivo' in request.form and request.form['motivo'] in MOTIVOS:
        carga.motivo = request.form['motivo']
    if 'data_expedicao' in request.form:
        carga.data_expedicao = _data(request.form.get('data_expedicao'))
    db.session.commit()
    flash('Dados da carga salvos.', 'success')
    return redirect(request.referrer or url_for('saida.carga', cid=cid))


@bp.route('/cargas/<int:cid>/item', methods=['POST'])
@perm('expedicao')
def item_novo(cid):
    carga = _carga_ou_404(cid)
    voltar = redirect(url_for('saida.carga', cid=cid))
    if carga.status not in ABERTAS:
        flash('Esta carga não aceita mais itens.', 'error')
        return voltar
    codigo = (request.form.get('codigo') or '').strip().upper()
    quantidade = _quantidade(request.form.get('quantidade'))
    produto = Produto.query.filter(db.or_(db.func.upper(Produto.sku) == codigo, Produto.ean == codigo,
                                          Produto.dun == codigo)).first() if codigo else None
    if not produto:
        flash(f'Produto "{codigo}" não encontrado. Cadastre em Cadastros › Produtos ou informe o SKU / EAN correto.', 'error')
    elif quantidade is None:
        flash('Informe uma quantidade maior que zero.', 'error')
    else:
        carga.itens.append(CargaItem(nf_numero=(request.form.get('nf') or '').strip()[:15] or None,
                                     cliente=(request.form.get('cliente') or '').strip()[:150] or None,
                                     produto=produto, unidade=produto.unidade, quantidade=quantidade))
        db.session.commit()
        flash(f'Item {produto.sku} incluído.', 'success')
    return voltar


@bp.route('/cargas/<int:cid>/item/<int:iid>/excluir', methods=['POST'])
@perm('expedicao')
def item_excluir(cid, iid):
    carga = _carga_ou_404(cid)
    item = db.session.get(CargaItem, iid)
    if not item or item.carga_id != carga.id:
        abort(404)
    if carga.status not in ABERTAS or item.conferido or any(t.status == 'Separado' for t in item.tarefas):
        flash('Este item já foi separado ou conferido e não pode ser excluído.', 'error')
    else:
        db.session.delete(item)
        db.session.commit()
        flash('Item excluído.', 'success')
    return redirect(url_for('saida.carga', cid=cid))


@bp.route('/cargas/<int:cid>/cancelar', methods=['POST'])
@perm('expedicao')
def cancelar(cid):
    carga = _carga_ou_404(cid)
    motivo = (request.form.get('motivo') or '').strip()[:200]
    if carga.status not in ABERTAS:
        abort(400)
    if not motivo:
        flash('Informe o motivo do cancelamento.', 'error')
        return redirect(url_for('saida.carga', cid=cid))
    Separacao.query.filter(Separacao.status == 'Pendente',
                           Separacao.carga_item_id.in_([i.id for i in carga.itens])).delete(synchronize_session=False)
    no_stage = [p for p in carga.paletes if p.status == 'Stage']
    for palete in no_stage:       # continuam no stage, mas livres para voltar ao estoque ou ir em outra carga
        palete.carga_id = None
    carga.status, carga.observacao = 'Cancelada', f'Cancelada: {motivo}'
    registrar_log('Cancelou carga', f'{carga.codigo} — {motivo}', modulo='expedicao')
    db.session.commit()
    flash(f'Carga {carga.codigo} cancelada.' + (f' {len(no_stage)} palete(s) ficaram no stage: devolva ao estoque em Movimentação.'
                                                 if no_stage else ''), 'success')
    return redirect(url_for('saida.carga', cid=cid))


# ---------------------------------------------------------------- separacao

@bp.route('/separacao')
@perm('expedicao')
def separacao():
    lista = Carga.query.filter(Carga.status.in_(ABERTAS)).order_by(Carga.id).all()
    return render_template('saida_separacao.html', carga=None, cargas=[(c, resumo_carga(c)) for c in lista if c.itens])


@bp.route('/separacao/<int:cid>')
@perm('expedicao')
def separacao_carga(cid):
    carga = _carga_ou_404(cid)
    tarefas = (Separacao.query.join(CargaItem).filter(CargaItem.carga_id == carga.id)
               .order_by(Separacao.status, Separacao.origem, Separacao.id).all())
    return render_template('saida_separacao.html', carga=carga, tarefas=tarefas, aberta=carga.status in ABERTAS,
                           pendentes=sum(1 for t in tarefas if t.status == 'Pendente'), **resumo_carga(carga))


@bp.route('/separacao/<int:cid>/gerar', methods=['POST'])
@perm('expedicao')
def gerar_separacao(cid):
    """Monta a lista de separacao pela regra configurada: FEFO (vence primeiro, sai primeiro) ou FIFO."""
    carga = _carga_ou_404(cid)
    voltar = redirect(url_for('saida.separacao_carga', cid=cid))
    if carga.status not in ABERTAS:
        flash('Esta carga não está mais aberta.', 'error')
        return voltar
    # Quanto de cada palete ja esta prometido a outras tarefas pendentes (de qualquer carga).
    reservado = dict(db.session.query(Separacao.palete_item_id, db.func.sum(Separacao.quantidade))
                     .filter(Separacao.status == 'Pendente').group_by(Separacao.palete_item_id).all())
    ja_alocado = separado_por_item(carga)
    criadas, sem_estoque = 0, []
    antiguidade = db.func.coalesce(PaleteItem.fabricacao, db.func.date(Palete.criado_em))
    picking_antes = db.case((Endereco.tipo == 'Picking', 0), else_=1)
    if politica_separacao() == 'FEFO':
        # FEFO: sai primeiro o que vence primeiro; sem validade, vai para o fim, na ordem do FIFO.
        ordem = (PaleteItem.validade.is_(None), PaleteItem.validade, antiguidade, picking_antes, Palete.criado_em, Palete.id)
    else:
        # FIFO: sai primeiro o mais antigo (fabricacao; sem ela, o dia em que entrou), esteja no picking ou no pulmao.
        # Empate: o que vence antes; depois o que ja esta no picking.
        ordem = (antiguidade, PaleteItem.validade.is_(None), PaleteItem.validade, picking_antes, Palete.criado_em, Palete.id)
    for item in carga.itens:
        falta = round(item.quantidade - sum(ja_alocado.get(item.id, (0, 0))), 3)
        if falta <= 0:
            continue
        candidatos = (PaleteItem.query.join(Palete).join(Endereco, Palete.endereco_id == Endereco.id)
                      .filter(PaleteItem.produto_id == item.produto_id, Palete.status == 'Armazenado',
                              Palete.classificacao == 'Bom', Palete.carga_id.is_(None), Endereco.bloqueado.is_(False))
                      .order_by(*ordem).all())
        # Reentrega: o que voltou da rua desta mesma NF sai antes do estoque comum.
        if item.nf_numero:
            reentregas = (PaleteItem.query.join(Palete).join(Endereco, Palete.endereco_id == Endereco.id)
                          .join(NotaFiscal, Palete.nota_id == NotaFiscal.id)
                          .filter(PaleteItem.produto_id == item.produto_id, Palete.status == 'Armazenado',
                                  Palete.classificacao == 'Reentrega', Palete.carga_id.is_(None),
                                  Endereco.bloqueado.is_(False), NotaFiscal.tipo == 'Retorno',
                                  NotaFiscal.numero == item.nf_numero)
                          .order_by(Palete.criado_em, Palete.id).all())
            candidatos = reentregas + candidatos
        for conteudo in candidatos:
            livre = round(conteudo.quantidade - (reservado.get(conteudo.id) or 0), 3)
            if livre <= 0:
                continue
            quantidade = min(livre, falta)
            db.session.add(Separacao(item=item, palete=conteudo.palete, palete_item=conteudo,
                                     origem=conteudo.palete.endereco.codigo, quantidade=quantidade))
            reservado[conteudo.id] = (reservado.get(conteudo.id) or 0) + quantidade
            falta = round(falta - quantidade, 3)
            criadas += 1
            if falta <= 0:
                break
        if falta > 0:
            sem_estoque.append(f'{item.produto.sku} (faltam {falta:g})')
    if criadas:
        if carga.status == 'Aberta':
            carga.status = 'Em separação'
        registrar_log('Gerou lista de separação', f'Carga {carga.codigo}: {criadas} tarefa(s)', modulo='expedicao')
        db.session.commit()
        flash(f'{criadas} tarefa(s) de separação criada(s).', 'success')
    elif not sem_estoque:
        flash('Não há nada novo para separar nesta carga.', 'success')
    if sem_estoque:
        flash('Sem estoque disponível para: ' + ', '.join(sem_estoque[:12]) + ('…' if len(sem_estoque) > 12 else '') + '.', 'error')
    return voltar


@bp.route('/separacao/tarefa/<int:tid>/confirmar', methods=['POST'])
@perm('expedicao')
def confirmar_tarefa(tid):
    """Confirma a separacao bipando a etiqueta do palete ou a longarina de origem; o produto vai para o stage."""
    tarefa = db.session.get(Separacao, tid)
    if not tarefa:
        abort(404)
    carga = tarefa.item.carga
    voltar = redirect(url_for('saida.separacao_carga', cid=carga.id))
    origem = tarefa.palete
    if tarefa.status != 'Pendente' or carga.status not in ABERTAS:
        flash('Esta tarefa não está mais pendente.', 'error')
        return voltar
    bipado, erro = localizar_palete(request.form.get('codigo'))
    if not erro and bipado.id != origem.id:
        erro = f'O código bipado é do palete {bipado.etiqueta}, mas a tarefa pede o palete {origem.etiqueta} ({tarefa.origem}).'
    if not erro and (origem.status != 'Armazenado' or tarefa.palete_item.quantidade < tarefa.quantidade):
        erro = f'O palete {origem.etiqueta} não tem mais essa quantidade no endereço. Exclua a tarefa e gere a lista de novo.'
    vaga = None if erro else vaga_no_stage()
    if not erro and not vaga:
        erro = 'Não há câmara do tipo Stage com endereço cadastrado (Endereçamento › Carregar layout do CD).'
    if erro:
        flash(erro, 'error')
        return voltar
    conteudo = tarefa.palete_item
    if tarefa.quantidade >= conteudo.quantidade and len(origem.itens) == 1:
        origem.carga_id = carga.id                       # palete inteiro vai para o stage
        colocar_em(origem, vaga, 'Stage', motivo=f'Carga {carga.codigo}')
        mensagem = f'Palete {origem.etiqueta} levado ao stage ({vaga.codigo}).'
    else:
        # Separacao parcial: a quantidade sai do palete de origem e vira um palete novo no stage.
        conteudo.quantidade = round(conteudo.quantidade - tarefa.quantidade, 3)
        novo = Palete(etiqueta=gerar_etiqueta(), nota_id=origem.nota_id, classificacao=origem.classificacao,
                      endereco=origem.endereco, status='Armazenado', carga_id=carga.id, criado_por=usuario_atual().username)
        db.session.add(novo)
        novo.itens.append(PaleteItem(produto_id=conteudo.produto_id, nota_item_id=conteudo.nota_item_id, lote=conteudo.lote,
                                     fabricacao=conteudo.fabricacao, validade=conteudo.validade, quantidade=tarefa.quantidade))
        db.session.flush()
        colocar_em(novo, vaga, 'Stage', motivo=f'Carga {carga.codigo} · parte do palete {origem.etiqueta}')
        tarefa.palete, tarefa.palete_item = novo, novo.itens[0]
        mensagem = f'{tarefa.quantidade:g} {tarefa.item.unidade} separados do palete {origem.etiqueta} para o stage ({vaga.codigo}).'
    tarefa.status, tarefa.usuario, tarefa.separado_em = 'Separado', usuario_atual().username, agora()
    db.session.commit()
    flash(mensagem, 'success')
    return voltar


@bp.route('/separacao/tarefa/<int:tid>/excluir', methods=['POST'])
@perm('expedicao')
def excluir_tarefa(tid):
    tarefa = db.session.get(Separacao, tid)
    if not tarefa:
        abort(404)
    cid = tarefa.item.carga_id
    if tarefa.status != 'Pendente':
        flash('Tarefa já separada não pode ser excluída.', 'error')
    else:
        db.session.delete(tarefa)
        db.session.commit()
        flash('Tarefa excluída. O palete voltou a ficar disponível.', 'success')
    return redirect(url_for('saida.separacao_carga', cid=cid))


# ---------------------------------------------------------------- conferencia de carga

@bp.route('/conferencia')
@perm('expedicao')
def conferencia():
    """A conferencia e uma etapa dentro da carga; este endereco so leva a carga pedida ou a lista de cargas."""
    codigo = (request.args.get('carga') or '').strip().upper()
    achada = Carga.query.filter_by(codigo=codigo).first() if codigo else None
    if achada:
        return redirect(url_for('saida.conferencia_carga', cid=achada.id))
    if codigo:
        flash(f'Carga {codigo} não encontrada. Importe o XML ou a planilha em Saída por XML.', 'error')
    return redirect(url_for('saida.cargas'))


@bp.route('/conferencia/<int:cid>')
@perm('expedicao')
def conferencia_carga(cid):
    carga = _carga_ou_404(cid)
    dados = resumo_carga(carga)
    no_stage = [p for p in carga.paletes if p.status == 'Stage']
    return render_template('saida_conferencia.html', carga=carga, aberta=carga.status in ABERTAS, no_stage=no_stage,
                           pdfs=pdfs_da_carga(carga),
                           sem_separacao=[l for l in dados['linhas'] if l['item'].conferido > l['separado']],
                           motivos_divergencia=MOTIVOS_DIVERGENCIA, **dados)


def _item_do_codigo(carga, codigo):
    """Resolve EAN / DUN / SKU para o item da carga. Devolve (item, fator, erro)."""
    codigo = (codigo or '').strip().upper()
    if len(codigo) % 2 == 0 and codigo[:len(codigo) // 2] == codigo[len(codigo) // 2:]:
        codigo = codigo[:len(codigo) // 2]          # leitor que colou o codigo duas vezes
    if not codigo:
        return None, 1, 'Bipe ou digite o código do produto.'
    produto = Produto.query.filter(db.or_(Produto.ean == codigo, Produto.dun == codigo,
                                          db.func.upper(Produto.sku) == codigo)).first()
    if not produto:
        return None, 1, f'Código {codigo} não está no cadastro de produtos (Base de dados).'
    do_produto = [i for i in carga.itens if i.produto_id == produto.id]
    if not do_produto:
        return None, 1, f'{produto.sku} · {produto.descricao} não está na relação desta carga.'
    item = next((i for i in do_produto if i.conferido < i.quantidade), do_produto[0])
    return item, (produto.fator_caixa if produto.dun == codigo and produto.ean != codigo else 1), None


@bp.route('/conferencia/<int:cid>/bipar', methods=['POST'])
@perm('expedicao')
def bipar(cid):
    carga = _carga_ou_404(cid)
    voltar = redirect(url_for('saida.conferencia_carga', cid=cid))
    if carga.status not in ABERTAS:
        flash('Esta carga não está mais aberta.', 'error')
        return voltar
    if not carga.doca:
        flash('Informe a doca antes de começar a bipar.', 'error')
        return voltar
    acao = request.form.get('acao') or 'bipar'
    if acao == 'bipar':
        item, fator, erro = _item_do_codigo(carga, request.form.get('codigo'))
        quantidade = _quantidade(request.form.get('quantidade') or '1')
        if not erro and quantidade is None:
            erro = 'Quantidade inválida.'
        if erro:
            flash(erro, 'error')
            return voltar
        item.conferido = round(item.conferido + quantidade * fator, 3)
        flash(f'{item.produto.sku}: +{quantidade * fator:g} (conferido {item.conferido:g} de {item.quantidade:g}).', 'success')
    else:
        item = db.session.get(CargaItem, request.form.get('item_id', type=int) or 0)
        if not item or item.carga_id != carga.id:
            abort(404)
        if acao == 'completar':
            item.conferido = item.quantidade
        elif acao == 'tirar1':
            item.conferido = max(round(item.conferido - 1, 3), 0)
        elif acao == 'zerar':
            item.conferido = 0
        else:
            abort(400)
    if not carga.inicio_conferencia:
        carga.inicio_conferencia = agora()
    carga.status = 'Em conferência'
    db.session.commit()
    return voltar


@bp.route('/conferencia/<int:cid>/zerar', methods=['POST'])
@perm('expedicao')
def zerar(cid):
    carga = _carga_ou_404(cid)
    if carga.status not in ABERTAS:
        abort(400)
    for item in carga.itens:
        item.conferido, item.motivo_divergencia = 0, None
    carga.inicio_conferencia = None
    registrar_log('Zerou a conferência da carga', carga.codigo, modulo='expedicao')
    db.session.commit()
    flash('Conferência zerada.', 'success')
    return redirect(url_for('saida.conferencia_carga', cid=cid))


@bp.route('/conferencia/<int:cid>/finalizar', methods=['POST'])
@perm('expedicao')
def finalizar(cid):
    """Gera o comprovante: fecha a carga e da saida no estoque dos paletes separados para ela."""
    carga = _carga_ou_404(cid)
    voltar = redirect(url_for('saida.conferencia_carga', cid=cid))
    if carga.status not in ABERTAS:
        abort(400)
    if not carga.doca or not carga.placa:
        flash('Informe a doca e a placa antes de gerar o comprovante.', 'error')
        return voltar
    if not any(i.conferido for i in carga.itens):
        flash('Nenhum item foi conferido ainda.', 'error')
        return voltar
    faltou = False
    for item in carga.itens:
        if item.conferido == item.quantidade:
            item.motivo_divergencia = None
            continue
        motivo = ' — '.join(t for t in ((request.form.get(f'motivo_{item.id}') or '').strip(),
                                        (request.form.get(f'obs_{item.id}') or '').strip()) if t)[:200]
        if not motivo:
            faltou = True
        item.motivo_divergencia = motivo or None
    if faltou:
        db.session.rollback()
        flash('Informe o motivo de cada divergência (falta ou sobra) para gerar o comprovante.', 'error')
        return voltar
    expedidos = 0
    for palete in [p for p in carga.paletes if p.status == 'Stage']:
        tirar_do_armazem(palete, 'Expedido', 'Saída', motivo=f'Carga {carga.codigo} · {carga.motivo}')
        expedidos += 1
    carga.status, carga.fim_conferencia = 'Expedida', agora()
    if not carga.data_expedicao:
        carga.data_expedicao = agora().date()
    registrar_log('Expediu carga', f'{carga.codigo} · placa {carga.placa} · {expedidos} palete(s) baixado(s)', modulo='expedicao')
    db.session.commit()
    flash(f'Carga {carga.codigo} expedida. {expedidos} palete(s) saíram do estoque.', 'success')
    return redirect(url_for('saida.extrato', cid=cid))


# ---------------------------------------------------------------- extrato (comprovante)

@bp.route('/extrato')
@perm('expedicao')
def extratos():
    codigo = (request.args.get('carga') or '').strip().upper()
    if codigo:
        achada = Carga.query.filter_by(codigo=codigo).first()
        if achada:
            return redirect(url_for('saida.extrato', cid=achada.id))
        flash(f'Carga {codigo} não encontrada.', 'error')
    lista = Carga.query.filter(Carga.status != 'Cancelada').order_by(Carga.id.desc()).limit(100).all()
    return render_template('saida_extratos.html', cargas=[(c, resumo_carga(c)) for c in lista])


@bp.route('/extrato/<int:cid>')
@perm('expedicao')
def extrato(cid):
    carga = _carga_ou_404(cid)
    dados = resumo_carga(carga)
    paletes = Palete.query.filter_by(carga_id=carga.id).order_by(Palete.id).all()
    duracao = None
    if carga.inicio_conferencia and carga.fim_conferencia:
        minutos = int((carga.fim_conferencia - carga.inicio_conferencia).total_seconds() // 60)
        duracao = f'{minutos // 60}h {minutos % 60:02d}min'
    if request.args.get('formato') != 'xlsx':
        return render_template('saida_extrato.html', carga=carga, paletes=paletes, duracao=duracao,
                               emitido_em=agora(), emitido_por=usuario_atual().nome, **dados)
    livro = Workbook()
    resumo = livro.active
    resumo.title = 'Resumo'
    for rotulo, valor in (('Extrato de carregamento', f'Carga {carga.codigo}'), ('Situação', carga.status),
                          ('Motivo da saída', carga.motivo), ('Notas fiscais', ', '.join(dados['notas'])),
                          ('Data de expedição', carga.data_expedicao.strftime('%d/%m/%Y') if carga.data_expedicao else None),
                          ('Doca', carga.doca), ('Placa', carga.placa), ('Motorista', carga.motorista),
                          ('Coordenador', carga.coordenador), ('Conferente', carga.conferente), ('Ajudantes', carga.ajudantes),
                          ('Início da conferência', carga.inicio_conferencia.strftime('%d/%m/%Y %H:%M') if carga.inicio_conferencia else None),
                          ('Fim da conferência', carga.fim_conferencia.strftime('%d/%m/%Y %H:%M') if carga.fim_conferencia else None),
                          ('Duração', duracao), ('Itens', len(carga.itens)), ('Quantidade das notas', dados['total']),
                          ('Quantidade conferida', dados['conferido']), ('Itens com divergência', len(dados['divergentes'])),
                          ('Paletes expedidos', len(paletes))):
        resumo.append([rotulo, valor])
        resumo.cell(row=resumo.max_row, column=1).font = Font(bold=True)
    resumo.column_dimensions['A'].width, resumo.column_dimensions['B'].width = 26, 60
    aba = livro.create_sheet('Itens')
    _titulo_planilha(aba, ['NF', 'Cliente', 'Cidade', 'SKU', 'Descrição', 'Unidade', 'Qtd NF', 'Separado', 'Conferido', 'Diferença',
                           'Situação', 'Motivo da divergência'], (12, 34, 20, 14, 44, 9, 10, 10, 11, 11, 14, 44))
    for l in dados['linhas']:
        i = l['item']
        aba.append([i.nf_numero, i.cliente, i.cidade, i.produto.sku, i.produto.descricao, i.unidade, i.quantidade,
                    l['separado'], i.conferido, l['diferenca'], l['situacao'], i.motivo_divergencia])
    aba = livro.create_sheet('Paletes')
    _titulo_planilha(aba, ['Etiqueta', 'SKU', 'Descrição', 'Quantidade', 'Unidade', 'Lote', 'Validade', 'Situação'],
                     (26, 14, 44, 11, 9, 14, 12, 14))
    for p in paletes:
        for it in p.itens:
            aba.append([p.etiqueta, it.produto.sku, it.produto.descricao, it.quantidade, it.produto.unidade, it.lote,
                        it.validade.strftime('%d/%m/%Y') if it.validade else None, p.status])
    return _enviar_planilha(livro, f'extrato_carga_{carga.codigo}.xlsx')


# ---------------------------------------------------------------- divergencias, romaneio e painel

def _consulta_itens():
    """Itens de carga filtrados por ?carga= ?nf= ?cliente= ?produto= ?cidade= (tela de divergencias)."""
    consulta = CargaItem.query.join(Carga).join(Produto, CargaItem.produto_id == Produto.id).filter(Carga.status != 'Cancelada')
    filtros = {nome: (request.args.get(nome) or '').strip() for nome in ('carga', 'nf', 'cliente', 'produto', 'cidade')}
    if filtros['carga']:
        consulta = consulta.filter(Carga.codigo.like(f'%{filtros["carga"].upper()}%'))
    if filtros['nf']:
        consulta = consulta.filter(CargaItem.nf_numero.like(f'%{filtros["nf"]}%'))
    if filtros['cliente']:
        consulta = consulta.filter(db.func.lower(CargaItem.cliente).like(f'%{filtros["cliente"].lower()}%'))
    if filtros['cidade']:
        consulta = consulta.filter(db.func.lower(CargaItem.cidade).like(f'%{filtros["cidade"].lower()}%'))
    if filtros['produto']:
        like = f'%{filtros["produto"].lower()}%'
        consulta = consulta.filter(db.or_(db.func.lower(Produto.sku).like(like), db.func.lower(Produto.descricao).like(like)))
    return consulta, filtros


@bp.route('/divergencias')
@perm('expedicao')
def divergencias():
    consulta, filtros = _consulta_itens()
    consulta = (consulta.filter(Carga.status.in_(('Em conferência', 'Expedida')), CargaItem.conferido != CargaItem.quantidade)
                .order_by(Carga.id.desc(), CargaItem.id))
    itens = consulta.limit(500).all()
    if request.args.get('formato') == 'xlsx':
        livro = Workbook()
        aba = livro.active
        aba.title = 'Divergências'
        _titulo_planilha(aba, ['Carga', 'Situação', 'Placa', 'NF', 'Cliente', 'SKU', 'Descrição', 'Unidade', 'Qtd NF', 'Conferido',
                               'Diferença', 'Tipo', 'Motivo'], (14, 16, 10, 12, 34, 14, 44, 9, 10, 11, 11, 9, 44))
        for i in itens:
            diferenca = round(i.conferido - i.quantidade, 3)
            aba.append([i.carga.codigo, i.carga.status, i.carga.placa, i.nf_numero, i.cliente, i.produto.sku, i.produto.descricao,
                        i.unidade, i.quantidade, i.conferido, diferenca, 'Falta' if diferenca < 0 else 'Sobra', i.motivo_divergencia])
        return _enviar_planilha(livro, 'divergencias_carregamento.xlsx')
    faltas = sum(1 for i in itens if i.conferido < i.quantidade)
    return render_template('saida_divergencias.html', itens=itens, filtros=filtros, faltas=faltas, sobras=len(itens) - faltas,
                           cargas=len({i.carga_id for i in itens}), motivos_divergencia=MOTIVOS_DIVERGENCIA)


@bp.route('/divergencias/<int:iid>/motivo', methods=['POST'])
@perm('expedicao')
def motivo_divergencia(iid):
    item = db.session.get(CargaItem, iid)
    if not item:
        abort(404)
    item.motivo_divergencia = ' — '.join(t for t in ((request.form.get('motivo') or '').strip(),
                                                    (request.form.get('obs') or '').strip()) if t)[:200] or None
    db.session.commit()
    flash(f'Motivo do item {item.produto.sku} salvo.', 'success')
    return redirect(request.referrer or url_for('saida.divergencias'))


@bp.route('/painel')
@perm('expedicao')
def painel():
    de, ate = _periodo()
    inicio, fim = datetime.combine(de, datetime.min.time()), datetime.combine(ate, datetime.max.time())
    lista = Carga.query.filter(Carga.criado_em.between(inicio, fim), Carga.status != 'Cancelada').order_by(Carga.id.desc()).all()
    linhas, produtos = [], {}
    for carga in lista:
        dados = resumo_carga(carga)
        minutos = int((carga.fim_conferencia - carga.inicio_conferencia).total_seconds() // 60) \
            if carga.inicio_conferencia and carga.fim_conferencia else None
        linhas.append({'carga': carga, 'itens': len(carga.itens), 'total': dados['total'], 'conferido': dados['conferido'],
                       'pct': dados['pct'], 'faltas': sum(1 for l in dados['divergentes'] if l['diferenca'] < 0),
                       'sobras': sum(1 for l in dados['divergentes'] if l['diferenca'] > 0), 'minutos': minutos})
        for item in carga.itens:
            if item.conferido:
                atual = produtos.setdefault(item.produto_id, {'produto': item.produto, 'quantidade': 0})
                atual['quantidade'] = round(atual['quantidade'] + item.conferido, 3)
    top = sorted(produtos.values(), key=lambda p: -p['quantidade'])[:10]
    expedidas = [l for l in linhas if l['carga'].status == 'Expedida']
    tempos = [l['minutos'] for l in expedidas if l['minutos'] is not None]
    kpis = {'cargas': len(linhas), 'expedidas': len(expedidas), 'andamento': len(linhas) - len(expedidas),
            'itens': sum(l['itens'] for l in linhas), 'conferido': round(sum(l['conferido'] for l in linhas), 3),
            'com_erro': sum(1 for l in linhas if l['faltas'] or l['sobras']),
            'faltas': sum(l['faltas'] for l in linhas), 'sobras': sum(l['sobras'] for l in linhas),
            'eficiencia': round(sum(l['pct'] for l in expedidas) / len(expedidas)) if expedidas else None,
            'tempo_medio': round(sum(tempos) / len(tempos)) if tempos else None}
    return render_template('saida_painel.html', de=de, ate=ate, linhas=linhas, top=top, kpis=kpis,
                           maior=top[0]['quantidade'] if top else 0)
