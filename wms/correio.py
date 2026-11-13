"""Envio de e-mail do WMS, do mesmo jeito que o Faz um Freela: pelo Azure Communication Services (ACS).

Na Azure o sistema se autentica com a propria identidade gerenciada, sem chave guardada: bastam ACS_ENDPOINT e
EMAIL_FROM. Fora da Azure da para usar ACS_CONNECTION_STRING ("endpoint=https://...;accesskey=...") ou um servidor
SMTP comum (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM). Sem nada disso, nao envia.
"""
import base64
import hashlib
import hmac
import json
import os
import smtplib
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formatdate

VERSAO_DA_API = '2023-03-31'
RECURSO = 'https://communication.azure.com'
_token = {'valor': None, 'expira': 0}


def _acs():
    partes = {}
    for parte in (os.environ.get('ACS_CONNECTION_STRING') or '').split(';'):
        chave, _, valor = parte.partition('=')
        if valor:
            partes[chave.strip().lower()] = valor.strip()
    return {'endpoint': (os.environ.get('ACS_ENDPOINT') or partes.get('endpoint') or '').strip().rstrip('/'),
            'remetente': (os.environ.get('EMAIL_FROM') or '').strip(), 'chave': partes.get('accesskey') or ''}


def meio():
    """Por onde o e-mail sai: 'acs', 'smtp' ou None (nao configurado)."""
    acs = _acs()
    if acs['endpoint'] and acs['remetente']:
        return 'acs'
    return 'smtp' if os.environ.get('SMTP_HOST') else None


def configurado():
    return meio() is not None


def _token_da_identidade():
    if _token['valor'] and _token['expira'] - 300 > time.time():
        return _token['valor']
    endereco, cabecalho = os.environ.get('IDENTITY_ENDPOINT'), os.environ.get('IDENTITY_HEADER')
    if not endereco or not cabecalho:
        raise RuntimeError('sem identidade gerenciada e sem ACS_CONNECTION_STRING')
    pedido = urllib.request.Request(f'{endereco}?api-version=2019-08-01&resource={urllib.parse.quote(RECURSO, safe="")}',
                                    headers={'X-IDENTITY-HEADER': cabecalho})
    with urllib.request.urlopen(pedido, timeout=10) as resposta:
        dados = json.loads(resposta.read())
    _token.update(valor=dados['access_token'], expira=float(dados['expires_on']))
    return _token['valor']


def assinar_pedido(url, corpo, chave, data=None):
    """Cabecalhos HMAC-SHA256 que o ACS exige quando o pedido usa a chave de acesso."""
    data = data or formatdate(usegmt=True)
    u = urllib.parse.urlsplit(url)
    hash_do_corpo = base64.b64encode(hashlib.sha256(corpo).digest()).decode()
    texto = f'POST\n{u.path}?{u.query}\n{data};{u.netloc};{hash_do_corpo}'
    assinatura = base64.b64encode(hmac.new(base64.b64decode(chave), texto.encode(), hashlib.sha256).digest()).decode()
    return {'x-ms-date': data, 'x-ms-content-sha256': hash_do_corpo,
            'Authorization': f'HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature={assinatura}'}


def _enviar_acs(para, assunto, texto, html):
    acs = _acs()
    url = f'{acs["endpoint"]}/emails:send?api-version={VERSAO_DA_API}'
    conteudo = {'subject': assunto, 'plainText': texto}
    if html:
        conteudo['html'] = html
    corpo = json.dumps({'senderAddress': acs['remetente'], 'recipients': {'to': [{'address': e} for e in para]},
                        'content': conteudo}).encode()
    cabecalhos = assinar_pedido(url, corpo, acs['chave']) if acs['chave'] else {'Authorization': f'Bearer {_token_da_identidade()}'}
    pedido = urllib.request.Request(url, data=corpo, method='POST', headers={'Content-Type': 'application/json', **cabecalhos})
    try:
        with urllib.request.urlopen(pedido, timeout=20) as resposta:
            return resposta.status in (200, 202)
    except urllib.error.HTTPError as erro:
        raise RuntimeError(f'Azure recusou ({erro.code}), remetente {acs["remetente"]}: {erro.read()[:400]!r}') from None


def _enviar_smtp(para, assunto, texto, html):
    mensagem = EmailMessage()
    mensagem['Subject'] = assunto
    mensagem['From'] = os.environ.get('SMTP_FROM') or os.environ.get('SMTP_USER') or 'wms@localhost'
    mensagem['To'] = ', '.join(para)
    mensagem.set_content(texto)
    if html:
        mensagem.add_alternative(html, subtype='html')
    with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT') or 587), timeout=15) as servidor:
        if os.environ.get('SMTP_TLS', '1') != '0':
            servidor.starttls()
        if os.environ.get('SMTP_USER'):
            servidor.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD') or '')
        servidor.send_message(mensagem)
    return True


def enviar_email(para, assunto, texto, html=None, rotulo='e-mail'):
    """Envia um e-mail. Devolve 'ok', 'nao_configurado' ou 'falhou' (o motivo da falha vai so para o log do servidor)."""
    para = [para] if isinstance(para, str) else list(para)
    por = meio()
    if not por or not para:
        return 'nao_configurado'
    try:
        return 'ok' if (_enviar_acs if por == 'acs' else _enviar_smtp)(para, assunto, texto, html) else 'falhou'
    except Exception as erro:  # noqa: BLE001 - e-mail fora do ar nao pode derrubar a tela
        print(f'[email] Falha ao enviar {rotulo}: {erro}', flush=True)
        return 'falhou'
