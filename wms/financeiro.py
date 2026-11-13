"""Financeiro: cobranca da armazenagem, na dinamica do WMS Plus.

Cinco partes (sub-abas): Tabela de cobranca, Contrato, Clientes, Movimentacao (controle de permanencia) e Logica de
cobranca. Nao emite fatura nem boleto: calcula o valor de cada nota e gera a planilha detalhada.

O cliente e a empresa emitente da nota de entrada (Cadastros > Empresas). As contas ficam em financeiro_calculo.py;
aqui os dados de cada nota sao montados a partir dos paletes dela:
- em estoque  = paletes aguardando guarda, guardados ou no stage;
- saida       = paletes expedidos numa carga (ou tirados do armazem pela tela de Controle de palete);
- baixados    = nao contam (foram erro de lancamento).
O peso vem do cadastro do produto (peso por unidade x quantidade); produto em KG sem peso cadastrado vale a quantidade.
Produto sem peso no cadastro usa o peso da nota (lido do XML), dividido entre os itens pela quantidade.
"""
import re
from collections import defaultdict
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from sqlalchemy.orm import selectinload

from . import financeiro_calculo as calc
from .core import perm, pode_editar, registrar_log
from .estoque import _excel
from .nfe import XmlInvalido, ler_nfe
from .models import (Carga, ContratoCobranca, Empresa, Movimentacao, NotaFiscal, Palete, PaleteItem, TabelaCobranca,
                     agora, db)

bp = Blueprint('financeiro', __name__, url_prefix='/financeiro')

ABAS = [('tabelas', 'Tabela de cobrança', 'table-list'), ('contratos', 'Contrato', 'file-signature'),
        ('clientes', 'Clientes', 'building-user'), ('movimentacao', 'Movimentação', 'right-left'),
        ('logica', 'Lógica de cobrança', 'calculator')]
CUSTOS = [('custo_posicao', 'Custo por posição palete (R$)'), ('custo_kilo', 'Custo por quilo (R$)'),
          ('custo_palete', 'Custo por palete (R$)'), ('custo_entrada', 'Custo de entrada (R$/palete)'),
          ('custo_saida', 'Custo de saída (R$/palete)')]
COBRANCAS = [('cobrar_posicao', 'Posição palete', 'Posição'), ('cobrar_kilo', 'Por quilo', 'Quilo'),
             ('cobrar_palete', 'Por palete', 'Palete'), ('cobrar_entrada', 'Entrada', 'Entrada'), ('cobrar_saida', 'Saída', 'Saída')]
EM_ESTOQUE = ('Aguardando guarda', 'Armazenado', 'Stage')
SAIU = ('Expedido', 'Fora')
UNIDADES_CAIXA = {'CX', 'CAIXA', 'FD', 'FARDO'}
UNIDADES_PESO = {'KG', 'KGM', 'QUILO', 'QUILOGRAMA'}
POR_PAGINA = {'movimentacao': 8, 'logica': 10}          # como no Plus


@bp.app_template_filter('moeda')
def moeda(valor):
    if valor is None:
        return '—'
    texto = f'{Decimal(str(valor)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP):,.2f}'
    return 'R$ ' + texto.replace(',', '#').replace('.', ',').replace('#', '.')


@bp.app_template_filter('cnpj')
def formatar_cnpj(valor):
    d = re.sub(r'\D', '', valor or '')
    if len(d) == 14:
        return f'{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}'
    if len(d) == 11:
        return f'{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}'
    return valor or ''


def _data(texto):
    try:
        return datetime.strptime((texto or '').strip(), '%Y-%m-%d').date()
    except ValueError:
        return None


def _valor(texto):
    """'1.234,56', '0,18' ou '0.18' -> numero. Vazio = 0. Devolve None se nao for um valor valido."""
    texto = (texto or '').strip().replace('R$', '').replace(' ', '')
    if not texto:
        return 0.0
    if ',' in texto:
        texto = texto.replace('.', '').replace(',', '.')
    try:
        valor = float(texto)
    except ValueError:
        return None
    return valor if 0 <= valor < 1e9 else None


# ---------------------------------------------------------------- dados de cada nota

def _peso_do_cadastro(produto):
    """kg por unidade pelo cadastro do produto; None quando o cadastro nao diz."""
    if produto.peso_kg:
        return produto.peso_kg
    if (produto.unidade or '').strip().upper() in UNIDADES_PESO:
        return 1.0
    return None


