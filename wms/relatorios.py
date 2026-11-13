"""Dashboard do estoque e relatorios (todos com Excel).

O dashboard junta num so lugar o que as outras telas calculam: ocupacao das camaras, classificacoes (reentrega,
avaria, descarte / perdas, palete bloqueado), alertas do estoque de seguranca e do shelf life, temperatura e o
movimento dos ultimos dias. Os relatorios sao listas prontas com filtro de periodo e de camara.
"""
from datetime import datetime, timedelta

from flask import Blueprint, abort, render_template, request, url_for

from .core import perm, pode_ver
from .enderecamento import paletes_por_endereco, resumo_camaras
from .entrada import conferido_por_item
from .estoque import _br, _excel, dados_lotes, dados_seguranca, dados_shelf
from .models import (Camara, Carga, CargaItem, Endereco, Inventario, InventarioLinha, Movimentacao, NotaFiscal, Palete,
                     PaleteItem, Produto, TemperaturaCamara, Usuario, agora, db)
from .paletes import NO_ARMAZEM, resumo_itens

bp = Blueprint('relatorios', __name__)

CLASSIFICACOES_DESTAQUE = [('Reentrega', 'rotate', 'Voltou da rua e espera sair de novo'), ('Avaria', 'box-open', 'Mercadoria danificada'),
                           ('Descarte / Perdas', 'trash-can', 'Separado para descarte'), ('Palete bloqueado', 'lock', 'Não pode ser movimentado para venda')]
DIAS_MOVIMENTO = 14


def _hora(valor):
    return valor.strftime('%d/%m/%Y %H:%M') if valor else None


# ---------------------------------------------------------------- dashboard

def dados_dashboard():
    hoje = agora().date()
    camaras = resumo_camaras()
    total = sum(l['total'] for l in camaras)
    ocupadas = sum(l['ocupados'] for l in camaras)
    bloqueadas = sum(l['bloqueados'] for l in camaras)
    # paletes e quantidade por classificacao (so o que esta no armazem)
    por_classe = {classe: {'paletes': paletes, 'quantidade': round(quantidade or 0, 3)} for classe, paletes, quantidade in
                  db.session.query(Palete.classificacao, db.func.count(db.distinct(Palete.id)), db.func.sum(PaleteItem.quantidade))
                  .join(PaleteItem, PaleteItem.palete_id == Palete.id).filter(Palete.status.in_(NO_ARMAZEM))
                  .group_by(Palete.classificacao)}
    por_status = dict(db.session.query(Palete.status, db.func.count(Palete.id)).group_by(Palete.status).all())
    seguranca, shelf = dados_seguranca(), dados_shelf()
    # temperatura: ultima leitura de cada camara
    fora, sem_leitura = [], 0
    for camara in Camara.query.filter(Camara.ativo.is_(True), Camara.tipo != 'Stage'):
        ultima = (TemperaturaCamara.query.filter_by(camara_id=camara.id)
                  .order_by(TemperaturaCamara.medido_em.desc(), TemperaturaCamara.id.desc()).first())
        if not ultima:
            sem_leitura += 1
        elif ultima.fora:
            fora.append({'camara': camara, 'leitura': ultima})
    # movimento por dia (paletes que entraram, sairam e voltaram)
    inicio = datetime.combine(hoje - timedelta(days=DIAS_MOVIMENTO - 1), datetime.min.time())
    dias = [hoje - timedelta(days=n) for n in range(DIAS_MOVIMENTO - 1, -1, -1)]
    contagem = {tipo: {d: 0 for d in dias} for tipo in ('Entrada', 'Saída', 'Retorno')}
    for tipo, quando in db.session.query(Movimentacao.tipo, Movimentacao.criado_em).filter(
            Movimentacao.criado_em >= inicio, Movimentacao.tipo.in_(tuple(contagem))):
        if quando.date() in contagem[tipo]:
            contagem[tipo][quando.date()] += 1
    vencendo = [l for l in dados_lotes() if l['dias'] is not None][:8]
    return {
        'camaras': camaras, 'total': total, 'ocupadas': ocupadas, 'bloqueadas': bloqueadas,
        'livres': max(total - ocupadas - bloqueadas, 0), 'ocupacao': round(100.0 * ocupadas / total, 1) if total else 0,
        'paletes': sum(por_status.get(s, 0) for s in NO_ARMAZEM), 'aguardando': por_status.get('Aguardando guarda', 0),
        'stage': por_status.get('Stage', 0), 'fora_cd': por_status.get('Fora', 0),
        'classes': [{'nome': nome, 'icone': icone, 'ajuda': ajuda, **por_classe.get(nome, {'paletes': 0, 'quantidade': 0})}
                    for nome, icone, ajuda in CLASSIFICACOES_DESTAQUE],
        'bom': por_classe.get('Bom', {'paletes': 0, 'quantidade': 0}),
        'alertas_seguranca': sum(1 for l in seguranca if l['status'] in ('Amarelo', 'Vermelho')),
        'vermelhos': sum(1 for l in seguranca if l['status'] == 'Vermelho'),
        'shelf_critico': sum(1 for l in shelf if l['status'] in ('Laranja', 'Vermelho')),
        'vencidos': sum(1 for l in shelf if l['dias'] is not None and l['dias'] < 0),
        'temperatura_fora': fora, 'temperatura_sem_leitura': sem_leitura,
        'inventarios_abertos': Inventario.query.filter(Inventario.status != 'Finalizado').count(),
        'retornos_abertos': NotaFiscal.query.filter(NotaFiscal.tipo == 'Retorno', NotaFiscal.status.in_(('Aguardando', 'Em conferência'))).count(),
        'dias': dias, 'movimento': contagem, 'vencendo': vencendo,
    }


