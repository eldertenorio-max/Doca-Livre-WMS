"""Administracao: usuarios, matriz de permissoes por perfil e log de acoes."""
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from .core import GESTAO, MODULOS, NIVEIS, PERFIS, eh_super, perm, registrar_log, usuario_atual
from .hierarquia import ROTULO_TIPO
from .models import LogAcao, Organizacao, Permissao, PermissaoUsuario, Usuario, db

bp = Blueprint('admin', __name__, url_prefix='/admin')

_PERFIS_VALIDOS = {p for p, _ in PERFIS}


def _perfis_que_posso_dar(user):
    """Perfis que quem esta logado pode atribuir. Como no Faz um Freela, ninguem vira Super Usuario pela tela: ele
    nasce na inicializacao do sistema e fica como esta. So o super cria ou promove administradores; o administrador
    comum mantem o proprio perfil ao editar a si mesmo."""
    if user is not None and user.perfil == 'super':
        return [p for p in PERFIS if p[0] == 'super']
    if eh_super():
        return [p for p in PERFIS if p[0] != 'super']
    proprio = user is not None and user.id == usuario_atual().id
    return [p for p in PERFIS if p[0] not in GESTAO or (proprio and p[0] == user.perfil)]


@bp.route('/usuarios')
@perm('admin')
def usuarios():
    busca = (request.args.get('q') or '').strip()
    consulta = Usuario.query
    if not eh_super():
        consulta = consulta.filter(Usuario.perfil != 'super')          # super usuario so aparece para outro super
    if busca:
        like = f'%{busca.lower()}%'
        consulta = consulta.filter(db.or_(db.func.lower(Usuario.username).like(like),
                                          db.func.lower(Usuario.nome).like(like)))
    lista = consulta.order_by(Usuario.ativo.desc(), Usuario.nome).all()
    return render_template('admin_usuarios.html', usuarios=lista, busca=busca, perfis=dict(PERFIS), gestao=GESTAO,
                           eu=usuario_atual())


@bp.route('/usuarios/novo', methods=['GET', 'POST'])
@bp.route('/usuarios/<int:uid>', methods=['GET', 'POST'])
@perm('admin')
def usuario_form(uid=None):
    user = db.session.get(Usuario, uid) if uid else None
    if uid and not user:
        abort(404)
    # Administrador comum nao mexe em outro gestor (administrador ou super): so o Super Usuario.
    if user and user.perfil in GESTAO and not eh_super() and user.id != usuario_atual().id:
        abort(404 if user.perfil == 'super' else 403)
    perfis = _perfis_que_posso_dar(user)
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        nome = (request.form.get('nome') or '').strip()
        email = (request.form.get('email') or '').strip() or None
        perfil = request.form.get('perfil')
        senha = request.form.get('senha') or ''
        ativo = request.form.get('ativo') == '1'
        erros = []
        if len(username) < 3:
            erros.append('O usuário precisa ter pelo menos 3 caracteres.')
        if not nome:
            erros.append('Informe o nome.')
        if perfil not in _PERFIS_VALIDOS:
            erros.append('Perfil inválido.')
        elif perfil not in {p for p, _ in perfis}:
            erros.append('O Super Usuário não pode ser rebaixado.' if user and user.perfil == 'super'
                         else 'Não é possível criar outro Super Usuário pela tela.' if perfil == 'super'
                         else 'Só o Super Usuário pode criar ou promover administradores.')
        if not user and len(senha) < 6:
            erros.append('A senha precisa ter pelo menos 6 caracteres.')
        if user and senha and len(senha) < 6:
            erros.append('A nova senha precisa ter pelo menos 6 caracteres.')
        duplicado = Usuario.query.filter(db.func.lower(Usuario.username) == username.lower())
        if user:
            duplicado = duplicado.filter(Usuario.id != user.id)
        if username and duplicado.first():
            erros.append('Já existe um usuário com esse login.')
        if user and user.perfil == 'super' and not ativo:
            erros.append('O Super Usuário não pode ser desativado.')
        if erros:
            for erro in erros:
                flash(erro, 'error')
            return render_template('admin_usuario_form.html', user=user, form=request.form, perfis=perfis)

        novo = user is None
        if novo:
            user = Usuario(trocar_senha=True)
            db.session.add(user)
        user.username, user.nome, user.email, user.perfil, user.ativo = username, nome, email, perfil, ativo
        if senha:
            user.set_password(senha)
            # Senha definida por outra pessoa: o dono troca no proximo acesso.
            user.trocar_senha = user.id != usuario_atual().id
        registrar_log('Criou usuário' if novo else 'Alterou usuário',
                      f'{username} · perfil {perfil} · {"ativo" if ativo else "inativo"}'
                      f'{" · senha redefinida" if senha and not novo else ""}', modulo='admin')
        db.session.commit()
        flash('Usuário salvo.', 'success')
        return redirect(url_for('admin.usuarios'))
    return render_template('admin_usuario_form.html', user=user, form=None, perfis=perfis)


