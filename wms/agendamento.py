"""Agendamento de docas e ocorrencias.

A agenda e do proprio WMS: cada agendamento e uma entrada, saida ou retorno previsto para um dia e uma doca. A
situacao dele acompanha o status dos produtos no WMS (pela nota fiscal): quando a nota entra em conferencia o
agendamento passa a "Em operacao"; quando ela e finalizada (ou a carga expedida), passa a "Concluido".

Integracao futura: os campos "origem" e "id_externo" (em Agendamento e em Ocorrencia) existem para um sistema de
fora (ex.: Doca Livre YMS) criar ou atualizar registros sem duplicar. Hoje tudo nasce aqui, com origem "WMS".
"""
import io
from datetime import datetime, timedelta

from flask import Blueprint, abort, flash, redirect, render_template, request, send_file, url_for
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .core import perm, registrar_log, usuario_atual
from .models import Agendamento, Carga, CargaItem, NotaFiscal, Ocorrencia, agora, db

bp = Blueprint('agendamento', __name__, url_prefix='/agendamento')

TIPOS = ['Entrada', 'Saída', 'Retorno']
STATUS = ['Agendado', 'No pátio', 'Em operação', 'Concluído', 'Não compareceu', 'Cancelado']
ABERTOS = ('Agendado', 'No pátio', 'Em operação')
TIPOS_OCORRENCIA = ['Atraso', 'Não comparecimento', 'Avaria', 'Falta', 'Sobra', 'Recusa', 'Documentação', 'Temperatura', 'Outro']
POR_PAGINA = 100


def _data(texto):
    try:
        return datetime.strptime((texto or '').strip(), '%Y-%m-%d').date()
    except ValueError:
        return None


def _hora(texto):
    texto = (texto or '').strip()[:5]
    try:
        return datetime.strptime(texto, '%H:%M').strftime('%H:%M')
    except ValueError:
        return None


def _numero(texto):
    texto = (texto or '').strip().replace('.', '').replace(',', '.') if ',' in (texto or '') else (texto or '').strip()
    try:
        valor = float(texto)
    except ValueError:
        return None
    return valor if valor >= 0 else None


def situacao_no_wms(agendamento):
    """Como estao os produtos deste agendamento dentro do WMS. Devolve (texto, endpoint, argumentos) para o atalho."""
    numero = (agendamento.nf_numero or '').strip()
    if not numero:
        return 'Sem NF informada', None, None
    if agendamento.tipo == 'Saída':
        item = (CargaItem.query.join(Carga).filter(CargaItem.nf_numero == numero, Carga.status != 'Cancelada')
                .order_by(Carga.id.desc()).first())
        if not item:
            return 'Sem carga no WMS', None, None
        carga = item.carga
        return ({'Expedida': 'Expedida', 'Em conferência': 'Carregando', 'Em separação': 'Em separação'}.get(carga.status, 'Carga aberta')
                + f' · carga {carga.codigo}', 'saida.carga', {'cid': carga.id})
    nota = (NotaFiscal.query.filter(NotaFiscal.numero == numero, NotaFiscal.tipo == ('Retorno' if agendamento.tipo == 'Retorno' else 'Entrada'),
                                    NotaFiscal.status != 'Cancelada').order_by(NotaFiscal.id.desc()).first())
    if not nota:
        return 'Previsão (nota ainda não entrou)', None, None
    if nota.status == 'Finalizada':
        return 'Já no WMS', 'entrada.nota', {'nid': nota.id}
    guardar = sum(1 for p in nota.paletes if p.status == 'Aguardando guarda')
    return (('Entrada em andamento' if nota.status == 'Em conferência' else 'Nota recebida, aguardando conferência')
            + (f' · {guardar} palete(s) para guardar' if guardar else ''), 'entrada.nota', {'nid': nota.id})