@bp.route('/estoque/dashboard')
@perm('estoque')
def dashboard():
    d = dados_dashboard()
    if request.args.get('formato') == 'xlsx':
        return _excel('dashboard_estoque', [
            ('Resumo', ['Indicador', 'Valor'],
             [['Posições', d['total']], ['Posições ocupadas', d['ocupadas']], ['Posições livres', d['livres']], ['Posições bloqueadas', d['bloqueadas']],
              ['Taxa de ocupação (%)', d['ocupacao']], ['Paletes no armazém', d['paletes']], ['Paletes aguardando guarda', d['aguardando']],
              ['Paletes no stage', d['stage']], ['Paletes fora do CD', d['fora_cd']]]
             + [[f'{c["nome"]} — paletes', c['paletes']] for c in d['classes']]
             + [['Estoque de segurança — Amarelo + Vermelho', d['alertas_seguranca']], ['Shelf life — Laranja + Vermelho', d['shelf_critico']],
                ['Câmaras com temperatura fora da faixa', len(d['temperatura_fora'])], ['Inventários abertos', d['inventarios_abertos']],
                ['Retornos em aberto', d['retornos_abertos']]], (44, 14)),
            ('Ocupação por câmara', ['Câmara', 'Nome', 'Tipo', 'Posições', 'Ocupadas', 'Livres', 'Bloqueadas', 'Ocupação (%)'],
             [[l['camara'].codigo, l['camara'].nome, l['camara'].tipo, l['total'], l['ocupados'], l['livres'], l['bloqueados'], l['ocupacao']]
              for l in d['camaras']], (9, 22, 16, 11, 11, 9, 12, 14)),
            ('Classificações', ['Classificação', 'Paletes', 'Quantidade'],
             [['Bom', d['bom']['paletes'], d['bom']['quantidade']]] + [[c['nome'], c['paletes'], c['quantidade']] for c in d['classes']], (22, 10, 14)),
            ('Movimento por dia', ['Dia', 'Entradas (paletes)', 'Saídas (paletes)', 'Retornos (paletes)'],
             [[_br(dia), d['movimento']['Entrada'][dia], d['movimento']['Saída'][dia], d['movimento']['Retorno'][dia]] for dia in d['dias']],
             (12, 19, 17, 19)),
            ('Vencendo primeiro', ['SKU', 'Descrição', 'Lote', 'Validade', 'Dias para vencer', 'Shelf %', 'Status', 'Quantidade', 'Endereços'],
             [[l['produto'].sku, l['produto'].descricao, l['lote'], _br(l['validade']), l['dias'], l['pct'], l['status'], l['quantidade'],
               ', '.join(l['enderecos'])] for l in d['vencendo']], (14, 40, 14, 12, 15, 10, 12, 12, 50))])
    rotulos = [dia.strftime('%d/%m') for dia in d['dias']]
    grafico = {'tipo': 'linhas', 'titulo': f'Movimento dos últimos {DIAS_MOVIMENTO} dias', 'sufixo': '', 'rotulos': rotulos, 'chaves': rotulos,
               'ajuda': 'Paletes por dia: que entraram (recebimento), que saíram (expedição ou saída manual) e que voltaram (retorno).',
               'ativo': None, 'pontos': None, 'links': None,
               'series': [{'nome': nome, 'cor': f'--serie-{n}', 'valores': [d['movimento'][tipo][dia] for dia in d['dias']]}
                          for n, (nome, tipo) in enumerate((('Entradas', 'Entrada'), ('Saídas', 'Saída'), ('Retornos', 'Retorno')), start=1)]}
    return render_template('estoque_dashboard.html', d=d, grafico=grafico)


