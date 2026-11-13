"""Avisa o Doca Livre Control Center quando uma funcionalidade do WMS falha.

Cobre: resposta 5xx de qualquer rota (inclui a camada /sb/), exceção não tratada em rotas de
página, tarefa em segundo plano que morre e erro fatal do processo.

Variáveis (sem elas o aviso fica DESLIGADO e nada muda no sistema):
  DOCA_CC_URL             ex.: https://doca-livre-control-center.onrender.com/api
  DOCA_CC_SYSTEM_SLUG     wms
  DOCA_CC_WEBHOOK_SECRET  segredo (HMAC) combinado com o Control Center, mínimo 16 caracteres
  DOCA_CC_SYSTEM_NAME     (opcional) nome para as mensagens

Garantias: nunca atrasa nem derruba uma resposta (envio em segundo plano, com limite de tempo,
sem propagar erro); agrupa repetições; no máximo 20 avisos por minuto por processo; não envia o
corpo dos pedidos nem conteúdo do banco, só a mensagem de erro (sem os valores), a rota e quem
estava usando. Só usa a biblioteca padrão e o Flask.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib import request as _urlrequest
from urllib.parse import urlsplit

LIMITE_POR_MINUTO = 20
JANELA_AGRUPAR_S = 30
TEMPO_LIMITE_S = 20
ESPERA_NOVA_TENTATIVA_S = 15
ROTAS_IGNORADAS = ('/api/health',)  # o Control Center já acompanha a saúde

_trava = threading.Lock()
_ultimo_por_chave = {}
_envios_recentes = []
_ultimo_log_falha = [0.0]
_captura_global_instalada = [False]


def _config():
    base = (os.environ.get('DOCA_CC_URL') or '').strip().rstrip('/')
    segredo = (os.environ.get('DOCA_CC_WEBHOOK_SECRET') or '').strip()
    slug = (os.environ.get('DOCA_CC_SYSTEM_SLUG') or '').strip()
    nome = (os.environ.get('DOCA_CC_SYSTEM_NAME') or slug or 'sistema').strip()
    if base and slug and len(segredo) >= 16:
        return base, segredo, slug, nome
    return None


def avisos_ativos():
    return _config() is not None


def _reiniciar_estado():
    """Só para testes."""
    with _trava:
        _ultimo_por_chave.clear()
        _envios_recentes[:] = []
        _ultimo_log_falha[0] = 0.0


def _liberado(chave):
    agora = time.time()
    with _trava:
        _envios_recentes[:] = [t for t in _envios_recentes if agora - t < 60]
        if len(_envios_recentes) >= LIMITE_POR_MINUTO:
            return False
        ultimo = _ultimo_por_chave.get(chave)
        if ultimo is not None and agora - ultimo < JANELA_AGRUPAR_S:
            return False
        _ultimo_por_chave[chave] = agora
        _envios_recentes.append(agora)
        if len(_ultimo_por_chave) > 500:
            for k in [k for k, t in _ultimo_por_chave.items() if agora - t > 120]:
                _ultimo_por_chave.pop(k, None)
        return True


def _logar_falha(motivo):
    agora = time.time()
    if agora - _ultimo_log_falha[0] < 60:
        return
    _ultimo_log_falha[0] = agora
    try:
        print('[control-center] aviso não enviado: %s' % motivo, file=sys.stderr)
    except Exception:
        pass


_RE_VALOR_PG = re.compile(r'\(([^()]*)\)=\(([^()]*)\)')  # "Key (email)=(x@y.com)" do Postgres
_RE_URL_COM_SENHA = re.compile(r'(\b[a-z][a-z0-9+.\-]*://)[^/\s:@]+:[^/\s@]+@', re.I)
_RE_SEGREDO = re.compile(r'\b(password|passwd|pwd|senha|secret|token|api[_-]?key)\b(\s*[=:]\s*)\S+', re.I)


def limpar_texto(valor, maximo):
    """Texto curto, em uma linha e sem valores sensíveis (valores de colunas, senhas em URLs)."""
    if isinstance(valor, BaseException):
        s = '%s: %s' % (type(valor).__name__, valor)
    elif valor is None:
        s = ''
    else:
        s = str(valor)
    # O SQLAlchemy anexa "[SQL: ...] [parameters: {...}]" com os VALORES reais da consulta (nomes, hashes de
    # senha...). Isso nunca sai daqui: fica só o tipo do erro e a mensagem do banco.
    s = re.split(r'\[(?:SQL|parameters):', s, maxsplit=1)[0]
    s = _RE_VALOR_PG.sub(r'(\1)=([omitido])', s)
    s = _RE_URL_COM_SENHA.sub(r'\1[omitido]@', s)
    s = _RE_SEGREDO.sub(r'\1\2[omitido]', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= maximo else s[: maximo - 1] + '…'


def _enviar_uma_vez(corpo, base, segredo, slug, limite):
    bruto = json.dumps(corpo, separators=(',', ':')).encode('utf-8')  # ASCII puro (ensure_ascii)
    carimbo = str(int(time.time()))  # a cada tentativa: nova assinatura
    assinatura = hmac.new(segredo.encode('utf-8'), carimbo.encode('ascii') + b'.' + bruto, hashlib.sha256).hexdigest()
    req = _urlrequest.Request(
        '%s/webhooks/%s' % (base, slug),
        data=bruto,
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'doca-control-center-reporter/1.0',
            'X-Doca-Timestamp': carimbo,
            'X-Doca-Signature': assinatura,
            'X-Doca-Idempotency-Key': corpo['idempotency_key'],
        },
    )
    with _urlrequest.urlopen(req, timeout=limite) as resp:  # HTTP >= 400 levanta HTTPError
        resp.read(1024)


def _enviar_em_segundo_plano(corpo, base, segredo, slug):
    def _tarefa():
        try:
            _enviar_uma_vez(corpo, base, segredo, slug, TEMPO_LIMITE_S)
            return
        except Exception as e:  # Control Center acordando (plano gratuito) ou rede: tenta mais uma vez
            _logar_falha(str(e) or type(e).__name__)
        try:
            time.sleep(ESPERA_NOVA_TENTATIVA_S)
            _enviar_uma_vez(corpo, base, segredo, slug, TEMPO_LIMITE_S + 10)
        except Exception as e2:
            _logar_falha(str(e2) or type(e2).__name__)

    threading.Thread(target=_tarefa, name='control-center-aviso', daemon=True).start()


def reportar_erro(nivel='error', titulo=None, mensagem=None, usuario=None, tela=None, acao=None,
                  detalhes=None, chave=None, aguardar=False):
    """Avisa uma falha. NUNCA levanta erro. `aguardar`: só para erro fatal (uma tentativa curta, síncrona)."""
    try:
        cfg = _config()
        if cfg is None:
            return
        base, segredo, slug, _nome = cfg
        if not _liberado(chave or '%s|%s' % (acao or '', titulo or '')):
            return
        carga = {
            'level': nivel if nivel in ('warn', 'error', 'critical') else 'error',
            'title': limpar_texto(titulo or 'Falha no servidor', 160),
            'message': limpar_texto(mensagem, 400),
        }
        if usuario:
            carga['user'] = usuario
        if tela:
            carga['screen'] = limpar_texto(tela, 200)
        if acao:
            carga['action'] = limpar_texto(acao, 200)
        if detalhes:
            carga['details'] = detalhes
        corpo = {
            'event_type': 'system.error',
            'idempotency_key': 'err-%s' % uuid.uuid4(),
            'occurred_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'system_slug': slug,
            'payload': carga,
        }
        if aguardar:
            try:
                _enviar_uma_vez(corpo, base, segredo, slug, 4)
            except Exception as e:
                _logar_falha(str(e) or type(e).__name__)
            return
        _enviar_em_segundo_plano(corpo, base, segredo, slug)
    except Exception:
        pass  # avisar nunca pode causar outro erro


def usuario_da_sessao(sessao):
    """Quem estava usando, só pelos dados da sessão (`user_id`; ou `usuario`/`usuario_id`)."""
    try:
        nome = sessao.get('usuario')
        uid = sessao.get('usuario_id')
        if uid is None:
            uid = sessao.get('user_id')
        if not nome and uid is None:
            return None
        quem = {}
        if uid is not None:
            quem['id'] = str(uid)[:80]
        if nome:
            quem['name'] = str(nome)[:120]
        return quem
    except Exception:
        return None


def _usuario_da_requisicao():
    """Prefere o usuário que o próprio app já carregou (`g.usuario`: id, nome, e-mail), sem consultar o banco."""
    from flask import g, session

    u = g.get('usuario')
    if u is not None:
        quem = {}
        for destino, atributos in (('id', ('id',)), ('name', ('nome', 'username')), ('email', ('email',))):
            for atributo in atributos:
                v = getattr(u, atributo, None)
                if v is not None and v != '':
                    quem[destino] = str(v)[:120]
                    break
        if quem:
            return quem
    return usuario_da_sessao(session)


def _guardar_usuario():
    """before_request (depois dos do app): tira um "retrato" do usuário, em dados simples. Depois de um erro de
    banco o rollback do SQLAlchemy EXPIRA os objetos e lê-los de novo faria outra consulta ao banco que falhou."""
    try:
        from flask import g

        g._cc_usuario = _usuario_da_requisicao()
    except Exception:
        pass


def tela_do_pedido(req):
    """Página de onde veio o pedido (Referer), sem querystring (pode conter token)."""
    try:
        ref = (req.headers.get('Referer') or '').strip()
        if not ref:
            return None
        u = urlsplit(ref)
        if not u.scheme or not u.netloc:
            return None
        return '%s://%s%s' % (u.scheme, u.netloc, u.path)
    except Exception:
        return None


def _regra(req):
    """Rota com os parâmetros em modelo (/api/x/<id>): agrupa bem e não vaza valores do caminho."""
    try:
        return str(req.url_rule.rule) if req.url_rule is not None else (req.path or '')
    except Exception:
        return ''


def descrever_acao(app, req):
    """Primeira linha da docstring da função da rota + 'MÉTODO /rota'."""
    rota = '%s %s' % (req.method, _regra(req))
    try:
        view = app.view_functions.get(req.endpoint) if req.endpoint else None
        doc = (getattr(view, '__doc__', None) or '').strip()
        if doc:
            linha = doc.split('\n')[0].strip().rstrip('.')
            if linha:
                return '%s (%s)' % (linha[:110], rota)
    except Exception:
        pass
    return rota


def _detalhe_da_resposta(resp):
    """Texto de erro quando a resposta é um JSON pequeno {"erro": "..."} (sem tocar em respostas em fluxo)."""
    try:
        if resp.direct_passthrough or resp.is_streamed or (resp.mimetype or '') != 'application/json':
            return ''
        bruto = resp.get_data()
        if not bruto or len(bruto) > 50000:
            return ''
        dados = json.loads(bruto)
        if not isinstance(dados, dict):
            return ''
        principal = ''
        for chave in ('erro', 'error', 'message', 'mensagem'):
            v = dados.get(chave)
            if isinstance(v, dict):
                v = v.get('message') or v.get('mensagem')
            if isinstance(v, str) and v.strip():
                principal = v.strip()
                break
        extra = dados.get('detalhe') or dados.get('details')
        if isinstance(extra, str) and extra.strip() and extra.strip() not in principal:
            principal = '%s (%s)' % (principal, extra.strip()) if principal else extra.strip()
        return principal
    except Exception:
        return ''


def _ao_excecao(sender, exception=None, **extra):
    """Sinal do Flask: exceção sem tratador. Guarda para a mensagem do aviso (a resposta não muda)."""
    try:
        from flask import g
        g._cc_excecao = exception
    except Exception:
        pass


def _avisar_resposta(app, resp, status):
    cfg = _config()
    if cfg is None:
        return
    from flask import g, request, session
    caminho = request.path or ''
    if caminho.startswith(ROTAS_IGNORADAS):
        return
    nome = cfg[3]
    exc = getattr(g, '_cc_excecao', None)
    regra = _regra(request)
    if exc is not None:
        mensagem = '%s: %s' % (type(exc).__name__, exc)
    else:
        mensagem = _detalhe_da_resposta(resp) or 'HTTP %s em %s %s' % (status, request.method, regra)
    reportar_erro(
        titulo='Falha no servidor %s (HTTP %s)' % (nome, status),
        mensagem=mensagem,
        usuario=g.get('_cc_usuario') or usuario_da_sessao(session),
        tela=tela_do_pedido(request),
        acao=descrever_acao(app, request),
        detalhes={'rota': '%s %s' % (request.method, regra), 'status': status},
        chave='%s %s|%s' % (request.method, regra, status),
    )


def _instalar_captura_global(nome):
    """Tarefa em segundo plano que morre e erro fatal do processo. Sempre repassa ao tratador anterior."""
    if _captura_global_instalada[0]:
        return
    _captura_global_instalada[0] = True
    anterior_thread = threading.excepthook
    anterior_sys = sys.excepthook

    def _thread_hook(args):
        try:
            if args.exc_type is not SystemExit:
                quem = getattr(args.thread, 'name', None) or 'desconhecida'
                reportar_erro(
                    nivel='error',
                    titulo='Uma tarefa em segundo plano do %s falhou' % nome,
                    mensagem='%s: %s' % (getattr(args.exc_type, '__name__', 'Erro'), args.exc_value),
                    acao='Tarefa em segundo plano (%s)' % quem,
                    tela='Servidor',
                    chave='thread:%s' % quem,
                )
        except Exception:
            pass
        anterior_thread(args)

    def _sys_hook(tipo, valor, tb):
        try:
            if not issubclass(tipo, KeyboardInterrupt):
                reportar_erro(
                    nivel='critical',
                    titulo='O servidor %s caiu (erro não tratado)' % nome,
                    mensagem='%s: %s' % (getattr(tipo, '__name__', 'Erro'), valor),
                    acao='Execução do servidor',
                    tela='Servidor',
                    chave='fatal',
                    aguardar=True,
                )
        except Exception:
            pass
        anterior_sys(tipo, valor, tb)

    threading.excepthook = _thread_hook
    sys.excepthook = _sys_hook


def instalar(app):
    """Liga os avisos neste app Flask. Sem as variáveis DOCA_CC_*, não faz nada. Devolve True se ligou."""
    cfg = _config()
    if cfg is None:
        return False
    if app.extensions.get('doca_control_center'):
        return True
    app.extensions['doca_control_center'] = True

    def _depois_do_pedido(resp):
        try:
            if resp.status_code >= 500:
                _avisar_resposta(app, resp, resp.status_code)
        except Exception:
            pass  # nunca atrapalhar a resposta
        return resp

    # Chame instalar() DEPOIS de montar o app: o retrato do usuário precisa rodar depois do before_request que o carrega.
    app.before_request(_guardar_usuario)
    app.after_request(_depois_do_pedido)
    try:
        from flask.signals import got_request_exception

        got_request_exception.connect(_ao_excecao, app, weak=False)
    except Exception:
        pass
    _instalar_captura_global(cfg[3])
    return True
