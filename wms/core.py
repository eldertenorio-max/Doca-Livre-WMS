"""Nucleo compartilhado: permissoes, menu, CSRF e log."""
import secrets
from functools import wraps

from flask import abort, g, redirect, request, session, url_for

from .catalogo import MODULOS, MODULOS_OPERACAO
from .models import LogAcao, Permissao, PermissaoUsuario, Usuario, db

SEM_ACESSO, VISUALIZAR, EDITAR = 0, 1, 2
NIVEIS = [(SEM_ACESSO, 'Sem acesso'), (VISUALIZAR, 'Visualizar'), (EDITAR, 'Editar')]

# Super Usuario: acima do Administrador (modelo do Faz um Freela). Nasce na inicializacao do sistema e nao ha tela
# para promover alguem a super. Pode tudo o que o administrador pode e so ele cria, edita, promove, rebaixa ou
# redefine a senha de administradores. Nao aparece para o administrador comum e nao pode ser rebaixado nem desativado.
PERFIS = [
    ('super', 'Super Usuário'),
    ('admin', 'Administrador'),
    ('supervisor', 'Supervisor'),
    ('operador', 'Operador'),
    ('consulta', 'Consulta'),
    ('cliente', 'Cliente (portal)'),          # embarcador: so entra no Portal do cliente
]


GESTAO = ('super', 'admin')          # perfis que sempre editam tudo


def eh_super(user=None):
    user = user or usuario_atual()
    return bool(user and user.perfil == 'super')


def nivel_padrao(perfil, modulo):
    if perfil in GESTAO:
        return EDITAR
    if perfil == 'cliente':
        return VISUALIZAR if modulo == 'portal' else SEM_ACESSO
    if modulo in ('admin', 'financeiro', 'hierarquia', 'portal'):
        return SEM_ACESSO
    if perfil == 'supervisor':
        return EDITAR
    if perfil == 'operador':
        return EDITAR if modulo in MODULOS_OPERACAO else VISUALIZAR
    return VISUALIZAR


def garantir_permissoes_padrao():
    """Cria as linhas que faltam na matriz (novos modulos ou perfis) sem alterar as existentes."""
    existentes = {(p.perfil, p.modulo) for p in Permissao.query.all()}
    for perfil, _ in PERFIS:
        for modulo in MODULOS:
            if (perfil, modulo['id']) not in existentes:
                db.session.add(Permissao(perfil=perfil, modulo=modulo['id'],
                                         nivel=nivel_padrao(perfil, modulo['id'])))
    db.session.commit()


# ---------------------------------------------------------------- sessao / permissao

def usuario_atual():
    if 'usuario' not in g:
        uid = session.get('user_id')
        user = db.session.get(Usuario, uid) if uid else None
        g.usuario = user if user and user.ativo else None
    return g.usuario


_PREFIXOS = {}          # modulo -> [(prefixo do caminho, id da tela)], do mais comprido para o mais curto


def tela_do_caminho(modulo, caminho):
    """Id da tela do modulo a que o caminho pertence (pelo endereco da tela e pelos "tambem" do catalogo).
    None = o caminho nao e de nenhuma tela desse modulo (vale a permissao do modulo)."""
    if modulo not in _PREFIXOS:
        definicao = next((m for m in MODULOS if m['id'] == modulo), None)
        prefixos = []
        for tela in (definicao['telas'] if definicao else []):
            if not tela.get('endpoint'):
                continue
            url = url_for(tela['endpoint'], **tela.get('args', {}))
            prefixos += [(p, tela['id']) for p in [(url.rstrip('/') or '/')] + tela.get('tambem', [])]
        _PREFIXOS[modulo] = sorted(prefixos, key=lambda par: -len(par[0]))
    caminho = caminho.rstrip('/') or '/'
    for prefixo, tela in _PREFIXOS[modulo]:
        if caminho == prefixo or caminho.startswith(prefixo + '/'):
            return tela
    return None


