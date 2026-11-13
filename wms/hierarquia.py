"""Hierarquia: arvore de organizacoes, grupos e o vinculo de cada usuario com a organizacao dele (modelo do WMS Plus).

Arvore: Operador Logistico (raiz) -> Filial Operador / Embarcador -> Unidade -> Transportadora.
Grupo: junta organizacoes da arvore (com um "pai no grupo" opcional). O grupo de um usuario e o grupo em que a
organizacao dele esta.

O que a hierarquia decide hoje no sistema:
- layouts salvos do CD: cada um so aparece para o grupo de quem salvou (chaves_de_layout);
- lista de clientes ao reservar espaco na camara: so as empresas do grupo do usuario (empresas_do_usuario).
Usuario sem organizacao continua como antes (grupo = perfil, todas as empresas).

Cada organizacao que e uma empresa de fato (embarcador, unidade, transportadora) fica ligada ao cadastro em
Cadastros > Empresas: usa a que ja existe com o mesmo CNPJ ou nome, ou cria.
"""
import re

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from .core import GESTAO, PERFIS, eh_super, perm, pode_editar, registrar_log, usuario_atual
from .models import Empresa, GrupoHierarquia, GrupoMembro, Organizacao, Usuario, db

bp = Blueprint('hierarquia', __name__, url_prefix='/admin/hierarquia')

TIPOS = [('operador_logistico', 'Operador Logístico'), ('filial_operador', 'Filial Operador'), ('embarcador', 'Embarcador'),
         ('unidade', 'Unidade'), ('transportadora', 'Transportadora')]
ROTULO_TIPO = dict(TIPOS)
FILHOS_PERMITIDOS = {None: ('operador_logistico',), 'operador_logistico': ('filial_operador', 'embarcador'),
                     'filial_operador': ('embarcador', 'unidade', 'transportadora'), 'embarcador': ('unidade',),
                     'unidade': ('transportadora',), 'transportadora': ()}
# tipo da organizacao -> tipo da empresa criada em Cadastros (operador e filial sao a propria casa: nao viram empresa)
TIPO_DE_EMPRESA = {'embarcador': 'Depositante', 'unidade': 'Depositante', 'transportadora': 'Transportadora'}


# ---------------------------------------------------------------- consultas usadas por outros modulos

def raiz_de(organizacao):
    vistos = set()
    while organizacao.pai is not None and organizacao.id not in vistos:
        vistos.add(organizacao.id)
        organizacao = organizacao.pai
    return organizacao


def descendentes(organizacao):
    """A organizacao e tudo o que esta abaixo dela."""
    todas, pilha = [], [organizacao]
    while pilha:
        atual = pilha.pop()
        todas.append(atual)
        pilha.extend(atual.filhos)
    return todas


def grupos_do_usuario(user):
    if not user or not user.organizacao_id:
        return []
    return (GrupoHierarquia.query.join(GrupoMembro).filter(GrupoMembro.organizacao_id == user.organizacao_id)
            .order_by(GrupoHierarquia.id).all())


def chaves_de_layout(user):
    """Chaves de grupo do usuario, a primeira e onde ele salva. Sem organizacao: o perfil (como era antes da Hierarquia).
    Com organizacao e sem grupo: a arvore dele (a raiz)."""
    if not user.organizacao_id:
        # super usuario e administrador sao o mesmo grupo (os layouts que o administrador salvou continuam com ele)
        return ['admin' if user.perfil in GESTAO else user.perfil]
    grupos = grupos_do_usuario(user)
    if grupos:
        return [f'g{g.id}' for g in grupos]
    return [f'o{raiz_de(user.organizacao).id}']


def nome_da_chave(chave):
    """Texto para mostrar de que grupo e um layout salvo."""
    if chave[:1] == 'g' and chave[1:].isdigit():
        grupo = db.session.get(GrupoHierarquia, int(chave[1:]))
        return f'Grupo {grupo.nome}' if grupo else 'Grupo excluído'
    if chave[:1] == 'o' and chave[1:].isdigit():
        organizacao = db.session.get(Organizacao, int(chave[1:]))
        return organizacao.nome if organizacao else 'Organização excluída'
    return dict(PERFIS).get(chave, chave)


def organizacoes_do_usuario(user):
    """Organizacoes que o usuario enxerga: as dos grupos dele; sem grupo, a arvore inteira dele. None = sem restricao."""
    if not user or user.perfil in GESTAO or not user.organizacao_id:
        return None
    grupos = grupos_do_usuario(user)
    if grupos:
        return (Organizacao.query.join(GrupoMembro, GrupoMembro.organizacao_id == Organizacao.id)
                .filter(GrupoMembro.grupo_id.in_([g.id for g in grupos])).all())
    return descendentes(raiz_de(user.organizacao))


