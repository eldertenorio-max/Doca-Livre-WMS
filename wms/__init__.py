"""WMS Doca Livre - fabrica da aplicacao Flask."""
import os
import secrets
from datetime import timedelta

from flask import Flask, render_template

from .core import garantir_permissoes_padrao, registrar_nucleo
from .models import LogAcao, Usuario, db

ASSETS_VERSION = '45'
VERSAO = 'v1.0'


def _database_url(app):
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if not url:
        return 'sqlite:///' + os.path.join(app.instance_path, 'wms.db').replace('\\', '/')
    # Render/Supabase entregam postgres:// ou postgresql://; o driver instalado e o psycopg 3.
    for prefixo in ('postgres://', 'postgresql://'):
        if url.startswith(prefixo):
            return 'postgresql+psycopg://' + url[len(prefixo):]
    return url


def _secret_key(app):
    chave = os.environ.get('SECRET_KEY')
    if chave:
        return chave
    # Sem SECRET_KEY no ambiente (uso local): gera uma vez e guarda em instance/.
    caminho = os.path.join(app.instance_path, 'secret_key')
    if os.path.exists(caminho):
        with open(caminho, encoding='utf-8') as arq:
            return arq.read().strip()
    chave = secrets.token_hex(32)
    with open(caminho, 'w', encoding='utf-8') as arq:
        arq.write(chave)
    return chave


def _garantir_colunas():
    """Acrescenta ao banco as colunas novas dos modelos (o create_all so cria tabelas que faltam).

    Cobre a evolucao passo a passo do sistema sem apagar dados: so ADD COLUMN, nunca altera nem remove.
    """
    from sqlalchemy import inspect, text

    inspetor = inspect(db.engine)
    for tabela in db.metadata.sorted_tables:
        if not inspetor.has_table(tabela.name):
            continue
        existentes = {c['name'] for c in inspetor.get_columns(tabela.name)}
        for coluna in tabela.columns:
            if coluna.name in existentes:
                continue
            tipo = coluna.type.compile(dialect=db.engine.dialect)
            padrao = ''
            if not coluna.nullable:
                # Coluna obrigatoria nova precisa de valor para as linhas que ja existem.
                valor = coluna.default.arg if coluna.default is not None and not callable(coluna.default.arg) else 0
                if isinstance(valor, bool):
                    valor = 'TRUE' if valor else 'FALSE'
                elif isinstance(valor, str):
                    valor = "'" + valor.replace("'", "''") + "'"
                padrao = f' DEFAULT {valor} NOT NULL'
            with db.engine.begin() as conexao:
                conexao.execute(text(f'ALTER TABLE {tabela.name} ADD COLUMN {coluna.name} {tipo}{padrao}'))


def _criar_admin_inicial(app):
    if Usuario.query.count():
        return
    senha = os.environ.get('ADMIN_PASSWORD') or 'admin'
    admin = Usuario(username='admin', nome='Administrador', perfil='super',
                    trocar_senha=not os.environ.get('ADMIN_PASSWORD'))
    admin.set_password(senha)
    db.session.add(admin)
    db.session.commit()
    app.logger.warning('Usuario inicial criado: admin (troca de senha obrigatoria no primeiro acesso).')


def _garantir_super(app):
    """Banco que ja existia antes do perfil Super Usuario: o administrador ativo mais antigo passa a ser o super."""
    if Usuario.query.filter_by(perfil='super').count():
        return
    primeiro = Usuario.query.filter_by(perfil='admin', ativo=True).order_by(Usuario.id).first() \
        or Usuario.query.filter_by(perfil='admin').order_by(Usuario.id).first()
    if not primeiro:
        return
    primeiro.perfil = 'super'
    db.session.add(LogAcao(usuario='sistema', modulo='admin', acao='Promoveu a Super Usuário',
                           detalhe=f'{primeiro.username} (administrador mais antigo, na criação do perfil)'))
    db.session.commit()
    app.logger.warning('Usuario %s promovido a Super Usuario.', primeiro.username)


# Endereco oficial do WMS (Azure Container Apps, ao lado do banco). O servico antigo do Render continua existindo so
# para quem tem o endereco antigo salvo: la, todo acesso e redirecionado para ca.
URL_OFICIAL_AZURE = 'https://doca-livre-wms-pro.purpleocean-4b1d485c.brazilsouth.azurecontainerapps.io'


def destino_do_redirecionamento():
    """REDIRECIONAR_PARA (qualquer ambiente) ou, rodando no Render, o endereco oficial na Azure. Vazio = nao redireciona."""
    destino = (os.environ.get('REDIRECIONAR_PARA') or '').strip()
    if destino:
        return destino
    if (os.environ.get('RENDER') or '').strip().lower() == 'true' and not os.environ.get('WMS_RODAR_NO_RENDER'):
        return URL_OFICIAL_AZURE
    return ''


