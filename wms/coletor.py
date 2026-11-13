"""Coletor: as telas de bipagem (guarda, separacao, inventario e conferencia de entrada) em formato de celular ou
coletor de dados — uma coisa por vez, letra e botoes grandes, o campo de bipar sempre em foco.

Nao ha regra nova aqui: cada tela do coletor envia para a MESMA acao das telas normais (entrada.guardar,
saida.confirmar_tarefa, inventario.bipar, entrada.montar_palete), entao as validacoes e o historico sao os mesmos.
A unica diferenca e para onde a pessoa volta depois: o formulario manda "voltar_coletor" e a resposta e desviada de
volta para a tela do coletor (ver _voltar_para_o_coletor).
"""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from .core import nivel, perm, pode_editar, pode_ver
from .enderecamento import localizar_endereco
from .entrada import ABERTAS as NOTAS_ABERTAS, conferido_por_item
from .inventario import ABERTOS as INVENTARIOS_ABERTOS
from .models import Carga, CargaItem, Inventario, InventarioLinha, NotaFiscal, Palete, Separacao, db
from .paletes import CLASSIFICACOES, CLASSIFICACOES_RETORNO, localizar_palete, resumo_itens
from .saida import ABERTAS as CARGAS_ABERTAS

bp = Blueprint('coletor', __name__, url_prefix='/coletor')


def registrar(app):
    @app.after_request
    def _voltar_para_o_coletor(resposta):
        """Acao disparada pelo coletor: em vez de ir para a tela normal, volta para a tela do coletor que a chamou."""
        destino = request.form.get('voltar_coletor') if request.method == 'POST' else None
        if destino and destino.startswith('/coletor/') and resposta.status_code in (301, 302, 303):
            resposta.headers['Location'] = destino
        return resposta


def _exigir(modulo, editar=False):
    if nivel(modulo) < (2 if editar else 1):
        abort(403)


@bp.route('/')
@perm('coletor')
def inicio():
    opcoes = []
    if pode_ver('recebimento'):
        opcoes.append({'titulo': 'Conferir entrada', 'icone': 'dolly', 'url': url_for('coletor.conferencia'),
                       'numero': NotaFiscal.query.filter(NotaFiscal.status.in_(NOTAS_ABERTAS)).count(), 'rotulo': 'nota(s) em aberto'})
        opcoes.append({'titulo': 'Guardar palete', 'icone': 'pallet', 'url': url_for('coletor.guarda'),
                       'numero': Palete.query.filter_by(status='Aguardando guarda').count(), 'rotulo': 'palete(s) para guardar'})
    if pode_ver('expedicao'):
        opcoes.append({'titulo': 'Separar carga', 'icone': 'truck-ramp-box', 'url': url_for('coletor.separacao'),
                       'numero': Separacao.query.filter_by(status='Pendente').count(), 'rotulo': 'tarefa(s) pendente(s)'})
    if pode_ver('estoque'):
        opcoes.append({'titulo': 'Inventário', 'icone': 'clipboard-check', 'url': url_for('coletor.inventario'),
                       'numero': Inventario.query.filter(Inventario.status.in_(INVENTARIOS_ABERTOS)).count(), 'rotulo': 'inventário(s) aberto(s)'})
    return render_template('coletor_inicio.html', opcoes=opcoes, titulo='Coletor')


# ---------------------------------------------------------------- guarda

@bp.route('/guarda')
@perm('coletor')
def guarda():
    _exigir('recebimento')
    palete = None
    codigo = (request.args.get('palete') or '').strip()
    if codigo:
        palete, erro = localizar_palete(codigo)
        if not erro and palete.status != 'Aguardando guarda':
            erro = f'O palete {palete.etiqueta} já foi guardado' + (f' em {palete.endereco.codigo}.' if palete.endereco else '.')
        if erro:
            flash(erro, 'error')
            return redirect(url_for('coletor.guarda'))
    fila = Palete.query.filter_by(status='Aguardando guarda').order_by(Palete.id).limit(60).all()
    return render_template('coletor_guarda.html', titulo='Guardar palete', palete=palete, fila=fila, resumo_itens=resumo_itens,
                           editar=pode_editar('recebimento'))


# ---------------------------------------------------------------- separacao

@bp.route('/separacao')
@perm('coletor')
def separacao():
    _exigir('expedicao')
    cargas = []
    for carga in Carga.query.filter(Carga.status.in_(CARGAS_ABERTAS)).order_by(Carga.id):
        if not carga.itens:
            continue
        tarefas = Separacao.query.join(CargaItem).filter(CargaItem.carga_id == carga.id)
        cargas.append({'carga': carga, 'pendentes': tarefas.filter(Separacao.status == 'Pendente').count(), 'total': tarefas.count()})
    return render_template('coletor_separacao.html', titulo='Separar carga', carga=None, cargas=cargas)