# ---------------------------------------------------------------- relatorios

def _periodo():
    """(de, ate) como datetime, pelo filtro da tela; padrao: ultimos 30 dias."""
    hoje = agora().date()
    try:
        de = datetime.strptime(request.args.get('de') or '', '%Y-%m-%d')
    except ValueError:
        de = datetime.combine(hoje - timedelta(days=29), datetime.min.time())
    try:
        ate = datetime.strptime(request.args.get('ate') or '', '%Y-%m-%d')
    except ValueError:
        ate = datetime.combine(hoje, datetime.min.time())
    return de, ate


def _camara_do_filtro():
    return db.session.get(Camara, request.args.get('camara', type=int) or 0)


def rel_ocupacao():
    camara = _camara_do_filtro()
    ocupados = paletes_por_endereco(camara.id if camara else None)
    grupos = {}
    consulta = Endereco.query.join(Camara)
    if camara:
        consulta = consulta.filter(Endereco.camara_id == camara.id)
    for e in consulta.order_by(Camara.codigo, Endereco.rua):
        g = grupos.setdefault((e.camara.codigo, e.rua), {'camara': e.camara, 'rua': e.rua, 'total': 0, 'ocupadas': 0, 'bloqueadas': 0, 'picking': 0})
        g['total'] += 1
        g['ocupadas'] += e.id in ocupados
        g['bloqueadas'] += bool(e.bloqueado and e.id not in ocupados)
        g['picking'] += e.tipo == 'Picking'
    linhas = [[f'{g["camara"].codigo:02d}', g['camara'].nome, g['camara'].tipo, g['rua'], g['total'], g['ocupadas'],
               g['total'] - g['ocupadas'] - g['bloqueadas'], g['bloqueadas'], g['picking'],
               round(100.0 * g['ocupadas'] / g['total'], 1) if g['total'] else 0] for g in grupos.values()]
    return (['Câmara', 'Nome', 'Tipo', 'Rua', 'Posições', 'Ocupadas', 'Livres', 'Bloqueadas', 'Picking', 'Ocupação (%)'], linhas,
            (9, 22, 16, 7, 11, 11, 9, 12, 10, 14))


