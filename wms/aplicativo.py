"""Aplicativo Android do WMS (pasta android/): a parte do sistema que conversa com ele.

O app e uma Trusted Web Activity: abre o proprio WMS em tela cheia, com o login do Chrome. Alem disso ele tem, em
codigo nativo, um widget com as pendencias do armazem e o aviso de alertas graves. Para isso o app precisa buscar um
resumo sem a pessoa estar com o WMS aberto; como ele nao tem a sessao do navegador, usa um link pessoal com um codigo
(token) do usuario, entregue pelo botao "Ativar neste celular".

Rotas:
  /.well-known/assetlinks.json   prova para o Android de que o app e deste site (tira a barra de endereco)
  /api/app/resumo?token=...      pendencias do armazem para o widget e as notificacoes (so numeros, conforme a permissao)
  /aplicativo                    tela com o botao de baixar, o passo a passo e a ativacao do celular
"""
import os
import secrets
from urllib.parse import quote

from flask import Blueprint, flash, g, jsonify, redirect, render_template, request, url_for

from .core import ROTAS_PUBLICAS, exigir, perm, pode_ver, registrar_log, usuario_atual
from .models import NotaFiscal, Palete, Separacao, Usuario, agora, db

bp = Blueprint('aplicativo', __name__)

PACOTE = 'br.com.docalivre.wms'
# Impressao digital (SHA-256) da chave que assina o APK. E publica por natureza; a chave em si fica fora do codigo.
SHA256_DA_CHAVE = '95:CF:DE:CC:0D:34:5F:7E:71:EA:E7:F9:1E:9D:6E:FD:FB:1C:15:B9:F1:64:69:AE:22:9F:34:CC:7D:6E:37:11'
APK_URL = os.environ.get('APP_APK_URL') or 'https://github.com/eldertenorio-max/Doca-Livre-WMS/releases/download/android-latest/doca-livre-wms.apk'

ROTAS_PUBLICAS.update({'aplicativo.assetlinks', 'aplicativo.resumo'})


@bp.route('/.well-known/assetlinks.json')
def assetlinks():
    return jsonify([{'relation': ['delegate_permission/common.handle_all_urls'],
                     'target': {'namespace': 'android_app', 'package_name': PACOTE, 'sha256_cert_fingerprints': [SHA256_DA_CHAVE]}}])


def dados_do_resumo():
    """Pendencias do armazem, so do que o usuario (ja colocado em g.usuario) pode ver."""
    dados = {'usuario': usuario_atual().nome, 'aguardando_guarda': None, 'separacao': None, 'notas_abertas': None,
             'alertas': None, 'alertas_graves': 0, 'alerta_texto': ''}
    if pode_ver('recebimento'):
        dados['aguardando_guarda'] = Palete.query.filter_by(status='Aguardando guarda').count()
        dados['notas_abertas'] = NotaFiscal.query.filter(NotaFiscal.tipo == 'Entrada', NotaFiscal.status.in_(('Aguardando', 'Em conferência'))).count()
    if pode_ver('expedicao'):
        dados['separacao'] = Separacao.query.filter_by(status='Pendente').count()
    if pode_ver('estoque'):
        from .sistema import calcular_alertas
        alertas = calcular_alertas()
        graves = [a for a in alertas if a['grave']]
        dados['alertas'], dados['alertas_graves'] = len(alertas), len(graves)
        if graves:
            dados['alerta_texto'] = f'{graves[0]["tipo"]}: {graves[0]["titulo"]}'[:120]
    return dados


@bp.route('/api/app/resumo')
def resumo():
    token = request.args.get('token') or ''
    user = Usuario.query.filter_by(app_token=token).first() if len(token) >= 20 else None
    if not user or not user.ativo:
        return jsonify(erro='Celular não ativado.'), 401
    g.usuario = user                      # as permissoes passam a valer para este usuario nesta chamada
    versao = (request.headers.get('X-App-Versao') or '').strip()[:20]
    if versao:
        user.app_versao = versao
    user.app_visto_em = agora()
    db.session.commit()
    resposta = jsonify(dados_do_resumo())
    resposta.headers['Cache-Control'] = 'no-store'
    return resposta


def link_de_ativacao(user):
    """Link que abre o app ja instalado e entrega o link pessoal; sem o app, cai no download do APK."""
    endereco = url_for('aplicativo.resumo', token=user.app_token, _external=True)
    if request.headers.get('X-Forwarded-Proto', request.scheme) == 'https':
        endereco = endereco.replace('http://', 'https://', 1)
    return (f'intent://setup?u={quote(endereco, safe="")}#Intent;scheme=docalivrewms;package={PACOTE};'
            f'S.browser_fallback_url={quote(APK_URL, safe="")};end')


@bp.route('/aplicativo')
@perm('coletor')
def pagina():
    user = usuario_atual()
    return render_template('aplicativo.html', apk_url=APK_URL, ativacao=link_de_ativacao(user) if user.app_token else None,
                           no_celular='Android' in (request.headers.get('User-Agent') or ''))


@bp.route('/aplicativo/ativar', methods=['POST'])
def ativar():
    """Cria (ou troca) o codigo pessoal usado pelo app. Trocar desliga os celulares ativados antes.
    Basta poder ver o Coletor: o codigo e do proprio usuario, mesmo de quem so visualiza."""
    exigir('coletor')
    user = db.session.get(Usuario, usuario_atual().id)
    trocou = bool(user.app_token)
    user.app_token = secrets.token_urlsafe(32)
    user.app_versao, user.app_visto_em = None, None
    registrar_log('Trocou o código do aplicativo' if trocou else 'Criou o código do aplicativo', user.username, modulo='coletor')
    db.session.commit()
    flash('Código novo criado. Os celulares ativados antes param de receber o resumo: ative de novo neste celular.' if trocou
          else 'Pronto. Agora toque em "Ativar neste celular".', 'success')
    return redirect(url_for('aplicativo.pagina'))


@bp.route('/aplicativo/desativar', methods=['POST'])
def desativar():
    exigir('coletor')
    user = db.session.get(Usuario, usuario_atual().id)
    user.app_token, user.app_versao, user.app_visto_em = None, None, None
    registrar_log('Desativou o aplicativo', user.username, modulo='coletor')
    db.session.commit()
    flash('Aplicativo desativado para o seu usuário. O widget e os avisos param de funcionar nos celulares ativados.', 'success')
    return redirect(url_for('aplicativo.pagina'))