def acompanhar_wms(agendamentos):
    """Liga a agenda ao status dos produtos: agendamento aberto acompanha a nota / a carga dele. Devolve quantos mudaram."""
    mudou = 0
    for a in agendamentos:
        if a.status not in ABERTOS or not a.nf_numero:
            continue
        texto = situacao_no_wms(a)[0]
        novo = None
        if texto.startswith(('Já no WMS', 'Expedida')):
            novo = 'Concluído'
        elif texto.startswith(('Entrada em andamento', 'Carregando', 'Em separação')) and a.status != 'Em operação':
            novo = 'Em operação'
        if novo and novo != a.status:
            a.status = novo
            if novo == 'Em operação':
                a.inicio_em = a.inicio_em or agora()
                a.chegada_em = a.chegada_em or a.inicio_em
            else:
                a.fim_em = a.fim_em or agora()
            mudou += 1
    if mudou:
        db.session.commit()
    return mudou


def _ler_formulario(agendamento):
    """Preenche o agendamento com o formulario. Devolve a lista de erros (vazia = pode salvar)."""
    erros = []
    tipo = request.form.get('tipo')
    data = _data(request.form.get('data'))
    hora = _hora(request.form.get('hora'))
    if tipo not in TIPOS:
        erros.append('Escolha o tipo: entrada, saída ou retorno.')
    if not data:
        erros.append('Informe a data do agendamento.')
    if (request.form.get('hora') or '').strip() and not hora:
        erros.append('Hora inválida (use o formato 14:30).')
    volumes = peso = None
    for campo, rotulo in (('volumes', 'Volumes'), ('peso', 'Peso')):
        texto = (request.form.get(campo) or '').strip()
        valor = _numero(texto) if texto else None
        if texto and valor is None:
            erros.append(f'{rotulo}: número inválido.')
        if campo == 'volumes':
            volumes = valor
        else:
            peso = valor
    cliente = ' '.join((request.form.get('cliente') or '').split())[:150]
    if not cliente:
        erros.append('Informe o cliente / fornecedor.')
    if erros:
        return erros
    agendamento.tipo, agendamento.data, agendamento.hora, agendamento.cliente = tipo, data, hora, cliente
    agendamento.volumes, agendamento.peso = volumes, peso
    for campo, tamanho in (('doca', 10), ('nf_numero', 15), ('pedido', 30), ('transportadora', 150), ('motorista', 120),
                           ('protocolo', 40), ('observacao', 300)):
        setattr(agendamento, campo, (request.form.get(campo) or '').strip()[:tamanho] or None)
    placa = ''.join(c for c in (request.form.get('placa') or '').upper() if c.isalnum())[:8]
    agendamento.placa = placa or None
    return []


def _conflito(agendamento):
    """Outro agendamento aberto na mesma doca, no mesmo dia e na mesma hora."""
    if not (agendamento.doca and agendamento.hora):
        return None
    consulta = Agendamento.query.filter(Agendamento.data == agendamento.data, Agendamento.hora == agendamento.hora,
                                        Agendamento.doca == agendamento.doca, Agendamento.status.in_(ABERTOS))
    if agendamento.id:
        consulta = consulta.filter(Agendamento.id != agendamento.id)
    return consulta.first()


# ---------------------------------------------------------------- agenda