def rel_localizacoes():
    camara = _camara_do_filtro()
    situacao = request.args.get('situacao') or ''
    ocupados = paletes_por_endereco(camara.id if camara else None)
    consulta = Endereco.query.join(Camara)
    if camara:
        consulta = consulta.filter(Endereco.camara_id == camara.id)
    linhas = []
    for e in consulta.order_by(Camara.codigo, Endereco.rua, Endereco.coluna, Endereco.nivel):
        paletes = ocupados.get(e.id, [])
        estado = 'Ocupado' if paletes else 'Bloqueado' if e.bloqueado else 'Livre'
        if situacao and situacao != estado:
            continue
        base = [e.codigo, e.camara.nome, e.rua, e.coluna, e.nivel, e.tipo, e.destino,
                (e.cliente.fantasia or e.cliente.nome) if e.cliente_id else None, estado]
        if not paletes:
            linhas.append(base + [None] * 8)
        for palete in paletes:
            for item in palete.itens or [None]:
                linhas.append(base + [palete.etiqueta, palete.classificacao, item.produto.sku if item else None,
                                      item.produto.descricao if item else None, item.quantidade if item else None,
                                      item.lote if item else None, _br(item.validade) if item else None,
                                      palete.nota.numero if palete.nota else None])
    return (['Endereço', 'Câmara', 'Rua', 'Coluna', 'Nível', 'Tipo', 'Destino', 'Espaço de cliente', 'Situação', 'Palete', 'Classificação',
             'SKU', 'Descrição', 'Quantidade', 'Lote', 'Validade', 'NF'], linhas, (14, 18, 6, 8, 7, 10, 22, 24, 11, 26, 16, 14, 40, 11, 14, 12, 10))


def _notas(tipo):
    de, ate = _periodo()
    linhas = []
    for nota in (NotaFiscal.query.filter(NotaFiscal.tipo == tipo, NotaFiscal.criado_em >= de, NotaFiscal.criado_em < ate + timedelta(days=1))
                 .order_by(NotaFiscal.criado_em)):
        conferido = conferido_por_item(nota)
        for item in nota.itens:
            feito = conferido.get(item.id, 0)
            linhas.append([_hora(nota.criado_em), nota.numero, nota.serie, nota.empresa.nome if nota.empresa else None, nota.origem, nota.status]
                          + ([nota.motivo_retorno, nota.carga.codigo if nota.carga else None] if tipo == 'Retorno' else [])
                          + [item.produto.sku, item.produto.descricao, item.unidade, item.quantidade, feito, round(feito - item.quantidade, 3),
                             item.motivo_divergencia, item.lote, _br(item.validade), len(nota.paletes), _hora(nota.finalizado_em), nota.criado_por])
    colunas = (['Entrada no sistema', 'NF', 'Série', 'Dono da mercadoria' if tipo == 'Retorno' else 'Remetente', 'Origem', 'Situação']
               + (['Motivo do retorno', 'Carga de origem'] if tipo == 'Retorno' else [])
               + ['SKU', 'Descrição', 'Unidade', 'Qtd. da nota', 'Qtd. conferida', 'Diferença', 'Motivo da divergência', 'Lote', 'Validade',
                  'Paletes da nota', 'Finalizado em', 'Usuário'])
    larguras = (17, 10, 7, 34, 10, 15) + ((26, 14) if tipo == 'Retorno' else ()) + (14, 40, 9, 13, 14, 11, 30, 14, 12, 14, 17, 14)
    return colunas, linhas, larguras


def rel_entradas():
    return _notas('Entrada')


def rel_retornos():
    return _notas('Retorno')