def _niveis(user):
    """Niveis do usuario: os do perfil e, por cima, os proprios dele (dados pelo Super Usuario).
    Chave "modulo" = o modulo inteiro; chave "modulo/tela" = so aquela tela."""
    if 'niveis' not in g:
        g.niveis = {p.modulo: p.nivel for p in Permissao.query.filter_by(perfil=user.perfil)}
        g.niveis.update({p.modulo: p.nivel for p in PermissaoUsuario.query.filter_by(usuario_id=user.id)})
    return g.niveis


def nivel_tela(modulo, tela):
    """Nivel do usuario logado numa tela: a permissao propria da tela, senao a do modulo."""
    user = usuario_atual()
    if not user:
        return SEM_ACESSO
    if user.perfil in GESTAO:
        return EDITAR
    niveis = _niveis(user)
    return niveis.get(f'{modulo}/{tela}', niveis.get(modulo, SEM_ACESSO))


def nivel(modulo):
    """Nivel do usuario logado no modulo. Administrador e Super Usuario sempre editam tudo.

    Quando a pagina aberta e de uma tela desse modulo, vale o nivel da tela (assim os botoes e as acoes da pagina
    seguem a permissao da propria tela)."""
    user = usuario_atual()
    if not user:
        return SEM_ACESSO
    if user.perfil in GESTAO:
        return EDITAR
    niveis = _niveis(user)
    tela = tela_do_caminho(modulo, g.get('menu_caminho') or request.path)
    if tela and f'{modulo}/{tela}' in niveis:
        return niveis[f'{modulo}/{tela}']
    return niveis.get(modulo, SEM_ACESSO)


def pode_ver(modulo):
    return nivel(modulo) >= VISUALIZAR


def pode_editar(modulo):
    return nivel(modulo) >= EDITAR


def exigir(modulo, editar=False):
    if nivel(modulo) < (EDITAR if editar else VISUALIZAR):
        abort(403)


def perm(modulo):
    """Protege a rota: GET exige Visualizar, qualquer outro metodo exige Editar."""
    def decorador(view):
        @wraps(view)
        def envolvida(*args, **kwargs):
            exigir(modulo, editar=request.method != 'GET')
            return view(*args, **kwargs)
        return envolvida
    return decorador


def guardar_arquivo(pasta, nome, conteudo):
    """Guarda no banco a copia de uma imagem enviada (quem chama faz o commit)."""
    from .models import ArquivoEnviado
    db.session.merge(ArquivoEnviado(pasta=pasta, nome=nome, conteudo=conteudo))


def apagar_arquivo(pasta, nome):
    from .models import ArquivoEnviado
    ArquivoEnviado.query.filter_by(pasta=pasta, nome=nome).delete()


def garantir_no_disco(diretorio, pasta, nome):
    """Se a imagem nao esta mais no disco (aplicativo reiniciado), recria a partir da copia do banco."""
    import os

    from .models import ArquivoEnviado
    caminho = os.path.join(diretorio, nome)
    if os.path.basename(nome) != nome or os.path.exists(caminho):
        return
    guardado = db.session.get(ArquivoEnviado, (pasta, nome))
    if guardado:
        with open(caminho, 'wb') as destino:
            destino.write(guardado.conteudo)


def registrar_log(acao, detalhe='', modulo=None):
    user = usuario_atual()
    db.session.add(LogAcao(usuario=user.username if user else 'sistema',
                           modulo=modulo, acao=acao, detalhe=detalhe))


def tipo_da_imagem(conteudo):
    """Extensao ('jpg', 'png' ou 'webp') conferida pelo inicio do arquivo, sem confiar no nome enviado.
    None se nao for uma dessas imagens."""
    if conteudo.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if conteudo.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if conteudo[:4] == b'RIFF' and conteudo[8:12] == b'WEBP':
        return 'webp'
    return None


# ---------------------------------------------------------------- menu

