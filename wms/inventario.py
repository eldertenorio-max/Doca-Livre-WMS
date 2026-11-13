"""Inventario, na logica do WMS Pro.

Iniciar um inventario tira uma fotografia do estoque (uma linha por item de palete que esta no armazem). Cada
bipagem procura a linha pendente correspondente e a marca como conferido (tudo igual) ou divergente; o que nao
esta na fotografia vira extra. No fim: "aplicar na base" corrige o estoque com o que foi contado nas linhas
divergentes, ou "finalizar sem atualizar" so guarda o resultado.
"""
import io
import re
from datetime import datetime, timedelta

from flask import Blueprint, abort, flash, redirect, render_template, request, send_file, url_for
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .core import perm, registrar_log, usuario_atual
from .entrada import _data, _quantidade
from .models import (Camara, Endereco, Inventario, InventarioLinha, Palete, PaleteItem, Produto, agora, db)
from .paletes import NO_ARMAZEM, registrar

bp = Blueprint('inventario', __name__, url_prefix='/estoque/inventario')

ABERTOS = ('Ativo', 'Em andamento')
STATUS_LINHA = ['Pendente', 'Conferido', 'Divergente', 'Extra']
POR_PAGINA = 100


def _inventario_ou_404(iid):
    inventario = db.session.get(Inventario, iid)
    if not inventario:
        abort(404)
    return inventario


def _voltar(inventario, **extra):
    return redirect(url_for('inventario.detalhe', iid=inventario.id, **extra))


def resumo(inventario):
    contagem = dict(db.session.query(InventarioLinha.status, db.func.count(InventarioLinha.id))
                    .filter_by(inventario_id=inventario.id).group_by(InventarioLinha.status).all())
    r = {s: contagem.get(s, 0) for s in STATUS_LINHA}
    r['total'] = sum(r.values())
    r['da_fotografia'] = r['total'] - r['Extra']
    r['contadas'] = r['Conferido'] + r['Divergente']
    r['pct'] = round(100 * r['contadas'] / r['da_fotografia']) if r['da_fotografia'] else 0
    return r