def rel_movimentacoes():
    de, ate = _periodo()
    consulta = (Movimentacao.query.filter(Movimentacao.criado_em >= de, Movimentacao.criado_em < ate + timedelta(days=1))
                .order_by(Movimentacao.criado_em, Movimentacao.id))
    linhas = [[_hora(m.criado_em), m.tipo, m.palete.etiqueta, resumo_itens(m.palete), m.palete.nota.numero if m.palete.nota else None,
               m.origem, m.destino, m.motivo, m.observacao, m.usuario] for m in consulta.limit(50000)]
    return (['Data e hora', 'Tipo', 'Palete', 'Conteúdo', 'NF', 'De', 'Para', 'Motivo', 'Observação', 'Usuário'], linhas,
            (17, 14, 26, 50, 10, 14, 14, 40, 40, 16))


def rel_saidas():
    de, ate = _periodo()
    linhas = []
    for carga in (Carga.query.filter(Carga.status == 'Expedida', Carga.fim_conferencia >= de, Carga.fim_conferencia < ate + timedelta(days=1))
                  .order_by(Carga.fim_conferencia)):
        for item in carga.itens:
            linhas.append([_hora(carga.fim_conferencia), carga.codigo, carga.motivo, carga.doca, carga.placa, carga.motorista, carga.conferente,
                           item.nf_numero, item.cliente, item.cidade, item.produto.sku, item.produto.descricao, item.unidade, item.quantidade,
                           item.conferido, round((item.conferido or 0) - item.quantidade, 3), item.motivo_divergencia])
    return (['Saiu em', 'Carga', 'Motivo', 'Doca', 'Placa', 'Motorista', 'Conferente', 'NF', 'Cliente', 'Cidade', 'SKU', 'Descrição', 'Unidade',
             'Qtd. da nota', 'Qtd. carregada', 'Diferença', 'Motivo da divergência'], linhas,
            (17, 12, 14, 7, 10, 22, 22, 10, 34, 18, 14, 40, 9, 13, 14, 11, 34))


def rel_classificacoes():
    """Reentrega, avaria, descarte / perdas e palete bloqueado: o que esta no armazem e nao e estoque Bom."""
    camara = _camara_do_filtro()
    classe = request.args.get('classificacao') or ''
    consulta = (db.session.query(PaleteItem, Palete, Produto, Endereco).select_from(PaleteItem)
                .join(Palete, PaleteItem.palete_id == Palete.id).join(Produto, PaleteItem.produto_id == Produto.id)
                .outerjoin(Endereco, Palete.endereco_id == Endereco.id)
                .filter(Palete.status.in_(NO_ARMAZEM), Palete.classificacao != 'Bom'))
    if camara:
        consulta = consulta.filter(Endereco.camara_id == camara.id)
    if classe:
        consulta = consulta.filter(Palete.classificacao == classe)
    hoje = agora().date()
    linhas = [[palete.classificacao, endereco.codigo if endereco else None, produto.sku, produto.descricao, conteudo.quantidade, produto.unidade,
               conteudo.lote, _br(conteudo.validade), palete.nota.numero if palete.nota else None,
               palete.nota.empresa.nome if palete.nota and palete.nota.empresa else None,
               palete.nota.motivo_retorno if palete.nota else None, palete.etiqueta, _hora(palete.armazenado_em),
               (hoje - palete.armazenado_em.date()).days if palete.armazenado_em else None]
              for conteudo, palete, produto, endereco in consulta.order_by(Palete.classificacao, Endereco.codigo, Produto.sku)]
    return (['Classificação', 'Endereço', 'SKU', 'Descrição', 'Quantidade', 'Unidade', 'Lote', 'Validade', 'NF', 'Dono da mercadoria',
             'Motivo do retorno', 'Palete', 'Guardado em', 'Dias parado'], linhas, (18, 14, 14, 40, 11, 9, 14, 12, 10, 34, 26, 26, 17, 12))


# id -> (titulo, descricao, icone, filtros, funcao). filtros: 'periodo', 'camara', 'situacao', 'classificacao'.
# ---------------------------------------------------------------- produtividade (por pessoa e turno)

