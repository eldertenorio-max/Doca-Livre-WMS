"""Temperatura das camaras: registro das leituras (conferente, data e graus de cada camara) e historico.

Cada leitura e comparada com a faixa do cadastro da camara (temperatura minima e maxima); fora dela, fica marcada.
"""
import io
from datetime import datetime, timedelta

from flask import Blueprint, abort, flash, redirect, render_template, request, send_file, url_for
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .core import perm, registrar_log, usuario_atual
from .models import Camara, TemperaturaCamara, agora, db

bp = Blueprint('temperaturas', __name__, url_prefix='/enderecamento/temperaturas')

POR_PAGINA = 100


def _numero(texto):
    """Graus digitados (aceita virgula e sinal). None se vazio; ValueError se invalido."""
    texto = (texto or '').strip().replace(',', '.').replace('°', '').replace('C', '').replace('c', '').strip()
    if not texto:
        return None
    valor = float(texto)
    if not -80 <= valor <= 60:
        raise ValueError(texto)
    return round(valor, 1)


def fora_da_faixa(camara, temperatura):
    """True/False quando a camara tem faixa cadastrada; None quando nao da para saber."""
    if camara.temp_min is None and camara.temp_max is None:
        return None
    return bool((camara.temp_min is not None and temperatura < camara.temp_min)
                or (camara.temp_max is not None and temperatura > camara.temp_max))


def _camaras():
    # O stage e area de passagem: nao entra na ronda de temperatura.
    return Camara.query.filter(Camara.ativo.is_(True), Camara.tipo != 'Stage').order_by(Camara.codigo).all()


def _data_do_filtro(texto):
    try:
        return datetime.strptime((texto or '').strip(), '%Y-%m-%d')
    except ValueError:
        return None


