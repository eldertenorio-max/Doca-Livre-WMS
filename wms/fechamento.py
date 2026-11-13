"""Fechamento mensal do Financeiro: congela o valor do mes de um cliente e gera o demonstrativo em PDF.

O calculo "ao vivo" do Financeiro muda todo dia (a nota continua armazenada, sai palete, muda contrato). O fechamento
guarda uma fotografia: para cada nota do cliente, a armazenagem do mes (dia 1 ao ultimo dia) e os debitos de entrada e
de saida do mes, com a tabela e o contrato que valiam na hora. Depois de fechado, o valor nao muda mais; para refazer,
reabra (exclua) o fechamento e feche de novo.

Limite herdado do motor de calculo: a cobranca por quilo usa o peso que a nota tem no momento do fechamento. Por isso o
certo e fechar o mes logo que ele termina.
"""
import calendar
import json
from datetime import date

from flask import Blueprint, Response, abort, flash, redirect, render_template, request, url_for
from fpdf.enums import XPos, YPos

from . import financeiro_calculo as calc
from .core import perm, pode_editar, registrar_log, usuario_atual
from .danfe import _Espelho, _cnpj, _data, _t
from .financeiro import ABAS, _contrato_dict, _o_que_cobra, _tabela_dict, contratos_ativos, linhas_do_financeiro, moeda
from .models import Empresa, FechamentoMensal, agora, db

bp = Blueprint('fechamento', __name__, url_prefix='/financeiro/fechamentos')

MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']


def nome_do_mes(ano, mes):
    return f'{MESES[mes - 1]} de {ano}'


def calcular_fechamento(empresa, ano, mes):
    """Linhas (uma por nota com valor no mes) e totais do mes do cliente, com o que vale agora."""
    inicio, fim = date(ano, mes, 1), date(ano, mes, calendar.monthrange(ano, mes)[1])
    hoje = agora().date()
    linhas = []
    for l in linhas_do_financeiro(empresa_id=empresa.id, hoje=min(hoje, fim)):
        contrato, tabela = _contrato_dict(l['contrato']), _tabela_dict(l['tabela'])
        p = calc.cobrar_periodo(l['resumo'], l['cobranca'], contrato, tabela, inicio, fim)
        if p['total'] <= 0 and p['dias'] <= 0:
            continue                       # nota que nao esteve no armazem neste mes
        r = l['resumo']
        linhas.append({
            'nf': l['nota'].numero, 'entrada': r['entrada'].isoformat(), 'saida': r['data_saida'].isoformat() if r['data_saida'] else None,
            'status': r['status'], 'dias': p['dias'], 'diaria': p['valor_diaria'], 'armazenagem': p['armazenagem'],
            'debitos_entrada': p['debitos_entrada'], 'paletes_entrada': p['paletes_entrada'],
            'debitos_saida': p['debitos_saida'], 'paletes_saida': p['paletes_saida'], 'total': p['total'],
            'peso': round(l['peso'], 3), 'paletes': r['paletes'], 'posicoes': r['posicoes']})
    linhas.sort(key=lambda x: (x['entrada'], x['nf']))
    totais = {campo: calc.arredondar(sum(x[campo] for x in linhas)) for campo in ('armazenagem', 'debitos_entrada', 'debitos_saida', 'total')}
    return inicio, fim, linhas, totais


