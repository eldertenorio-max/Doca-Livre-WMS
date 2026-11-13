"""Confirmacao de cadastro por e-mail, como no Faz um Freela.

Quando um usuario e criado com e-mail (tela Administracao > Usuarios), ele recebe uma mensagem com um link. Por esse
link a pessoa confirma o e-mail e cria a propria senha; ate la o cadastro fica "aguardando confirmacao" e nao entra.
Nao existe cadastro pela tela de login: so quem administra os usuarios cria.
"""
import hashlib
import html as _html
import secrets
from datetime import timedelta

from flask import Blueprint, flash, redirect, render_template, request, url_for

from . import correio
from .core import ROTAS_PUBLICAS
from .models import LogAcao, Usuario, agora, db

bp = Blueprint('confirmacao', __name__)
ROTAS_PUBLICAS.add('confirmacao.confirmar')

VALIDADE_HORAS = 48


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def pendente(user):
    return bool(user.confirmacao_hash)


def link_externo(caminho):
    """Endereco completo; em producao sempre o dominio oficial."""
    from . import HOSTS_DE_PRODUCAO, URL_OFICIAL
    if request.host.split(':')[0].lower() in HOSTS_DE_PRODUCAO:
        return URL_OFICIAL + caminho
    return request.host_url.rstrip('/') + caminho


def montar_email(user, link):
    nome = (user.nome or '').strip() or 'olá'
    assunto = 'Doca Livre WMS - confirme seu cadastro'
    texto = (f'Olá, {nome}!\n\n'
             'Seu cadastro no Doca Livre WMS foi criado.\n'
             f'Seu usuário para entrar: {user.username}\n\n'
             'Para confirmar seu e-mail e criar sua senha, abra este link:\n'
             f'{link}\n\n'
             f'O link vale por {VALIDADE_HORAS} horas.\n\n'
             'Se você não esperava este cadastro, ignore este e-mail.')
    e = _html.escape
    corpo = (f'<p>Olá, <strong>{e(nome)}</strong>!</p>'
             '<p>Seu cadastro no <strong>Doca Livre WMS</strong> foi criado.</p>'
             f'<p>Seu usuário para entrar: <strong style="font-size:18px">{e(user.username)}</strong></p>'
             '<p>Para confirmar seu e-mail e criar sua senha, clique no botão:</p>'
             f'<p><a href="{e(link)}" style="display:inline-block;padding:12px 22px;background:#1a237e;color:#ffffff;'
             'border-radius:8px;text-decoration:none;font-weight:700">Confirmar cadastro</a></p>'
             f'<p style="color:#64748b;font-size:13px">Se o botão não abrir, copie este endereço no navegador:<br>{e(link)}</p>'
             f'<p style="color:#64748b;font-size:13px">O link vale por {VALIDADE_HORAS} horas. '
             'Se você não esperava este cadastro, ignore este e-mail.</p>')
    return assunto, texto, corpo


def enviar_confirmacao(user):
    """Gera um link novo (o anterior deixa de valer) e manda para o e-mail do usuario.
    Devolve (situacao, link), com situacao 'ok', 'nao_configurado' ou 'falhou'. Quem chama faz o commit."""
    token = secrets.token_urlsafe(32)
    user.confirmacao_hash = _hash(token)
    user.confirmacao_expira = agora() + timedelta(hours=VALIDADE_HORAS)
    user.email_confirmado_em = None
    link = link_externo(url_for('confirmacao.confirmar', token=token))
    assunto, texto, corpo = montar_email(user, link)
    return correio.enviar_email(user.email, assunto, texto, corpo, rotulo='confirmação de cadastro'), link


def avisar_resultado(user, situacao, link):
    """Mensagem para quem criou o cadastro ou pediu o reenvio."""
    if situacao == 'ok':
        flash(f'E-mail de confirmação enviado para {user.email}. {user.nome} só consegue entrar depois de abrir o link '
              f'e criar a senha (vale por {VALIDADE_HORAS} horas).', 'success')
    else:
        motivo = ('O envio de e-mail não está configurado neste ambiente.' if situacao == 'nao_configurado'
                  else 'Não foi possível enviar o e-mail agora.')
        flash(f'{motivo} Passe este link para {user.nome} confirmar o cadastro e criar a senha: {link}', 'error')


@bp.route('/confirmar/<token>', methods=['GET', 'POST'])
def confirmar(token):
    user = Usuario.query.filter_by(confirmacao_hash=_hash(token)).first()
    if not user or not user.ativo or not user.confirmacao_expira or user.confirmacao_expira < agora():
        return render_template('confirmar_cadastro.html', user=None), 410 if user else 404
    if request.method == 'POST':
        senha = request.form.get('senha') or ''
        if len(senha) < 6:
            flash('A senha precisa ter pelo menos 6 caracteres.', 'error')
        elif senha != (request.form.get('senha2') or ''):
            flash('As duas senhas não são iguais.', 'error')
        else:
            user.set_password(senha)
            user.trocar_senha = False
            user.confirmacao_hash = user.confirmacao_expira = None
            user.email_confirmado_em = agora()
            db.session.add(LogAcao(usuario=user.username, modulo='admin', acao='Confirmou o cadastro',
                                   detalhe=f'e-mail {user.email} confirmado pelo link'))
            db.session.commit()
            flash('Cadastro confirmado. Entre com o seu usuário e a senha que acabou de criar.', 'success')
            return redirect(url_for('principal.login'))
    return render_template('confirmar_cadastro.html', user=user)