def _consulta():
    hoje = agora().date()
    f = {'periodo': request.args.get('periodo') or 'semana', 'tipo': request.args.get('tipo') or '', 'status': request.args.get('status') or '',
         'q': (request.args.get('q') or '').strip(), 'de': request.args.get('de') or '', 'ate': request.args.get('ate') or ''}
    consulta = Agendamento.query
    de, ate = _data(f['de']), _data(f['ate'])
    if de or ate:
        f['periodo'] = 'datas'
        if de:
            consulta = consulta.filter(Agendamento.data >= de)
        if ate:
            consulta = consulta.filter(Agendamento.data <= ate)
    elif f['periodo'] == 'hoje':
        consulta = consulta.filter(Agendamento.data == hoje)
    elif f['periodo'] == 'atrasados':
        consulta = consulta.filter(Agendamento.data < hoje, Agendamento.status.in_(ABERTOS))
    elif f['periodo'] == 'todos':
        pass
    else:
        f['periodo'] = 'semana'      # de hoje ate 7 dias, mais o que ficou aberto para tras
        consulta = consulta.filter(db.or_(db.and_(Agendamento.data >= hoje, Agendamento.data <= hoje + timedelta(days=7)),
                                          db.and_(Agendamento.data < hoje, Agendamento.status.in_(ABERTOS))))
    if f['tipo'] in TIPOS:
        consulta = consulta.filter(Agendamento.tipo == f['tipo'])
    if f['status'] == 'abertos':
        consulta = consulta.filter(Agendamento.status.in_(ABERTOS))
    elif f['status'] in STATUS:
        consulta = consulta.filter(Agendamento.status == f['status'])
    if f['q']:
        like = f'%{f["q"].upper()}%'
        consulta = consulta.filter(db.or_(Agendamento.nf_numero.like(like), db.func.upper(Agendamento.cliente).like(like),
                                          db.func.upper(Agendamento.transportadora).like(like), Agendamento.placa.like(like),
                                          db.func.upper(Agendamento.pedido).like(like), db.func.upper(Agendamento.protocolo).like(like),
                                          db.func.upper(Agendamento.motorista).like(like)))
    return consulta, f


def _pagina(form=None, editando=None):
    hoje = agora().date()
    # antes de listar: agendamentos abertos acompanham a nota / a carga deles
    acompanhar_wms(Agendamento.query.filter(Agendamento.status.in_(ABERTOS), Agendamento.nf_numero.isnot(None)).all())
    consulta, f = _consulta()
    ordenada = consulta.order_by(Agendamento.data, Agendamento.hora.is_(None), Agendamento.hora, Agendamento.id)
    filtros = {k: v for k, v in f.items() if v and not (k == 'periodo' and v in ('semana', 'datas'))}
    if request.args.get('formato') == 'xlsx' and request.method == 'GET':
        livro = Workbook()
        aba = livro.active
        aba.title = 'Agendamentos'
        aba.append(['Data', 'Hora', 'Tipo', 'Doca', 'Situação', 'NF', 'Pedido', 'Cliente / fornecedor', 'Transportadora', 'Placa', 'Motorista',
                    'Volumes', 'Peso (kg)', 'Protocolo', 'No WMS', 'Chegada', 'Início', 'Fim', 'Observação', 'Origem', 'Criado por'])
        for celula in aba[1]:
            celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
        for a in ordenada.limit(20000):
            aba.append([a.data.strftime('%d/%m/%Y'), a.hora, a.tipo, a.doca, a.status, a.nf_numero, a.pedido, a.cliente, a.transportadora, a.placa,
                        a.motorista, a.volumes, a.peso, a.protocolo, situacao_no_wms(a)[0]]
                       + [d.strftime('%d/%m/%Y %H:%M') if d else None for d in (a.chegada_em, a.inicio_em, a.fim_em)]
                       + [a.observacao, a.origem, a.criado_por])
        for n, largura in enumerate((11, 7, 9, 7, 16, 10, 14, 34, 28, 10, 22, 9, 10, 14, 34, 17, 17, 17, 40, 9, 14), start=1):
            aba.column_dimensions[aba.cell(row=1, column=n).column_letter].width = largura
        aba.freeze_panes = 'A2'
        saida = io.BytesIO()
        livro.save(saida)
        saida.seek(0)
        return send_file(saida, as_attachment=True, download_name=f'agendamentos_{agora().strftime("%Y-%m-%d_%H%M")}.xlsx',
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    lista = ordenada.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all()
    # agrupa por dia, na ordem
    dias = []
    for a in lista:
        if not dias or dias[-1]['data'] != a.data:
            dias.append({'data': a.data, 'itens': []})
        dias[-1]['itens'].append({'a': a, 'wms': situacao_no_wms(a),
                                  'ocorrencias': Ocorrencia.query.filter_by(agendamento_id=a.id, status='Aberta').count(),
                                  'atrasado': a.status == 'Agendado' and (a.data < hoje or (a.data == hoje and a.hora and a.hora < agora().strftime('%H:%M')))})
    resumo = {'hoje': Agendamento.query.filter(Agendamento.data == hoje, Agendamento.status != 'Cancelado').count(),
              'patio': Agendamento.query.filter(Agendamento.status.in_(('No pátio', 'Em operação'))).count(),
              'atrasados': Agendamento.query.filter(Agendamento.data < hoje, Agendamento.status.in_(ABERTOS)).count(),
              'ocorrencias': Ocorrencia.query.filter_by(status='Aberta').count()}
    return render_template('agendamentos.html', dias=dias, f=f, filtros=filtros, total=total, pagina=pagina,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1), resumo=resumo, tipos=TIPOS, status=STATUS,
                           tipos_ocorrencia=TIPOS_OCORRENCIA, hoje=hoje, form=form, editando=editando)