def empresas_do_usuario(user):
    """Empresas ativas que o usuario pode escolher (ex.: reservar espaco na camara)."""
    consulta = Empresa.query.filter_by(ativo=True).order_by(Empresa.nome)
    organizacoes = organizacoes_do_usuario(user)
    if organizacoes is None:
        return consulta.all()
    ids = {o.empresa_id for o in organizacoes if o.empresa_id}
    return consulta.filter(Empresa.id.in_(ids)).all() if ids else []


# ---------------------------------------------------------------- tela

def _empresa_para(organizacao):
    """Liga a organizacao ao cadastro de empresas (mesmo CNPJ, senao mesmo nome); cria quando for o caso."""
    empresa = None
    if organizacao.cnpj:
        empresa = Empresa.query.filter_by(cnpj=organizacao.cnpj).first()
    if not empresa:
        empresa = Empresa.query.filter(db.func.lower(Empresa.nome) == organizacao.nome.lower()).first()
    if not empresa and organizacao.tipo in TIPO_DE_EMPRESA:
        empresa = Empresa(nome=organizacao.nome, cnpj=organizacao.cnpj,
                          tipo='Fornecedor' if organizacao.fornecedor and organizacao.tipo != 'transportadora'
                          else TIPO_DE_EMPRESA[organizacao.tipo], ativo=True)
        db.session.add(empresa)
    return empresa


def _escopo():
    """Organizacoes que quem esta logado pode ver e editar. None = todas (administrador / super). Os demais, com a
    permissao de Hierarquia, alcancam so a organizacao deles e as que estao abaixo dela."""
    user = usuario_atual()
    if user.perfil in GESTAO:
        return None
    return {o.id for o in descendentes(user.organizacao)} if user.organizacao_id else set()


def _exigir_gestao():
    if usuario_atual().perfil not in GESTAO:
        abort(403)


def _pagina(form_org=None, form_grupo=None, form_membro=None):
    aba = request.args.get('aba') if request.method == 'GET' else request.form.get('aba')
    aba = aba if aba in ('arvore', 'usuarios') else 'arvore'
    escopo = _escopo()
    organizacoes = Organizacao.query.order_by(Organizacao.nome).all()
    if escopo is None:
        raizes = Organizacao.query.filter_by(pai_id=None).order_by(Organizacao.id).all()
        grupos = GrupoHierarquia.query.order_by(GrupoHierarquia.nome).all()
    else:
        raizes = [usuario_atual().organizacao] if escopo else []
        organizacoes = [o for o in organizacoes if o.id in escopo]
        grupos = []                      # grupos juntam organizacoes diferentes: so a gestao
    grupo = db.session.get(GrupoHierarquia, (request.args.get('grupo', type=int) or request.form.get('grupo', type=int) or 0))
    usuarios_por_org = dict(db.session.query(Usuario.organizacao_id, db.func.count()).filter(Usuario.organizacao_id.isnot(None))
                            .group_by(Usuario.organizacao_id))
    busca = (request.args.get('q') or '').strip()
    if escopo is not None:
        grupo = None
    usuarios = Usuario.query
    if not eh_super():
        usuarios = usuarios.filter(Usuario.perfil != 'super')
    if escopo is not None:
        usuarios = usuarios.filter(Usuario.organizacao_id.in_(escopo), Usuario.perfil.notin_(GESTAO))
    if busca:
        like = f'%{busca.lower()}%'
        usuarios = usuarios.filter(db.or_(db.func.lower(Usuario.username).like(like), db.func.lower(Usuario.nome).like(like),
                                          db.func.lower(Usuario.email).like(like)))
    usuarios = usuarios.order_by(Usuario.ativo.desc(), Usuario.nome).all()
    # quem esta em cada organizacao (aparece dentro da caixa, no desenho)
    visiveis = Usuario.query.filter(Usuario.organizacao_id.isnot(None))
    if not eh_super():
        visiveis = visiveis.filter(Usuario.perfil != 'super')
    usuarios_da_org = {}
    for u in visiveis.order_by(Usuario.ativo.desc(), Usuario.nome):
        usuarios_da_org.setdefault(u.organizacao_id, []).append(u)
    return render_template(
        'admin_hierarquia.html', aba=aba, raizes=raizes, organizacoes=organizacoes, grupos=grupos, grupo=grupo,
        usuarios=usuarios, busca=busca, usuarios_por_org=usuarios_por_org, perfis=dict(PERFIS), rotulo_tipo=ROTULO_TIPO,
        filhos_permitidos={tipo: [(t, ROTULO_TIPO[t]) for t in filhos] for tipo, filhos in FILHOS_PERMITIDOS.items() if tipo},
        grupos_do_usuario=grupos_do_usuario, form_org=form_org, form_grupo=form_grupo, form_membro=form_membro,
        gestao=escopo is None, editar=pode_editar('hierarquia'), usuarios_da_org=usuarios_da_org,
        meu_no=usuario_atual().organizacao_id if escopo is not None else None)