def pdf_do_fechamento(f):
    """Demonstrativo do fechamento em PDF (A4 deitado). Devolve os bytes."""
    dados = json.loads(f.dados)
    pdf = _Espelho(orientation='L', format='A4')
    pdf.rodape = f'WMS Doca Livre · fechamento feito em {_data(f.criado_em, True)} por {f.criado_por or "-"}'
    pdf.set_title(_t(f'Demonstrativo {f.empresa.nome} {f.mes:02d}-{f.ano}'))
    pdf.set_auto_page_break(True, margin=16)
    pdf.set_margins(12, 12, 12)
    pdf.add_page()
    largura = pdf.epw

    pdf.set_fill_color(26, 35, 126)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 15)
    pdf.cell(largura * 0.65, 12, _t('  DEMONSTRATIVO DE ARMAZENAGEM'), fill=True)
    pdf.set_font('Helvetica', 'B', 11)
    pdf.cell(largura * 0.35, 12, _t(nome_do_mes(f.ano, f.mes).upper() + '  '), fill=True, align='R', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)

    campos = [('Cliente', f.empresa.nome), ('CNPJ', _cnpj(f.empresa.cnpj)), ('Período', f'{_data(f.inicio)} a {_data(f.fim)}'),
              ('Tabela de cobrança', dados.get('tabela') or '-'), ('Contrato', dados.get('contrato') or '-'), ('O que cobra', dados.get('cobra') or '-')]
    w = largura / 3
    for n in range(0, len(campos), 3):
        y = pdf.get_y()
        for k, (rotulo, valor) in enumerate(campos[n:n + 3]):
            pdf.set_xy(pdf.l_margin + k * w, y)
            pdf.set_font('Helvetica', '', 6.5)
            pdf.set_text_color(110, 110, 110)
            pdf.cell(w, 3.5, _t(rotulo.upper()))
            pdf.set_xy(pdf.l_margin + k * w, y + 3.5)
            pdf.set_font('Helvetica', 'B', 9.5)
            pdf.set_text_color(20, 20, 20)
            pdf.cell(w - 2, 5, _t(valor)[:70])
        pdf.set_y(y + 11)
    pdf.ln(2)

    colunas = [('NF', 20, 'L'), ('Entrada', 22, 'L'), ('Saída', 22, 'L'), ('Situação', 26, 'L'), ('Peso (kg)', 24, 'R'), ('Dias no mês', 22, 'R'),
               ('Diária', 26, 'R'), ('Armazenagem', 30, 'R'), ('Entrada (R$)', 26, 'R'), ('Saída (R$)', 24, 'R'), ('Total', 0, 'R')]
    fixo = sum(l for _, l, _ in colunas)
    colunas = [(t, l or largura - fixo, a) for t, l, a in colunas]

    def cabecalho():
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_fill_color(232, 234, 246)
        pdf.set_text_color(26, 35, 126)
        for titulo, l, alinhamento in colunas:
            pdf.cell(l, 7, _t(titulo), fill=True, align=alinhamento)
        pdf.ln(7)

    def numero(valor, casas=3):
        texto = f'{valor:,.{casas}f}'
        if casas > 2:
            texto = texto.rstrip('0').rstrip('.')
        return texto.replace(',', '#').replace('.', ',').replace('#', '.')

    cabecalho()
    pdf.set_font('Helvetica', '', 8.5)
    pdf.set_text_color(20, 20, 20)
    for n, x in enumerate(dados['linhas']):
        if pdf.get_y() > pdf.h - 28:
            pdf.add_page()
            cabecalho()
            pdf.set_font('Helvetica', '', 8.5)
            pdf.set_text_color(20, 20, 20)
        valores = [x['nf'], _data(date.fromisoformat(x['entrada'])), _data(date.fromisoformat(x['saida'])) if x['saida'] else '-', x['status'],
                   numero(x['peso']), str(x['dias']), moeda(x['diaria']), moeda(x['armazenagem']), moeda(x['debitos_entrada']),
                   moeda(x['debitos_saida']), moeda(x['total'])]
        pdf.set_fill_color(247, 248, 250)
        for (_, l, alinhamento), valor in zip(colunas, valores):
            pdf.cell(l, 6.5, _t(valor), align=alinhamento, fill=n % 2 == 1)
        pdf.ln(6.5)
    if not dados['linhas']:
        pdf.cell(0, 8, _t('Nenhuma nota com valor neste mês.'), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(1)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_fill_color(232, 234, 246)
    antes = sum(l for _, l, _ in colunas[:7])
    pdf.cell(antes, 8, _t(f'  TOTAL · {len(dados["linhas"])} nota(s)'), fill=True)
    for (_, l, alinhamento), valor in zip(colunas[7:], (f.armazenagem, f.debitos_entrada, f.debitos_saida, f.total)):
        pdf.cell(l, 8, _t(moeda(valor)), align=alinhamento, fill=True)
    pdf.ln(12)

    pdf.set_fill_color(26, 35, 126)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 13)
    pdf.cell(largura * 0.6, 11, _t('  VALOR A COBRAR NO MÊS'), fill=True)
    pdf.cell(largura * 0.4, 11, _t(moeda(f.total) + '  '), fill=True, align='R', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(90, 90, 90)
    pdf.set_font('Helvetica', '', 7.5)
    pdf.ln(2)
    pdf.multi_cell(0, 4, _t('Armazenagem = dias da nota no armazém dentro do mês x valor da diária. Entrada e saída = paletes que entraram ou saíram '
                            'no mês x valor por palete. Demonstrativo de conferência: não é nota fiscal nem boleto.'
                            + (f' Observação: {f.observacao}' if f.observacao else '')))
    return bytes(pdf.output())


def resposta_pdf(f):
    nome = f'demonstrativo_{f.ano}-{f.mes:02d}_{f.empresa_id}.pdf'
    return Response(pdf_do_fechamento(f), mimetype='application/pdf',
                    headers={'Content-Disposition': f'inline; filename="{nome}"', 'Cache-Control': 'no-store'})


def _mes_do_formulario(texto):
    try:
        ano, mes = (int(p) for p in (texto or '').split('-'))
        date(ano, mes, 1)
        return ano, mes
    except (ValueError, TypeError):
        return None


def _tela(form=None, previa=None):
    hoje = agora().date()
    anterior = (hoje.replace(day=1).toordinal() - 1)
    padrao = date.fromordinal(anterior)
    ativos = contratos_ativos()
    return render_template(
        'financeiro_fechamentos.html', abas=ABAS, form=form, previa=previa, editar=pode_editar('financeiro'), nome_do_mes=nome_do_mes,
        fechamentos=FechamentoMensal.query.order_by(FechamentoMensal.ano.desc(), FechamentoMensal.mes.desc(), FechamentoMensal.id.desc()).all(),
        clientes=Empresa.query.filter(Empresa.id.in_(list(ativos) or [0])).order_by(Empresa.nome).all(),
        mes_padrao=f'{padrao.year}-{padrao.month:02d}', mes_maximo=f'{hoje.year}-{hoje.month:02d}')


@bp.route('/')
@perm('financeiro')
def lista():
    return _tela()


@bp.route('/fechar', methods=['POST'])
@perm('financeiro')
def fechar():
    """acao=previa mostra o que sera fechado; acao=fechar grava."""
    empresa = db.session.get(Empresa, request.form.get('empresa_id', type=int) or 0)
    periodo = _mes_do_formulario(request.form.get('mes'))
    hoje = agora().date()
    erro = None
    if not empresa:
        erro = 'Escolha o cliente.'
    elif not periodo:
        erro = 'Escolha o mês.'
    elif periodo > (hoje.year, hoje.month):
        erro = 'Não dá para fechar um mês que ainda não começou.'
    elif empresa.id not in contratos_ativos():
        erro = f'{empresa.nome} não tem contrato ativo. Cadastre o contrato antes de fechar o mês.'
    elif FechamentoMensal.query.filter_by(empresa_id=empresa.id, ano=periodo[0], mes=periodo[1]).first():
        erro = f'{nome_do_mes(*periodo).capitalize()} de {empresa.nome} já está fechado. Para refazer, reabra o fechamento.'
    if erro:
        flash(erro, 'error')
        return _tela(form=request.form)
    ano, mes = periodo
    inicio, fim, linhas, totais = calcular_fechamento(empresa, ano, mes)
    contrato = contratos_ativos()[empresa.id]
    if request.form.get('acao') != 'fechar':
        return _tela(form=request.form, previa={'empresa': empresa, 'ano': ano, 'mes': mes, 'inicio': inicio, 'fim': fim, 'linhas': linhas,
                                                'totais': totais, 'em_andamento': fim >= hoje})
    f = FechamentoMensal(empresa=empresa, ano=ano, mes=mes, inicio=inicio, fim=fim, notas=len(linhas), criado_por=usuario_atual().username,
                         observacao=(request.form.get('observacao') or '').strip()[:300] or None, **totais,
                         dados=json.dumps({'linhas': linhas, 'tabela': contrato.tabela.nome, 'cobra': _o_que_cobra(contrato),
                                           'contrato': f'{calc.ROTULO_CICLO[contrato.ciclo]} · {calc.ROTULO_REGRA[contrato.regra_tempo]}'},
                                          ensure_ascii=False))
    db.session.add(f)
    registrar_log('Fechou o mês', f'{empresa.nome} · {mes:02d}/{ano} · {moeda(totais["total"])}', modulo='financeiro')
    db.session.commit()
    flash(f'{nome_do_mes(ano, mes).capitalize()} de {empresa.nome} fechado: {moeda(totais["total"])} em {len(linhas)} nota(s).', 'success')
    if fim >= hoje:
        flash('Atenção: este mês ainda não terminou. O valor fechado vai só até hoje; se quiser o mês inteiro, reabra e feche de novo depois do dia '
              f'{fim.strftime("%d/%m")}.', 'warning')
    return redirect(url_for('fechamento.lista'))


def _fechamento_ou_404(fid):
    f = db.session.get(FechamentoMensal, fid)
    if not f:
        abort(404)
    return f


@bp.route('/<int:fid>/pdf')
@perm('financeiro')
def pdf(fid):
    return resposta_pdf(_fechamento_ou_404(fid))


@bp.route('/<int:fid>/reabrir', methods=['POST'])
@perm('financeiro')
def reabrir(fid):
    f = _fechamento_ou_404(fid)
    registrar_log('Reabriu o mês', f'{f.empresa.nome} · {f.mes:02d}/{f.ano} · era {moeda(f.total)}', modulo='financeiro')
    db.session.delete(f)
    db.session.commit()
    flash(f'{nome_do_mes(f.ano, f.mes).capitalize()} de {f.empresa.nome} reaberto. O valor volta a ser calculado ao vivo até você fechar de novo.', 'success')
    return redirect(url_for('fechamento.lista'))
