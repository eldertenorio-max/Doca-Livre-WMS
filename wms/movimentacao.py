"""Movimentacao interna de paletes e controle de palete (saida e retorno)."""
from flask import Blueprint, flash, redirect, render_template, request, url_for

from .core import perm, registrar_log
from .enderecamento import localizar_endereco
from .models import Movimentacao, Palete, db
from .paletes import (MOTIVOS_BAIXA, MOTIVOS_SAIDA, NO_ARMAZEM, colocar_em, localizar_palete, registrar,
                      resumo_itens, sugerir_endereco, tirar_do_armazem, vaga_no_stage, validar_destino)

bp = Blueprint('movimentacao', __name__, url_prefix='/movimentacao')

TIPOS = ['Entrada', 'Guarda', 'Transferência', 'Stage', 'Saída', 'Retorno', 'Baixa', 'Inventário']


def _historico(limite=80, tipo=None, busca=None, palete_id=None):
    consulta = Movimentacao.query.join(Palete)
    if palete_id:
        consulta = consulta.filter(Movimentacao.palete_id == palete_id)
    if tipo in TIPOS:
        consulta = consulta.filter(Movimentacao.tipo == tipo)
    if busca:
        like = f'%{busca.upper()}%'
        consulta = consulta.filter(db.or_(Palete.etiqueta.like(like), Movimentacao.origem.like(like),
                                          Movimentacao.destino.like(like)))
    return consulta.order_by(Movimentacao.id.desc()).limit(limite).all()


# ---------------------------------------------------------------- movimentacao

@bp.route('/movimentar')
@perm('movimentacao')
def movimentar():
    tipo = request.args.get('tipo') or ''
    busca = (request.args.get('q') or '').strip()
    return render_template('movimentacao.html', historico=_historico(tipo=tipo, busca=busca), tipo=tipo, busca=busca,
                           tipos=TIPOS, motivos_baixa=MOTIVOS_BAIXA, resumo_itens=resumo_itens,
                           pendentes=Palete.query.filter_by(status='Aguardando guarda').order_by(Palete.criado_em).all(),
                           no_stage=Palete.query.filter_by(status='Stage').count())


@bp.route('/movimentar', methods=['POST'])
@perm('movimentacao')
def executar():
    voltar = redirect(url_for('movimentacao.movimentar'))
    acao = request.form.get('acao')
    observacao = request.form.get('observacao')
    palete, erro = localizar_palete(request.form.get('palete'))
    if erro:
        flash(erro, 'error')
        return voltar
    if palete.status not in NO_ARMAZEM:
        flash(f'O palete {palete.etiqueta} está "{palete.status}" e não pode ser movimentado por aqui.', 'error')
        return voltar

    if acao in ('transferir', 'tirar_stage'):
        if acao == 'tirar_stage' and palete.status != 'Stage':
            flash(f'O palete {palete.etiqueta} não está no stage.', 'error')
            return voltar
        destino, erro = localizar_endereco(request.form.get('destino'))
        if not erro and destino.id == palete.endereco_id:
            erro = 'O palete já está nesse endereço.'
        if not erro and acao == 'tirar_stage' and destino.camara.tipo == 'Stage':
            erro = 'Para tirar do stage, informe um endereço de armazenagem.'
        erro = erro or validar_destino(destino, palete)
        if erro:
            flash(erro, 'error')
            return voltar
        origem = palete.endereco.codigo
        colocar_em(palete, destino, 'Transferência', observacao=observacao)
        mensagem = f'Palete {palete.etiqueta} movido de {origem} para {destino.codigo}.'
    elif acao == 'stage':
        if palete.status == 'Stage':
            flash(f'O palete {palete.etiqueta} já está no stage.', 'error')
            return voltar
        vaga = vaga_no_stage()
        if not vaga:
            flash('Não há câmara do tipo Stage com endereço cadastrado. Cadastre em Endereçamento › Câmaras e endereços '
                  '(ou use "Carregar layout do CD").', 'error')
            return voltar
        origem = palete.endereco.codigo
        colocar_em(palete, vaga, 'Stage', observacao=observacao)
        mensagem = f'Palete {palete.etiqueta} enviado ao stage ({origem} → {vaga.codigo}).'
    elif acao == 'baixar':
        motivo = request.form.get('motivo')
        if motivo not in MOTIVOS_BAIXA:
            flash('Escolha o motivo da remoção.', 'error')
            return voltar
        if motivo == 'Outro' and not (observacao or '').strip():
            flash('Descreva o motivo na observação.', 'error')
            return voltar
        origem = palete.endereco.codigo
        tirar_do_armazem(palete, 'Baixado', 'Baixa', motivo=motivo, observacao=observacao)
        registrar_log('Removeu palete do estoque', f'{palete.etiqueta} · {origem} · {motivo}', modulo='movimentacao')
        mensagem = f'Palete {palete.etiqueta} removido do estoque ({motivo}). Endereço {origem} liberado.'
    else:
        flash('Escolha a ação.', 'error')
        return voltar
    db.session.commit()
    flash(mensagem, 'success')
    return voltar