@bp.route('/permissoes', methods=['GET', 'POST'])
@perm('admin')
def permissoes():
    editaveis = [p for p in PERFIS if p[0] not in GESTAO]
    linhas = {(p.perfil, p.modulo): p for p in Permissao.query.all()}
    if request.method == 'POST':
        mudancas = []
        for perfil, _ in editaveis:
            for modulo in MODULOS:
                valor = request.form.get(f'{perfil}:{modulo["id"]}', type=int)
                if valor not in (0, 1, 2):
                    continue
                linha = linhas.get((perfil, modulo['id']))
                if linha is None:
                    linha = Permissao(perfil=perfil, modulo=modulo['id'], nivel=valor)
                    db.session.add(linha)
                    mudancas.append(f'{perfil}/{modulo["id"]}={valor}')
                elif linha.nivel != valor:
                    mudancas.append(f'{perfil}/{modulo["id"]}: {linha.nivel}→{valor}')
                    linha.nivel = valor
        if mudancas:
            registrar_log('Alterou permissões', ', '.join(mudancas), modulo='admin')
            db.session.commit()
            flash(f'Permissões atualizadas ({len(mudancas)} alteração(ões)).', 'success')
        else:
            flash('Nenhuma alteração.', 'success')
        return redirect(url_for('admin.permissoes'))
    matriz = {chave: linha.nivel for chave, linha in linhas.items()}
    return render_template('admin_permissoes.html', perfis=editaveis, modulos=MODULOS,
                           matriz=matriz, niveis=NIVEIS)


@bp.route('/permissoes/usuarios', methods=['GET', 'POST'])
@perm('admin')
def permissoes_usuario():
    """Permissoes de uma pessoa, por modulo e por tela, por cima das do perfil. So o Super Usuario.
    Os usuarios aparecem separados pela hierarquia (a organizacao de cada um)."""
    if not eh_super():
        abort(403)
    uid = request.args.get('usuario', type=int)
    user = db.session.get(Usuario, uid) if uid else None
    if uid and (not user or user.perfil in GESTAO):
        abort(404)
    # chaves possiveis: o modulo inteiro e cada tela dos modulos que tem mais de uma
    chaves = []
    for modulo in MODULOS:
        chaves.append(modulo['id'])
        if len(modulo['telas']) > 1:
            chaves += [f'{modulo["id"]}/{tela["id"]}' for tela in modulo['telas']]
    if request.method == 'POST':
        if not user:
            abort(404)
        atuais = {p.modulo: p for p in PermissaoUsuario.query.filter_by(usuario_id=user.id)}
        rotulos = dict(NIVEIS)
        acao = request.form.get('acao')
        mudancas = []
        for chave in chaves:
            if acao == 'limpar':
                valor = ''
            elif acao in ('tudo', 'ver'):
                # o modulo recebe o nivel e as telas voltam a seguir o modulo
                valor = ('2' if acao == 'tudo' else '1') if '/' not in chave else ''
            else:
                valor = request.form.get(f'p:{chave}', '')
            linha = atuais.get(chave)
            if valor == '':
                if linha is not None:
                    db.session.delete(linha)
                    mudancas.append(f'{chave}: volta ao padrão')
            elif valor in ('0', '1', '2'):
                valor = int(valor)
                if linha is None:
                    db.session.add(PermissaoUsuario(usuario_id=user.id, modulo=chave, nivel=valor))
                    mudancas.append(f'{chave}={rotulos[valor]}')
                elif linha.nivel != valor:
                    mudancas.append(f'{chave}: {rotulos[linha.nivel]}→{rotulos[valor]}')
                    linha.nivel = valor
        if mudancas:
            registrar_log('Alterou permissões do usuário', f'{user.username} · ' + ', '.join(mudancas), modulo='admin')
            db.session.commit()
            flash(f'Permissões de {user.nome} atualizadas ({len(mudancas)} alteração(ões)).', 'success')
        else:
            flash('Nenhuma alteração.', 'success')
        return redirect(url_for('admin.permissoes_usuario', usuario=user.id))

    # usuarios separados pela hierarquia, na ordem da arvore
    usuarios = Usuario.query.filter(Usuario.perfil.notin_(GESTAO)).order_by(Usuario.ativo.desc(), Usuario.nome).all()
    por_org = {}
    for u in usuarios:
        por_org.setdefault(u.organizacao_id, []).append(u)
    blocos = []

    def descer(organizacao, profundidade):
        blocos.append({'org': organizacao, 'nivel': profundidade, 'usuarios': por_org.get(organizacao.id, [])})
        for filho in sorted(organizacao.filhos, key=lambda o: o.nome.lower()):
            descer(filho, profundidade + 1)

    for raiz_org in Organizacao.query.filter_by(pai_id=None).order_by(Organizacao.id):
        descer(raiz_org, 0)
    if por_org.get(None):
        blocos.append({'org': None, 'nivel': 0, 'usuarios': por_org[None]})
    return render_template(
        'admin_permissoes_usuario.html', blocos=blocos, user=user, modulos=MODULOS, niveis=NIVEIS, rotulo_nivel=dict(NIVEIS),
        perfis=dict(PERFIS), rotulo_tipo=ROTULO_TIPO,
        proprias_por_usuario=dict(db.session.query(PermissaoUsuario.usuario_id, db.func.count()).group_by(PermissaoUsuario.usuario_id)),
        pelo_perfil={p.modulo: p.nivel for p in Permissao.query.filter_by(perfil=user.perfil)} if user else {},
        proprias={p.modulo: p.nivel for p in PermissaoUsuario.query.filter_by(usuario_id=user.id)} if user else {})


@bp.route('/logs')
@perm('admin')
def logs():
    busca = (request.args.get('q') or '').strip()
    consulta = LogAcao.query
    if busca:
        like = f'%{busca.lower()}%'
        consulta = consulta.filter(db.or_(db.func.lower(LogAcao.usuario).like(like),
                                          db.func.lower(LogAcao.acao).like(like),
                                          db.func.lower(LogAcao.detalhe).like(like)))
    registros = consulta.order_by(LogAcao.criado_em.desc()).limit(300).all()
    return render_template('admin_logs.html', registros=registros, busca=busca)
