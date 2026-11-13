"""Retornos e reentregas: mercadoria que saiu numa carga e voltou para o CD.

O retorno e uma nota do tipo 'Retorno'. Ela nasce de uma carga expedida (escolhendo o que voltou), de um XML,
de uma planilha ou digitada; a conferencia, a montagem de palete e a guarda sao as mesmas telas do recebimento
(wms/entrada.py), com uma classificacao a mais: Reentrega (espera sair de novo para o mesmo cliente).
"""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from .core import perm, registrar_log, usuario_atual
from .entrada import (ABERTAS, POR_PAGINA, _criar_nota, _data, _empresa_para, _nota_repetida, _quantidade,
                      ler_planilha_de_notas, preparar_danfes, texto_do_xml)
from .models import Carga, Empresa, NotaFiscal, NotaItem, Palete, PaleteItem, agora, db
from .nfe import XmlInvalido, ler_nfe
from .paletes import MOTIVOS_RETORNO, NO_ARMAZEM

bp = Blueprint('retornos', __name__, url_prefix='/retornos')


def _motivo():
    """Motivo do retorno vindo do formulario (lista fixa; 'Outro' aceita o texto digitado)."""
    motivo = request.form.get('motivo_retorno') or ''
    if motivo == 'Outro':
        return (request.form.get('motivo_outro') or '').strip()[:60] or 'Outro'
    return motivo if motivo in MOTIVOS_RETORNO else None


def _abrir(nota):
    return redirect(url_for('entrada.nota', nid=nota.id))


def devolvido_da_carga(carga):
    """(nf, produto_id) -> quantidade que ja voltou desta carga em retornos nao cancelados."""
    linhas = (db.session.query(NotaFiscal.numero, NotaItem.produto_id, db.func.sum(NotaItem.quantidade))
              .join(NotaItem, NotaItem.nota_id == NotaFiscal.id)
              .filter(NotaFiscal.tipo == 'Retorno', NotaFiscal.carga_id == carga.id, NotaFiscal.status != 'Cancelada')
              .group_by(NotaFiscal.numero, NotaItem.produto_id).all())
    return {(numero, produto_id): round(total or 0, 3) for numero, produto_id, total in linhas}


# ---------------------------------------------------------------- lista

@bp.route('/')
@perm('devolucoes')
def lista():
    situacao = request.args.get('situacao') or 'abertas'
    busca = (request.args.get('q') or '').strip()
    consulta = NotaFiscal.query.filter_by(tipo='Retorno')
    if situacao == 'abertas':
        consulta = consulta.filter(NotaFiscal.status.in_(ABERTAS))
    elif situacao in ('Aguardando', 'Em conferência', 'Finalizada', 'Cancelada'):
        consulta = consulta.filter_by(status=situacao)
    if busca:
        consulta = (consulta.outerjoin(Empresa, NotaFiscal.empresa_id == Empresa.id)
                    .outerjoin(Carga, NotaFiscal.carga_id == Carga.id)
                    .filter(db.or_(NotaFiscal.numero.like(f'%{busca}%'), db.func.lower(Empresa.nome).like(f'%{busca.lower()}%'),
                                   Carga.codigo.like(f'%{busca}%'), NotaFiscal.motivo_retorno.like(f'%{busca}%'))))
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    notas = consulta.order_by(NotaFiscal.criado_em.desc()).offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all()
    contagem = dict(db.session.query(NotaFiscal.status, db.func.count(NotaFiscal.id))
                    .filter_by(tipo='Retorno').group_by(NotaFiscal.status).all())
    reentregas = (Palete.query.filter(Palete.classificacao == 'Reentrega', Palete.status.in_(NO_ARMAZEM)).count())
    cargas = Carga.query.filter_by(status='Expedida').order_by(Carga.fim_conferencia.desc(), Carga.id.desc()).limit(200).all()
    return render_template('retornos.html', notas=notas, situacao=situacao, busca=busca, total=total, pagina=pagina,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1), contagem=contagem,
                           reentregas=reentregas, cargas=cargas, motivos=MOTIVOS_RETORNO,
                           empresas=Empresa.query.filter_by(ativo=True).order_by(Empresa.nome).all())


# ---------------------------------------------------------------- retorno de uma carga expedida

def _linhas_da_carga(carga):
    """Itens da carga com o que saiu, o que ja voltou e o que ainda pode voltar."""
    ja = devolvido_da_carga(carga)
    linhas = []
    for item in carga.itens:
        saiu = round(item.conferido or 0, 3)
        voltou = ja.get((item.nf_numero, item.produto_id), 0)
        linhas.append({'item': item, 'saiu': saiu, 'voltou': voltou, 'pode': max(round(saiu - voltou, 3), 0)})
    return linhas


