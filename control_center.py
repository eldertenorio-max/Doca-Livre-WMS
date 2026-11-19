"""Avisa o Doca Livre Control Center quando uma funcionalidade do WMS falha.

Cobre: resposta 5xx de qualquer rota (inclui a camada /sb/), exceção não tratada em rotas de
página, tarefa em segundo plano que morre e erro fatal do processo.

Variáveis (sem elas o aviso fica DESLIGADO e nada muda no sistema):
  DOCA_CC_URL             ex.: https://doca-livre-control-center.onrender.com/api
  DOCA_CC_SYSTEM_SLUG     wms
  DOCA_CC_WEBHOOK_SECRET  segredo (HMAC) combinado com o Control Center, mínimo 16 caracteres
  DOCA_CC_SYSTEM_NAME     (opcional) nome para as mensagens
  DOCA_CC_SNAPSHOT_MIN    (opcional) minutos entre os retratos de usuários (padrão 10; 0 desliga)
  DOCA_CC_HEARTBEAT_SEC   (opcional) segundos mínimos entre dois avisos "está usando agora" da mesma pessoa
                          (padrão 60, mínimo 10; 0 desliga)

Garantias: nunca atrasa nem derruba uma resposta (envio em segundo plano, com limite de tempo,
sem propagar erro); agrupa repetições; no máximo 20 avisos por minuto por processo; não envia o
corpo dos pedidos nem conteúdo do banco, só a mensagem de erro (sem os valores), a rota e quem
estava usando. Só usa a biblioteca padrão e o Flask.

Também envia, de tempos em tempos, o "retrato" dos usuários cadastrados (user.updated / user.deleted), só com
nome, e-mail, usuário, perfil, situação e datas: nunca senha nem token. Ver "Retrato dos usuários" abaixo.

E avisa quem está USANDO o WMS agora (session.heartbeat, só com o external_id): ver "Quem está usando agora" abaixo.
"""
import hashlib
import hmac
import json
import math
import os
import queue
import random
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
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
        _retrato_conhecidos.clear()
    with _hb_trava:
        _hb_ultimo.clear()
        _hb_estado['falhas'] = 0
        _hb_estado['pausado_ate'] = 0.0


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


# ---------------------------------------------------------------------------------------------
# Retrato dos usuários: de tempos em tempos envia ao Control Center quem está cadastrado no WMS
# (user.updated para cada pessoa e user.deleted para quem sumiu), para o painel mostrar os usuários
# sem precisar ler o banco do WMS. Só lê (SELECT), só estes campos, e nunca envia senha nem token.
# Variável opcional: DOCA_CC_SNAPSHOT_MIN = minutos entre os envios (padrão 10, mínimo 2, 0 desliga).
# ---------------------------------------------------------------------------------------------
RETRATO_PADRAO_MIN = 10
RETRATO_MINIMO_MIN = 2
RETRATO_ATRASO_INICIAL_S = 45
RETRATO_LIMITE_USUARIOS = 2000
RETRATO_TEMPO_PRIMEIRO_S = 70  # o Control Center (plano gratuito) pode estar acordando
RETRATO_TEMPO_DEMAIS_S = 15
RETRATO_PAUSA_S = 0.1
RETRATO_MAX_FALHAS_SEGUIDAS = 3
RETRATO_AUTOMATICO = True  # os testes desligam para não criar o ciclo em cada app de teste

# Perfil do WMS -> papel conhecido pelo Control Center (super_usuario, gestor, operador).
PAPEL_DO_PERFIL = {'super': 'super_usuario', 'supervisor': 'gestor', 'gestor': 'gestor', 'operador': 'operador'}

_BRT = timezone(timedelta(hours=-3))  # o WMS grava horários de Brasília, sem fuso
_retrato_conhecidos = {}  # id -> hash do último retrato visto (para saber quem sumiu)
_retrato_em_andamento = threading.Lock()


def intervalo_do_retrato_s():
    """Segundos entre os retratos; 0 = desligado."""
    bruto = (os.environ.get('DOCA_CC_SNAPSHOT_MIN') or '').strip()
    try:
        minutos = float(bruto) if bruto else RETRATO_PADRAO_MIN
    except ValueError:
        minutos = RETRATO_PADRAO_MIN
    if minutos <= 0:
        return 0
    return max(minutos, RETRATO_MINIMO_MIN) * 60


