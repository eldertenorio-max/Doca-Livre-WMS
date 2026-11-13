"""Painel inicial: indicadores e graficos de tudo, em sub-abas por assunto.

Cada sub-aba so aparece para quem pode ver o modulo dela, e so os dados da aba aberta sao calculados.
Os graficos usam o componente static/graficos.js (linhas e colunas).
"""
from datetime import datetime, timedelta

from flask import url_for

from .core import pode_ver
from .models import Agendamento, Carga, Movimentacao, NotaFiscal, Palete, PaleteItem, Produto, agora, db

DIAS = 14
NO_ARMAZEM = ('Armazenado', 'Stage')
EM_ESTOQUE = ('Aguardando guarda', 'Armazenado', 'Stage')

# (chave, nome, icone, modulos: basta poder ver um deles; vazio = todos)
ABAS = [('geral', 'Visão geral', 'gauge-high', ()), ('estoque', 'Estoque', 'boxes-stacked', ('estoque',)),
        ('movimento', 'Entradas e saídas', 'right-left', ('recebimento', 'expedicao', 'devolucoes')),
        ('financeiro', 'Financeiro', 'coins', ('financeiro',)), ('operacao', 'Operação', 'stopwatch', ('relatorios', 'agendamento')),
        ('alertas', 'Alertas', 'bell', ('estoque',)), ('modulos', 'Módulos', 'table-cells-large', ())]


def abas_do_usuario():
    return [(chave, nome, icone) for chave, nome, icone, modulos in ABAS if not modulos or any(pode_ver(m) for m in modulos)]


def grafico(tipo, titulo, rotulos, series, ajuda='', sufixo='', links=None):
    """series = [(nome, valores)]. No tipo "colunas" vale a primeira serie."""
    series = [(nome, list(valores)) for nome, valores in series]
    if not any(v for _, valores in series for v in valores):
        rotulos = []                     # tudo zero: o componente mostra "sem itens" em vez de um grafico vazio
    return {'tipo': tipo, 'titulo': titulo, 'ajuda': ajuda, 'sufixo': sufixo, 'rotulos': [str(r) for r in rotulos],
            'chaves': [str(r) for r in rotulos], 'ativo': None, 'links': links if rotulos else None, 'textoLink': 'Clique para abrir', 'textoVazio': 'Ainda não há dados para este gráfico.',
            # no grafico de colunas cada coluna precisa da sua cor
            'pontos': ['var(--serie-1)'] * len(rotulos) if tipo == 'colunas' else None,
            'series': [{'nome': nome, 'cor': f'--serie-{n}', 'valores': list(valores)} for n, (nome, valores) in enumerate(series, start=1)]}


def kpi(icone, valor, rotulo, url=None, alerta=False, detalhe=None):
    return {'icone': icone, 'valor': valor, 'rotulo': rotulo, 'url': url, 'alerta': alerta, 'detalhe': detalhe}


def _moeda(valor):
    texto = f'{valor:,.2f}'
    return 'R$ ' + texto.replace(',', '#').replace('.', ',').replace('#', '.')


def _dias():
    hoje = agora().date()
    return [hoje - timedelta(days=n) for n in range(DIAS - 1, -1, -1)]


def _por_dia(consulta, dias):
    """consulta devolve datas/horas; conta quantas caem em cada dia."""
    contagem = {d: 0 for d in dias}
    for (quando,) in consulta:
        dia = quando.date() if isinstance(quando, datetime) else quando
        if dia in contagem:
            contagem[dia] += 1
    return [contagem[d] for d in dias]


def _grafico_movimento(dias):
    inicio = datetime.combine(dias[0], datetime.min.time())
    series = []
    for nome, tipo in (('Entradas', 'Entrada'), ('Saídas', 'Saída'), ('Retornos', 'Retorno')):
        series.append((nome, _por_dia(db.session.query(Movimentacao.criado_em).filter(Movimentacao.criado_em >= inicio, Movimentacao.tipo == tipo), dias)))
    return grafico('linhas', f'Paletes por dia — últimos {DIAS} dias', [d.strftime('%d/%m') for d in dias], series,
                   'Paletes que entraram (recebimento), que saíram (expedição ou saída manual) e que voltaram (retorno).')