TURNOS = ['Manhã', 'Tarde', 'Noite']
COLUNAS_PRODUTIVIDADE = [('conferidos', 'Conferidos'), ('guardados', 'Guardados'), ('movimentados', 'Movimentados'),
                         ('separados', 'Separados'), ('expedidos', 'Expedidos'), ('contagens', 'Contagens')]
_COLUNA_DO_MOVIMENTO = {'Entrada': 'conferidos', 'Retorno': 'conferidos', 'Guarda': 'guardados', 'Transferência': 'movimentados',
                        'Stage': 'separados', 'Saída': 'expedidos'}


def turno_de(momento):
    """Manha 06h-14h, tarde 14h-22h, noite 22h-06h."""
    return 'Manhã' if 6 <= momento.hour < 14 else ('Tarde' if 14 <= momento.hour < 22 else 'Noite')


def dados_produtividade(de, ate, por_turno=True):
    """Linhas {usuario, nome, turno, valores, total} e os totais por coluna, do periodo [de, ate] (datas, contando as duas)."""
    inicio, fim = datetime.combine(de, datetime.min.time()), datetime.combine(ate, datetime.min.time()) + timedelta(days=1)
    contas = {}

    def somar(usuario, momento, coluna):
        chave = (usuario or '—', turno_de(momento) if por_turno else '')
        contas.setdefault(chave, {})
        contas[chave][coluna] = contas[chave].get(coluna, 0) + 1

    for tipo, usuario, momento in (db.session.query(Movimentacao.tipo, Movimentacao.usuario, Movimentacao.criado_em)
                                   .filter(Movimentacao.criado_em >= inicio, Movimentacao.criado_em < fim)):
        if tipo in _COLUNA_DO_MOVIMENTO:
            somar(usuario, momento, _COLUNA_DO_MOVIMENTO[tipo])
    for usuario, momento in (db.session.query(InventarioLinha.contado_por, InventarioLinha.contado_em)
                             .filter(InventarioLinha.contado_em >= inicio, InventarioLinha.contado_em < fim)):
        somar(usuario, momento, 'contagens')
    nomes = dict(db.session.query(Usuario.username, Usuario.nome))
    linhas = [{'usuario': usuario, 'nome': nomes.get(usuario, usuario), 'turno': turno, 'valores': valores, 'total': sum(valores.values())}
              for (usuario, turno), valores in contas.items()]
    linhas.sort(key=lambda l: (l['nome'].lower(), TURNOS.index(l['turno']) if l['turno'] in TURNOS else 0))
    totais = {chave: sum(l['valores'].get(chave, 0) for l in linhas) for chave, _ in COLUNAS_PRODUTIVIDADE}
    return linhas, totais


@bp.route('/relatorios/produtividade')
@perm('relatorios')
def produtividade():
    hoje = agora().date()

    def data(texto, padrao):
        try:
            return datetime.strptime((texto or '').strip(), '%Y-%m-%d').date()
        except ValueError:
            return padrao

    ate = data(request.args.get('ate'), hoje)
    de = data(request.args.get('de'), ate - timedelta(days=6))
    if de > ate:
        de = ate
    ver = 'pessoa' if request.args.get('ver') == 'pessoa' else 'turno'
    linhas, totais = dados_produtividade(de, ate, por_turno=ver == 'turno')
    if request.args.get('formato') == 'xlsx':
        colunas = ['Pessoa', 'Login'] + (['Turno'] if ver == 'turno' else []) + [r for _, r in COLUNAS_PRODUTIVIDADE] + ['Total']
        dados = [[l['nome'], l['usuario']] + ([l['turno']] if ver == 'turno' else [])
                 + [l['valores'].get(chave, 0) for chave, _ in COLUNAS_PRODUTIVIDADE] + [l['total']] for l in linhas]
        return _excel('produtividade', [(f'Produtividade {de.strftime("%d-%m")} a {ate.strftime("%d-%m")}', colunas, dados,
                                         [28, 16] + ([10] if ver == 'turno' else []) + [13] * (len(COLUNAS_PRODUTIVIDADE) + 1))])
    return render_template('relatorio_produtividade.html', linhas=linhas, totais=totais, colunas=COLUNAS_PRODUTIVIDADE, de=de, ate=ate, ver=ver)