def completar_pesos():
    """Notas com XML guardado antes de o sistema ler o peso: le agora e grava (uma vez so por nota)."""
    pendentes = NotaFiscal.query.filter(NotaFiscal.xml.isnot(None), NotaFiscal.peso_bruto.is_(None),
                                        NotaFiscal.peso_liquido.is_(None)).all()
    for nota in pendentes:
        try:
            dados = ler_nfe(nota.xml.encode('utf-8'))
        except XmlInvalido:
            dados = {}
        nota.peso_bruto, nota.peso_liquido = dados.get('peso_bruto') or 0.0, dados.get('peso_liquido') or 0.0
    if pendentes:
        db.session.commit()


def pesos_por_item(nota):
    """nota_item_id -> (kg por unidade, origem). Vale o cadastro do produto; item sem peso no cadastro divide o que
    sobra do peso da nota (bruto; se nao houver, liquido), na proporcao da quantidade."""
    pesos, sem_peso, conhecido = {}, [], 0.0
    for item in nota.itens:
        unitario = _peso_do_cadastro(item.produto)
        if unitario is None:
            sem_peso.append(item)
        else:
            pesos[item.id] = (unitario, 'cadastro')
            conhecido += unitario * item.quantidade
    quantidade = sum(i.quantidade for i in sem_peso)
    sobra = max(0.0, (nota.peso_bruto or nota.peso_liquido or 0.0) - conhecido)
    for item in sem_peso:
        pesos[item.id] = (sobra / quantidade if quantidade > 0 else 0.0, 'nota')
    return pesos


def _peso(conteudo, pesos):
    unitario = _peso_do_cadastro(conteudo.produto)
    if unitario is None:
        unitario = pesos.get(conteudo.nota_item_id, (0.0, ''))[0]
    return conteudo.quantidade * unitario


def _caixas(item):
    return item.quantidade if (item.produto.unidade or '').strip().upper() in UNIDADES_CAIXA else 0.0


def _contrato_dict(contrato):
    if not contrato:
        return None
    return {'ciclo': contrato.ciclo, 'regra': contrato.regra_tempo, 'cobrar_posicao': contrato.cobrar_posicao,
            'cobrar_kilo': contrato.cobrar_kilo, 'cobrar_palete': contrato.cobrar_palete,
            'cobrar_entrada': contrato.cobrar_entrada, 'cobrar_saida': contrato.cobrar_saida}


def _tabela_dict(tabela):
    if not tabela:
        return None
    return {campo: getattr(tabela, campo) or 0.0 for campo, _ in CUSTOS}


def contratos_ativos():
    """empresa_id -> contrato ativo mais recente."""
    ativos = {}
    for contrato in ContratoCobranca.query.filter_by(ativo=True).order_by(ContratoCobranca.id.desc()):
        ativos.setdefault(contrato.empresa_id, contrato)
    return ativos


