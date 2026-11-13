"""Estoque: saldo atual, historico de movimentacao, historico por NF e analise (seguranca, shelf life, visao cruzada).

As regras da analise seguem o WMS Light (frontend_light: EstoqueSeguranca, ControleShelfLifePanel, estoqueShelfCruzada):
- Estoque de seguranca: semaforo Excedido / Verde / Amarelo / Vermelho / Analisar + "Confiabilidade (decisao)"
  (PRODUZ / AVALIA / NAO PRODUZ, travada quando o saldo ou o giro parecem errados). No Light o semaforo vem pronto de
  uma planilha; aqui ele e calculado com o minimo, o ideal e o maximo do cadastro do produto, e o consumo vem das saidas.
- Shelf life: % da vida util JA CONSUMIDA (dias de vida / shelf). Verde ate 33,33; Amarelo ate 60,01; Laranja ate 80,01;
  Vermelho acima.
- Visao cruzada: junta os dois e diz o que fazer (critico, desperdicio, produzir, validade, avaliar, excedente ok, ok).
"""
import io
import re
from datetime import datetime, timedelta

from flask import Blueprint, render_template, request, send_file, url_for
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from .core import perm
from .models import (Camara, Carga, CargaItem, Empresa, Endereco, Movimentacao, NotaFiscal, Palete, PaleteItem,
                     Produto, agora, db)
from .paletes import CLASSIFICACOES_RETORNO, NO_ARMAZEM, resumo_itens

bp = Blueprint('estoque', __name__, url_prefix='/estoque')

POR_PAGINA = 100
POR_PAGINA_ANALISE = 15          # como no Light
TIPOS_MOVIMENTO = ['Entrada', 'Guarda', 'Transferência', 'Stage', 'Saída', 'Retorno', 'Baixa', 'Inventário']
CATEGORIAS = ['Congelado', 'Resfriado', 'Seco']


# ---------------------------------------------------------------- apoio

def _hoje():
    return agora().date()


def _br(data):
    return data.strftime('%d/%m/%Y') if data else None


def _data_do_filtro(texto):
    try:
        return datetime.strptime((texto or '').strip(), '%Y-%m-%d')
    except ValueError:
        return None


def _excel(nome, abas):
    """Planilha para baixar. abas = [(titulo, colunas, linhas, larguras)]."""
    livro = Workbook()
    for indice, (titulo, colunas, linhas, larguras) in enumerate(abas):
        aba = livro.active if indice == 0 else livro.create_sheet()
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


def _pagina():
    return max(request.args.get('pagina', 1, type=int), 1)


