"""Login, painel inicial, troca de senha e telas ainda em construcao."""
import os
from urllib.parse import urlparse

from flask import (Blueprint, abort, current_app, flash, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)

from .cadastros import contagens
from .catalogo import MODULOS, MODULOS_POR_ID, telas_prontas
from .core import (apagar_arquivo, exigir, garantir_no_disco, guardar_arquivo, pode_ver, registrar_log, tipo_da_imagem, url_tela,
                   usuario_atual)
from .models import NotaFiscal, Palete, Usuario, agora, db
from .painel import abas_do_usuario, dados_do_painel

bp = Blueprint('principal', __name__)


def _destino_seguro(destino):
    """Aceita so caminhos internos, para o ?next= nao virar redirecionamento aberto."""
    if not destino:
        return None
    partes = urlparse(destino)
    if partes.scheme or partes.netloc or not destino.startswith('/') or destino.startswith('//'):
        return None
    return destino


@bp.route('/login', methods=['GET', 'POST'])
def login():
    if usuario_atual():
        return redirect(url_for('principal.dashboard'))
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        senha = request.form.get('password') or ''
        user = Usuario.query.filter(db.func.lower(Usuario.username) == username.lower()).first()
        if user and user.ativo and user.check_password(senha):
            destino = _destino_seguro(request.form.get('next'))
            session.clear()
            session.permanent = True
            session['user_id'] = user.id
            user.ultimo_acesso = agora()
            db.session.commit()
            return redirect(destino or url_for('principal.dashboard'))
        flash('Usuário ou senha inválidos.', 'error')
    return render_template('login.html')


@bp.route('/sair')
def logout():
    session.clear()
    return redirect(url_for('principal.login'))


@bp.route('/')
def dashboard():
    if usuario_atual().perfil == 'cliente':
        return redirect(url_for('portal.inicio'))
    modulos = []
    for modulo in MODULOS:
        if not pode_ver(modulo['id']):
            continue
        prontas = telas_prontas(modulo)
        # Abre na primeira tela ja construida do modulo; se nao houver, na primeira prevista.
        primeira = next((t for t in modulo['telas'] if t.get('endpoint')), modulo['telas'][0])
        modulos.append({**modulo, 'url': url_tela(modulo, primeira), 'prontas': prontas,
                        'situacao': 'pronto' if prontas == len(modulo['telas'])
                        else ('parcial' if prontas else 'pendente')})
    if not request.args.get('aba'):
        return render_template('inicio.html')          # primeira tela: boas-vindas (como no Oferta de Carga)
    abas = abas_do_usuario()
    aba = request.args.get('aba')
    if aba not in {chave for chave, _, _ in abas}:
        aba = 'geral'
    cadastros = contagens() if aba == 'modulos' and pode_ver('cadastros') else []
    return render_template('dashboard.html', modulos=modulos, cadastros=cadastros, abas=abas, aba=aba, d=dados_do_painel(aba))


@bp.route('/modulo/<modulo>/<tela>')
def em_construcao(modulo, tela):
    mod = MODULOS_POR_ID.get(modulo)
    item = next((t for t in mod['telas'] if t['id'] == tela), None) if mod else None
    if not item or item.get('endpoint'):
        abort(404)
    exigir(modulo)
    return render_template('em_construcao.html', modulo=mod, tela=item)


@bp.route('/senha', methods=['GET', 'POST'])
def senha():
    user = usuario_atual()
    if request.method == 'POST':
        atual = request.form.get('atual') or ''
        nova = request.form.get('nova') or ''
        confirma = request.form.get('confirma') or ''
        if not user.check_password(atual):
            flash('Senha atual incorreta.', 'error')
        elif len(nova) < 6:
            flash('A nova senha precisa ter pelo menos 6 caracteres.', 'error')
        elif nova != confirma:
            flash('A confirmação não confere com a nova senha.', 'error')
        elif nova == atual:
            flash('A nova senha precisa ser diferente da atual.', 'error')
        else:
            user.set_password(nova)
            user.trocar_senha = False
            registrar_log('Trocou a própria senha', modulo='admin')
            db.session.commit()
            flash('Senha alterada com sucesso.', 'success')
            return redirect(url_for('principal.dashboard'))
    return render_template('senha.html', obrigatoria=user.trocar_senha)


# ---------------------------------------------------------------- painel do usuario (canto superior direito)

_TAMANHO_MAXIMO_FOTO = 3 * 1024 * 1024


def _pasta_avatars():
    pasta = os.path.join(current_app.instance_path, 'avatars')
    os.makedirs(pasta, exist_ok=True)
    return pasta


@bp.route('/perfil/painel')
def perfil_painel():
    """Conteudo do painel do usuario, carregado quando ele clica no canto superior direito."""
    user = usuario_atual()
    return render_template('_perfil_painel.html',
                           notas=NotaFiscal.query.filter_by(criado_por=user.username).count(),
                           paletes=Palete.query.filter_by(criado_por=user.username).count())


@bp.route('/perfil/foto', methods=['POST'])
def perfil_foto():
    user = usuario_atual()
    voltar = redirect(request.referrer or url_for('principal.dashboard'))
    antiga = os.path.join(_pasta_avatars(), user.avatar) if user.avatar else None
    if request.form.get('acao') == 'excluir':
        if user.avatar:
            apagar_arquivo('avatars', user.avatar)
        user.avatar = None
        db.session.commit()
        if antiga and os.path.exists(antiga):
            os.remove(antiga)
        flash('Foto de perfil removida.', 'success')
        return voltar
    arquivo = request.files.get('foto')
    conteudo = arquivo.read(_TAMANHO_MAXIMO_FOTO + 1) if arquivo else b''
    extensao = tipo_da_imagem(conteudo)
    if not extensao:
        flash('Use uma foto JPG, PNG ou WEBP.', 'error')
        return voltar
    if len(conteudo) > _TAMANHO_MAXIMO_FOTO:
        flash('A foto precisa ter no máximo 3 MB.', 'error')
        return voltar
    # Nome novo a cada troca: o navegador nao fica mostrando a foto antiga guardada em cache.
    nome = f'{user.id}-{int(agora().timestamp())}.{extensao}'
    with open(os.path.join(_pasta_avatars(), nome), 'wb') as destino:
        destino.write(conteudo)
    guardar_arquivo('avatars', nome, conteudo)
    if user.avatar:
        apagar_arquivo('avatars', user.avatar)
    user.avatar = nome
    db.session.commit()
    if antiga and os.path.exists(antiga):
        os.remove(antiga)
    flash('Foto de perfil atualizada.', 'success')
    return voltar


@bp.route('/perfil/foto/<nome>')
def avatar(nome):
    garantir_no_disco(_pasta_avatars(), 'avatars', nome)
    return send_from_directory(_pasta_avatars(), nome, max_age=86400)


@bp.route('/api/health')
def saude():
    return jsonify(ok=True)