def url_tela(modulo, tela):
    if tela.get('endpoint'):
        return url_for(tela['endpoint'], **tela.get('args', {}))
    return url_for('principal.em_construcao', modulo=modulo['id'], tela=tela['id'])


def menu_do_usuario():
    """Grupos do menu lateral, ja filtrados pela permissao do usuario."""
    # Tela que pertence a outro item do menu (ex.: a nota de um retorno abre na tela do recebimento) avisa aqui.
    caminho = g.get('menu_caminho') or request.path
    grupos = []
    for modulo in MODULOS:
        itens = []
        for tela in modulo['telas']:
            if nivel_tela(modulo['id'], tela['id']) < VISUALIZAR:
                continue                 # tela que este usuario nao pode abrir nao aparece
            url = url_tela(modulo, tela)
            # "tambem": outros caminhos que pertencem a esta tela (etapas sem item proprio no menu).
            # sem a barra final, para a tela "/retornos/" tambem marcar "/retornos/carga/3"
            prefixos = [(url.rstrip('/') or '/')] + tela.get('tambem', [])
            itens.append({'nome': tela['nome'], 'icone': tela['icone'], 'url': url,
                          'pronto': bool(tela.get('endpoint')),
                          'ativo': any(caminho.rstrip('/') == p or caminho.startswith(p + '/') for p in prefixos)})
        if itens:
            grupos.append({'id': modulo['id'], 'nome': modulo['nome'], 'icone': modulo['icone'],
                           'itens': itens, 'ativo': any(i['ativo'] for i in itens)})
    return grupos


# ---------------------------------------------------------------- CSRF

def csrf_token():
    if '_csrf' not in session:
        session['_csrf'] = secrets.token_urlsafe(32)
    return session['_csrf']


def validar_csrf():
    enviado = request.form.get('_csrf') or request.headers.get('X-CSRF-Token') or ''
    esperado = session.get('_csrf') or ''
    if not esperado or not secrets.compare_digest(enviado, esperado):
        abort(400, description='Sessão expirada ou formulário inválido. Recarregue a página e tente de novo.')


# ---------------------------------------------------------------- registro no app

ROTAS_PUBLICAS = {'principal.login', 'principal.saude', 'static'}


def registrar_nucleo(app):
    @app.before_request
    def _proteger():
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            validar_csrf()
        if request.endpoint in ROTAS_PUBLICAS or request.endpoint is None:
            return None
        user = usuario_atual()
        if not user:
            session.clear()
            return redirect(url_for('principal.login', next=request.full_path.rstrip('?')))
        if user.trocar_senha and request.endpoint not in ('principal.senha', 'principal.logout'):
            return redirect(url_for('principal.senha'))
        return None

    @app.context_processor
    def _contexto():
        user = usuario_atual()
        partes = user.nome.split() if user else []
        return {
            'usuario': user,
            # Iniciais para o avatar sem foto: primeiro e ultimo nome ("Maria Souza" -> "MS").
            'iniciais': (partes[0][0] + partes[-1][0] if len(partes) > 1 else (partes[0][:2] if partes else 'DL')).upper(),
            'versao': app.config['VERSAO'],
            'menu': menu_do_usuario() if user else [],
            'csrf_token': csrf_token,
            'pode_ver': pode_ver,
            'pode_editar': pode_editar,
            'eh_super': eh_super(user),
            'perfil_nome': dict(PERFIS).get(user.perfil, user.perfil) if user else '',
            'assets_version': app.config['ASSETS_VERSION'],
        }

    @app.template_filter('datahora')
    def _datahora(valor):
        return valor.strftime('%d/%m/%Y %H:%M') if valor else '—'

    @app.template_filter('numero')
    def _numero(valor):
        """1234.5 -> 1.234,5 (sem zeros sobrando)."""
        if valor is None or valor == '':
            return '—'
        texto = f'{float(valor):,.3f}'.rstrip('0').rstrip('.')
        return texto.replace(',', '#').replace('.', ',').replace('#', '.')