def _paginas(total):
    return max((total + POR_PAGINA - 1) // POR_PAGINA, 1)


# ---------------------------------------------------------------- estoque atual

SITUACOES = [('armazem', 'No armazém (guardado + stage)'), ('Armazenado', 'Guardado no endereço'), ('Stage', 'No stage'),
             ('Aguardando guarda', 'Aguardando guarda'), ('todos', 'Tudo')]


def _consulta_estoque():
    """Itens de palete que estao no CD, ja com os filtros da tela. Devolve (consulta, filtros)."""
    f = {'q': (request.args.get('q') or '').strip(), 'camara': request.args.get('camara', type=int),
         'classificacao': request.args.get('classificacao') or '', 'situacao': request.args.get('situacao') or 'armazem',
         'empresa': request.args.get('empresa', type=int), 'visao': request.args.get('visao') or 'detalhe'}
    consulta = (db.session.query(PaleteItem, Palete, Produto, Endereco, Camara, NotaFiscal).select_from(PaleteItem)
                .join(Palete, PaleteItem.palete_id == Palete.id)
                .join(Produto, PaleteItem.produto_id == Produto.id)
                .outerjoin(Endereco, Palete.endereco_id == Endereco.id)
                .outerjoin(Camara, Endereco.camara_id == Camara.id)
                .outerjoin(NotaFiscal, Palete.nota_id == NotaFiscal.id)
                .filter(PaleteItem.quantidade > 0))
    if f['situacao'] in ('Armazenado', 'Stage', 'Aguardando guarda'):
        consulta = consulta.filter(Palete.status == f['situacao'])
    elif f['situacao'] == 'todos':
        consulta = consulta.filter(Palete.status.in_(NO_ARMAZEM + ('Aguardando guarda',)))
    else:
        f['situacao'] = 'armazem'
        consulta = consulta.filter(Palete.status.in_(NO_ARMAZEM))
    if f['camara']:
        consulta = consulta.filter(Endereco.camara_id == f['camara'])
    if f['classificacao'] in CLASSIFICACOES_RETORNO:
        consulta = consulta.filter(Palete.classificacao == f['classificacao'])
    if f['empresa']:
        consulta = consulta.filter(NotaFiscal.empresa_id == f['empresa'])
    if f['q']:
        like = f'%{f["q"].upper()}%'
        consulta = consulta.filter(db.or_(db.func.upper(Produto.sku).like(like), db.func.upper(Produto.descricao).like(like),
                                          Produto.ean.like(like), Produto.dun.like(like),
                                          db.func.upper(PaleteItem.lote).like(like), Palete.etiqueta.like(like),
                                          Endereco.codigo.like(like), NotaFiscal.numero.like(like)))
    return consulta, f


def _linha_estoque(conteudo, palete, produto, endereco, camara, nota):
    hoje = _hoje()
    return {'conteudo': conteudo, 'palete': palete, 'produto': produto, 'endereco': endereco, 'camara': camara, 'nota': nota,
            'dias': (conteudo.validade - hoje).days if conteudo.validade else None}


@bp.route('/atual')
@perm('estoque')
def atual():
    consulta, f = _consulta_estoque()
    ordem = (Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel, Produto.sku, PaleteItem.id)
    xlsx = request.args.get('formato') == 'xlsx'
    totais = consulta.with_entities(db.func.count(db.distinct(Palete.id)), db.func.count(db.distinct(Produto.id)),
                                    db.func.coalesce(db.func.sum(PaleteItem.quantidade), 0),
                                    db.func.count(db.distinct(Palete.endereco_id))).one()
    resumo = {'paletes': totais[0], 'skus': totais[1], 'quantidade': round(totais[2] or 0, 3), 'posicoes': totais[3]}

    if f['visao'] == 'produto':
        # Uma linha por produto: soma de tudo o que o filtro achou.
        grupos = {}
        for conteudo, palete, produto, endereco, camara, nota in consulta.all():
            g = grupos.setdefault(produto.id, {'produto': produto, 'quantidade': 0, 'paletes': set(), 'posicoes': set(),
                                               'lotes': set(), 'validade': None})
            g['quantidade'] += conteudo.quantidade
            g['paletes'].add(palete.id)
            if endereco:
                g['posicoes'].add(endereco.id)
            if conteudo.lote:
                g['lotes'].add(conteudo.lote)
            if conteudo.validade and (g['validade'] is None or conteudo.validade < g['validade']):
                g['validade'] = conteudo.validade
        hoje = _hoje()
        produtos = sorted(grupos.values(), key=lambda g: g['produto'].sku)
        for g in produtos:
            g['quantidade'] = round(g['quantidade'], 3)
            g['dias'] = (g['validade'] - hoje).days if g['validade'] else None
        if xlsx:
            return _excel('estoque_por_produto', [('Estoque por produto',
                          ['SKU', 'Descrição', 'Categoria', 'Unidade', 'Quantidade', 'Paletes', 'Posições', 'Lotes',
                           'Validade mais próxima', 'Dias para vencer'],
                          [[g['produto'].sku, g['produto'].descricao, g['produto'].categoria, g['produto'].unidade, g['quantidade'],
                            len(g['paletes']), len(g['posicoes']), len(g['lotes']), _br(g['validade']), g['dias']] for g in produtos],
                          (14, 44, 12, 9, 12, 9, 10, 8, 20, 16))])
        total, pagina = len(produtos), _pagina()
        linhas = produtos[(pagina - 1) * POR_PAGINA:pagina * POR_PAGINA]
    else:
        f['visao'] = 'detalhe'
        if xlsx:
            linhas = [_linha_estoque(*l) for l in consulta.order_by(*ordem).all()]
            return _excel('estoque_atual', [('Estoque atual',
                          ['Endereço', 'Câmara', 'SKU', 'Descrição', 'Quantidade', 'Unidade', 'Lote', 'Fabricação', 'Validade',
                           'Dias para vencer', 'Classificação', 'Situação', 'NF', 'Dono da mercadoria', 'Palete', 'UP', 'Guardado em'],
                          [[l['endereco'].codigo if l['endereco'] else None, l['camara'].nome if l['camara'] else None,
                            l['produto'].sku, l['produto'].descricao, l['conteudo'].quantidade, l['produto'].unidade,
                            l['conteudo'].lote, _br(l['conteudo'].fabricacao), _br(l['conteudo'].validade), l['dias'],
                            l['palete'].classificacao, l['palete'].status, l['nota'].numero if l['nota'] else None,
                            l['nota'].empresa.nome if l['nota'] and l['nota'].empresa else None, l['palete'].etiqueta, l['palete'].up,
                            l['palete'].armazenado_em.strftime('%d/%m/%Y %H:%M') if l['palete'].armazenado_em else None]
                           for l in linhas],
                          (14, 18, 14, 44, 11, 9, 14, 12, 12, 15, 18, 18, 10, 34, 26, 8, 17))])
        total, pagina = consulta.count(), _pagina()
        linhas = [_linha_estoque(*l) for l in consulta.order_by(*ordem).offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all()]

    donos = (Empresa.query.join(NotaFiscal, NotaFiscal.empresa_id == Empresa.id).join(Palete, Palete.nota_id == NotaFiscal.id)
             .filter(Palete.status.in_(NO_ARMAZEM + ('Aguardando guarda',))).distinct().order_by(Empresa.nome).all())
    return render_template('estoque_atual.html', linhas=linhas, f=f, resumo=resumo, total=total, pagina=pagina,
                           paginas=_paginas(total), situacoes=SITUACOES, classificacoes=CLASSIFICACOES_RETORNO,
                           camaras=Camara.query.order_by(Camara.codigo).all(), donos=donos,
                           filtros={k: v for k, v in f.items() if v and not (k == 'situacao' and v == 'armazem')
                                    and not (k == 'visao' and v == 'detalhe')})


# ---------------------------------------------------------------- historico de movimentacao

@bp.route('/historico')
@perm('estoque')
def historico():
    f = {'tipo': request.args.get('tipo') or '', 'q': (request.args.get('q') or '').strip(),
         'usuario': (request.args.get('usuario') or '').strip(), 'de': request.args.get('de') or '', 'ate': request.args.get('ate') or ''}
    consulta = Movimentacao.query.join(Palete, Movimentacao.palete_id == Palete.id)
    if f['tipo'] in TIPOS_MOVIMENTO:
        consulta = consulta.filter(Movimentacao.tipo == f['tipo'])
    de, ate = _data_do_filtro(f['de']), _data_do_filtro(f['ate'])
    if de:
        consulta = consulta.filter(Movimentacao.criado_em >= de)
    if ate:
        consulta = consulta.filter(Movimentacao.criado_em < ate + timedelta(days=1))
    if f['usuario']:
        consulta = consulta.filter(db.func.lower(Movimentacao.usuario) == f['usuario'].lower())
    if f['q']:
        like = f'%{f["q"].upper()}%'
        do_produto = (db.session.query(PaleteItem.id).join(Produto, PaleteItem.produto_id == Produto.id)
                      .filter(PaleteItem.palete_id == Palete.id,
                              db.or_(db.func.upper(Produto.sku).like(like), db.func.upper(Produto.descricao).like(like),
                                     db.func.upper(PaleteItem.lote).like(like))).exists())
        da_nota = (db.session.query(NotaFiscal.id).filter(NotaFiscal.id == Palete.nota_id, NotaFiscal.numero.like(like)).exists())
        consulta = consulta.filter(db.or_(Palete.etiqueta.like(like), Movimentacao.origem.like(like), Movimentacao.destino.like(like),
                                          db.func.upper(Movimentacao.motivo).like(like), do_produto, da_nota))
    contagem = dict(consulta.with_entities(Movimentacao.tipo, db.func.count(Movimentacao.id)).group_by(Movimentacao.tipo).all())
    ordenada = consulta.order_by(Movimentacao.criado_em.desc(), Movimentacao.id.desc())
    if request.args.get('formato') == 'xlsx':
        return _excel('historico_movimentacao', [('Movimentações',
                      ['Data e hora', 'Tipo', 'Palete', 'Conteúdo', 'NF', 'De', 'Para', 'Motivo', 'Observação', 'Usuário'],
                      [[m.criado_em.strftime('%d/%m/%Y %H:%M'), m.tipo, m.palete.etiqueta, resumo_itens(m.palete),
                        m.palete.nota.numero if m.palete.nota else None, m.origem, m.destino, m.motivo, m.observacao, m.usuario]
                       for m in ordenada.limit(20000).all()],
                      (17, 14, 26, 50, 10, 14, 14, 40, 40, 16))])
    total, pagina = consulta.count(), _pagina()
    usuarios = [u for (u,) in db.session.query(Movimentacao.usuario).distinct().order_by(Movimentacao.usuario)]
    return render_template('estoque_historico.html', movimentos=ordenada.offset((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).all(),
                           f=f, tipos=TIPOS_MOVIMENTO, contagem=contagem, total=total, pagina=pagina, paginas=_paginas(total),
                           usuarios=usuarios, resumo_itens=resumo_itens, filtros={k: v for k, v in f.items() if v})


# ---------------------------------------------------------------- historico por nota fiscal

def _eventos_da_nf(numero):
    """Tudo o que aconteceu com a NF, em ordem: entrada, paletes, movimentacoes, cargas de saida e retornos."""
    notas = NotaFiscal.query.filter_by(numero=numero).order_by(NotaFiscal.criado_em).all()
    saidas = (CargaItem.query.join(Carga).filter(CargaItem.nf_numero == numero).order_by(Carga.criado_em, CargaItem.id).all())
    eventos = []

    def evento(quando, tipo, texto, usuario=None, link=None):
        if quando:
            eventos.append({'quando': quando, 'tipo': tipo, 'texto': texto, 'usuario': usuario, 'link': link})

    for nota in notas:
        rotulo = 'Retorno' if nota.tipo == 'Retorno' else 'Entrada'
        link = url_for('entrada.nota', nid=nota.id)
        evento(nota.criado_em, rotulo, f'{rotulo} aberto(a) por {nota.origem}' + (f' — {nota.motivo_retorno}' if nota.motivo_retorno else '')
               + (f' (carga {nota.carga.codigo})' if nota.carga else '') + f' · {len(nota.itens)} item(ns)', nota.criado_por, link)
        if nota.finalizado_em:
            evento(nota.finalizado_em, rotulo, ('Cancelado(a): ' + (nota.motivo_cancelamento or '')) if nota.status == 'Cancelada'
                   else f'{rotulo} finalizado(a) · {len(nota.paletes)} palete(s)', None, link)
        for palete in nota.paletes:
            for m in palete.movimentacoes:
                caminho = ' → '.join(p for p in (m.origem, m.destino) if p)
                evento(m.criado_em, m.tipo, f'Palete {palete.etiqueta} ({resumo_itens(palete)})' + (f' · {caminho}' if caminho else '')
                       + (f' · {m.motivo}' if m.motivo else ''), m.usuario, url_for('movimentacao.paletes', q=palete.etiqueta))
    for carga in {i.carga_id: i.carga for i in saidas}.values():
        dela = [i for i in saidas if i.carga_id == carga.id]
        link = url_for('saida.carga', cid=carga.id)
        evento(carga.criado_em, 'Saída', f'NF incluída na carga {carga.codigo} · {len(dela)} item(ns)', carga.criado_por, link)
        if carga.status == 'Expedida':
            evento(carga.fim_conferencia, 'Saída', f'Carga {carga.codigo} expedida · conferido '
                   + ', '.join(f'{i.produto.sku} {i.conferido:g}/{i.quantidade:g}' for i in dela)
                   + (f' · placa {carga.placa}' if carga.placa else ''), carga.conferente, link)
        elif carga.status == 'Cancelada':
            evento(carga.criado_em, 'Saída', f'Carga {carga.codigo} cancelada', None, link)
    eventos.sort(key=lambda e: e['quando'])
    return notas, saidas, eventos


@bp.route('/historico-nf')
@perm('estoque')
def historico_nf():
    numero = (request.args.get('nf') or '').strip()
    if numero:
        notas, saidas, eventos = _eventos_da_nf(numero)
        if request.args.get('formato') == 'xlsx' and eventos:
            return _excel(f'historico_NF_{numero}', [(f'NF {numero}', ['Data e hora', 'Tipo', 'O que aconteceu', 'Usuário'],
                          [[e['quando'].strftime('%d/%m/%Y %H:%M'), e['tipo'], e['texto'], e['usuario']] for e in eventos],
                          (17, 14, 110, 16))])
        cargas = list({i.carga_id: i.carga for i in saidas}.values())
        return render_template('estoque_historico_nf.html', numero=numero, notas=notas, saidas=saidas, cargas=cargas,
                               eventos=eventos, recentes=None, resumo_itens=resumo_itens)
    # Sem busca: as notas mais recentes (entrada, retorno e saida) para escolher.
    recentes = [{'numero': n.numero, 'tipo': n.tipo, 'quem': n.empresa.nome if n.empresa else None, 'situacao': n.status,
                 'quando': n.criado_em} for n in NotaFiscal.query.order_by(NotaFiscal.criado_em.desc()).limit(100)]
    vistas = set()
    for item in CargaItem.query.join(Carga).filter(CargaItem.nf_numero.isnot(None)).order_by(Carga.criado_em.desc()).limit(400):
        if (item.nf_numero, item.carga_id) in vistas:
            continue
        vistas.add((item.nf_numero, item.carga_id))
        recentes.append({'numero': item.nf_numero, 'tipo': 'Saída', 'quem': item.cliente, 'situacao': item.carga.status,
                         'quando': item.carga.criado_em, 'carga': item.carga.codigo})
    recentes.sort(key=lambda r: r['quando'], reverse=True)
    return render_template('estoque_historico_nf.html', numero='', recentes=recentes[:150], notas=[], saidas=[], cargas=[],
                           eventos=[], resumo_itens=resumo_itens)


# ---------------------------------------------------------------- analise: seguranca, shelf life, visao cruzada

STATUS_SEGURANCA = ['Excedido', 'Verde', 'Amarelo', 'Vermelho', 'Analisar']
STATUS_SHELF = ['Verde', 'Amarelo', 'Laranja', 'Vermelho', 'Sem dado']
# Faixas do semaforo do shelf life (legenda do Light).
FAIXAS_SHELF = [('Verde', '0% a 33,33%', 'Longe do vencimento'), ('Amarelo', '33,34% a 60,01%', 'Vencendo em breve'),
                ('Laranja', '60,02% a 80,01%', 'Atenção na validade'), ('Vermelho', 'acima de 80,01%', 'Vencimento crítico')]
# Prioridades da visao cruzada, na ordem da lista, com os textos de acao do Light.
PRIORIDADES = [('critico', 'Crítico', 'Crítico: pouco estoque e validade curta — conferir lote, FIFO; evitar pedido grande de lote novo.'),
               ('desperdicio', 'Desperdício', 'Desperdício: muito estoque e validade curta — não produzir; priorizar consumo do que vence.'),
               ('produzir', 'Produzir', 'Produzir / reabastecer — estoque baixo com shelf ainda aceitável.'),
               ('validade', 'Validade', 'Priorizar giro — estoque ok, mas shelf em atenção ou crítico.'),
               ('avaliar', 'Avaliar', 'Avaliar manualmente — semáforo Amarelo no estoque de segurança.'),
               ('excedente_ok', 'Excedente OK', 'Não produzir — excedente com data boa; não piorar estoque.'),
               ('sem_shelf', 'Sem shelf', 'Sem shelf — conferir a validade e a fabricação nos lotes ou o shelf no cadastro do produto.'),
               ('ok', 'Ok', 'Ok — estoque e validade dentro das faixas usuais.')]
CARTOES_CRUZADA = ['critico', 'desperdicio', 'produzir', 'validade', 'avaliar', 'excedente_ok']     # os cartoes do Light
ROTULO_PRIORIDADE = {chave: rotulo for chave, rotulo, _ in PRIORIDADES}
ACAO_PRIORIDADE = {chave: acao for chave, _, acao in PRIORIDADES}
ABAS_ANALISE = [('seguranca', 'Estoque de segurança', 'shield-halved'), ('shelf', 'Relação shelf life', 'hourglass-half'),
                ('cruzada', 'Visão cruzada', 'table-cells-large'), ('lotes', 'Estoque × Shelf life', 'layer-group')]


def _disponivel():
    """Itens que contam como estoque disponivel: guardados, classificacao Bom e endereco nao bloqueado (como no Pro)."""
    return (db.session.query(PaleteItem, Palete, Produto, Endereco).select_from(PaleteItem)
            .join(Palete, PaleteItem.palete_id == Palete.id).join(Produto, PaleteItem.produto_id == Produto.id)
            .join(Endereco, Palete.endereco_id == Endereco.id)
            .filter(Palete.status == 'Armazenado', Palete.classificacao == 'Bom', Endereco.bloqueado.is_(False),
                    PaleteItem.quantidade > 0))


def status_seguranca(quantidade, minimo, ideal, maximo):
    if not (minimo or ideal or maximo):
        return 'Analisar'           # sem meta no cadastro: decisao manual
    if maximo and quantidade > maximo:
        return 'Excedido'
    if minimo and quantidade < minimo:
        return 'Vermelho'
    if ideal and quantidade < ideal:
        return 'Amarelo'
    return 'Verde'


def status_shelf(pct):
    """Semaforo pela % da vida util ja consumida (quanto maior, mais perto do vencimento)."""
    if pct is None:
        return 'Sem dado'
    return 'Verde' if pct <= 33.33 else 'Amarelo' if pct <= 60.01 else 'Laranja' if pct <= 80.01 else 'Vermelho'


def _shelf(fabricacao, validade, shelf_do_produto):
    """Devolve dict(shelf, dias, vida, pct) do lote.

    shelf = vida total em dias: do proprio lote (validade - fabricacao) quando ha as duas datas; senao o do cadastro.
    dias = dias para vencer (negativo = vencido); vida = dias ja vividos; pct = vida / shelf (pode passar de 100).
    """
    hoje = _hoje()
    dias = (validade - hoje).days if validade else None
    shelf = (validade - fabricacao).days if fabricacao and validade and validade > fabricacao else (shelf_do_produto or None)
    if fabricacao:
        vida = (hoje - fabricacao).days
    elif shelf and dias is not None:
        vida = shelf - dias
    else:
        vida = None
    pct = round(100.0 * vida / shelf, 2) if shelf and vida is not None else None
    return {'shelf': shelf, 'dias': dias, 'vida': vida, 'pct': pct}


def _consumo():
    """produto_id -> saida dos ultimos 30 dias (cargas expedidas): media por dia, maior dia e media dos ultimos 5 dias."""
    hoje = _hoje()
    inicio = datetime.combine(hoje - timedelta(days=29), datetime.min.time())
    por_dia = {}
    linhas = (db.session.query(CargaItem.produto_id, Carga.fim_conferencia, CargaItem.conferido)
              .join(Carga, CargaItem.carga_id == Carga.id)
              .filter(Carga.status == 'Expedida', Carga.fim_conferencia >= inicio, CargaItem.conferido > 0))
    for produto_id, quando, quantidade in linhas:
        dias = por_dia.setdefault(produto_id, {})
        dias[quando.date()] = dias.get(quando.date(), 0) + quantidade
    consumo = {}
    for produto_id, dias in por_dia.items():
        ultimos5 = sum(q for dia, q in dias.items() if (hoje - dia).days < 5)
        consumo[produto_id] = {'media30': round(sum(dias.values()) / 30.0, 2), 'max30': round(max(dias.values()), 3),
                               'media5': round(ultimos5 / 5.0, 2)}
    return consumo


def confiabilidade(estoque, media5, media30, status, cobertura):
    """'Confiável' ou 'Conferir' — as travas do Light contra decidir em cima de saldo ou giro suspeito."""
    eps = 1e-6
    if estoque <= eps and status in ('Verde', 'Amarelo'):
        return 'Conferir'
    if media5 <= eps and estoque > eps:
        return 'Conferir'
    if media5 > eps and media30 > eps and not 0.22 <= media5 / media30 <= 4.5:
        return 'Conferir'
    if status == 'Excedido' and media5 > eps and cobertura >= 80:
        return 'Conferir'
    return 'Confiável'


def decisao(status, confianca):
    """Texto da coluna "Confiabilidade (decisao)". Verde e testado antes da trava, como no Light."""
    if status == 'Verde':
        return 'Verde + confiável → NÃO PRODUZ'
    if confianca == 'Conferir':
        return 'Não confiável — bloqueia decisão automática (conferir estoque e consumo antes de produzir ou liberar pedido).'
    return {'Vermelho': 'Vermelho + confiável → PRODUZ', 'Amarelo': 'Amarelo + confiável → AVALIA',
            'Excedido': 'Excedido + confiável → NÃO PRODUZ (priorizar consumo do excedente)'}.get(
                status, 'Analisar + confiável → AVALIA (decisão manual; não automatizar)')


def dados_seguranca(categoria=None):
    """Uma linha por produto ativo que tem meta cadastrada ou estoque disponivel."""
    saldo = {}
    for conteudo, palete, produto, endereco in _disponivel().all():
        s = saldo.setdefault(produto.id, {'quantidade': 0, 'posicoes': set()})
        s['quantidade'] += conteudo.quantidade
        s['posicoes'].add(endereco.id)
    produtos = Produto.query.filter_by(ativo=True)
    if categoria:
        produtos = produtos.filter(Produto.categoria == categoria)
    consumo = _consumo()
    linhas = []
    for p in produtos.order_by(Produto.sku):
        s = saldo.get(p.id)
        if not s and not (p.estoque_seguranca or p.estoque_ideal or p.estoque_maximo):
            continue
        quantidade = round(s['quantidade'], 3) if s else 0
        referencia = p.estoque_ideal or p.estoque_maximo or p.estoque_seguranca
        giro = consumo.get(p.id, {'media30': 0, 'max30': 0, 'media5': 0})
        status = status_seguranca(quantidade, p.estoque_seguranca, p.estoque_ideal, p.estoque_maximo)
        # Dias de cobertura: estoque atual / media dos ultimos 5 dias (0 quando nao houve saida).
        cobertura = round(quantidade / giro['media5'], 2) if giro['media5'] > 0 else 0
        confianca = confiabilidade(quantidade, giro['media5'], giro['media30'], status, cobertura)
        linhas.append({'produto': p, 'quantidade': quantidade, 'posicoes': len(s['posicoes']) if s else 0, 'status': status,
                       'ideal_max': p.estoque_maximo, 'ideal_med': p.estoque_ideal, 'ideal_min': p.estoque_seguranca,
                       'pct': round(100.0 * quantidade / referencia) if referencia else None, **giro, 'cobertura': cobertura,
                       'confianca': confianca, 'decisao': decisao(status, confianca),
                       'conferir': confianca == 'Conferir' and status != 'Verde'})
    return linhas


def dados_shelf(categoria=None):
    """Uma linha por produto em estoque, pelo lote que vence primeiro."""
    grupos = {}
    for conteudo, palete, produto, endereco in _disponivel().all():
        if categoria and produto.categoria != categoria:
            continue
        g = grupos.setdefault(produto.id, {'produto': produto, 'quantidade': 0, 'validade': None, 'lote': None, 'fabricacao': None})
        g['quantidade'] += conteudo.quantidade
        if conteudo.validade and (g['validade'] is None or conteudo.validade < g['validade']):
            g['validade'], g['lote'], g['fabricacao'] = conteudo.validade, conteudo.lote, conteudo.fabricacao
    linhas = []
    for g in grupos.values():
        g['quantidade'] = round(g['quantidade'], 3)
        g.update(_shelf(g['fabricacao'], g['validade'], g['produto'].shelf_dias))
        g['status'] = status_shelf(g['pct'])
        linhas.append(g)
    # Como no Light: lista por codigo.
    linhas.sort(key=lambda g: g['produto'].sku)
    return linhas


def _prioridade(seguranca, shelf):
    ruim = shelf in ('Laranja', 'Vermelho')
    if shelf == 'Sem dado':
        return 'sem_shelf'
    if seguranca == 'Vermelho' and ruim:
        return 'critico'
    if seguranca == 'Excedido' and ruim:
        return 'desperdicio'
    if seguranca == 'Vermelho':
        return 'produzir'
    if seguranca == 'Excedido' and shelf == 'Verde':
        return 'excedente_ok'
    if seguranca in ('Verde', 'Analisar') and ruim:
        return 'validade'
    if seguranca == 'Amarelo':
        return 'avaliar'
    return 'ok'


NIVEL_ESTOQUE = {'Excedido': 'muito', 'Vermelho': 'pouco', 'Verde': 'ok', 'Amarelo': 'ok', 'Analisar': 'ok'}
NIVEL_SHELF = {'Verde': 'boa', 'Amarelo': 'atencao', 'Laranja': 'ruim', 'Vermelho': 'ruim'}


def dados_cruzada(categoria=None):
    shelf = {g['produto'].id: g for g in dados_shelf(categoria)}
    linhas = []
    for s in dados_seguranca(categoria):
        g = shelf.get(s['produto'].id)
        status_do_shelf = g['status'] if g else 'Sem dado'
        prioridade = _prioridade(s['status'], status_do_shelf)
        linhas.append({'produto': s['produto'], 'quantidade': s['quantidade'], 'seguranca': s['status'], 'shelf': status_do_shelf,
                       'pct': g['pct'] if g else None, 'dias': g['dias'] if g else None, 'validade': g['validade'] if g else None,
                       'prioridade': prioridade, 'rotulo': ROTULO_PRIORIDADE[prioridade], 'acao': ACAO_PRIORIDADE[prioridade],
                       'nivel_estoque': NIVEL_ESTOQUE[s['status']], 'nivel_shelf': NIVEL_SHELF.get(status_do_shelf, 'sem'),
                       'celula': (NIVEL_ESTOQUE[s['status']] + '-' + NIVEL_SHELF[status_do_shelf]) if status_do_shelf in NIVEL_SHELF else None})
    ordem = [chave for chave, _, _ in PRIORIDADES]
    linhas.sort(key=lambda l: (ordem.index(l['prioridade']), l['produto'].sku))
    return linhas


def dados_lotes(categoria=None):
    """Estoque x shelf life: uma linha por produto + lote + validade, com onde esta. O que vence primeiro em cima (FEFO)."""
    grupos = {}
    for conteudo, palete, produto, endereco in _disponivel().all():
        if categoria and produto.categoria != categoria:
            continue
        g = grupos.setdefault((produto.id, conteudo.lote, conteudo.validade),
                              {'produto': produto, 'lote': conteudo.lote, 'validade': conteudo.validade,
                               'fabricacao': conteudo.fabricacao, 'quantidade': 0, 'paletes': set(), 'enderecos': set()})
        g['quantidade'] += conteudo.quantidade
        g['paletes'].add(palete.id)
        g['enderecos'].add(endereco.codigo)
    linhas = []
    for g in grupos.values():
        g['quantidade'] = round(g['quantidade'], 3)
        g.update(_shelf(g['fabricacao'], g['validade'], g['produto'].shelf_dias))
        g['status'] = status_shelf(g['pct'])
        g['enderecos'] = sorted(g['enderecos'])
        linhas.append(g)
    linhas.sort(key=lambda g: (g['validade'] is None, g['validade'] or _hoje(), g['produto'].sku))
    return linhas


COR_STATUS = {'Excedido': '#7c3aed', 'Verde': '#16a34a', 'Amarelo': '#ca8a04', 'Laranja': '#ea580c', 'Vermelho': '#dc2626',
              'Analisar': '#db2777', 'Sem dado': '#64748b'}
MAX_ITENS_GRAFICO = 150


def _graficos(aba, linhas, todas, ordem, base, busca, filtro):
    """Os graficos do Light para as sub-abas Estoque de seguranca e Shelf life.

    linhas = o recorte que a tabela mostra (todas as paginas); todas = antes do filtro de status (para o semaforo).
    Clicar num item filtra a tela pelo codigo; clicar num status filtra pelo status; clicar no que ja esta ativo limpa.
    """
    def url(**extra):
        return url_for('estoque.analise', **{**base, **extra})

    sem_busca = {k: v for k, v in base.items() if k != 'q'}
    itens = linhas[:MAX_ITENS_GRAFICO]

    def por_item(titulo, ajuda, series, sufixo='', pontos=None, ordenados=None):
        dados = ordenados if ordenados is not None else itens
        chaves = [l['produto'].sku for l in dados]
        return {'tipo': 'linhas', 'titulo': titulo, 'ajuda': ajuda, 'sufixo': sufixo, 'rotulos': chaves, 'chaves': chaves,
                'descricoes': [l['produto'].descricao for l in dados], 'ativo': busca.upper() if busca.upper() in chaves else None,
                'pontos': [COR_STATUS[l['status']] for l in dados] if pontos else None,
                'series': [{'nome': nome, 'cor': f'--serie-{n}', 'valores': [l.get(campo) or 0 for l in dados]}
                           for n, (nome, campo) in enumerate(series, start=1)],
                'links': [url_for('estoque.analise', **sem_busca, **({'status': filtro} if filtro else {}))
                          if busca.upper() == chave.upper() else url_for('estoque.analise', **{**sem_busca, 'q': chave},
                                                                         **({'status': filtro} if filtro else {}))
                          for chave in chaves]}

    contagem = _contar(todas, 'status', ordem)
    semaforo = {'tipo': 'colunas', 'titulo': 'Semáforo — quantidade por status', 'sufixo': '', 'rotulos': ordem, 'chaves': ordem,
                'ajuda': 'Altura = quantos itens em cada status. Clique num status para filtrar a lista e os demais gráficos.',
                'ativo': filtro if filtro in ordem else None, 'pontos': [COR_STATUS[s] for s in ordem],
                'series': [{'nome': 'Quantidade de itens', 'cor': '--serie-1', 'valores': [contagem[s] for s in ordem]}],
                'links': [url() if filtro == s else url(status=s) for s in ordem]}
    if aba == 'seguranca':
        return [por_item('Saída média e máxima (30 dias) e média dos últimos 5 dias',
                         'Cada ponto no eixo de baixo é um produto. Mostra se o consumo recente (5 dias) acompanha ou foge do padrão do mês.',
                         [('Saída média por dia (30 d)', 'media30'), ('Maior saída num dia (30 d)', 'max30'), ('Média dos últimos 5 dias', 'media5')]),
                por_item('Comparativo de estoque ideal', 'Os três patamares do cadastro do produto: máximo, médio (ideal) e mínimo (segurança).',
                         [('Estoque ideal máximo', 'ideal_max'), ('Estoque ideal médio', 'ideal_med'), ('Estoque ideal mínimo', 'ideal_min')]),
                por_item('Dias de estoque (estoque atual ÷ média dos últimos 5 dias)',
                         'Por quantos dias o estoque cobre o ritmo recente de saída. Fica em zero quando não houve saída nos últimos 5 dias.',
                         [('Dias de estoque', 'cobertura')], sufixo=' d'),
                por_item('Estoque atual', 'Quantidade disponível por produto: guardada, classificada como Bom e em endereço não bloqueado.',
                         [('Estoque atual', 'quantidade')]),
                semaforo]
    # Shelf life: os graficos por produto vem do maior % consumido para o menor (sem dado no fim).
    por_pct = sorted(itens, key=lambda l: -(l['pct'] if l['pct'] is not None else -1))
    return [semaforo,
            por_item('Shelf life % por produto', 'Do maior % consumido para o menor. A cor do ponto é o status (verde → vermelho).',
                     [('Shelf life %', 'pct')], sufixo='%', pontos=True, ordenados=por_pct),
            por_item('Dias para vencer e dias de vida', 'Por produto: dias que faltam até o vencimento e dias já vividos desde a fabricação.',
                     [('Dias para vencer', 'dias'), ('Dias de vida', 'vida')], sufixo=' d', ordenados=por_pct),
            por_item('Quantidade em estoque', 'Quantidade disponível de cada produto (mesmo recorte dos filtros).',
                     [('Quantidade', 'quantidade')], ordenados=por_pct)]


def _contar(linhas, campo, chaves):
    contagem = {chave: 0 for chave in chaves}
    for linha in linhas:
        contagem[linha[campo]] = contagem.get(linha[campo], 0) + 1
    return contagem


def _base_da_analise(aba, categoria, busca):
    base = {'aba': aba}
    if categoria:
        base['categoria'] = categoria
    if busca:
        base['q'] = busca
    return base


@bp.route('/analise')
@perm('estoque')
def analise():
    aba = request.args.get('aba')
    if aba not in [a for a, _, _ in ABAS_ANALISE]:
        aba = 'seguranca'
    categoria = request.args.get('categoria') if request.args.get('categoria') in CATEGORIAS else ''
    busca = (request.args.get('q') or '').strip()
    filtro = request.args.get('status') or ''
    celula = request.args.get('celula') or ''
    xlsx = request.args.get('formato') == 'xlsx'

    def com_busca(linhas):
        if not busca:
            return linhas
        termo = busca.upper()
        return [l for l in linhas if termo in l['produto'].sku.upper() or termo in l['produto'].descricao.upper()
                or termo in (l.get('lote') or '').upper()]

    contexto = {'aba': aba, 'abas': ABAS_ANALISE, 'categoria': categoria, 'categorias': CATEGORIAS, 'busca': busca,
                'filtro': filtro, 'celula': celula, 'hoje': _hoje(), 'faixas_shelf': FAIXAS_SHELF}
    if aba == 'seguranca':
        todas = com_busca(dados_seguranca(categoria))
        if filtro == 'alerta':          # sininho: Amarelo + Vermelho
            linhas = [l for l in todas if l['status'] in ('Amarelo', 'Vermelho')]
        else:
            linhas = [l for l in todas if l['status'] == filtro] if filtro in STATUS_SEGURANCA else todas
        if xlsx:
            return _excel('estoque-seguranca-lista', [('Lista',
                          ['SKU', 'Descrição', 'Categoria', 'Unidade', 'Saída média/dia (30 d)', 'Maior saída num dia (30 d)',
                           'Média últ. 5 dias', 'Estoque ideal máximo', 'Estoque ideal médio', 'Estoque ideal mínimo',
                           'Dias de estoque (atual ÷ média 5 d)', 'Estoque atual', 'Posição atual', 'Para condicional', 'Confiabilidade'],
                          [[l['produto'].sku, l['produto'].descricao, l['produto'].categoria, l['produto'].unidade, l['media30'], l['max30'],
                            l['media5'], l['produto'].estoque_maximo, l['produto'].estoque_ideal, l['produto'].estoque_seguranca,
                            l['cobertura'], l['quantidade'], l['posicoes'], l['status'], l['decisao']] for l in linhas],
                          (14, 44, 12, 9, 20, 24, 17, 20, 19, 20, 32, 14, 13, 16, 70))])
        contexto.update(contagem=_contar(todas, 'status', STATUS_SEGURANCA), ordem=STATUS_SEGURANCA,
                        alertas=sum(1 for l in todas if l['status'] in ('Amarelo', 'Vermelho')),
                        graficos=_graficos(aba, linhas, todas, STATUS_SEGURANCA, _base_da_analise(aba, categoria, busca), busca, filtro))
    elif aba == 'shelf':
        todas = com_busca(dados_shelf(categoria))
        linhas = [l for l in todas if l['status'] == filtro] if filtro in STATUS_SHELF else todas
        if xlsx:
            return _excel('controle-shelf-life', [('Shelf Life',
                          ['Código', 'Descrição', 'Unidade', 'Quantidade', 'Lote que vence primeiro', 'Data fabricação', 'Data vencimento',
                           'Shelf life (dias)', 'Data hoje', 'Dias p/ vencer', 'Dias de vida', 'Shelf life %', 'Status'],
                          [[l['produto'].sku, l['produto'].descricao, l['produto'].unidade, l['quantidade'], l['lote'], _br(l['fabricacao']),
                            _br(l['validade']), l['shelf'], _br(_hoje()), l['dias'], l['vida'], l['pct'], l['status']] for l in linhas],
                          (14, 44, 9, 12, 22, 15, 16, 16, 12, 13, 12, 12, 12))])
        contexto.update(contagem=_contar(todas, 'status', STATUS_SHELF), ordem=STATUS_SHELF,
                        criticos=sum(1 for l in todas if l['status'] in ('Laranja', 'Vermelho')),
                        graficos=_graficos(aba, linhas, todas, STATUS_SHELF, _base_da_analise(aba, categoria, busca), busca, filtro))
    elif aba == 'cruzada':
        todas = com_busca(dados_cruzada(categoria))
        linhas = todas
        if filtro == 'urgentes':
            linhas = [l for l in linhas if l['prioridade'] in ('critico', 'desperdicio')]
        elif filtro in ROTULO_PRIORIDADE:
            linhas = [l for l in linhas if l['prioridade'] == filtro]
        if celula:
            linhas = [l for l in linhas if l['celula'] == celula]
        if xlsx:
            return _excel('visao-cruzada-estoque-shelf', [('Visão cruzada',
                          ['Código', 'Descrição', 'Prioridade', 'Estoque (condicional)', 'Shelf status', 'Shelf %', 'Dias p/ vencer',
                           'Estoque atual', 'Nível estoque', 'Nível shelf', 'Ação sugerida'],
                          [[l['produto'].sku, l['produto'].descricao, l['rotulo'], l['seguranca'], l['shelf'], l['pct'], l['dias'],
                            l['quantidade'], l['nivel_estoque'], l['nivel_shelf'], l['acao']] for l in linhas],
                          (14, 44, 14, 20, 13, 10, 15, 13, 14, 12, 80))])
        matriz = {}
        for l in todas:
            if l['celula']:
                matriz[l['celula']] = matriz.get(l['celula'], 0) + 1
        contexto.update(contagem=_contar(todas, 'prioridade', ROTULO_PRIORIDADE), matriz=matriz,
                        prioridades=[p for p in PRIORIDADES if p[0] in CARTOES_CRUZADA],
                        urgentes=sum(1 for l in todas if l['prioridade'] in ('critico', 'desperdicio')),
                        fora_da_grade=sum(1 for l in todas if not l['celula']))
    else:
        todas = com_busca(dados_lotes(categoria))
        linhas = [l for l in todas if l['status'] == filtro] if filtro in STATUS_SHELF else todas
        if xlsx:
            return _excel('estoque_x_shelf_life', [('Estoque x Shelf life',
                          ['SKU', 'Descrição', 'Lote', 'Fabricação', 'Validade', 'Shelf (dias)', 'Dias para vencer', 'Dias de vida', 'Shelf %',
                           'Status', 'Quantidade', 'Unidade', 'Paletes', 'Endereços'],
                          [[l['produto'].sku, l['produto'].descricao, l['lote'], _br(l['fabricacao']), _br(l['validade']), l['shelf'], l['dias'],
                            l['vida'], l['pct'], l['status'], l['quantidade'], l['produto'].unidade, len(l['paletes']),
                            ', '.join(l['enderecos'])] for l in linhas], (14, 44, 14, 12, 12, 12, 15, 12, 10, 12, 12, 9, 9, 60))])
        contexto.update(contagem=_contar(todas, 'status', STATUS_SHELF), ordem=STATUS_SHELF)
    total, pagina = len(linhas), _pagina()
    return render_template('estoque_analise.html', total=total, total_geral=len(todas), pagina=pagina,
                           linhas=linhas[(pagina - 1) * POR_PAGINA_ANALISE:pagina * POR_PAGINA_ANALISE],
                           paginas=max((total + POR_PAGINA_ANALISE - 1) // POR_PAGINA_ANALISE, 1), **contexto)