def _excel(nome, colunas, linhas, larguras, titulo='Inventário'):
    livro = Workbook()
    aba = livro.active
    aba.title = re.sub(r'[\/?*\[\]:]', '-', titulo)[:31]
    aba.append(colunas)
    for celula in aba[1]:
        celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
    for linha in linhas:
        aba.append(linha)
    for n, largura in enumerate(larguras, start=1):
        aba.column_dimensions[aba.cell(row=1, column=n).column_letter].width = largura
    aba.freeze_panes = 'A2'
    saida = io.BytesIO()
    livro.save(saida)
    saida.seek(0)
    return send_file(saida, as_attachment=True, download_name=f'{nome}_{agora().strftime("%Y-%m-%d_%H%M")}.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


def _br(data):
    return data.strftime('%d/%m/%Y') if data else None


# ---------------------------------------------------------------- lista e inicio

@bp.route('/')
@perm('estoque')
def lista():
    inventarios = Inventario.query.order_by(Inventario.id.desc()).limit(200).all()
    return render_template('inventario_lista.html', inventarios=[(i, resumo(i)) for i in inventarios],
                           camaras=Camara.query.filter_by(ativo=True).order_by(Camara.codigo).all(),
                           em_estoque=Palete.query.filter(Palete.status.in_(NO_ARMAZEM)).count())


@bp.route('/novo', methods=['POST'])
@perm('estoque')
def novo():
    """Inicia o inventario: fotografia do que esta guardado ou no stage (na camara escolhida, ou em tudo)."""
    descricao = ' '.join((request.form.get('descricao') or '').split())[:120]
    camara = db.session.get(Camara, request.form.get('camara_id', type=int) or 0)
    if not descricao:
        flash('Dê uma descrição ao inventário (ex.: Inventário mensal — câmara 6).', 'error')
        return redirect(url_for('inventario.lista'))
    consulta = (db.session.query(PaleteItem, Palete, Produto, Endereco, Camara).select_from(PaleteItem)
                .join(Palete, PaleteItem.palete_id == Palete.id).join(Produto, PaleteItem.produto_id == Produto.id)
                .outerjoin(Endereco, Palete.endereco_id == Endereco.id).outerjoin(Camara, Endereco.camara_id == Camara.id)
                .filter(Palete.status.in_(NO_ARMAZEM), PaleteItem.quantidade > 0))
    if camara:
        consulta = consulta.filter(Endereco.camara_id == camara.id)
    itens = consulta.order_by(Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel, Produto.sku, PaleteItem.lote).all()
    if not itens:
        flash('Não há estoque para inventariar' + (f' na {camara.nome}.' if camara else '.'), 'error')
        return redirect(url_for('inventario.lista'))
    inventario = Inventario(descricao=descricao, camara=camara, cego=request.form.get('cego') == '1',
                            criado_por=usuario_atual().username)
    db.session.add(inventario)
    for conteudo, palete, produto, endereco, cam in itens:
        inventario.linhas.append(InventarioLinha(
            palete_item_id=conteudo.id, palete_etiqueta=palete.etiqueta, endereco=endereco.codigo if endereco else None,
            camara_nome=cam.nome if cam else None, produto=produto, sku=produto.sku, descricao=produto.descricao,
            unidade=produto.unidade, lote=conteudo.lote, fabricacao=conteudo.fabricacao, validade=conteudo.validade,
            quantidade_esperada=conteudo.quantidade, up=palete.up, classificacao=palete.classificacao))
    registrar_log('Iniciou inventário', f'{descricao} · {len(itens)} linha(s)' + (f' · {camara.nome}' if camara else ''), modulo='estoque')
    db.session.commit()
    flash(f'Inventário iniciado com {len(itens)} linha(s) do estoque. Agora é só contar.', 'success')
    return _voltar(inventario)


# ---------------------------------------------------------------- detalhe e contagem

@bp.route('/<int:iid>')
@perm('estoque')
def detalhe(iid):
    inventario = _inventario_ou_404(iid)
    filtro = request.args.get('status') if request.args.get('status') in STATUS_LINHA else ''
    busca = (request.args.get('q') or '').strip()
    consulta = InventarioLinha.query.filter_by(inventario_id=inventario.id)
    if filtro:
        consulta = consulta.filter_by(status=filtro)
    if busca:
        like = f'%{busca.upper()}%'
        consulta = consulta.filter(db.or_(db.func.upper(InventarioLinha.sku).like(like), db.func.upper(InventarioLinha.descricao).like(like),
                                          InventarioLinha.endereco.like(like), InventarioLinha.palete_etiqueta.like(like),
                                          db.func.upper(InventarioLinha.lote).like(like), db.func.upper(InventarioLinha.bip_lote).like(like)))
    ordenada = consulta.order_by(InventarioLinha.endereco.is_(None), InventarioLinha.endereco, InventarioLinha.sku, InventarioLinha.id)
    if request.args.get('formato') == 'xlsx':
        return _excel(f'inventario_{inventario.id}',
                      ['Situação', 'Endereço', 'Câmara', 'Palete', 'SKU', 'Descrição', 'Unidade', 'Lote (sistema)', 'Fabricação (sistema)',
                       'Validade (sistema)', 'Qtd. (sistema)', 'UP (sistema)', 'Lote (contado)', 'Fabricação (contada)', 'Validade (contada)',
                       'Qtd. (contada)', 'UP (contado)', 'Diferença', 'Contado por', 'Contado em', 'Observação'],
                      [[l.status, l.endereco, l.camara_nome, l.palete_etiqueta, l.bip_sku or l.sku, l.descricao, l.unidade, l.lote, _br(l.fabricacao),
                        _br(l.validade), l.quantidade_esperada, l.up, l.bip_lote, _br(l.bip_fabricacao), _br(l.bip_validade), l.bip_quantidade,
                        l.bip_up, l.diferenca, l.contado_por, l.contado_em.strftime('%d/%m/%Y %H:%M') if l.contado_em else None, l.observacao]
                       for l in ordenada.all()],
                      (12, 13, 16, 26, 14, 40, 9, 15, 18, 17, 14, 12, 15, 18, 17, 14, 12, 11, 14, 17, 40))
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    aberto = inventario.status in ABERTOS
    return render_template('inventario_detalhe.html', inventario=inventario, resumo=resumo(inventario), filtro=filtro, busca=busca,
                           linhas=ordenada.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all(), total=total, pagina=pagina,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1), status_linha=STATUS_LINHA, aberto=aberto,
                           # contagem cega: enquanto esta aberto, quem conta nao ve o que o sistema espera
                           esconder=aberto and inventario.cego, form=None)