def _grafico_ocupacao(camaras):
    linhas = [l for l in camaras if l['total']]
    return grafico('colunas', 'Ocupação por câmara (%)', [l['camara'].codigo for l in linhas], [('Ocupação', [l['ocupacao'] for l in linhas])],
                   'Posições ocupadas sobre o total de posições de cada câmara.', '%',
                   links=[url_for('enderecamento.mapa', camara=l['camara'].codigo) for l in linhas])


def _grafico_climatizacao(camaras):
    from .enderecamento import resumo_por_climatizacao
    grupos = [g for g in resumo_por_climatizacao(camaras) if g['total']]
    return grafico('colunas', 'Ocupação por climatização (%)', [g['nome'] for g in grupos], [('Ocupação', [g['ocupacao'] for g in grupos])],
                   'Posições ocupadas sobre o total de posições das câmaras congeladas, resfriadas e secas: '
                   + '; '.join(f"{g['nome']}: {g['ocupados']} de {g['total']} em {g['camaras']} câmara(s)" for g in grupos) + '.', '%')


def _texto_climatizacao(camaras):
    from .enderecamento import resumo_por_climatizacao
    return ' · '.join(f"{g['nome']} {g['ocupacao']:g}%".replace('.', ',') for g in resumo_por_climatizacao(camaras) if g['total'])


def _geral():
    from .enderecamento import resumo_camaras
    from .sistema import resumo_alertas
    hoje = agora().date()
    kpis, graficos = [], []
    if pode_ver('estoque') or pode_ver('enderecamento'):
        camaras = resumo_camaras()
        total, ocupadas = sum(l['total'] for l in camaras), sum(l['ocupados'] for l in camaras)
        kpis.append(kpi('warehouse', f'{round(100.0 * ocupadas / total, 1) if total else 0:g}%'.replace('.', ','), 'Ocupação do armazém',
                        url_for('enderecamento.mapa') if pode_ver('enderecamento') else None, detalhe=f'{ocupadas} de {total} posições' + (' · ' + _texto_climatizacao(camaras) if total else '')))
        kpis.append(kpi('pallet', Palete.query.filter(Palete.status.in_(NO_ARMAZEM)).count(), 'Paletes no armazém',
                        url_for('estoque.atual') if pode_ver('estoque') else None))
        aguardando = Palete.query.filter_by(status='Aguardando guarda').count()
        kpis.append(kpi('dolly', aguardando, 'Paletes aguardando guarda', alerta=aguardando > 0))
        graficos.append(_grafico_movimento(_dias()))
        graficos.append(_grafico_ocupacao(camaras))
        graficos.append(_grafico_climatizacao(camaras))
    if pode_ver('recebimento'):
        abertas = NotaFiscal.query.filter(NotaFiscal.tipo == 'Entrada', NotaFiscal.status.in_(('Aguardando', 'Em conferência'))).count()
        kpis.append(kpi('file-invoice', abertas, 'Notas de entrada em aberto', url_for('entrada.notas')))
    if pode_ver('expedicao'):
        cargas = Carga.query.filter(Carga.status.in_(('Aberta', 'Em separação', 'Em conferência'))).count()
        kpis.append(kpi('truck-ramp-box', cargas, 'Cargas em aberto', url_for('saida.cargas')))
    if pode_ver('agendamento'):
        kpis.append(kpi('calendar-day', Agendamento.query.filter(Agendamento.data == hoje, Agendamento.status != 'Cancelado').count(),
                        'Agendados para hoje', url_for('agendamento.lista', periodo='hoje')))
    if pode_ver('estoque'):
        total_alertas, graves = resumo_alertas()
        kpis.append(kpi('bell', total_alertas, 'Alertas', url_for('sistema.alertas'), alerta=graves > 0,
                        detalhe=f'{graves} grave(s)' if graves else None))
    if pode_ver('financeiro'):
        from .financeiro import linhas_do_financeiro
        kpis.append(kpi('coins', _moeda(sum(l['periodo']['total'] for l in linhas_do_financeiro())), 'A cobrar no período',
                        url_for('financeiro.painel', aba='movimentacao')))
    return {'kpis': kpis, 'graficos': graficos}