@bp.route('/carga')
@perm('devolucoes')
def escolher_carga():
    """Atalho da lista: recebe o codigo (ou id) da carga e abre a tela do que voltou."""
    codigo = (request.args.get('codigo') or '').strip()
    carga = Carga.query.filter_by(codigo=codigo).first() if codigo else None
    if not carga:
        flash(f'Carga "{codigo}" não encontrada.' if codigo else 'Informe a carga.', 'error')
        return redirect(url_for('retornos.lista'))
    return redirect(url_for('retornos.de_carga', cid=carga.id))


@bp.route('/carga/<int:cid>', methods=['GET', 'POST'])
@perm('devolucoes')
def de_carga(cid):
    carga = db.session.get(Carga, cid)
    if not carga:
        abort(404)
    if carga.status != 'Expedida':
        flash(f'A carga {carga.codigo} ainda não foi expedida; só o que já saiu pode retornar.', 'error')
        return redirect(url_for('retornos.lista'))
    linhas = _linhas_da_carga(carga)
    if request.method == 'GET':
        return render_template('retorno_carga.html', carga=carga, linhas=linhas, motivos=MOTIVOS_RETORNO, form=None)

    def recusar(mensagem):
        # A tela volta com as quantidades e o motivo que a pessoa tinha preenchido.
        flash(mensagem, 'error')
        return render_template('retorno_carga.html', carga=carga, linhas=linhas, motivos=MOTIVOS_RETORNO, form=request.form)

    motivo = _motivo()
    if not motivo:
        return recusar('Escolha o motivo do retorno.')
    por_nota, erros = {}, []
    for linha in linhas:
        item = linha['item']
        texto = (request.form.get(f'qtd_{item.id}') or '').strip()
        if not texto or texto in ('0', '0,0', '0.0'):
            continue
        quantidade = _quantidade(texto)
        if quantidade is None:
            erros.append(f'{item.produto.sku}: quantidade inválida.')
        elif quantidade > linha['pode']:
            erros.append(f'{item.produto.sku} (NF {item.nf_numero or "—"}): voltaram {quantidade:g}, mas só {linha["pode"]:g} '
                         'ainda podem retornar.')
        else:
            por_nota.setdefault(item.nf_numero or carga.codigo, []).append((item, quantidade))
    if erros:
        return recusar(' '.join(erros[:6]))
    if not por_nota:
        return recusar('Informe a quantidade que voltou em ao menos um item.')

    # Lote, validade e dono da mercadoria vem dos paletes que sairam nesta carga.
    origem = {}
    for palete in carga.paletes:
        for conteudo in palete.itens:
            origem.setdefault(conteudo.produto_id, (conteudo, palete))
    criadas = []
    for numero, itens in por_nota.items():
        primeiro = itens[0][0]
        conteudo, palete = origem.get(primeiro.produto_id, (None, None))
        empresa = (palete.nota.empresa if palete and palete.nota else None) or primeiro.produto.depositante
        nota = NotaFiscal(tipo='Retorno', numero=str(numero)[:15], serie=primeiro.nf_serie, empresa=empresa, origem='Carga',
                          carga_id=carga.id, motivo_retorno=motivo, placa=carga.placa, motorista=carga.motorista,
                          observacao=(request.form.get('observacao') or '').strip()[:300] or None,
                          criado_por=usuario_atual().username)
        db.session.add(nota)
        for item, quantidade in itens:
            conteudo, _ = origem.get(item.produto_id, (None, None))
            nota.itens.append(NotaItem(produto=item.produto, codigo=item.produto.sku, descricao=item.produto.descricao,
                                       unidade=item.unidade or item.produto.unidade, quantidade=quantidade,
                                       lote=conteudo.lote if conteudo else None,
                                       fabricacao=conteudo.fabricacao if conteudo else None,
                                       validade=conteudo.validade if conteudo else None))
        criadas.append(nota)
    registrar_log('Abriu retorno de carga', f'Carga {carga.codigo}: ' + ', '.join(f'NF {n.numero}' for n in criadas) + f' — {motivo}',
                  modulo='devolucoes')
    db.session.commit()
    flash(f'{len(criadas)} retorno(s) aberto(s) da carga {carga.codigo}. Agora confira o que voltou e monte os paletes.', 'success')
    return _abrir(criadas[0]) if len(criadas) == 1 else redirect(url_for('retornos.lista'))


# ---------------------------------------------------------------- XML, planilha e manual