def _iguais(linha, bip):
    """Tudo o que foi contado bate com a fotografia? (SKU, lote, fabricacao, validade, quantidade e, se houver, a UP)"""
    def texto(valor):
        return (valor or '').strip().upper()
    ok = (texto(linha.sku) == texto(bip['produto'].sku) and texto(linha.lote) == texto(bip['lote'])
          and linha.fabricacao == bip['fabricacao'] and linha.validade == bip['validade']
          and round(linha.quantidade_esperada or 0, 3) == round(bip['quantidade'], 3))
    if ok and bip['up'] and linha.up:
        ok = texto(linha.up) == texto(bip['up'])
    return ok


def _linha_pendente_para(inventario, bip):
    """A linha pendente a que a bipagem se refere, na ordem do Pro: a indicada; a do palete/endereco; a da UP;
    a que bate em tudo; a primeira do mesmo produto."""
    pendentes = InventarioLinha.query.filter_by(inventario_id=inventario.id, status='Pendente').order_by(InventarioLinha.id)
    if bip['linha_id']:
        return pendentes.filter_by(id=bip['linha_id']).first()
    sku = bip['produto'].sku.upper()
    if bip['local']:
        local = bip['local'].upper()
        do_local = pendentes.filter(db.or_(InventarioLinha.palete_etiqueta == local, InventarioLinha.endereco == local)).all()
        if do_local:
            return next((l for l in do_local if l.sku.upper() == sku), do_local[0])
    if bip['up']:
        linha = pendentes.filter(db.func.upper(InventarioLinha.up) == bip['up'].upper()).first()
        if linha:
            return linha
    candidatas = pendentes.filter(db.func.upper(InventarioLinha.sku) == sku).all()
    for linha in candidatas:
        if _iguais(linha, bip):
            return linha
    mesmo_lote = [l for l in candidatas if (l.lote or '').upper() == (bip['lote'] or '').upper()]
    return (mesmo_lote or candidatas or [None])[0]


