"""Portal do cliente: o embarcador entra e ve so o estoque, as notas e a cobranca dele.

De quem e a mercadoria: da empresa que emitiu a nota de entrada (a mesma regra do Financeiro e do mapa).
Quais empresas o usuario ve: a organizacao dele na Hierarquia e as que estao abaixo dela (as ligadas a uma empresa de
Cadastros). Administrador e Super Usuario escolhem qualquer cliente, para ver o portal como ele ve.

O perfil "Cliente (portal)" so tem acesso a este modulo: nenhuma outra tela do WMS abre para ele.
"""
from flask import Blueprint, abort, render_template, request

from .core import GESTAO, perm, usuario_atual
from .estoque import _excel
from .fechamento import nome_do_mes, resposta_pdf
from .financeiro import linhas_do_financeiro
from .hierarquia import descendentes
from .models import Empresa, FechamentoMensal, NotaFiscal, Palete, PaleteItem, Produto, db

bp = Blueprint('portal', __name__, url_prefix='/portal')

EM_ESTOQUE = ('Aguardando guarda', 'Armazenado', 'Stage')
ABAS = [('estoque', 'Meu estoque', 'boxes-stacked'), ('notas', 'Minhas notas', 'file-invoice'), ('cobranca', 'Cobrança', 'coins')]


def empresas_do_portal():
    """(empresas que o usuario pode ver, se ele e da gestao)."""
    user = usuario_atual()
    if user.perfil in GESTAO:
        return Empresa.query.filter(Empresa.id.in_(db.session.query(NotaFiscal.empresa_id).filter(NotaFiscal.empresa_id.isnot(None)))) \
            .order_by(Empresa.nome).all(), True
    if not user.organizacao_id:
        return [], False
    ids = {o.empresa_id for o in descendentes(user.organizacao) if o.empresa_id}
    return (Empresa.query.filter(Empresa.id.in_(ids)).order_by(Empresa.nome).all() if ids else []), False


def _empresas_escolhidas():
    """As empresas cujos dados aparecem agora: todas as do usuario, ou a escolhida no filtro. Devolve (todas, escolhidas, gestao)."""
    todas, gestao = empresas_do_portal()
    escolhida = request.args.get('empresa', type=int)
    if escolhida:
        if escolhida not in {e.id for e in todas}:
            abort(404)                     # cliente de outro: para este usuario nao existe
        return todas, [e for e in todas if e.id == escolhida], gestao
    # a gestao comeca sem cliente escolhido (para nao somar todos os clientes num portal so)
    return todas, ([] if gestao else todas), gestao


def estoque_do_cliente(ids):
    """Uma linha por produto, lote e validade do que esta guardado das notas dessas empresas."""
    if not ids:
        return []
    consulta = (db.session.query(Produto.sku, Produto.descricao, Produto.unidade, PaleteItem.lote, PaleteItem.fabricacao, PaleteItem.validade,
                                 db.func.sum(PaleteItem.quantidade), db.func.count(db.distinct(Palete.id)))
                .select_from(PaleteItem).join(Palete, PaleteItem.palete_id == Palete.id).join(Produto, PaleteItem.produto_id == Produto.id)
                .join(NotaFiscal, Palete.nota_id == NotaFiscal.id)
                .filter(NotaFiscal.empresa_id.in_(ids), Palete.status.in_(EM_ESTOQUE), PaleteItem.quantidade > 0)
                .group_by(Produto.sku, Produto.descricao, Produto.unidade, PaleteItem.lote, PaleteItem.fabricacao, PaleteItem.validade)
                .order_by(Produto.descricao, PaleteItem.validade))
    return [{'sku': sku, 'descricao': descricao, 'unidade': unidade, 'lote': lote, 'fabricacao': fabricacao, 'validade': validade,
             'quantidade': round(quantidade or 0, 3), 'paletes': paletes}
            for sku, descricao, unidade, lote, fabricacao, validade, quantidade, paletes in consulta]


@bp.route('/')
@perm('portal')
def inicio():
    todas, escolhidas, gestao = _empresas_escolhidas()
    ids = [e.id for e in escolhidas]
    aba = request.args.get('aba') if request.args.get('aba') in {chave for chave, _, _ in ABAS} else 'estoque'
    filtros = {'empresa': request.args.get('empresa', type=int)}
    linhas_fin = [l for empresa_id in ids for l in linhas_do_financeiro(empresa_id=empresa_id)]
    estoque = estoque_do_cliente(ids)

    if aba == 'estoque' and request.args.get('formato') == 'xlsx':
        return _excel('meu-estoque', [('Estoque', ['Código', 'Descrição', 'Unidade', 'Lote', 'Fabricação', 'Validade', 'Quantidade', 'Paletes'],
                                       [[l['sku'], l['descricao'], l['unidade'], l['lote'], l['fabricacao'].strftime('%d/%m/%Y') if l['fabricacao'] else '',
                                         l['validade'].strftime('%d/%m/%Y') if l['validade'] else '', l['quantidade'], l['paletes']] for l in estoque],
                                       [16, 44, 9, 16, 12, 12, 12, 9])])
    contexto = {
        'abas': ABAS, 'aba': aba, 'todas': todas, 'escolhidas': escolhidas, 'gestao': gestao, 'filtros': {k: v for k, v in filtros.items() if v},
        'resumo': {'paletes': sum(l['resumo']['paletes'] for l in linhas_fin), 'posicoes': sum(l['resumo']['posicoes'] for l in linhas_fin),
                   'peso': sum(l['resumo']['peso_atual'] for l in linhas_fin), 'notas': sum(1 for l in linhas_fin if l['resumo']['armazenada']),
                   'produtos': len({l['sku'] for l in estoque}), 'cobrar': sum(l['periodo']['total'] for l in linhas_fin)},
    }
    if aba == 'estoque':
        contexto['estoque'] = estoque
    elif aba == 'notas':
        contexto['notas'] = (NotaFiscal.query.filter(NotaFiscal.empresa_id.in_(ids or [0]), NotaFiscal.status != 'Cancelada')
                             .order_by(NotaFiscal.id.desc()).limit(300).all())
        contexto['guardados'] = {l['nota'].id: l['resumo'] for l in linhas_fin}
    else:
        contexto['linhas'] = sorted(linhas_fin, key=lambda l: (not l['resumo']['armazenada'], -l['nota'].id))
        contexto['fechamentos'] = (FechamentoMensal.query.filter(FechamentoMensal.empresa_id.in_(ids or [0]))
                                   .order_by(FechamentoMensal.ano.desc(), FechamentoMensal.mes.desc()).all())
        contexto['nome_do_mes'] = nome_do_mes
    return render_template('portal.html', **contexto)


def _permitidas():
    return {e.id for e in empresas_do_portal()[0]}


@bp.route('/notas/<int:nid>/pdf')
@perm('portal')
def nota_pdf(nid):
    from .entrada import resposta_pdf_da_nota
    nota = db.session.get(NotaFiscal, nid)
    if not nota or nota.empresa_id not in _permitidas():
        abort(404)
    return resposta_pdf_da_nota(nota)


@bp.route('/fechamentos/<int:fid>/pdf')
@perm('portal')
def fechamento_pdf(fid):
    f = db.session.get(FechamentoMensal, fid)
    if not f or f.empresa_id not in _permitidas():
        abort(404)
    return resposta_pdf(f)