@bp.route('/')
@perm('agendamento')
def lista():
    return _pagina()


@bp.route('/novo', methods=['POST'])
@perm('agendamento')
def novo():
    agendamento = Agendamento(origem='WMS', criado_por=usuario_atual().username)
    erros = _ler_formulario(agendamento)
    conflito = None if erros else _conflito(agendamento)
    if conflito and request.form.get('aceitar_conflito') != '1':
        erros.append(f'A doca {agendamento.doca} já tem um agendamento às {agendamento.hora} neste dia ({conflito.cliente}). '
                     'Troque a doca ou a hora, ou marque "Agendar mesmo assim".')
    if erros:
        # a janela volta aberta com o que foi preenchido
        for erro in erros:
            flash(erro, 'error')
        return _pagina(form=request.form)
    db.session.add(agendamento)
    registrar_log('Criou agendamento', f'{agendamento.tipo} · {agendamento.data.strftime("%d/%m/%Y")} {agendamento.hora or ""} · {agendamento.cliente}',
                  modulo='agendamento')
    db.session.commit()
    flash('Agendamento criado.', 'success')
    return redirect(url_for('agendamento.lista'))


def _agendamento_ou_404(aid):
    agendamento = db.session.get(Agendamento, aid)
    if not agendamento:
        abort(404)
    return agendamento


@bp.route('/<int:aid>/editar', methods=['POST'])
@perm('agendamento')
def editar(aid):
    agendamento = _agendamento_ou_404(aid)
    erros = _ler_formulario(agendamento)
    conflito = None if erros else _conflito(agendamento)
    if conflito and request.form.get('aceitar_conflito') != '1':
        erros.append(f'A doca {agendamento.doca} já tem um agendamento às {agendamento.hora} neste dia ({conflito.cliente}). '
                     'Troque a doca ou a hora, ou marque "Agendar mesmo assim".')
    if erros:
        db.session.rollback()
        for erro in erros:
            flash(erro, 'error')
        return _pagina(form=request.form, editando=aid)
    registrar_log('Alterou agendamento', f'nº {agendamento.id} · {agendamento.cliente}', modulo='agendamento')
    db.session.commit()
    flash('Agendamento salvo.', 'success')
    return redirect(request.form.get('voltar') or url_for('agendamento.lista'))