def linhas_do_financeiro(empresa_id=None, hoje=None):
    """Uma linha por nota de entrada que ja recebeu palete: resumo, cobranca da estadia e cobranca do periodo."""
    hoje = hoje or agora().date()
    completar_pesos()
    consulta = (NotaFiscal.query.filter(NotaFiscal.tipo == 'Entrada', NotaFiscal.status != 'Cancelada')
                .options(selectinload(NotaFiscal.empresa), selectinload(NotaFiscal.itens),
                         selectinload(NotaFiscal.paletes).selectinload(Palete.itens).selectinload(PaleteItem.produto),
                         selectinload(NotaFiscal.paletes).selectinload(Palete.endereco)))
    if empresa_id:
        consulta = consulta.filter(NotaFiscal.empresa_id == empresa_id)
    notas = consulta.order_by(NotaFiscal.id.desc()).all()

    movimentos = defaultdict(dict)          # palete_id -> {'Entrada': data, 'Saída': data}
    for palete_id, tipo, quando in (db.session.query(Movimentacao.palete_id, Movimentacao.tipo, db.func.max(Movimentacao.criado_em))
                                    .filter(Movimentacao.tipo.in_(('Entrada', 'Saída')))
                                    .group_by(Movimentacao.palete_id, Movimentacao.tipo)):
        movimentos[palete_id][tipo] = quando
    cargas = dict(db.session.query(Carga.id, Carga.codigo))
    ativos = contratos_ativos()
    padrao = calc.periodo_padrao(hoje)

    linhas = []
    for nota in notas:
        vivos = [p for p in nota.paletes if p.status != 'Baixado']
        estoque = [p for p in vivos if p.status in EM_ESTOQUE and sum(i.quantidade for i in p.itens) > 1e-9]
        saidos = [p for p in vivos if p.status in SAIU]
        if not estoque and not saidos:
            continue                         # nota que ainda nao recebeu nada
        entrada = nota.data_armazenagem or min(p.criado_em for p in vivos).date()
        pesos = pesos_por_item(nota)
        grupos = {}
        for p in saidos:
            quando = movimentos[p.id].get('Saída') or p.criado_em
            chave = ('carga', p.carga_id) if p.carga_id and p.status == 'Expedido' else ('dia', quando.date())
            g = grupos.setdefault(chave, {'data': quando, 'peso': 0.0, 'caixas': 0.0, 'paletes': 0,
                                          'ref': f'Carga {cargas.get(p.carga_id, "")}'.strip() if chave[0] == 'carga' else (p.motivo or 'Saída')})
            g['data'] = max(g['data'], quando)
            g['peso'] += sum(_peso(i, pesos) for i in p.itens)
            g['caixas'] += sum(_caixas(i) for i in p.itens)
            g['paletes'] += 1
        saidas = sorted(grupos.values(), key=lambda s: s['data'])
        peso_atual = sum(_peso(i, pesos) for p in estoque for i in p.itens)
        resumo = calc.resumir(
            entrada=entrada, saidas=saidas, em_estoque=bool(estoque),
            peso_entrada=peso_atual + sum(s['peso'] for s in saidas), peso_atual=peso_atual,
            paletes_entrada=sum(1 for p in vivos if 'Entrada' in movimentos[p.id]) or len(vivos),
            paletes_atuais=len(estoque), posicoes=len({p.endereco_id for p in estoque if p.endereco_id}),
            caixas=sum(_caixas(i) for p in estoque for i in p.itens), hoje=hoje)
        contrato = ativos.get(nota.empresa_id)
        tabela = contrato.tabela if contrato else None
        cobranca = calc.calcular(resumo, _contrato_dict(contrato), _tabela_dict(tabela))
        inicio, fim = nota.cobranca_inicio or padrao[0], nota.cobranca_fim or padrao[1]
        linhas.append({
            'nota': nota, 'empresa': nota.empresa, 'contrato': contrato, 'tabela': tabela, 'resumo': resumo, 'cobranca': cobranca,
            'periodo': calc.cobrar_periodo(resumo, cobranca, _contrato_dict(contrato), _tabela_dict(tabela), inicio, fim),
            'periodo_proprio': bool(nota.cobranca_inicio or nota.cobranca_fim),
            'estoque': estoque, 'itens': len(nota.itens), 'valor_mercadoria': nota.valor_total,
            'peso': resumo['peso_atual'] if resumo['armazenada'] else resumo['peso_entrada'],
            'peso_da_nota': any(origem == 'nota' and unitario > 0 for unitario, origem in pesos.values()),
            'sem_peso': bool(contrato and contrato.cobrar_kilo and resumo['peso_entrada'] <= 1e-6),
        })
    return linhas


def _o_que_cobra(contrato):
    if not contrato:
        return 'Sem contrato ativo'
    return ', '.join(curto for campo, _, curto in COBRANCAS if getattr(contrato, campo)) or 'Nenhuma cobrança marcada'