@bp.route('/')
@perm('hierarquia')
def painel():
    return _pagina()


def _voltar(**extra):
    return redirect(url_for('hierarquia.painel', **{k: v for k, v in extra.items() if v}))


@bp.route('/org/salvar', methods=['POST'])
@perm('hierarquia')
def org_salvar():
    oid = request.form.get('id', type=int)
    organizacao = db.session.get(Organizacao, oid) if oid else Organizacao()
    if oid and not organizacao:
        abort(404)
    escopo = _escopo()
    if oid and escopo is not None and oid not in escopo:
        abort(404)
    erros = []
    if not oid:
        pai = db.session.get(Organizacao, request.form.get('pai_id', type=int) or 0)
        tipo = request.form.get('tipo')
        if request.form.get('pai_id') and not pai:
            abort(404)
        if escopo is not None and (not pai or pai.id not in escopo):
            abort(403)                   # fora da gestao, so se cria abaixo da propria organizacao
        if tipo not in FILHOS_PERMITIDOS[pai.tipo if pai else None]:
            erros.append('Este tipo de organização não pode ficar neste lugar da árvore.' if pai
                         else 'A árvore começa por um Operador Logístico.')
        organizacao.pai_id, organizacao.tipo = (pai.id if pai else None), tipo
    nome = ' '.join((request.form.get('nome') or '').split())[:150]
    cnpj = re.sub(r'\D', '', request.form.get('cnpj') or '')
    if not nome:
        erros.append('Informe o nome da organização.')
    if cnpj and len(cnpj) != 14:
        erros.append('O CNPJ precisa ter 14 números (ou fique em branco).')
    if cnpj and not erros:
        outra = Organizacao.query.filter(Organizacao.cnpj == cnpj, Organizacao.id != (oid or 0)).first()
        if outra:
            erros.append(f'Já existe uma organização com este CNPJ na árvore ({outra.nome}).')
    if erros:
        db.session.rollback()
        for erro in erros:
            flash(erro, 'error')
        return _pagina(form_org=request.form)          # a janela volta aberta com o que foi digitado
    organizacao.nome, organizacao.cnpj = nome, cnpj or None
    organizacao.codigo = (request.form.get('codigo') or '').strip()[:30] or None
    organizacao.fornecedor = request.form.get('fornecedor') == '1'
    organizacao.empresa = _empresa_para(organizacao)
    db.session.add(organizacao)
    registrar_log('Alterou organização' if oid else 'Criou organização', f'{ROTULO_TIPO[organizacao.tipo]} · {nome}', modulo='admin')
    db.session.commit()
    flash(f'{nome} salvo na hierarquia.', 'success')
    return _voltar(grupo=request.form.get('grupo', type=int))


@bp.route('/org/<int:oid>/excluir', methods=['POST'])
@perm('hierarquia')
def org_excluir(oid):
    organizacao = db.session.get(Organizacao, oid)
    if not organizacao:
        abort(404)
    escopo = _escopo()
    if escopo is not None and (oid not in escopo or oid == usuario_atual().organizacao_id):
        abort(403)                       # nao exclui o que esta fora do alcance, nem a propria organizacao
    usuarios = Usuario.query.filter_by(organizacao_id=oid).count()
    if organizacao.filhos:
        flash(f'{organizacao.nome} tem organizações abaixo dela. Exclua ou mova as de baixo primeiro.', 'error')
    elif usuarios:
        flash(f'{organizacao.nome} tem {usuarios} usuário(s) vinculado(s). Troque o vínculo deles na aba Usuários primeiro.', 'error')
    else:
        GrupoMembro.query.filter_by(pai_id=oid).update({'pai_id': None})
        registrar_log('Excluiu organização', organizacao.nome, modulo='admin')
        db.session.delete(organizacao)
        db.session.commit()
        flash(f'{organizacao.nome} excluído da hierarquia. O cadastro da empresa em Cadastros não foi apagado.', 'success')
    return _voltar(grupo=request.form.get('grupo', type=int))