def create_app():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(raiz, '.env'))
    except ImportError:
        pass

    app = Flask(__name__, instance_path=os.path.join(raiz, 'instance'),
                template_folder=os.path.join(raiz, 'templates'),
                static_folder=os.path.join(raiz, 'static'))
    os.makedirs(app.instance_path, exist_ok=True)

    app.config.update(
        SECRET_KEY=_secret_key(app),
        SQLALCHEMY_DATABASE_URI=_database_url(app),
        SQLALCHEMY_ENGINE_OPTIONS={'pool_pre_ping': True},
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE', '').lower() in ('1', 'true'),
        MAX_CONTENT_LENGTH=20 * 1024 * 1024,
        ASSETS_VERSION=ASSETS_VERSION,
        VERSAO=VERSAO,
    )

    destino = destino_do_redirecionamento()
    if destino:
        # Este servico so encaminha para o endereco oficial: nao abre banco nem monta as telas.
        from urllib.parse import urlparse

        from flask import jsonify, redirect, request

        alvo = urlparse(destino)

        @app.route('/api/health')
        def _saude():
            return jsonify(ok=True, redireciona_para=destino)

        @app.before_request
        def _encaminhar():
            if request.path == '/api/health' or not alvo.scheme or not alvo.netloc or request.host.lower() == alvo.netloc.lower():
                return None
            caminho = request.full_path if request.query_string else request.path
            return redirect(destino.rstrip('/') + caminho, code=302 if request.method in ('GET', 'HEAD') else 307)

        @app.errorhandler(404)
        def _nao_achou(_erro):
            return redirect(destino)

        return app

    db.init_app(app)
    registrar_nucleo(app)

    from .admin import bp as admin_bp
    from .cadastros import bp as cadastros_bp
    from .enderecamento import bp as enderecamento_bp
    from .entrada import bp as entrada_bp
    from .movimentacao import bp as movimentacao_bp
    from .saida import bp as saida_bp
    from .principal import bp as principal_bp
    from .retornos import bp as retornos_bp
    from .estoque import bp as estoque_bp
    from .temperaturas import bp as temperaturas_bp
    from .inventario import bp as inventario_bp
    from .relatorios import bp as relatorios_bp
    from .agendamento import bp as agendamento_bp
    from .financeiro import bp as financeiro_bp
    from .hierarquia import bp as hierarquia_bp
    from . import sistema
    from .fechamento import bp as fechamento_bp
    from .portal import bp as portal_bp
    from . import coletor
    app.register_blueprint(principal_bp)
    app.register_blueprint(cadastros_bp)
    app.register_blueprint(enderecamento_bp)
    app.register_blueprint(entrada_bp)
    app.register_blueprint(movimentacao_bp)
    app.register_blueprint(saida_bp)
    app.register_blueprint(retornos_bp)
    app.register_blueprint(estoque_bp)
    app.register_blueprint(temperaturas_bp)
    app.register_blueprint(inventario_bp)
    app.register_blueprint(relatorios_bp)
    app.register_blueprint(agendamento_bp)
    app.register_blueprint(financeiro_bp)
    app.register_blueprint(hierarquia_bp)
    app.register_blueprint(sistema.bp)
    app.register_blueprint(fechamento_bp)
    app.register_blueprint(portal_bp)
    app.register_blueprint(coletor.bp)
    coletor.registrar(app)
    sistema.registrar(app)
    app.register_blueprint(admin_bp)

    if app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
        # O SQLite so respeita chave estrangeira se pedirmos em cada conexao.
        from sqlalchemy import event

        with app.app_context():
            @event.listens_for(db.engine, 'connect')
            def _fk_sqlite(conexao, _registro):
                conexao.execute('PRAGMA foreign_keys=ON')

    for codigo, titulo, mensagem in (
        (400, 'Requisição inválida', None),
        (403, 'Acesso negado', 'Seu perfil não tem permissão para esta tela ou ação.'),
        (404, 'Página não encontrada', 'O endereço acessado não existe.'),
        (500, 'Erro interno', 'Algo deu errado. Tente novamente.'),
    ):
        def _handler(erro, codigo=codigo, titulo=titulo, mensagem=mensagem):
            if codigo == 500:
                db.session.rollback()
            texto = mensagem or getattr(erro, 'description', '')
            return render_template('erro.html', codigo=codigo, titulo=titulo, mensagem=texto), codigo
        app.register_error_handler(codigo, _handler)

    with app.app_context():
        db.create_all()
        _garantir_colunas()
        garantir_permissoes_padrao()
        _criar_admin_inicial(app)
        _garantir_super(app)

    return app