# ---------------------------------------------------------------- controle de palete

@bp.route('/paletes')
@perm('movimentacao')
def paletes():
    termo = (request.args.get('q') or '').strip()
    palete = None
    if termo:
        palete, erro = localizar_palete(termo)
        if erro:
            flash(erro, 'error')
    fora = Palete.query.filter_by(status='Fora').order_by(Palete.id.desc()).all()
    return render_template('movimentacao_paletes.html', termo=termo, palete=palete, fora=fora,
                           historico=_historico(limite=200, palete_id=palete.id) if palete else [],
                           motivos_saida=MOTIVOS_SAIDA, resumo_itens=resumo_itens)


@bp.route('/paletes/<int:pid>/saida', methods=['POST'])
@perm('movimentacao')
def saida(pid):
    palete = db.session.get(Palete, pid)
    voltar = redirect(url_for('movimentacao.paletes', q=palete.etiqueta if palete else ''))
    motivo = request.form.get('motivo')
    if not palete or palete.status not in NO_ARMAZEM:
        flash('Só é possível registrar a saída de um palete que está no armazém.', 'error')
        return voltar
    if motivo not in MOTIVOS_SAIDA:
        flash('Escolha o motivo da saída.', 'error')
        return voltar
    destino_externo = (request.form.get('destino_externo') or '').strip()[:80]
    observacao = ' · '.join(t for t in (f'Destino: {destino_externo}' if destino_externo else '',
                                        (request.form.get('observacao') or '').strip()) if t)
    origem = palete.endereco.codigo
    tirar_do_armazem(palete, 'Fora', 'Saída', motivo=motivo, observacao=observacao)
    db.session.commit()
    flash(f'Saída do palete {palete.etiqueta} registrada ({motivo}). Endereço {origem} liberado.', 'success')
    return voltar


@bp.route('/paletes/<int:pid>/retorno', methods=['POST'])
@perm('movimentacao')
def retorno(pid):
    palete = db.session.get(Palete, pid)
    voltar = redirect(url_for('movimentacao.paletes', q=palete.etiqueta if palete else ''))
    if not palete or palete.status != 'Fora':
        flash('Só é possível registrar o retorno de um palete que está fora.', 'error')
        return voltar
    motivo = (request.form.get('motivo') or '').strip()[:200] or None
    observacao = request.form.get('observacao')
    codigo = (request.form.get('destino') or '').strip()
    if codigo:
        destino, erro = localizar_endereco(codigo)
        erro = erro or validar_destino(destino, palete)
        if erro:
            flash(erro, 'error')
            return voltar
        palete.motivo = None
        colocar_em(palete, destino, 'Retorno', motivo=motivo, observacao=observacao)
        mensagem = f'Palete {palete.etiqueta} voltou e foi guardado em {destino.codigo}.'
    else:
        # Sem endereco: volta para a fila de guarda (aparece em Movimentacao e na Conferencia de entrada).
        palete.status, palete.motivo = 'Aguardando guarda', None
        registrar(palete, 'Retorno', motivo=motivo, observacao=observacao)
        palete.sugerido = sugerir_endereco(palete)
        mensagem = f'Palete {palete.etiqueta} voltou e está aguardando guarda' + \
                   (f' (indicado: {palete.sugerido.codigo}).' if palete.sugerido else '.')
    db.session.commit()
    flash(mensagem, 'success')
    return voltar