def _pagina(form=None):
    camaras = _camaras()
    f = {'camara': request.args.get('camara', type=int), 'de': request.args.get('de') or '', 'ate': request.args.get('ate') or '',
         'fora': request.args.get('fora') == '1'}
    consulta = TemperaturaCamara.query.join(Camara)
    if f['camara']:
        consulta = consulta.filter(TemperaturaCamara.camara_id == f['camara'])
    de, ate = _data_do_filtro(f['de']), _data_do_filtro(f['ate'])
    if de:
        consulta = consulta.filter(TemperaturaCamara.medido_em >= de)
    if ate:
        consulta = consulta.filter(TemperaturaCamara.medido_em < ate + timedelta(days=1))
    if f['fora']:
        consulta = consulta.filter(TemperaturaCamara.fora.is_(True))
    ordenada = consulta.order_by(TemperaturaCamara.medido_em.desc(), TemperaturaCamara.id.desc())
    filtros = {k: (1 if v is True else v) for k, v in f.items() if v}
    if request.args.get('formato') == 'xlsx' and request.method == 'GET':
        livro = Workbook()
        aba = livro.active
        aba.title = 'Temperaturas'
        aba.append(['Data e hora', 'Câmara', 'Temperatura (°C)', 'Mínima', 'Máxima', 'Situação', 'Conferente', 'Observação', 'Registrado por'])
        for celula in aba[1]:
            celula.font, celula.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1A237E')
        for l in ordenada.limit(20000):
            aba.append([l.medido_em.strftime('%d/%m/%Y %H:%M'), f'{l.camara.codigo:02d} · {l.camara.nome}', l.temperatura, l.temp_min, l.temp_max,
                        'Sem faixa' if l.fora is None else 'Fora da faixa' if l.fora else 'Dentro da faixa', l.conferente, l.observacao,
                        l.registrado_por])
        for n, largura in enumerate((17, 24, 16, 10, 10, 16, 24, 40, 16), start=1):
            aba.column_dimensions[aba.cell(row=1, column=n).column_letter].width = largura
        aba.freeze_panes = 'A2'
        saida = io.BytesIO()
        livro.save(saida)
        saida.seek(0)
        return send_file(saida, as_attachment=True, download_name=f'temperaturas_{agora().strftime("%Y-%m-%d_%H%M")}.xlsx',
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    # Ultima leitura de cada camara, para os cartoes.
    ultimas = {}
    for camara in camaras:
        ultimas[camara.id] = (TemperaturaCamara.query.filter_by(camara_id=camara.id)
                              .order_by(TemperaturaCamara.medido_em.desc(), TemperaturaCamara.id.desc()).first())
    total = consulta.count()
    pagina = max(request.args.get('pagina', 1, type=int), 1)
    return render_template('temperaturas.html', camaras=camaras, ultimas=ultimas, f=f, filtros=filtros, total=total, pagina=pagina,
                           paginas=max((total + POR_PAGINA - 1) // POR_PAGINA, 1),
                           leituras=ordenada.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all(),
                           agora_local=agora().strftime('%Y-%m-%dT%H:%M'), form=form, limite_atraso=agora() - timedelta(hours=24))


@bp.route('/')
@perm('enderecamento')
def lista():
    return _pagina()


@bp.route('/', methods=['POST'])
@perm('enderecamento')
def registrar():
    """Uma ronda: conferente, data e hora e os graus de cada camara (as deixadas em branco nao sao registradas)."""
    conferente = ' '.join((request.form.get('conferente') or '').split())[:120]
    try:
        medido_em = datetime.strptime(request.form.get('medido_em') or '', '%Y-%m-%dT%H:%M')
    except ValueError:
        medido_em = None
    erros, leituras = [], []
    if not conferente:
        erros.append('Informe o conferente.')
    if not medido_em:
        erros.append('Informe a data e a hora da medição.')
    elif medido_em > agora().replace(tzinfo=None) + timedelta(minutes=5):
        erros.append('A data da medição não pode estar no futuro.')
    for camara in _camaras():
        try:
            valor = _numero(request.form.get(f'temp_{camara.id}'))
        except ValueError:
            erros.append(f'{camara.nome}: temperatura inválida (use graus entre -80 e 60, ex.: -18,5).')
            continue
        if valor is not None:
            leituras.append((camara, valor))
    if not erros and not leituras:
        erros.append('Informe a temperatura de ao menos uma câmara.')
    if erros:
        # A tela volta com a janela aberta e o que foi digitado.
        for erro in erros:
            flash(erro, 'error')
        return _pagina(form=request.form)
    observacao = (request.form.get('observacao') or '').strip()[:200] or None
    fora = []
    for camara, valor in leituras:
        situacao = fora_da_faixa(camara, valor)
        db.session.add(TemperaturaCamara(camara=camara, temperatura=valor, medido_em=medido_em, conferente=conferente,
                                         observacao=observacao, temp_min=camara.temp_min, temp_max=camara.temp_max, fora=situacao,
                                         registrado_por=usuario_atual().username))
        if situacao:
            fora.append(f'{camara.nome} ({valor:g} °C)'.replace('.', ','))
    registrar_log('Registrou temperaturas', f'{len(leituras)} câmara(s) por {conferente}' + (f' — fora da faixa: {", ".join(fora)}' if fora else ''),
                  modulo='enderecamento')
    db.session.commit()
    flash(f'{len(leituras)} temperatura(s) registrada(s).', 'success')
    if fora:
        flash('Atenção: fora da faixa — ' + ', '.join(fora) + '.', 'error')
    return redirect(url_for('temperaturas.lista'))


@bp.route('/<int:lid>/excluir', methods=['POST'])
@perm('enderecamento')
def excluir(lid):
    leitura = db.session.get(TemperaturaCamara, lid)
    if not leitura:
        abort(404)
    registrar_log('Excluiu leitura de temperatura', f'{leitura.camara.nome}: {leitura.temperatura:g} °C em '
                  f'{leitura.medido_em.strftime("%d/%m/%Y %H:%M")}', modulo='enderecamento')
    db.session.delete(leitura)
    db.session.commit()
    flash('Leitura excluída.', 'success')
    return redirect(request.referrer or url_for('temperaturas.lista'))