@bp.route('/<int:iid>/bipar', methods=['POST'])
@perm('estoque')
def bipar(iid):
    inventario = _inventario_ou_404(iid)
    if inventario.status not in ABERTOS:
        flash('Este inventário não está mais aberto.', 'error')
        return _voltar(inventario)

    def recusar(mensagem):
        # A tela volta com o que foi digitado no formulario de contagem.
        flash(mensagem, 'error')
        if (request.form.get('voltar_coletor') or '').startswith('/coletor/'):
            return redirect(request.form['voltar_coletor'])
        return render_template('inventario_detalhe.html', inventario=inventario, resumo=resumo(inventario), filtro='', busca='',
                               linhas=InventarioLinha.query.filter_by(inventario_id=inventario.id)
                               .order_by(InventarioLinha.endereco.is_(None), InventarioLinha.endereco, InventarioLinha.sku).limit(POR_PAGINA).all(),
                               total=resumo(inventario)['total'], pagina=1, paginas=1, status_linha=STATUS_LINHA, aberto=True,
                               esconder=inventario.cego, form=request.form)

    linha_id = request.form.get('linha_id', type=int)
    # "Confere": um clique na linha confirma que esta tudo igual ao sistema (nao existe na contagem cega).
    if request.form.get('acao') == 'confere':
        linha = InventarioLinha.query.filter_by(id=linha_id or 0, inventario_id=inventario.id, status='Pendente').first()
        if not linha or inventario.cego:
            abort(400)
        linha.status, linha.bip_sku, linha.bip_lote = 'Conferido', linha.sku, linha.lote
        linha.bip_fabricacao, linha.bip_validade, linha.bip_quantidade, linha.bip_up = linha.fabricacao, linha.validade, linha.quantidade_esperada, linha.up
        linha.contado_por, linha.contado_em = usuario_atual().username, agora()
        inventario.status = 'Em andamento'
        db.session.commit()
        flash(f'{linha.sku} em {linha.endereco or "sem endereço"}: conferido.', 'success')
        return _voltar(inventario, status=request.form.get('voltar_status') or None)

    codigo = (request.form.get('codigo') or '').strip().upper()
    produto = Produto.query.filter(db.or_(db.func.upper(Produto.sku) == codigo, Produto.ean == codigo, Produto.dun == codigo)).first() if codigo else None
    quantidade = _quantidade(request.form.get('quantidade'))
    fabricacao, validade = _data(request.form.get('fabricacao')), _data(request.form.get('validade'))
    if not codigo:
        return recusar('Informe o código do produto (EAN, DUN ou SKU).')
    if not produto:
        return recusar(f'Produto "{codigo}" não está no cadastro. Cadastre em Cadastros › Produtos ou confira o código.')
    if quantidade is None:
        return recusar('Informe a quantidade contada (maior que zero).')
    if fabricacao and validade and validade < fabricacao:
        return recusar('A validade não pode ser anterior à fabricação.')
    if fabricacao and fabricacao > agora().date():
        return recusar('A data de fabricação não pode estar no futuro.')
    bip = {'produto': produto, 'quantidade': quantidade, 'fabricacao': fabricacao, 'validade': validade, 'linha_id': linha_id,
           'lote': (request.form.get('lote') or '').strip()[:30] or None, 'up': (request.form.get('up') or '').strip()[:20] or None,
           'local': (request.form.get('local') or '').strip()[:26] or None}
    linha = _linha_pendente_para(inventario, bip)
    if linha_id and not linha:
        return recusar('Essa linha já foi contada. Use "Desfazer" nela se precisar contar de novo.')
    if linha:
        linha.status = 'Conferido' if _iguais(linha, bip) else 'Divergente'
    else:
        linha = InventarioLinha(inventario=inventario, status='Extra', produto=produto, sku=produto.sku, descricao=produto.descricao,
                                unidade=produto.unidade, endereco=None, palete_etiqueta=None)
        # extra bipado num endereco conhecido: guarda onde foi achado
        if bip['local']:
            endereco = Endereco.query.filter_by(codigo=bip['local'].upper()).first()
            palete = Palete.query.filter_by(etiqueta=bip['local'].upper()).first()
            linha.endereco = endereco.codigo if endereco else (palete.endereco.codigo if palete and palete.endereco else None)
            linha.palete_etiqueta = palete.etiqueta if palete else None
        db.session.add(linha)
    linha.bip_sku, linha.bip_lote, linha.bip_fabricacao, linha.bip_validade = produto.sku, bip['lote'], fabricacao, validade
    linha.bip_quantidade, linha.bip_up = quantidade, bip['up']
    linha.observacao = (request.form.get('observacao') or '').strip()[:200] or None
    linha.contado_por, linha.contado_em = usuario_atual().username, agora()
    inventario.status = 'Em andamento'
    db.session.commit()
    onde = f' em {linha.endereco}' if linha.endereco else ''
    if linha.status == 'Conferido':
        flash(f'{produto.sku}{onde}: conferido.', 'success')
    elif linha.status == 'Divergente':
        flash(f'{produto.sku}{onde}: DIVERGENTE — contado diferente do sistema.', 'error')
    else:
        flash(f'{produto.sku}: EXTRA — não havia linha pendente deste produto no inventário.', 'error')
    return _voltar(inventario)


@bp.route('/<int:iid>/linha/<int:lid>/desfazer', methods=['POST'])
@perm('estoque')
def desfazer(iid, lid):
    """Volta a linha para pendente (ou apaga o extra), para contar de novo."""
    inventario = _inventario_ou_404(iid)
    linha = InventarioLinha.query.filter_by(id=lid, inventario_id=inventario.id).first()
    if not linha or inventario.status not in ABERTOS or linha.status == 'Pendente':
        abort(400)
    if linha.status == 'Extra':
        db.session.delete(linha)
    else:
        linha.status = 'Pendente'
        linha.bip_sku = linha.bip_lote = linha.bip_fabricacao = linha.bip_validade = linha.bip_quantidade = linha.bip_up = None
        linha.contado_por = linha.contado_em = linha.observacao = None
    db.session.commit()
    flash('Contagem desfeita.', 'success')
    return _voltar(inventario, status=request.form.get('voltar_status') or None)