def _estoque():
    from .enderecamento import resumo_camaras
    hoje = agora().date()
    em_armazem = Palete.status.in_(EM_ESTOQUE)
    por_classe = dict(db.session.query(Palete.classificacao, db.func.count(Palete.id)).filter(em_armazem).group_by(Palete.classificacao))
    por_status = dict(db.session.query(Palete.status, db.func.count(Palete.id)).filter(em_armazem).group_by(Palete.status))
    top = (db.session.query(Produto.sku, db.func.sum(PaleteItem.quantidade)).select_from(PaleteItem)
           .join(Palete, PaleteItem.palete_id == Palete.id).join(Produto, PaleteItem.produto_id == Produto.id)
           .filter(em_armazem).group_by(Produto.sku).order_by(db.func.sum(PaleteItem.quantidade).desc()).limit(10).all())
    faixas = [('Vencido', 0), ('Até 7 dias', 0), ('8 a 30 dias', 0), ('31 a 90 dias', 0), ('Mais de 90', 0), ('Sem validade', 0)]
    contagem = [0] * len(faixas)
    for (validade,) in (db.session.query(PaleteItem.validade).join(Palete, PaleteItem.palete_id == Palete.id)
                        .filter(em_armazem, PaleteItem.quantidade > 0)):
        if validade is None:
            contagem[5] += 1
        else:
            falta = (validade - hoje).days
            contagem[0 if falta < 0 else 1 if falta <= 7 else 2 if falta <= 30 else 3 if falta <= 90 else 4] += 1
    classes = ['Bom', 'Reentrega', 'Avaria', 'Descarte / Perdas', 'Palete bloqueado']
    produtos = db.session.query(db.func.count(db.distinct(PaleteItem.produto_id))).join(Palete, PaleteItem.palete_id == Palete.id).filter(em_armazem).scalar()
    return {
        'kpis': [kpi('pallet', sum(por_status.values()), 'Paletes em estoque', url_for('estoque.atual')),
                 kpi('box', produtos or 0, 'Produtos diferentes'),
                 kpi('dolly', por_status.get('Aguardando guarda', 0), 'Aguardando guarda', alerta=por_status.get('Aguardando guarda', 0) > 0),
                 kpi('truck-loading', por_status.get('Stage', 0), 'No stage'),
                 kpi('box-open', sum(v for c, v in por_classe.items() if c != 'Bom'), 'Fora do estoque bom', detalhe='reentrega, avaria, descarte, bloqueado')],
        'graficos': [
            grafico('colunas', 'Lotes por prazo de validade', [f for f, _ in faixas], [('Lotes em estoque', contagem)],
                    'Quantos lotes guardados estão em cada faixa de vencimento.',
                    links=[url_for('estoque.analise', aba='lotes')] * len(faixas)),
            grafico('colunas', 'Paletes por classificação', classes, [('Paletes', [por_classe.get(c, 0) for c in classes])],
                    'Bom é o estoque disponível para venda; as outras são áreas separadas.'),
            grafico('colunas', '10 produtos com mais estoque', [sku for sku, _ in top], [('Quantidade', [round(q or 0, 3) for _, q in top])],
                    'Soma da quantidade em estoque de cada produto.', links=[url_for('estoque.atual', q=sku) for sku, _ in top]),
            _grafico_ocupacao(resumo_camaras()),
            _grafico_climatizacao(resumo_camaras()),
        ]}