RELATORIOS = {
    'ocupacao': ('Ocupação', 'Posições totais, ocupadas, livres e bloqueadas de cada rua de cada câmara.', 'warehouse', ('camara',), rel_ocupacao),
    'localizacoes': ('Localizações', 'Todos os endereços, um por linha, com o que está guardado em cada um.', 'location-dot',
                     ('camara', 'situacao'), rel_localizacoes),
    'entradas': ('Entradas', 'Notas recebidas no período, item a item, com o conferido e as divergências.', 'dolly', ('periodo',), rel_entradas),
    'movimentacoes': ('Movimentações', 'Tudo o que aconteceu com os paletes no período.', 'right-left', ('periodo',), rel_movimentacoes),
    'saidas': ('Saídas', 'Cargas expedidas no período, item a item, com o carregado e as divergências.', 'truck-ramp-box', ('periodo',), rel_saidas),
    'retornos': ('Retornos e reentregas', 'Retornos abertos no período, com o motivo e a carga de origem.', 'rotate-left', ('periodo',), rel_retornos),
    'classificacoes': ('Avaria, descarte / perdas, bloqueado e reentrega', 'Paletes no armazém que não são estoque Bom, com há quantos dias estão parados.',
                       'triangle-exclamation', ('camara', 'classificacao'), rel_classificacoes),
}
PREVIA = 200


@bp.route('/relatorios/')
@perm('relatorios')
def lista():
    # atalhos para relatorios que ja existem em outras telas
    outros = [(nome, texto, icone, url_for(endpoint, **args)) for nome, texto, icone, endpoint, args, modulo in (
        ('Estoque atual', 'Saldo por palete ou por produto.', 'magnifying-glass', 'estoque.atual', {}, 'estoque'),
        ('Análise de estoque', 'Estoque de segurança, shelf life e visão cruzada.', 'chart-simple', 'estoque.analise', {}, 'estoque'),
        ('Inventários e contagens', 'Resultado de cada inventário e consulta das contagens.', 'clipboard-check', 'inventario.lista', {}, 'estoque'),
        ('Temperatura das câmaras', 'Histórico das leituras.', 'temperature-half', 'temperaturas.lista', {}, 'enderecamento'),
        ('Dashboard do estoque', 'Indicadores do dia em uma tela.', 'chart-pie', 'relatorios.dashboard', {}, 'estoque')) if pode_ver(modulo)]
    return render_template('relatorios.html', relatorios=RELATORIOS, outros=outros)


@bp.route('/relatorios/<rid>')
@perm('relatorios')
def relatorio(rid):
    if rid not in RELATORIOS:
        abort(404)
    titulo, descricao, icone, filtros, funcao = RELATORIOS[rid]
    colunas, linhas, larguras = funcao()
    if request.args.get('formato') == 'xlsx':
        return _excel(f'relatorio_{rid}', [(titulo, colunas, linhas, larguras)])
    de, ate = _periodo()
    atuais = {k: v for k, v in request.args.items() if k in ('de', 'ate', 'camara', 'situacao', 'classificacao') and v}
    return render_template('relatorio.html', rid=rid, titulo=titulo, descricao=descricao, icone=icone, filtros=filtros, colunas=colunas,
                           linhas=linhas[:PREVIA], total=len(linhas), previa=PREVIA, de=de.strftime('%Y-%m-%d'), ate=ate.strftime('%Y-%m-%d'),
                           atuais=atuais, camaras=Camara.query.order_by(Camara.codigo).all(), camara=request.args.get('camara', type=int),
                           situacao=request.args.get('situacao') or '', classificacao=request.args.get('classificacao') or '')