# ---------------------------------------------------------------- encerramento

@bp.route('/<int:iid>/aplicar', methods=['POST'])
@perm('estoque')
def aplicar(iid):
    """Aplica as contagens na base: cada linha divergente corrige o item do palete com o que foi contado. Finaliza."""
    inventario = _inventario_ou_404(iid)
    if inventario.status not in ABERTOS:
        flash('Este inventário já foi finalizado.', 'error')
        return _voltar(inventario)
    atualizados, sem_palete = 0, 0
    for linha in InventarioLinha.query.filter_by(inventario_id=inventario.id, status='Divergente'):
        conteudo = db.session.get(PaleteItem, linha.palete_item_id or 0)
        if not conteudo or conteudo.palete.status not in NO_ARMAZEM:
            sem_palete += 1          # o palete saiu ou foi baixado depois da fotografia: nao ha o que corrigir
            continue
        mudancas = []
        if linha.bip_sku and linha.bip_sku != conteudo.produto.sku:
            novo = Produto.query.filter_by(sku=linha.bip_sku).first()
            if novo:
                mudancas.append(f'produto {conteudo.produto.sku} → {novo.sku}')
                conteudo.produto = novo
        if round(conteudo.quantidade, 3) != round(linha.bip_quantidade, 3):
            mudancas.append(f'quantidade {conteudo.quantidade:g} → {linha.bip_quantidade:g}')
            conteudo.quantidade = linha.bip_quantidade
        for campo, rotulo, valor in (('lote', 'lote', linha.bip_lote), ('fabricacao', 'fabricação', linha.bip_fabricacao),
                                     ('validade', 'validade', linha.bip_validade)):
            # como no Pro: so troca pelo que foi informado na contagem (em branco mantem o que estava)
            if valor and getattr(conteudo, campo) != valor:
                mudancas.append(f'{rotulo} {getattr(conteudo, campo) or "—"} → {valor}')
                setattr(conteudo, campo, valor)
        if linha.bip_up and linha.bip_up != conteudo.palete.up:
            mudancas.append(f'UP {conteudo.palete.up or "—"} → {linha.bip_up}')
            conteudo.palete.up = linha.bip_up
        if mudancas:
            registrar(conteudo.palete, 'Inventário', origem=conteudo.palete.endereco, destino=conteudo.palete.endereco,
                      motivo=(f'Inventário nº {inventario.id}: ' + '; '.join(mudancas))[:200])
            atualizados += 1
    inventario.status, inventario.finalizado_em, inventario.aplicado = 'Finalizado', agora(), True
    inventario.finalizado_por = usuario_atual().username
    registrar_log('Aplicou inventário na base', f'nº {inventario.id} · {inventario.descricao} · {atualizados} item(ns) corrigido(s)', modulo='estoque')
    db.session.commit()
    flash(f'Inventário finalizado e aplicado: {atualizados} item(ns) do estoque corrigido(s).', 'success')
    r = resumo(inventario)
    if sem_palete:
        flash(f'{sem_palete} linha(s) divergente(s) não foram aplicadas porque o palete já saiu do armazém.', 'error')
    if r['Extra'] or r['Pendente']:
        flash((f'{r["Extra"]} extra(s) não entram no estoque sozinhos: dê entrada deles (Entrada) se a mercadoria existe. ' if r['Extra'] else '')
              + (f'{r["Pendente"]} linha(s) ficaram sem contar e o estoque delas não foi alterado.' if r['Pendente'] else ''), 'error')
    return _voltar(inventario)


@bp.route('/<int:iid>/finalizar', methods=['POST'])
@perm('estoque')
def finalizar(iid):
    """Finaliza sem atualizar a base: o resultado fica guardado e o estoque continua como estava."""
    inventario = _inventario_ou_404(iid)
    if inventario.status not in ABERTOS:
        flash('Este inventário já foi finalizado.', 'error')
        return _voltar(inventario)
    inventario.status, inventario.finalizado_em, inventario.aplicado = 'Finalizado', agora(), False
    inventario.finalizado_por = usuario_atual().username
    registrar_log('Finalizou inventário sem aplicar', f'nº {inventario.id} · {inventario.descricao}', modulo='estoque')
    db.session.commit()
    flash('Inventário finalizado. O estoque não foi alterado.', 'success')
    return _voltar(inventario)


