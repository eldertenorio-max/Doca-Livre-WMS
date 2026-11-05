"""SSO entre portal público (Plus) e sistemas Light / Plus / Pro (token HMAC)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

SSO_SYSTEMS = ('light', 'plus', 'pro')
SSO_TOKEN_TTL_SEC = 60
HUB_TOKEN_TTL_SEC = 8 * 60 * 60
# Sistema unificado: Light / Plus / Pro rodam no mesmo serviço (WMS Pro).
# Produção no domínio próprio https://wms.docalivre.com.br/
_DEFAULT_URLS_PROD = {
    'light': 'https://wms.docalivre.com.br/contagem',
    'plus': 'https://wms.docalivre.com.br/camaras',
    'pro': 'https://wms.docalivre.com.br/painel',
}
_DEFAULT_URLS_HML = {
    'light': 'https://doca-livre-wms-pro-homologacao.onrender.com/contagem',
    'plus': 'https://doca-livre-wms-pro-homologacao.onrender.com/camaras',
    'pro': 'https://doca-livre-wms-pro-homologacao.onrender.com/painel',
}
_DEFAULT_PORTAL_PROD = 'https://wms.docalivre.com.br/'
_DEFAULT_PORTAL_HML = 'https://doca-livre-wms-pro-homologacao.onrender.com/'


def _is_homolog_env() -> bool:
    raw = (os.environ.get('APP_ENV') or '').strip().lower()
    if raw in ('homolog', 'homologacao', 'hml', 'staging', 'stg'):
        return True
    svc = (os.environ.get('RENDER_SERVICE_NAME') or '').strip().lower()
    return 'homolog' in svc or svc.endswith('-hml')


def _default_urls() -> dict[str, str]:
    return _DEFAULT_URLS_HML if _is_homolog_env() else _DEFAULT_URLS_PROD


def portal_public_url() -> str:
    """Link único público — Plus prod ou homolog."""
    env = (os.environ.get('PORTAL_PUBLIC_URL') or '').strip()
    if env:
        return env if env.endswith('/') else env + '/'
    return _DEFAULT_PORTAL_HML if _is_homolog_env() else _DEFAULT_PORTAL_PROD


_used_jti_lock = threading.Lock()
_used_jti: dict[str, float] = {}


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def _b64url_decode(text: str) -> bytes:
    pad = '=' * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + pad).encode('ascii'))


def sso_secret() -> str:
    secret = (os.environ.get('SSO_SECRET') or '').strip()
    if secret:
        return secret
    return (os.environ.get('SECRET_KEY') or 'ultrapao-secret-key-2024').strip()


def system_base_url(system_id: str) -> str | None:
    sid = (system_id or '').strip().lower()
    defaults = _default_urls()
    env_map = {
        'light': 'SYSTEM_URL_LIGHT',
        'plus': 'SYSTEM_URL_PLUS',
        'pro': 'SYSTEM_URL_PRO',
    }
    env_key = env_map.get(sid)
    if not env_key:
        return None
    return (os.environ.get(env_key) or defaults.get(sid) or '').strip() or None


def _sign_payload(payload: dict[str, Any]) -> str:
    body = _b64url_encode(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))
    sig = _b64url_encode(
        hmac.new(sso_secret().encode('utf-8'), body.encode('ascii'), hashlib.sha256).digest()
    )
    return f'{body}.{sig}'


def _read_signed_payload(token: str) -> dict[str, Any]:
    raw = (token or '').strip()
    if not raw or '.' not in raw:
        raise ValueError('Token inválido.')
    body, _, sig = raw.partition('.')
    if not body or not sig:
        raise ValueError('Token inválido.')
    expected = _b64url_encode(
        hmac.new(sso_secret().encode('utf-8'), body.encode('ascii'), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(expected, sig):
        raise ValueError('Assinatura inválida.')
    try:
        payload = json.loads(_b64url_decode(body).decode('utf-8'))
    except Exception as exc:
        raise ValueError('Payload inválido.') from exc
    if not isinstance(payload, dict):
        raise ValueError('Payload inválido.')
    return payload


def _purge_used_jti(now: float | None = None) -> None:
    agora = time.time() if now is None else now
    mortos = [k for k, exp in _used_jti.items() if exp <= agora]
    for k in mortos:
        _used_jti.pop(k, None)


def _mark_jti_used(jti: str, exp: float) -> bool:
    with _used_jti_lock:
        _purge_used_jti()
        if jti in _used_jti:
            return False
        _used_jti[jti] = float(exp) + 5.0
        return True


def issue_hub_token(usuario: str, ttl_sec: int = HUB_TOKEN_TTL_SEC) -> str:
    usuario = (usuario or '').strip()
    if not usuario:
        raise ValueError('Usuário inválido.')
    now = int(time.time())
    return _sign_payload({
        'u': usuario,
        't': 'hub',
        'exp': now + max(300, int(ttl_sec)),
        'jti': uuid.uuid4().hex,
        'iat': now,
    })


def verify_hub_token(token: str) -> dict[str, Any]:
    payload = _read_signed_payload(token)
    if str(payload.get('t') or '') != 'hub':
        raise ValueError('Token de portal inválido.')
    usuario = str(payload.get('u') or '').strip()
    try:
        exp = float(payload.get('exp') or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError('Expiração inválida.') from exc
    if not usuario:
        raise ValueError('Token incompleto.')
    if time.time() > exp:
        raise ValueError('Sessão do portal expirada. Faça login novamente.')
    return {'usuario': usuario, 'exp': exp}


def issue_token(usuario: str, system_id: str, ttl_sec: int = SSO_TOKEN_TTL_SEC) -> str:
    usuario = (usuario or '').strip()
    system_id = (system_id or '').strip().lower()
    if not usuario:
        raise ValueError('Usuário inválido.')
    if system_id not in SSO_SYSTEMS:
        raise ValueError('Sistema inválido.')
    now = int(time.time())
    return _sign_payload({
        'u': usuario,
        's': system_id,
        't': 'sso',
        'exp': now + max(15, int(ttl_sec)),
        'jti': uuid.uuid4().hex,
        'iat': now,
    })


def verify_token(token: str, *, expected_system: str | None = None, consume: bool = True) -> dict[str, Any]:
    payload = _read_signed_payload(token)
    kind = str(payload.get('t') or 'sso')
    if kind == 'hub':
        raise ValueError('Use o endpoint de portal para este token.')
    usuario = str(payload.get('u') or '').strip()
    system_id = str(payload.get('s') or '').strip().lower()
    jti = str(payload.get('jti') or '').strip()
    try:
        exp = float(payload.get('exp') or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError('Expiração inválida.') from exc
    if not usuario or system_id not in SSO_SYSTEMS or not jti:
        raise ValueError('Token incompleto.')
    if expected_system and system_id != expected_system.strip().lower():
        raise ValueError('Token destinado a outro sistema.')
    if time.time() > exp:
        raise ValueError('Token expirado.')
    if consume and not _mark_jti_used(jti, exp):
        raise ValueError('Token já utilizado.')
    return {'usuario': usuario, 'system': system_id, 'exp': exp, 'jti': jti}


def build_sso_redirect_url(system_id: str, token: str) -> str:
    base = system_base_url(system_id)
    if not base:
        raise ValueError('URL do sistema não configurada.')
    parsed = urlparse(base if '://' in base else f'https://{base}')
    # Light: cai na raiz do SPA (query preservada). Plus: /sso/entrar/. Pro: /sso/entrar.
    if system_id == 'light':
        path = '/'
    elif system_id == 'plus':
        path = '/sso/entrar/'
    else:
        path = '/sso/entrar'
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query['token'] = token
    query['sso'] = token
    return urlunparse((
        parsed.scheme or 'https',
        parsed.netloc,
        path,
        '',
        urlencode(query),
        '',
    ))


def portal_system_urls() -> dict[str, str]:
    out = {}
    for sid in SSO_SYSTEMS:
        url = system_base_url(sid)
        if url:
            out[sid] = url.rstrip('/') + '/'
    return out