@bp.route('/xml', methods=['POST'])
@perm('devolucoes')
def importar_xml():
    voltar = redirect(url_for('retornos.lista'))
    arquivos = [a for a in request.files.getlist('arquivos') if a and a.filename]
    motivo = _motivo()
    if not arquivos or not motivo:
        flash('Escolha ao menos um arquivo XML e o motivo do retorno.', 'error')
        return voltar
    criadas, erros, produtos_novos = [], [], 0
    for arquivo in arquivos:
        conteudo = arquivo.read()
        try:
            dados = ler_nfe(conteudo)
        except XmlInvalido as erro:
            erros.append(f'{arquivo.filename}: {erro}')
            continue
        if dados['chave'] and NotaFiscal.query.filter_by(chave=dados['chave']).first():
            erros.append(f'{arquivo.filename}: a NF {dados["numero"]} já está no sistema com esta chave. '
                         'Se ela saiu numa carga, abra o retorno pela carga.')
            continue
        nota, novos = _criar_nota(dados, 'XML', tipo='Retorno', motivo_retorno=motivo)
        nota.xml = texto_do_xml(conteudo)
        db.session.flush()
        criadas.append(nota)
        produtos_novos += novos
    if criadas:
        registrar_log('Importou XML de retorno', ', '.join(f'NF {n.numero}' for n in criadas) + f' — {motivo}', modulo='devolucoes')
        db.session.commit()
        preparar_danfes(criadas)          # XML ja vai para o Meu Danfe; o PDF fica guardado
        flash(f'{len(criadas)} retorno(s) importado(s): ' + ', '.join(n.numero for n in criadas) + '.'
              + (f' {produtos_novos} produto(s) novo(s) foram cadastrados — revise em Cadastros › Produtos.' if produtos_novos else ''),
              'success')
    for erro in erros[:8]:
        flash(erro, 'error')
    return _abrir(criadas[0]) if len(criadas) == 1 and not erros else voltar


@bp.route('/planilha', methods=['POST'])
@perm('devolucoes')
def importar_planilha():
    voltar = redirect(url_for('retornos.lista'))
    motivo = _motivo()
    if not motivo:
        flash('Escolha o motivo do retorno.', 'error')
        return voltar
    notas_lidas, erros, fatal = ler_planilha_de_notas(request.files.get('arquivo'))
    if fatal:
        flash(fatal, 'error')
        return voltar
    criadas, produtos_novos = [], 0
    for dados in notas_lidas:
        empresa, _ = _empresa_para(dados['emitente_nome'], dados['emitente_cnpj'])
        if _nota_repetida(dados['numero'], dados['serie'], empresa, tipo='Retorno'):
            erros.append(f'NF {dados["numero"]} de {dados["emitente_nome"]}: já existe um retorno desta nota.')
            continue
        nota, novos = _criar_nota(dados, 'Planilha', tipo='Retorno', motivo_retorno=motivo)
        criadas.append(nota)
        produtos_novos += novos
    if criadas:
        registrar_log('Importou planilha de retorno', ', '.join(f'NF {n.numero}' for n in criadas) + f' — {motivo}',
                      modulo='devolucoes')
        db.session.commit()
        flash(f'{len(criadas)} retorno(s) criado(s) pela planilha.'
              + (f' {produtos_novos} produto(s) novo(s) foram cadastrados — revise em Cadastros › Produtos.' if produtos_novos else ''),
              'success')
    else:
        db.session.rollback()
        if not erros:
            flash('Nenhuma linha preenchida na planilha.', 'error')
    if erros:
        flash(f'{len(erros)} problema(s): ' + ' | '.join(erros[:8]) + (' | …' if len(erros) > 8 else ''), 'error')
    return voltar


@bp.route('/manual', methods=['POST'])
@perm('devolucoes')
def manual():
    voltar = redirect(url_for('retornos.lista'))
    numero = (request.form.get('numero') or '').strip()
    serie = (request.form.get('serie') or '').strip()[:5] or None
    motivo = _motivo()
    empresa = db.session.get(Empresa, request.form.get('empresa_id', type=int) or 0)
    nova = (request.form.get('empresa_nova') or '').strip()
    if not empresa and nova:
        empresa, _ = _empresa_para(nova)
    if not numero or not empresa or not motivo:
        flash('Informe o número da nota, o dono da mercadoria e o motivo do retorno.', 'error')
        return voltar
    nota = NotaFiscal(tipo='Retorno', numero=numero[:15], serie=serie, empresa=empresa, origem='Manual',
                      data_emissao=_data(request.form.get('data_emissao')), motivo_retorno=motivo,
                      criado_por=usuario_atual().username)
    db.session.add(nota)
    registrar_log('Cadastrou retorno manual', f'NF {numero} · {empresa.nome} — {motivo}', modulo='devolucoes')
    db.session.commit()
    flash('Retorno criado. Agora inclua os itens que voltaram.', 'success')
    return _abrir(nota)