@bp.route('/<int:iid>/excluir', methods=['POST'])
@perm('estoque')
def excluir(iid):
    inventario = _inventario_ou_404(iid)
    if inventario.aplicado:
        flash('Este inventário já corrigiu o estoque e fica guardado como registro; não pode ser excluído.', 'error')
        return _voltar(inventario)
    registrar_log('Excluiu inventário', f'nº {inventario.id} · {inventario.descricao}', modulo='estoque')
    db.session.delete(inventario)
    db.session.commit()
    flash('Inventário excluído. O estoque não foi alterado.', 'success')
    return redirect(url_for('inventario.lista'))


# ---------------------------------------------------------------- consulta das contagens (como a tela "Estoque" do Light)

@bp.route('/contagens')
@perm('estoque')
def contagens():
    """Todas as linhas ja contadas, de todos os inventarios, com filtros."""
    hoje = agora().date()
    f = {'de': request.args.get('de') or (hoje - timedelta(days=7)).isoformat(), 'ate': request.args.get('ate') or hoje.isoformat(),
         'q': (request.args.get('q') or '').strip(), 'conferente': (request.args.get('conferente') or '').strip(),
         'camara': (request.args.get('camara') or '').strip(), 'status': request.args.get('status') or ''}
    consulta = InventarioLinha.query.join(Inventario).filter(InventarioLinha.contado_em.isnot(None))
    try:
        consulta = consulta.filter(InventarioLinha.contado_em >= datetime.strptime(f['de'], '%Y-%m-%d'),
                                   InventarioLinha.contado_em < datetime.strptime(f['ate'], '%Y-%m-%d') + timedelta(days=1))
    except ValueError:
        pass
    if f['q']:
        like = f'%{f["q"].upper()}%'
        consulta = consulta.filter(db.or_(db.func.upper(InventarioLinha.sku).like(like), db.func.upper(InventarioLinha.descricao).like(like),
                                          db.func.upper(InventarioLinha.bip_lote).like(like), db.func.upper(InventarioLinha.lote).like(like)))
    if f['conferente']:
        consulta = consulta.filter(InventarioLinha.contado_por == f['conferente'])
    if f['camara']:
        consulta = consulta.filter(InventarioLinha.camara_nome == f['camara'])
    if f['status'] in STATUS_LINHA:
        consulta = consulta.filter(InventarioLinha.status == f['status'])
    ordenada = consulta.order_by(InventarioLinha.contado_em.desc(), InventarioLinha.sku)
    if request.args.get('formato') == 'xlsx':
        return _excel('contagens_inventario',
                      ['Data', 'Inventário', 'Código', 'Descrição', 'Qtd. contada', 'Un.', 'Lote', 'Validade', 'Conferente', 'Câmara', 'Endereço',
                       'Situação', 'Qtd. no sistema', 'Diferença'],
                      [[l.contado_em.strftime('%d/%m/%Y %H:%M'), f'nº {l.inventario_id} · {l.inventario.descricao}', l.bip_sku or l.sku, l.descricao,
                        l.bip_quantidade, l.unidade, l.bip_lote, _br(l.bip_validade), l.contado_por, l.camara_nome, l.endereco, l.status,
                        l.quantidade_esperada, l.diferenca] for l in ordenada.limit(20000)],
                      (17, 36, 14, 40, 13, 7, 15, 12, 16, 16, 13, 12, 15, 11), titulo='Contagens')
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    base = InventarioLinha.query.filter(InventarioLinha.contado_em.isnot(None))
    return render_template('inventario_contagens.html', linhas=ordenada.offset((pagina - 1) * 50).limit(50).all(), f=f, total=total,
                           pagina=pagina, paginas=max((total + 49) // 50, 1), status_linha=STATUS_LINHA[1:],
                           conferentes=[c for (c,) in base.with_entities(InventarioLinha.contado_por).distinct().order_by(InventarioLinha.contado_por)],
                           camaras=[c for (c,) in base.with_entities(InventarioLinha.camara_nome).distinct().order_by(InventarioLinha.camara_nome) if c],
                           filtros={k: v for k, v in f.items() if v})