def _movimento():
    dias = _dias()
    inicio = datetime.combine(dias[0], datetime.min.time())
    recebidas = _por_dia(db.session.query(NotaFiscal.criado_em).filter(NotaFiscal.tipo == 'Entrada', NotaFiscal.status != 'Cancelada',
                                                                    NotaFiscal.criado_em >= inicio), dias)
    expedidas = _por_dia(db.session.query(Carga.fim_conferencia).filter(Carga.status == 'Expedida', Carga.fim_conferencia >= inicio), dias)
    retornos = _por_dia(db.session.query(NotaFiscal.criado_em).filter(NotaFiscal.tipo == 'Retorno', NotaFiscal.status != 'Cancelada',
                                                                   NotaFiscal.criado_em >= inicio), dias)
    status_notas = ['Aguardando', 'Em conferência', 'Finalizada', 'Cancelada']
    notas = dict(db.session.query(NotaFiscal.status, db.func.count(NotaFiscal.id)).filter(NotaFiscal.tipo == 'Entrada').group_by(NotaFiscal.status))
    status_cargas = ['Aberta', 'Em separação', 'Em conferência', 'Expedida', 'Cancelada']
    cargas = dict(db.session.query(Carga.status, db.func.count(Carga.id)).group_by(Carga.status))
    motivos = (db.session.query(NotaFiscal.motivo_retorno, db.func.count(NotaFiscal.id))
               .filter(NotaFiscal.tipo == 'Retorno', NotaFiscal.status != 'Cancelada', NotaFiscal.motivo_retorno.isnot(None))
               .group_by(NotaFiscal.motivo_retorno).order_by(db.func.count(NotaFiscal.id).desc()).limit(8).all())
    return {
        'kpis': [kpi('file-invoice', notas.get('Aguardando', 0) + notas.get('Em conferência', 0), 'Notas de entrada em aberto',
                     url_for('entrada.notas') if pode_ver('recebimento') else None),
                 kpi('file-circle-check', sum(recebidas), f'Notas recebidas em {DIAS} dias'),
                 kpi('truck-ramp-box', sum(cargas.get(s, 0) for s in status_cargas[:3]), 'Cargas em aberto',
                     url_for('saida.cargas') if pode_ver('expedicao') else None),
                 kpi('truck-fast', sum(expedidas), f'Cargas expedidas em {DIAS} dias'),
                 kpi('rotate-left', sum(retornos), f'Retornos em {DIAS} dias', url_for('retornos.lista') if pode_ver('devolucoes') else None)],
        'graficos': [
            grafico('linhas', f'Notas e cargas por dia — últimos {DIAS} dias', [d.strftime('%d/%m') for d in dias],
                    [('Notas recebidas', recebidas), ('Cargas expedidas', expedidas), ('Retornos', retornos)],
                    'Notas de entrada lançadas, cargas que saíram e notas de retorno, por dia.'),
            _grafico_movimento(dias),
            grafico('colunas', 'Notas de entrada por situação', status_notas, [('Notas', [notas.get(s, 0) for s in status_notas])]),
            grafico('colunas', 'Cargas por situação', status_cargas, [('Cargas', [cargas.get(s, 0) for s in status_cargas])]),
        ] + ([grafico('colunas', 'Retornos por motivo', [m for m, _ in motivos], [('Retornos', [n for _, n in motivos])],
                      'Por que a mercadoria voltou.')] if motivos else [])}


def _financeiro():
    from .financeiro import linhas_do_financeiro
    linhas = linhas_do_financeiro()
    por_cliente = {}
    for l in linhas:
        nome = l['empresa'].nome if l['empresa'] else 'Sem emitente'
        atual = por_cliente.setdefault(nome, {'cobrar': 0.0, 'acumulado': 0.0, 'nfs': 0, 'id': l['empresa'].id if l['empresa'] else None})
        atual['cobrar'] += l['periodo']['total']
        atual['acumulado'] += l['cobranca']['valor_vigente']
        atual['nfs'] += 1
    clientes = sorted(por_cliente.items(), key=lambda par: -par[1]['cobrar'])[:12]
    nomes = [nome[:18] for nome, _ in clientes]
    links = [url_for('financeiro.painel', aba='movimentacao', cliente=d['id']) if d['id'] else url_for('financeiro.painel') for _, d in clientes]
    return {
        'kpis': [kpi('coins', _moeda(sum(l['periodo']['total'] for l in linhas)), 'A cobrar no período', url_for('financeiro.painel', aba='movimentacao')),
                 kpi('sack-dollar', _moeda(sum(l['cobranca']['valor_vigente'] for l in linhas)), 'Armazenagem acumulada'),
                 kpi('file-invoice-dollar', sum(1 for l in linhas if l['resumo']['armazenada']), 'NFs armazenadas'),
                 kpi('file-circle-xmark', sum(1 for l in linhas if not l['contrato']), 'NFs de cliente sem contrato',
                     url_for('financeiro.painel', aba='contratos'), alerta=any(not l['contrato'] for l in linhas))],
        'graficos': [
            grafico('colunas', 'A cobrar no período, por cliente (R$)', nomes, [('A cobrar', [round(d['cobrar'], 2) for _, d in clientes])],
                    'Armazenagem do período de cada nota mais os débitos de entrada e de saída.', links=links),
            grafico('colunas', 'Armazenagem acumulada, por cliente (R$)', nomes, [('Acumulado', [round(d['acumulado'], 2) for _, d in clientes])],
                    'Desde a entrada de cada nota, sem olhar o período.', links=links),
            grafico('colunas', 'Notas por cliente', nomes, [('Notas', [d['nfs'] for _, d in clientes])], links=links),
        ] if clientes else []}