def _planilha(linhas):
    colunas = ['NF', 'Cliente', 'CNPJ', 'Status', 'Data de armazenagem', 'Entrada registrada', 'Saída', 'Dias armazenados',
               'Período início', 'Período fim', 'Dias do período', 'Valor diária', 'Valor acumulado', 'Valor armazenagem período',
               'Débitos entrada período', 'Débitos saída período', 'Valor total a cobrar', 'Peso entrada kg', 'Peso atual kg',
               'Peso saído kg', 'Qtd saídas', 'Caixas NF', 'Paletes NF', 'Posições NF', 'Valor mercadoria NF', 'Código item',
               'Descrição item', 'Quantidade item', 'Unidade item', 'Paletes item', 'Endereços item', 'UP', 'Lote', 'Fabricação',
               'Validade']
    saida = []
    for l in linhas:
        nota, r, p = l['nota'], l['resumo'], l['periodo']
        base = [nota.numero, l['empresa'].nome if l['empresa'] else '', formatar_cnpj(l['empresa'].cnpj) if l['empresa'] else '',
                r['status'], r['entrada'].strftime('%d/%m/%Y'), nota.criado_em.strftime('%d/%m/%Y %H:%M'),
                r['data_saida'].strftime('%d/%m/%Y') if r['data_saida'] else '', r['dias'],
                p['inicio'].strftime('%d/%m/%Y'), p['fim'].strftime('%d/%m/%Y'), p['dias'], l['cobranca']['valor_diaria'],
                l['cobranca']['valor_vigente'], p['armazenagem'], p['debitos_entrada'], p['debitos_saida'], p['total'],
                round(r['peso_entrada'], 3), round(r['peso_atual'], 3), round(r['peso_saido'], 3), len(r['saidas']),
                r['caixas'], r['paletes'], r['posicoes'], l['valor_mercadoria']]
        por_item = defaultdict(list)          # nota_item_id -> conteudos em estoque
        for palete in l['estoque']:
            for conteudo in palete.itens:
                por_item[conteudo.nota_item_id].append((palete, conteudo))
        if not nota.itens:
            saida.append(base + [''] * 10)
        for item in nota.itens:
            guardados = por_item.get(item.id, [])
            saida.append(base + [
                item.codigo or item.produto.sku, item.descricao or item.produto.descricao, item.quantidade, item.unidade,
                len({palete.id for palete, _ in guardados}),
                ', '.join(sorted({palete.endereco.codigo for palete, _ in guardados if palete.endereco})),
                ', '.join(sorted({palete.up for palete, _ in guardados if palete.up})), item.lote or '',
                item.fabricacao.strftime('%d/%m/%Y') if item.fabricacao else '', item.validade.strftime('%d/%m/%Y') if item.validade else ''])
    larguras = [10, 34, 20, 12, 14, 17, 12, 9, 12, 12, 9, 12, 14, 14, 14, 14, 14, 12, 12, 12, 8, 9, 9, 9, 14, 16, 40, 11, 8, 8, 30, 10,
                14, 12, 12]
    return _excel('financeiro-detalhado', [('Financeiro detalhado', colunas, saida, larguras)])


# ---------------------------------------------------------------- tela

def _clientes(linhas_todas):
    """Empresas que aparecem no Financeiro: emitentes de nota recebida, quem tem contrato e os depositantes/clientes."""
    com_nota = defaultdict(int)
    for l in linhas_todas:
        if l['empresa']:
            com_nota[l['empresa'].id] += 1
    com_contrato = {c.empresa_id for c in ContratoCobranca.query}
    empresas = Empresa.query.filter(db.or_(Empresa.id.in_(set(com_nota) | com_contrato),
                                           db.and_(Empresa.tipo.in_(('Cliente', 'Depositante')), Empresa.ativo.is_(True)))) \
        .order_by(Empresa.nome).all()
    return empresas, com_nota