@bp.route('/separacao/<int:cid>')
@perm('coletor')
def separacao_carga(cid):
    _exigir('expedicao')
    carga = db.session.get(Carga, cid)
    if not carga:
        abort(404)
    tarefas = (Separacao.query.join(CargaItem).filter(CargaItem.carga_id == carga.id)
               .order_by(Separacao.origem, Separacao.id).all())
    pendentes = [t for t in tarefas if t.status == 'Pendente']
    return render_template('coletor_separacao.html', titulo=f'Carga {carga.codigo}', carga=carga, tarefa=pendentes[0] if pendentes else None,
                           proximas=pendentes[1:6], feitas=len(tarefas) - len(pendentes), total=len(tarefas),
                           aberta=carga.status in CARGAS_ABERTAS, editar=pode_editar('expedicao'))


# ---------------------------------------------------------------- inventario

@bp.route('/inventario')
@perm('coletor')
def inventario():
    _exigir('estoque')
    abertos = []
    for inv in Inventario.query.filter(Inventario.status.in_(INVENTARIOS_ABERTOS)).order_by(Inventario.id.desc()):
        linhas = InventarioLinha.query.filter_by(inventario_id=inv.id)
        abertos.append({'inventario': inv, 'pendentes': linhas.filter_by(status='Pendente').count(), 'total': linhas.count()})
    return render_template('coletor_inventario.html', titulo='Inventário', inventario=None, abertos=abertos)


@bp.route('/inventario/<int:iid>')
@perm('coletor')
def inventario_contar(iid):
    _exigir('estoque')
    inv = db.session.get(Inventario, iid)
    if not inv:
        abort(404)
    codigo = (request.args.get('local') or '').strip().upper()
    local, linhas = None, []
    if codigo:
        endereco, _ = localizar_endereco(codigo)
        local = endereco.codigo if endereco else codigo
        linhas = (InventarioLinha.query.filter_by(inventario_id=inv.id)
                  .filter(db.or_(InventarioLinha.endereco == local, InventarioLinha.palete_etiqueta == local))
                  .order_by(InventarioLinha.status != 'Pendente', InventarioLinha.sku).all())
    todas = InventarioLinha.query.filter_by(inventario_id=inv.id)
    proximos = [e for (e,) in (db.session.query(InventarioLinha.endereco).filter_by(inventario_id=inv.id, status='Pendente')
                               .filter(InventarioLinha.endereco.isnot(None)).distinct().order_by(InventarioLinha.endereco).limit(8))]
    return render_template('coletor_inventario.html', titulo=f'Inventário nº {inv.id}', inventario=inv, local=local, linhas=linhas,
                           pendentes=todas.filter_by(status='Pendente').count(), total=todas.count(), proximos=proximos,
                           aberto=inv.status in INVENTARIOS_ABERTOS, editar=pode_editar('estoque'))


# ---------------------------------------------------------------- conferencia de entrada

@bp.route('/conferencia')
@perm('coletor')
def conferencia():
    _exigir('recebimento')
    notas = NotaFiscal.query.filter(NotaFiscal.status.in_(NOTAS_ABERTAS)).order_by(NotaFiscal.id.desc()).limit(60).all()
    return render_template('coletor_conferencia.html', titulo='Conferir entrada', nota=None, notas=notas)


@bp.route('/conferencia/<int:nid>')
@perm('coletor')
def conferencia_nota(nid):
    _exigir('recebimento')
    nota = db.session.get(NotaFiscal, nid)
    if not nota:
        abort(404)
    conferido = conferido_por_item(nota)
    itens = [{'item': i, 'conferido': conferido.get(i.id, 0), 'falta': round(i.quantidade - conferido.get(i.id, 0), 3)} for i in nota.itens]
    paletes = [p for p in nota.paletes if p.status != 'Baixado'][-6:][::-1]
    return render_template('coletor_conferencia.html', titulo=f'NF {nota.numero}', nota=nota, itens=itens, paletes=paletes,
                           aberta=nota.status in NOTAS_ABERTAS, editar=pode_editar('recebimento'), resumo_itens=resumo_itens,
                           classificacoes=CLASSIFICACOES_RETORNO if nota.tipo == 'Retorno' else CLASSIFICACOES,
                           item_escolhido=request.args.get('item', type=int))