@bp.route('/<int:aid>/status', methods=['POST'])
@perm('agendamento')
def mudar_status(aid):
    """Andamento do agendamento: chegou -> iniciar -> concluir; ou nao compareceu / cancelar; reabrir desfaz."""
    agendamento = _agendamento_ou_404(aid)
    acao = request.form.get('acao')
    momento = agora()
    if acao == 'chegou' and agendamento.status == 'Agendado':
        agendamento.status, agendamento.chegada_em = 'No pátio', momento
        doca = (request.form.get('doca') or '').strip()[:10]
        if doca:
            agendamento.doca = doca
    elif acao == 'iniciar' and agendamento.status in ('Agendado', 'No pátio'):
        agendamento.status, agendamento.inicio_em = 'Em operação', momento
        agendamento.chegada_em = agendamento.chegada_em or momento
    elif acao == 'concluir' and agendamento.status in ABERTOS:
        agendamento.status, agendamento.fim_em = 'Concluído', momento
        agendamento.chegada_em = agendamento.chegada_em or momento
        agendamento.inicio_em = agendamento.inicio_em or momento
    elif acao == 'faltou' and agendamento.status == 'Agendado':
        agendamento.status = 'Não compareceu'
        # nao comparecimento ja vira ocorrencia, para nao se perder
        db.session.add(Ocorrencia(agendamento=agendamento, nf_numero=agendamento.nf_numero, tipo='Não comparecimento', origem='WMS',
                                  descricao=f'{agendamento.cliente} não compareceu ao agendamento de {agendamento.data.strftime("%d/%m/%Y")}'
                                            + (f' às {agendamento.hora}' if agendamento.hora else '') + '.', criado_por=usuario_atual().username))
    elif acao == 'cancelar' and agendamento.status in ABERTOS:
        motivo = (request.form.get('motivo') or '').strip()[:200]
        if not motivo:
            flash('Informe o motivo do cancelamento.', 'error')
            return redirect(request.referrer or url_for('agendamento.lista'))
        agendamento.status = 'Cancelado'
        agendamento.observacao = ((agendamento.observacao + ' · ') if agendamento.observacao else '') + f'Cancelado: {motivo}'
        agendamento.observacao = agendamento.observacao[:300]
    elif acao == 'reabrir' and agendamento.status in ('Concluído', 'Não compareceu', 'Cancelado'):
        agendamento.status, agendamento.fim_em = ('No pátio' if agendamento.chegada_em else 'Agendado'), None
    else:
        abort(400)
    registrar_log('Agendamento: ' + agendamento.status, f'nº {agendamento.id} · {agendamento.cliente}', modulo='agendamento')
    db.session.commit()
    flash(f'{agendamento.cliente}: {agendamento.status.lower()}.', 'success')
    return redirect(request.referrer or url_for('agendamento.lista'))


@bp.route('/<int:aid>/excluir', methods=['POST'])
@perm('agendamento')
def excluir(aid):
    agendamento = _agendamento_ou_404(aid)
    if agendamento.chegada_em:
        flash('Este agendamento já teve chegada registrada; cancele em vez de excluir, para ficar o histórico.', 'error')
        return redirect(request.referrer or url_for('agendamento.lista'))
    registrar_log('Excluiu agendamento', f'nº {agendamento.id} · {agendamento.cliente}', modulo='agendamento')
    db.session.delete(agendamento)
    db.session.commit()
    flash('Agendamento excluído.', 'success')
    return redirect(url_for('agendamento.lista'))


# ---------------------------------------------------------------- ocorrencias

@bp.route('/ocorrencias')
@perm('agendamento')
def ocorrencias():
    f = {'status': request.args.get('status') or 'Aberta', 'tipo': request.args.get('tipo') or '', 'q': (request.args.get('q') or '').strip()}
    consulta = Ocorrencia.query
    if f['status'] in ('Aberta', 'Resolvida'):
        consulta = consulta.filter_by(status=f['status'])
    if f['tipo'] in TIPOS_OCORRENCIA:
        consulta = consulta.filter_by(tipo=f['tipo'])
    if f['q']:
        like = f'%{f["q"].upper()}%'
        consulta = consulta.outerjoin(Agendamento, Ocorrencia.agendamento_id == Agendamento.id).filter(
            db.or_(Ocorrencia.nf_numero.like(like), db.func.upper(Ocorrencia.descricao).like(like), db.func.upper(Agendamento.cliente).like(like),
                   Agendamento.placa.like(like)))
    ordenada = consulta.order_by(Ocorrencia.criado_em.desc(), Ocorrencia.id.desc())
    filtros = {k: v for k, v in f.items() if v and not (k == 'status' and v == 'Aberta')}
    if request.args.get('formato') == 'xlsx':
        livro = Workbook()
        aba = livro.active
        aba.title = 'Ocorrências'
        aba.append(['Aberta em', 'Tipo', 'Situação', 'NF', 'Cliente / fornecedor', 'Agendamento', 'Descrição', 'Aberta por', 'Resolução', 'Resolvida por',
                    'Resolvida em', 'Origem'])
        for celula in aba[1]:
            celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
        for o in ordenada.limit(20000):
            a = o.agendamento
            aba.append([o.criado_em.strftime('%d/%m/%Y %H:%M'), o.tipo, o.status, o.nf_numero, a.cliente if a else None,
                        (a.data.strftime('%d/%m/%Y') + (' ' + a.hora if a.hora else '')) if a else None, o.descricao, o.criado_por, o.resolucao,
                        o.resolvido_por, o.resolvido_em.strftime('%d/%m/%Y %H:%M') if o.resolvido_em else None, o.origem])
        for n, largura in enumerate((17, 20, 11, 10, 34, 17, 60, 14, 50, 14, 17, 9), start=1):
            aba.column_dimensions[aba.cell(row=1, column=n).column_letter].width = largura
        aba.freeze_panes = 'A2'
        saida = io.BytesIO()
        livro.save(saida)
        saida.seek(0)
        return send_file(saida, as_attachment=True, download_name=f'ocorrencias_{agora().strftime("%Y-%m-%d_%H%M")}.xlsx',
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    return render_template('ocorrencias.html', ocorrencias=ordenada.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all(), f=f, filtros=filtros,
                           total=total, pagina=pagina, paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1), tipos=TIPOS_OCORRENCIA,
                           abertas=Ocorrencia.query.filter_by(status='Aberta').count(),
                           agendamentos=Agendamento.query.filter(Agendamento.data >= agora().date() - timedelta(days=15))
                           .order_by(Agendamento.data.desc(), Agendamento.hora).limit(200).all())