@bp.route('/grupos/salvar', methods=['POST'])
@perm('hierarquia')
def grupo_salvar():
    _exigir_gestao()
    nome = ' '.join((request.form.get('nome') or '').split())[:80]
    erro = None
    if not nome:
        erro = 'Informe o nome do grupo.'
    elif GrupoHierarquia.query.filter(db.func.lower(GrupoHierarquia.nome) == nome.lower()).first():
        erro = f'Já existe um grupo chamado "{nome}".'
    if erro:
        flash(erro, 'error')
        return _pagina(form_grupo=request.form)
    grupo = GrupoHierarquia(nome=nome, descricao=(request.form.get('descricao') or '').strip()[:200] or None)
    db.session.add(grupo)
    registrar_log('Criou grupo de hierarquia', nome, modulo='admin')
    db.session.commit()
    flash(f'Grupo "{nome}" criado. Agora adicione as organizações dele.', 'success')
    return _voltar(grupo=grupo.id)


def _grupo_ou_404(gid):
    grupo = db.session.get(GrupoHierarquia, gid)
    if not grupo:
        abort(404)
    return grupo


@bp.route('/grupos/<int:gid>/excluir', methods=['POST'])
@perm('hierarquia')
def grupo_excluir(gid):
    _exigir_gestao()
    grupo = _grupo_ou_404(gid)
    registrar_log('Excluiu grupo de hierarquia', grupo.nome, modulo='admin')
    db.session.delete(grupo)
    db.session.commit()
    flash(f'Grupo "{grupo.nome}" excluído. Layouts salvos por ele deixam de aparecer.', 'success')
    return _voltar()


@bp.route('/grupos/<int:gid>/membros', methods=['POST'])
@perm('hierarquia')
def membro_novo(gid):
    _exigir_gestao()
    grupo = _grupo_ou_404(gid)
    organizacao = db.session.get(Organizacao, request.form.get('organizacao_id', type=int) or 0)
    pai = db.session.get(Organizacao, request.form.get('pai_id', type=int) or 0)
    no_grupo = {m.organizacao_id for m in grupo.membros}
    erro = None
    if not organizacao:
        erro = 'Escolha a organização para adicionar ao grupo.'
    elif organizacao.id in no_grupo:
        erro = f'{organizacao.nome} já está neste grupo.'
    elif pai and (pai.id not in no_grupo or pai.id == organizacao.id):
        erro = 'O "pai no grupo" precisa ser uma organização que já está no grupo.'
    if erro:
        flash(erro, 'error')
    else:
        db.session.add(GrupoMembro(grupo=grupo, organizacao=organizacao, pai=pai))
        registrar_log('Adicionou ao grupo', f'{grupo.nome} · {organizacao.nome}', modulo='admin')
        db.session.commit()
        flash(f'{organizacao.nome} adicionado ao grupo "{grupo.nome}".', 'success')
    return _voltar(grupo=gid)


@bp.route('/membros/<int:mid>/excluir', methods=['POST'])
@perm('hierarquia')
def membro_excluir(mid):
    _exigir_gestao()
    membro = db.session.get(GrupoMembro, mid)
    if not membro:
        abort(404)
    gid = membro.grupo_id
    GrupoMembro.query.filter_by(grupo_id=gid, pai_id=membro.organizacao_id).update({'pai_id': None})
    registrar_log('Removeu do grupo', f'{membro.grupo.nome} · {membro.organizacao.nome}', modulo='admin')
    db.session.delete(membro)
    db.session.commit()
    flash('Organização removida do grupo.', 'success')
    return _voltar(grupo=gid)


@bp.route('/usuarios/<int:uid>/vinculo', methods=['POST'])
@perm('hierarquia')
def vinculo(uid):
    """Liga o usuario a uma organizacao da arvore (ou tira o vinculo). Salva na hora."""
    user = db.session.get(Usuario, uid)
    if not user or (user.perfil == 'super' and not eh_super()):
        abort(404)
    oid = request.form.get('organizacao_id', type=int)
    organizacao = db.session.get(Organizacao, oid) if oid else None
    if oid and not organizacao:
        abort(404)
    escopo = _escopo()
    if escopo is not None and (user.perfil in GESTAO or user.organizacao_id not in escopo
                               or not organizacao or organizacao.id not in escopo):
        abort(403)                       # fora da gestao: so move, dentro da propria arvore, quem ja e dela
    user.organizacao = organizacao
    registrar_log('Vinculou usuário à hierarquia', f'{user.username} · {organizacao.nome if organizacao else "sem organização"}', modulo='admin')
    db.session.commit()
    flash(f'{user.nome}: ' + (f'vinculado a {organizacao.nome}.' if organizacao else 'sem organização (vê tudo, como antes).'), 'success')
    if request.form.get('voltar') == 'arvore':
        return _voltar()
    return _voltar(aba='usuarios', q=request.form.get('q'))