def _operacao():
    from .relatorios import COLUNAS_PRODUTIVIDADE, TURNOS, dados_produtividade
    hoje = agora().date()
    de = hoje - timedelta(days=6)
    kpis, graficos = [], []
    if pode_ver('relatorios'):
        pessoas, totais = dados_produtividade(de, hoje, por_turno=False)
        turnos, _ = dados_produtividade(de, hoje, por_turno=True)
        por_turno = {t: sum(l['total'] for l in turnos if l['turno'] == t) for t in TURNOS}
        melhores = sorted(pessoas, key=lambda l: -l['total'])[:12]
        ver = url_for('relatorios.produtividade')
        kpis += [kpi('person-digging', sum(totais.values()), 'Atividades em 7 dias', ver), kpi('users', len(pessoas), 'Pessoas com atividade', ver)]
        graficos += [
            grafico('colunas', 'Atividades por pessoa — 7 dias', [l['nome'][:14] for l in melhores], [('Atividades', [l['total'] for l in melhores])],
                    'Conferidos, guardados, movimentados, separados, expedidos e contagens.', links=[ver] * len(melhores)),
            grafico('colunas', 'Atividades por tipo — 7 dias', [rotulo for _, rotulo in COLUNAS_PRODUTIVIDADE],
                    [('Atividades', [totais.get(chave, 0) for chave, _ in COLUNAS_PRODUTIVIDADE])], links=[ver] * len(COLUNAS_PRODUTIVIDADE)),
            grafico('colunas', 'Atividades por turno — 7 dias', TURNOS, [('Atividades', [por_turno[t] for t in TURNOS])],
                    'Manhã 06h–14h, tarde 14h–22h, noite 22h–06h.', links=[ver] * len(TURNOS)),
        ]
    if pode_ver('agendamento'):
        from .agendamento import STATUS
        situacoes = dict(db.session.query(Agendamento.status, db.func.count(Agendamento.id))
                         .filter(Agendamento.data >= de, Agendamento.data <= hoje + timedelta(days=7)).group_by(Agendamento.status))
        kpis.append(kpi('calendar-day', Agendamento.query.filter(Agendamento.data == hoje, Agendamento.status != 'Cancelado').count(),
                        'Agendados para hoje', url_for('agendamento.lista', periodo='hoje')))
        graficos.append(grafico('colunas', 'Agendamentos por situação', STATUS, [('Agendamentos', [situacoes.get(s, 0) for s in STATUS])],
                                'Dos últimos 7 dias aos próximos 7.', links=[url_for('agendamento.lista', periodo='todos', status=s) for s in STATUS]))
    return {'kpis': kpis, 'graficos': graficos}


def _alertas():
    from .sistema import calcular_alertas
    lista = calcular_alertas()
    tipos = ['Validade', 'Estoque mínimo', 'Temperatura']
    return {
        'kpis': [kpi('bell', len(lista), 'Alertas', url_for('sistema.alertas')),
                 kpi('triangle-exclamation', sum(1 for a in lista if a['grave']), 'Graves', alerta=any(a['grave'] for a in lista))],
        'graficos': [grafico('colunas', 'Alertas por tipo', tipos, [('Alertas', [sum(1 for a in lista if a['tipo'] == t) for t in tipos])],
                             links=[url_for('sistema.alertas', tipo=t) for t in tipos])] if lista else [],
        'alertas': lista[:12], 'alertas_total': len(lista)}


MONTAR = {'geral': _geral, 'estoque': _estoque, 'movimento': _movimento, 'financeiro': _financeiro, 'operacao': _operacao, 'alertas': _alertas}


def dados_do_painel(aba):
    return MONTAR[aba]() if aba in MONTAR else {'kpis': [], 'graficos': []}