@bp.route('/ocorrencias/nova', methods=['POST'])
@perm('agendamento')
def ocorrencia_nova():
    voltar = redirect(request.form.get('voltar') or request.referrer or url_for('agendamento.ocorrencias'))
    tipo = request.form.get('tipo')
    descricao = ' '.join((request.form.get('descricao') or '').split())[:500]
    agendamento = db.session.get(Agendamento, request.form.get('agendamento_id', type=int) or 0)
    if tipo not in TIPOS_OCORRENCIA or not descricao:
        flash('Escolha o tipo da ocorrência e descreva o que aconteceu.', 'error')
        return voltar
    nf = (request.form.get('nf_numero') or '').strip()[:15] or (agendamento.nf_numero if agendamento else None)
    db.session.add(Ocorrencia(agendamento=agendamento, nf_numero=nf, tipo=tipo, descricao=descricao, origem='WMS',
                              criado_por=usuario_atual().username))
    registrar_log('Abriu ocorrência', f'{tipo}' + (f' · NF {nf}' if nf else '') + (f' · {agendamento.cliente}' if agendamento else ''),
                  modulo='agendamento')
    db.session.commit()
    flash('Ocorrência registrada.', 'success')
    return voltar


@bp.route('/ocorrencias/<int:oid>/resolver', methods=['POST'])
@perm('agendamento')
def ocorrencia_resolver(oid):
    ocorrencia = db.session.get(Ocorrencia, oid)
    if not ocorrencia:
        abort(404)
    if request.form.get('acao') == 'reabrir':
        ocorrencia.status, ocorrencia.resolvido_por, ocorrencia.resolvido_em = 'Aberta', None, None
        mensagem = 'Ocorrência reaberta.'
    else:
        resolucao = ' '.join((request.form.get('resolucao') or '').split())[:300]
        if not resolucao:
            flash('Descreva como a ocorrência foi resolvida.', 'error')
            return redirect(request.referrer or url_for('agendamento.ocorrencias'))
        ocorrencia.status, ocorrencia.resolucao = 'Resolvida', resolucao
        ocorrencia.resolvido_por, ocorrencia.resolvido_em = usuario_atual().username, agora()
        mensagem = 'Ocorrência resolvida.'
    registrar_log(mensagem.rstrip('.'), f'nº {ocorrencia.id} · {ocorrencia.tipo}', modulo='agendamento')
    db.session.commit()
    flash(mensagem, 'success')
    return redirect(request.referrer or url_for('agendamento.ocorrencias'))