def papel_do_cc(perfil):
    return PAPEL_DO_PERFIL.get(str(perfil or '').strip().lower(), 'operador')


def _iso_utc(horario):
    """Horário de Brasília sem fuso (como o WMS grava) -> ISO em UTC."""
    if not horario:
        return None
    try:
        return horario.replace(tzinfo=_BRT).astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except Exception:
        return None


def _texto_curto(valor, maximo):
    return ' '.join(str(valor).split())[:maximo]


def id_externo(valor):
    """Identificador da pessoa no Control Center (external_id). O retrato e o heartbeat usam ESTA função: é por ele
    que o painel acha o usuário, então os dois têm de ser idênticos."""
    return str(valor)


def payload_do_usuario(u):
    """Só os campos combinados com o Control Center. `u` é qualquer objeto com id, username, nome, email, perfil,
    ativo, criado_em e ultimo_acesso (linha do SQLAlchemy ou o próprio modelo). Senha, token, avatar e o resto
    do cadastro NUNCA entram aqui."""
    uid = id_externo(u.id)
    username = _texto_curto(getattr(u, 'username', None) or '', 80)
    p = {
        'external_id': uid,
        'name': _texto_curto(getattr(u, 'nome', None) or username or uid, 120),
        'role_code': papel_do_cc(getattr(u, 'perfil', None)),
    }
    if username:
        p['username'] = username
    email = _texto_curto(getattr(u, 'email', None) or '', 120)
    if email:
        p['email'] = email
    criado = _iso_utc(getattr(u, 'criado_em', None))
    if criado:
        p['created_at'] = criado
    ultimo = _iso_utc(getattr(u, 'ultimo_acesso', None))
    if ultimo:
        p['last_login_at'] = ultimo
        p['last_seen_at'] = ultimo
    # Nunca mandamos "online": isso é decidido pelas sessões ao vivo e o painel não sobrescreve quem está online.
    # Mandar offline/never (em vez de omitir) faz quem foi DESBLOQUEADO deixar de aparecer como bloqueado.
    if not getattr(u, 'ativo', True):
        p['status'] = 'blocked'
    else:
        p['status'] = 'offline' if ultimo else 'never'
    return p