def _pagina(aba=None, form=None, editando=None):
    """Monta a tela. form = o que foi digitado (volta preenchido quando deu erro); editando = id em edicao."""
    aba = aba or request.args.get('aba')
    tabelas = TabelaCobranca.query.order_by(TabelaCobranca.nome).all()
    if aba not in {chave for chave, _, _ in ABAS}:
        aba = 'movimentacao' if tabelas else 'tabelas'
    hoje = agora().date()
    contexto = {'aba': aba, 'abas': ABAS, 'tabelas': tabelas, 'custos': CUSTOS, 'cobrancas': COBRANCAS, 'form': form, 'editando': editando,
                'hoje': hoje, 'rotulo_ciclo': calc.ROTULO_CICLO, 'rotulo_regra': calc.ROTULO_REGRA, 'o_que_cobra': _o_que_cobra,
                'formatar_fator': calc.formatar_fator, 'editar': pode_editar('financeiro')}
    editar_id = editando or request.args.get('editar', type=int)

    if aba == 'tabelas':
        contexto['em_uso'] = dict(db.session.query(ContratoCobranca.tabela_id, db.func.count()).group_by(ContratoCobranca.tabela_id))
        contexto['registro'] = db.session.get(TabelaCobranca, editar_id) if editar_id else None
        return render_template('financeiro.html', **contexto)

    todas = linhas_do_financeiro(hoje=hoje)
    empresas, com_nota = _clientes(todas)
    contexto.update(empresas=empresas, com_nota=com_nota, ativos=contratos_ativos())

    if aba == 'contratos':
        contexto['contratos'] = ContratoCobranca.query.order_by(ContratoCobranca.id.desc()).all()
        contexto['registro'] = db.session.get(ContratoCobranca, editar_id) if editar_id else None
        contexto['todas_empresas'] = Empresa.query.filter_by(ativo=True).order_by(Empresa.nome).all()
        return render_template('financeiro.html', **contexto)

    cliente = db.session.get(Empresa, request.args.get('cliente', type=int) or 0)
    contexto['cliente'] = cliente

    if aba == 'clientes':
        if cliente:
            dele = [l for l in todas if l['empresa'] and l['empresa'].id == cliente.id]
            contexto.update(armazenadas=[l for l in dele if l['resumo']['armazenada']],
                            finalizadas=[l for l in dele if not l['resumo']['armazenada']],
                            total_cliente=sum(l['cobranca']['total'] for l in dele))
        return render_template('financeiro.html', **contexto)

    linhas = [l for l in todas if not cliente or (l['empresa'] and l['empresa'].id == cliente.id)]
    if aba == 'logica':
        linhas.sort(key=lambda l: (not l['resumo']['armazenada'], -l['resumo']['entrada'].toordinal()))
        contexto['totais'] = {
            'total': sum(l['cobranca']['total'] for l in linhas), 'nfs': len(linhas),
            'armazenadas': sum(1 for l in linhas if l['resumo']['armazenada']),
            'finalizadas': sum(1 for l in linhas if not l['resumo']['armazenada']),
            'dias': sum(l['resumo']['dias'] for l in linhas),
            'sem_contrato': sum(1 for l in linhas if not l['contrato']),
        }
    else:
        if request.args.get('formato') == 'xlsx' and request.method == 'GET':
            return _planilha(linhas)
        contexto['totais'] = {
            'cobrar': sum(l['periodo']['total'] for l in linhas), 'acumulado': sum(l['cobranca']['valor_vigente'] for l in linhas),
            'posicoes': sum(l['resumo']['posicoes'] for l in linhas), 'peso': sum(l['peso'] for l in linhas),
            'caixas': sum(l['resumo']['caixas'] for l in linhas), 'paletes': sum(l['resumo']['paletes'] for l in linhas),
            'itens': sum(l['itens'] for l in linhas), 'nfs': len(linhas),
        }
        contexto['falta_configurar'] = not tabelas or any(not l['contrato'] for l in linhas)
        contexto['periodo_padrao'] = calc.periodo_padrao(hoje)
    por_pagina = POR_PAGINA[aba]
    total = len(linhas)
    paginas = max((total + por_pagina - 1) // por_pagina, 1)
    pagina = min(max(request.args.get('pagina', 1, type=int), 1), paginas)
    contexto.update(linhas=linhas[(pagina - 1) * por_pagina: pagina * por_pagina], total=total, pagina=pagina, paginas=paginas,
                    filtros={k: v for k, v in (('aba', aba), ('cliente', cliente.id if cliente else None)) if v})
    return render_template('financeiro.html', **contexto)


@bp.route('/')
@perm('financeiro')
def painel():
    return _pagina()


# ---------------------------------------------------------------- tabela de cobranca

@bp.route('/tabelas/salvar', methods=['POST'])
@perm('financeiro')
def tabela_salvar():
    tid = request.form.get('id', type=int)
    tabela = db.session.get(TabelaCobranca, tid) if tid else TabelaCobranca()
    if tid and not tabela:
        abort(404)
    erros = []
    nome = ' '.join((request.form.get('nome') or '').split())[:80]
    if not nome:
        erros.append('Informe o nome da tabela.')
    else:
        repetida = TabelaCobranca.query.filter(db.func.lower(TabelaCobranca.nome) == nome.lower()).first()
        if repetida and repetida.id != tabela.id:
            erros.append(f'Já existe uma tabela chamada "{nome}".')
    valores = {}
    for campo, rotulo in CUSTOS:
        valores[campo] = _valor(request.form.get(campo))
        if valores[campo] is None:
            erros.append(f'{rotulo}: valor inválido (use, por exemplo, 12,50).')
    if erros:
        for erro in erros:
            flash(erro, 'error')
        return _pagina('tabelas', form=request.form, editando=tid)
    tabela.nome = nome
    for campo, valor in valores.items():
        setattr(tabela, campo, valor)
    db.session.add(tabela)
    registrar_log('Alterou tabela de cobrança' if tid else 'Criou tabela de cobrança', nome, modulo='financeiro')
    db.session.commit()
    flash('Tabela atualizada.' if tid else 'Tabela cadastrada.', 'success')
    return redirect(url_for('financeiro.painel', aba='tabelas'))


@bp.route('/tabelas/<int:tid>/excluir', methods=['POST'])
@perm('financeiro')
def tabela_excluir(tid):
    tabela = db.session.get(TabelaCobranca, tid)
    if not tabela:
        abort(404)
    if ContratoCobranca.query.filter_by(tabela_id=tid).count():
        flash('Remova ou altere os contratos antes de excluir esta tabela.', 'error')
    else:
        registrar_log('Excluiu tabela de cobrança', tabela.nome, modulo='financeiro')
        db.session.delete(tabela)
        db.session.commit()
        flash('Tabela excluída.', 'success')
    return redirect(url_for('financeiro.painel', aba='tabelas'))


# ---------------------------------------------------------------- contrato

@bp.route('/contratos/salvar', methods=['POST'])
@perm('financeiro')
def contrato_salvar():
    cid = request.form.get('id', type=int)
    contrato = db.session.get(ContratoCobranca, cid) if cid else ContratoCobranca()
    if cid and not contrato:
        abort(404)
    empresa = db.session.get(Empresa, request.form.get('empresa_id', type=int) or 0)
    tabela = db.session.get(TabelaCobranca, request.form.get('tabela_id', type=int) or 0)
    erros = []
    if not empresa:
        erros.append('Escolha o cliente do contrato.')
    if not tabela:
        erros.append('Escolha a tabela de cobrança.')
    ciclo, regra = request.form.get('ciclo'), request.form.get('regra_tempo')
    if ciclo not in calc.DIAS_DO_CICLO:
        erros.append('Escolha o ciclo de cobrança.')
    if regra not in calc.ROTULO_REGRA:
        erros.append('Escolha a regra de tempo.')
    if erros:
        for erro in erros:
            flash(erro, 'error')
        return _pagina('contratos', form=request.form, editando=cid)
    contrato.empresa, contrato.tabela, contrato.ciclo, contrato.regra_tempo = empresa, tabela, ciclo, regra
    for campo, _, _ in COBRANCAS:
        setattr(contrato, campo, request.form.get(campo) == '1')
    contrato.ativo = request.form.get('ativo') == '1'
    contrato.observacao = (request.form.get('observacao') or '').strip()[:300] or None
    db.session.add(contrato)
    registrar_log('Alterou contrato' if cid else 'Criou contrato', f'{empresa.nome} · {tabela.nome}', modulo='financeiro')
    db.session.commit()
    flash('Contrato atualizado.' if cid else 'Contrato cadastrado.', 'success')
    if not any(getattr(contrato, campo) for campo, _, _ in COBRANCAS):
        flash('Nenhuma cobrança está marcada neste contrato: o valor calculado será zero.', 'warning')
    return redirect(url_for('financeiro.painel', aba='contratos'))


@bp.route('/contratos/<int:cid>/excluir', methods=['POST'])
@perm('financeiro')
def contrato_excluir(cid):
    contrato = db.session.get(ContratoCobranca, cid)
    if not contrato:
        abort(404)
    registrar_log('Excluiu contrato', contrato.empresa.nome, modulo='financeiro')
    db.session.delete(contrato)
    db.session.commit()
    flash('Contrato excluído.', 'success')
    return redirect(url_for('financeiro.painel', aba='contratos'))


# ---------------------------------------------------------------- clientes

@bp.route('/clientes/novo', methods=['POST'])
@perm('financeiro')
def cliente_novo():
    nome = ' '.join((request.form.get('nome') or '').split())[:150]
    cnpj = re.sub(r'\D', '', request.form.get('cnpj') or '')
    erro = None
    if not nome:
        erro = 'Informe a razão social.'
    elif cnpj and len(cnpj) != 14:
        erro = 'O CNPJ precisa ter 14 números (ou fique em branco).'
    elif Empresa.query.filter(db.func.lower(Empresa.nome) == nome.lower()).first():
        erro = f'Já existe uma empresa chamada "{nome}" em Cadastros › Empresas.'
    elif cnpj and Empresa.query.filter_by(cnpj=cnpj).first():
        erro = 'Já existe uma empresa com este CNPJ em Cadastros › Empresas.'
    if erro:
        flash(erro, 'error')
        return _pagina('clientes', form=request.form)
    empresa = Empresa(nome=nome, cnpj=cnpj or None, tipo='Depositante', ativo=True)
    db.session.add(empresa)
    registrar_log('Cadastrou cliente pelo Financeiro', nome, modulo='financeiro')
    db.session.commit()
    flash(f'{nome} cadastrado. Os outros dados podem ser completados em Cadastros › Empresas.', 'success')
    return redirect(url_for('financeiro.painel', aba='clientes', cliente=empresa.id))


# ---------------------------------------------------------------- movimentacao (controle de permanencia)

def _nota_ou_404(nid):
    nota = db.session.get(NotaFiscal, nid)
    if not nota or nota.tipo != 'Entrada':
        abort(404)
    return nota


def _voltar():
    voltar = request.form.get('voltar') or ''
    if not voltar.startswith('/financeiro/'):          # so volta para dentro do proprio Financeiro
        voltar = url_for('financeiro.painel', aba='movimentacao')
    return redirect(voltar)


@bp.route('/notas/<int:nid>/data', methods=['POST'])
@perm('financeiro')
def nota_data(nid):
    """Data de armazenagem: de quando a cobranca comeca a contar."""
    nota = _nota_ou_404(nid)
    data = _data(request.form.get('data'))
    if not data:
        flash('Informe a data de armazenagem.', 'error')
    elif data > agora().date():
        flash('A data de armazenagem não pode ser no futuro.', 'error')
    else:
        nota.data_armazenagem = data
        registrar_log('Alterou data de armazenagem', f'NF {nota.numero} · {data.strftime("%d/%m/%Y")}', modulo='financeiro')
        db.session.commit()
        flash(f'NF {nota.numero}: armazenagem a partir de {data.strftime("%d/%m/%Y")}.', 'success')
    return _voltar()


@bp.route('/periodo', methods=['POST'])
@perm('financeiro')
def periodo():
    """Periodo de cobranca de uma nota, das marcadas ou de todas as filtradas. 'padrao' volta ao mes atual."""
    if request.form.get('alvo') == 'todas':
        cliente = request.form.get('cliente', type=int)
        ids = [l['nota'].id for l in linhas_do_financeiro(empresa_id=cliente)]
    else:
        ids = [int(i) for i in request.form.getlist('nf') if i.isdigit()]
    if not ids:
        flash('Marque pelo menos uma NF.', 'error')
        return _voltar()
    if request.form.get('acao') == 'padrao':
        inicio = fim = None
    else:
        inicio, fim = _data(request.form.get('inicio')), _data(request.form.get('fim'))
        if not inicio or not fim:
            flash('Informe o início e o fim do período.', 'error')
            return _voltar()
        if inicio > fim:
            flash('O início do período não pode ser depois do fim.', 'error')
            return _voltar()
    notas = NotaFiscal.query.filter(NotaFiscal.id.in_(ids), NotaFiscal.tipo == 'Entrada').all()
    for nota in notas:
        nota.cobranca_inicio, nota.cobranca_fim = inicio, fim
    registrar_log('Definiu período de cobrança',
                  f'{len(notas)} NF(s) · ' + (f'{inicio.strftime("%d/%m/%Y")} a {fim.strftime("%d/%m/%Y")}' if inicio else 'mês atual'),
                  modulo='financeiro')
    db.session.commit()
    flash(f'Período aplicado em {len(notas)} NF(s).' if inicio else f'{len(notas)} NF(s) voltaram ao período do mês atual.', 'success')
    return _voltar()