def _hash_do_payload(p):
    return hashlib.sha1(json.dumps(p, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()[:12]


def _balde_horario():
    """Hora atual em UTC (AAAAMMDDHH). O painel guarda para sempre as chaves já processadas e ignora as repetidas;
    com a hora na chave, qualquer divergência (ex.: bloqueou, desbloqueou e bloqueou de novo) é reparada em até 1 hora."""
    return datetime.now(timezone.utc).strftime('%Y%m%d%H')


def _corpo_do_retrato(slug, tipo, payload, hash_):
    """Dentro da mesma hora, a chave só muda quando o cadastro muda: repetir o envio não duplica nada."""
    sufixo = ('del:' if tipo == 'user.deleted' else '') + hash_
    return {
        'event_type': tipo,
        'idempotency_key': 'snap:%s:%s:%s:%s' % (slug, payload['external_id'], sufixo, _balde_horario()),
        'occurred_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'system_slug': slug,
        'payload': payload,
    }


def _usuarios_do_banco(app):
    """Lê os usuários do próprio banco do WMS: só SELECT e só as colunas necessárias."""
    from wms.models import Usuario, db

    with app.app_context():
        linhas = (
            db.session.query(Usuario.id, Usuario.username, Usuario.nome, Usuario.email, Usuario.perfil,
                             Usuario.ativo, Usuario.criado_em, Usuario.ultimo_acesso)
            .order_by(Usuario.id).limit(RETRATO_LIMITE_USUARIOS).all()
        )
        return [payload_do_usuario(linha) for linha in linhas]


def _ciclo_do_retrato(cfg, coletor, enviar):
    base, segredo, slug, _nome = cfg
    try:
        atuais = {p['external_id']: p for p in coletor()}
    except Exception as e:
        _logar_falha('retrato dos usuários: não consegui ler o banco (%s)' % (limpar_texto(e, 120) or type(e).__name__))
        return (0, 0, False)
    with _trava:
        anteriores = dict(_retrato_conhecidos)
    eventos = []  # (tipo, id, corpo)
    for uid, p in atuais.items():
        eventos.append(('user.updated', uid, _corpo_do_retrato(slug, 'user.updated', p, _hash_do_payload(p))))
    for uid, hash_anterior in anteriores.items():
        if uid not in atuais:
            eventos.append(('user.deleted', uid,
                            _corpo_do_retrato(slug, 'user.deleted', {'external_id': uid}, hash_anterior)))
    enviados = falhas = seguidas = 0
    interrompido = False
    apagados_pendentes = set()  # user.deleted que não chegou: tenta de novo no próximo ciclo
    primeiro = True
    for i, (tipo, uid, corpo) in enumerate(eventos):
        try:
            enviar(corpo, base, segredo, slug, RETRATO_TEMPO_PRIMEIRO_S if primeiro else RETRATO_TEMPO_DEMAIS_S)
            enviados += 1
            seguidas = 0
            primeiro = False
        except Exception as e:
            falhas += 1
            seguidas += 1
            if tipo == 'user.deleted':
                apagados_pendentes.add(uid)
            _logar_falha('retrato dos usuários: %s' % (limpar_texto(e, 120) or type(e).__name__))
            if seguidas >= RETRATO_MAX_FALHAS_SEGUIDAS:
                interrompido = True
                for outro_tipo, outro_id, _c in eventos[i + 1:]:
                    if outro_tipo == 'user.deleted':
                        apagados_pendentes.add(outro_id)
                break
        if RETRATO_PAUSA_S:
            time.sleep(RETRATO_PAUSA_S)
    novos = {uid: _hash_do_payload(p) for uid, p in atuais.items()}
    for uid in apagados_pendentes:
        novos[uid] = anteriores[uid]
    with _trava:
        _retrato_conhecidos.clear()
        _retrato_conhecidos.update(novos)
    return (enviados, falhas, interrompido)


def executar_ciclo_retrato(coletor, enviar=None):
    """Um ciclo do retrato. Devolve (enviados, falhas, interrompido). NUNCA levanta erro."""
    try:
        cfg = _config()
        if cfg is None:
            return (0, 0, False)
        if not _retrato_em_andamento.acquire(blocking=False):
            return (0, 0, False)  # já existe um ciclo rodando: não sobrepõe
        try:
            return _ciclo_do_retrato(cfg, coletor, enviar or _enviar_uma_vez)
        finally:
            _retrato_em_andamento.release()
    except Exception:
        return (0, 0, False)


def iniciar_retrato(app, coletor=None):
    """Agenda o retrato dos usuários (1º ciclo uns 45 s depois de subir, depois a cada DOCA_CC_SNAPSHOT_MIN minutos).
    Sem as variáveis DOCA_CC_*, ou com DOCA_CC_SNAPSHOT_MIN=0, não faz nada. Devolve True se agendou."""
    intervalo = intervalo_do_retrato_s()
    if _config() is None or intervalo <= 0 or not RETRATO_AUTOMATICO:
        return False
    if app.extensions.get('doca_cc_retrato'):
        return True
    parar = threading.Event()
    app.extensions['doca_cc_retrato'] = parar
    coleta = coletor or (lambda: _usuarios_do_banco(app))

    def _laco():
        espera = RETRATO_ATRASO_INICIAL_S + random.uniform(0, 15)
        while not parar.wait(espera):
            try:
                executar_ciclo_retrato(coleta)
            except Exception:
                pass
            espera = intervalo

    threading.Thread(target=_laco, name='control-center-retrato', daemon=True).start()
    return True


# ---------------------------------------------------------------------------------------------
# Quem está usando agora (session.heartbeat): quando o WMS atende uma requisição de um usuário LOGADO, avisa o
# Control Center que essa pessoa está ativa. O painel marca "online" e volta a "offline" se não chegar outro aviso
# dentro do prazo dele (SESSION_HEARTBEAT_TTL_SECONDS, 180 s). Vai SÓ o external_id, o mesmo do retrato: nada de
# nome, e-mail nem IP. O envio sai de uma fila com uma linha de execução própria: a resposta nunca espera.
# Variável opcional: DOCA_CC_HEARTBEAT_SEC = no máximo 1 aviso por pessoa a cada N segundos (padrão 60, mínimo 10,
# 0 desliga). Precisa ficar bem abaixo do prazo do painel.
# ---------------------------------------------------------------------------------------------
HEARTBEAT_PADRAO_S = 60
HEARTBEAT_MINIMO_S = 10
HEARTBEAT_TEMPO_LIMITE_S = 5
HEARTBEAT_MAX_FALHAS_SEGUIDAS = 3
HEARTBEAT_PAUSA_S = 300  # depois de 3 falhas seguidas, 5 minutos sem tentar
HEARTBEAT_LIMITE_MAPA = 5000  # pessoas lembradas para o limite de 1 aviso por intervalo
HEARTBEAT_LIMITE_FILA = 500  # fila cheia: o aviso é descartado (a pessoa volta a ser avisada no intervalo seguinte)
# Pedidos que não são "uso" do sistema. "aplicativo.resumo" é o widget do app Android: o celular busca o resumo
# sozinho a cada 30 minutos, com a pessoa longe do WMS. O uso do app em si abre o WMS no navegador e já conta.
HEARTBEAT_ROTAS_IGNORADAS = frozenset({'static', 'principal.saude', 'principal.logout', 'aplicativo.resumo',
                                       'aplicativo.assetlinks', 'aplicativo.sw_antigo'})
HEARTBEAT_CAMINHOS_IGNORADOS = ('/static/', '/api/health', '/.well-known/', '/sw.js', '/favicon')

_relogio = time.monotonic  # os testes trocam por um relógio falso
_hb_trava = threading.Lock()
_hb_ultimo = {}  # external_id -> momento (no _relogio) do último aviso posto na fila
_hb_estado = {'falhas': 0, 'pausado_ate': 0.0, 'fila': None, 'pid': None}


def intervalo_do_heartbeat_s():
    """Segundos mínimos entre dois avisos da mesma pessoa; 0 = desligado."""
    bruto = (os.environ.get('DOCA_CC_HEARTBEAT_SEC') or '').strip()
    try:
        segundos = float(bruto) if bruto else HEARTBEAT_PADRAO_S
    except ValueError:
        segundos = HEARTBEAT_PADRAO_S
    if not math.isfinite(segundos):
        segundos = HEARTBEAT_PADRAO_S
    if segundos <= 0:
        return 0
    return max(segundos, HEARTBEAT_MINIMO_S)


def _id_do_usuario_sem_consultar(u):
    """id de g.usuario SEM ir ao banco. Depois de um erro, o rollback do SQLAlchemy expira o objeto e ler `u.id`
    faria outra consulta; a identidade que o SQLAlchemy guarda continua disponível sem consulta."""
    try:
        from sqlalchemy import inspect as _inspecionar

        estado = _inspecionar(u, raiseerr=False)
    except Exception:
        estado = None
    if estado is not None:
        identidade = estado.identity
        if identidade and len(identidade) == 1:
            return identidade[0]
        return estado.dict.get('id')  # ainda sem identidade: só o que já está carregado
    return getattr(u, 'id', None)  # objeto simples (não é do SQLAlchemy)


def _corpo_do_heartbeat(slug, ext):
    agora = datetime.now(timezone.utc)
    return {
        'event_type': 'session.heartbeat',
        'idempotency_key': 'hb:%s:%s:%d' % (slug, ext, int(agora.timestamp() * 1000)),
        'occurred_at': agora.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'system_slug': slug,
        'payload': {'external_id': ext},
    }


def _podar_mapa_do_heartbeat(agora, intervalo):
    """(Com _hb_trava.) Mapa cheio: tira quem já passou do intervalo (não muda nada no limite) e, se ainda estiver
    cheio, a metade mais antiga."""
    for k in [k for k, t in _hb_ultimo.items() if agora - t >= intervalo]:
        del _hb_ultimo[k]
    if len(_hb_ultimo) >= HEARTBEAT_LIMITE_MAPA:
        for k, _t in sorted(_hb_ultimo.items(), key=lambda kv: kv[1])[: len(_hb_ultimo) // 2 + 1]:
            del _hb_ultimo[k]


def _hb_trabalhar(fila):
    while True:
        try:
            corpo, cfg = fila.get()
        except Exception:
            time.sleep(1)
            continue
        try:
            _hb_enviar(corpo, cfg)
        except Exception:
            pass
        finally:
            try:
                fila.task_done()
            except Exception:
                pass


def _hb_enfileirar(corpo, cfg):
    """Uma fila e UMA linha de execução de envio por processo (criadas no primeiro uso; de novo se o processo foi
    clonado). Fila cheia: descarta, nunca segura a resposta."""
    with _hb_trava:
        fila = _hb_estado['fila']
        if fila is None or _hb_estado['pid'] != os.getpid():
            nova = queue.Queue(maxsize=HEARTBEAT_LIMITE_FILA)
            threading.Thread(target=_hb_trabalhar, args=(nova,), name='control-center-heartbeat', daemon=True).start()
            _hb_estado['fila'], _hb_estado['pid'] = nova, os.getpid()
            fila = nova
    try:
        fila.put_nowait((corpo, cfg))
        return True
    except queue.Full:
        return False


def _hb_enviar(corpo, cfg):
    """Envia um heartbeat (mesma assinatura e formato dos outros avisos, até 5 s). 3 falhas seguidas = 5 min de pausa.
    Devolve True se chegou. NUNCA levanta erro."""
    try:
        base, segredo, slug, _nome = cfg
        with _hb_trava:
            if _relogio() < _hb_estado['pausado_ate']:
                return False  # a pausa começou depois que este entrou na fila
        try:
            _enviar_uma_vez(corpo, base, segredo, slug, HEARTBEAT_TEMPO_LIMITE_S)
        except Exception as e:
            with _hb_trava:
                _hb_estado['falhas'] += 1
                if _hb_estado['falhas'] >= HEARTBEAT_MAX_FALHAS_SEGUIDAS:
                    _hb_estado['falhas'] = 0
                    _hb_estado['pausado_ate'] = _relogio() + HEARTBEAT_PAUSA_S
            _logar_falha('heartbeat: %s' % (limpar_texto(e, 120) or type(e).__name__))
            return False
        with _hb_trava:
            _hb_estado['falhas'] = 0
        return True
    except Exception:
        return False


def registrar_atividade(uid):
    """Uma requisição do usuário `uid` (id no WMS) foi atendida: põe um heartbeat na fila se já passou o intervalo
    desde o último desta pessoa. Não espera o envio. Devolve True se enfileirou. NUNCA levanta erro."""
    try:
        cfg = _config()
        if cfg is None or uid is None:
            return False
        intervalo = intervalo_do_heartbeat_s()
        if intervalo <= 0:
            return False
        ext = id_externo(uid)
        if not ext:
            return False
        agora = _relogio()
        with _hb_trava:
            if agora < _hb_estado['pausado_ate']:
                return False
            ultimo = _hb_ultimo.get(ext)
            if ultimo is not None and agora - ultimo < intervalo:
                return False
            if ext not in _hb_ultimo and len(_hb_ultimo) >= HEARTBEAT_LIMITE_MAPA:
                _podar_mapa_do_heartbeat(agora, intervalo)
            _hb_ultimo[ext] = agora
        return _hb_enfileirar(_corpo_do_heartbeat(cfg[2], ext), cfg)
    except Exception:
        return False


def _heartbeat_do_pedido():
    """Requisição atendida para um usuário logado: `g.usuario`, que o próprio WMS carrega (wms/core.py, usuario_atual)
    a partir de session['user_id'] e só quando o usuário está ativo. Sem g.usuario = anônimo: nada a avisar."""
    from flask import g, request

    if request.method == 'OPTIONS' or request.endpoint in HEARTBEAT_ROTAS_IGNORADAS:
        return False
    if (request.path or '').startswith(HEARTBEAT_CAMINHOS_IGNORADOS):
        return False
    u = g.get('usuario')
    if u is None:
        return False
    return registrar_atividade(_id_do_usuario_sem_consultar(u))


def _heartbeat_depois_do_pedido(resp):
    """after_request: só observa; devolve a MESMA resposta, sem ler nem mudar nada nela."""
    try:
        _heartbeat_do_pedido()
    except Exception:
        pass  # nunca atrapalhar a resposta
    return resp


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
    if intervalo_do_heartbeat_s() > 0:
        app.after_request(_heartbeat_depois_do_pedido)  # "quem está usando agora"; 0 = nem instala
    try:
        from flask.signals import got_request_exception

        got_request_exception.connect(_ao_excecao, app, weak=False)
    except Exception:
        pass
    _instalar_captura_global(cfg[3])
    try:
        iniciar_retrato(app)
    except Exception:
        pass  # o retrato nunca pode impedir o sistema de subir
    return True
