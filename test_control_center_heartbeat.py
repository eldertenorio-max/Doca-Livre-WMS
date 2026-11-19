"""Testes do aviso "quem está usando agora" (session.heartbeat) enviado ao Control Center (control_center.py).

Rodam sem servidor externo e sem banco de produção:  python -m unittest test_control_center_heartbeat -v
Um "Control Center" falso (HTTP local) recebe os eventos e confere a assinatura HMAC. Um relógio falso controla o
intervalo e a pausa. A última classe sobe o app REAL do WMS com um SQLite descartável.
"""
import hashlib
import hmac
import json
import os
import queue
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest import mock

from flask import Blueprint, Flask, g, jsonify, request, session

import control_center as cc

SEGREDO = 'segredo-de-teste-com-entropia-suficiente'
VARIAVEIS = ('DOCA_CC_URL', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SYSTEM_NAME',
             'DOCA_CC_SNAPSHOT_MIN', 'DOCA_CC_HEARTBEAT_SEC')


class _CCFalso(BaseHTTPRequestHandler):
    recebidos = []

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        bruto = self.rfile.read(n)
        _CCFalso.recebidos.append({
            'caminho': self.path,
            'assinatura': self.headers.get('X-Doca-Signature'),
            'carimbo': self.headers.get('X-Doca-Timestamp'),
            'chave': self.headers.get('X-Doca-Idempotency-Key'),
            'bruto': bruto,
            'corpo': json.loads(bruto),
        })
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):
        pass


def usuario(id, username, nome, email, perfil='operador'):
    return SimpleNamespace(id=id, username=username, nome=nome, email=email, perfil=perfil, ativo=True,
                           criado_em=None, ultimo_acesso=None)


USUARIOS = {7: usuario(7, 'ana', 'Ana Souza', 'ana@exemplo.com'), 8: usuario(8, 'bia', 'Bia Lima', 'bia@exemplo.com')}


def criar_app(ligar=True):
    """Imita o WMS: rotas com os mesmos nomes (principal.saude, principal.logout, aplicativo.resumo, static) e um
    before_request que põe em g.usuario quem está na sessão (session['user_id']), como o wms/core.py. Este carrega o
    usuário até nas rotas públicas, para provar que o heartbeat ignora essas rotas por conta própria."""
    app = Flask(__name__)  # a pasta static/ do WMS fica ao lado deste arquivo
    app.config['SECRET_KEY'] = 'teste'
    principal = Blueprint('principal', __name__)
    aplicativo = Blueprint('aplicativo', __name__)

    @principal.route('/')
    def dashboard():
        return 'inicio'

    @principal.route('/api/health')
    def saude():
        return jsonify(ok=True)

    @principal.route('/sair')
    def logout():
        session.clear()
        return 'tchau'

    @aplicativo.route('/api/app/resumo')
    def resumo():  # como no WMS: o próprio pedido do widget põe o usuário em g.usuario pelo token
        g.usuario = USUARIOS.get(int(request.args.get('token') or 0))
        return jsonify(ok=True)

    app.register_blueprint(principal)
    app.register_blueprint(aplicativo)

    @app.before_request
    def _carregar_usuario_como_o_wms():
        uid = session.get('user_id')
        g.usuario = USUARIOS.get(uid) if uid else None

    if ligar:
        cc.instalar(app)
    return app


def logar(cliente, uid):
    with cliente.session_transaction() as s:
        s['user_id'] = uid


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servidor = ThreadingHTTPServer(('127.0.0.1', 0), _CCFalso)
        cls.porta = cls.servidor.server_address[1]
        threading.Thread(target=cls.servidor.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()
        cls.servidor.server_close()

    def setUp(self):
        self.drenar()
        _CCFalso.recebidos.clear()
        cc._reiniciar_estado()
        self._antigas = {k: os.environ.get(k) for k in VARIAVEIS}
        self._auto = cc.RETRATO_AUTOMATICO
        self._relogio = cc._relogio
        cc.RETRATO_AUTOMATICO = False
        self.relogio = [1000.0]
        cc._relogio = lambda: self.relogio[0]
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:%d/api/' % self.porta
        os.environ['DOCA_CC_SYSTEM_SLUG'] = 'wms'
        os.environ['DOCA_CC_WEBHOOK_SECRET'] = SEGREDO
        os.environ.pop('DOCA_CC_SNAPSHOT_MIN', None)
        os.environ.pop('DOCA_CC_HEARTBEAT_SEC', None)

    def tearDown(self):
        self.drenar()  # nada de envio "vazando" para o teste seguinte
        cc._relogio = self._relogio
        cc.RETRATO_AUTOMATICO = self._auto
        cc._reiniciar_estado()
        for k, v in self._antigas.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    @staticmethod
    def drenar(limite=8.0):
        """Espera a fila de heartbeats terminar (enviados ou descartados)."""
        fila = cc._hb_estado['fila']
        fim = time.time() + limite
        while fila is not None and fila.unfinished_tasks and time.time() < fim:
            time.sleep(0.01)

    @staticmethod
    def heartbeats():
        return [r for r in _CCFalso.recebidos if r['corpo'].get('event_type') == 'session.heartbeat']

    def ids(self):
        return [r['corpo']['payload']['external_id'] for r in self.heartbeats()]

    def esperar(self, quantidade, limite=5.0):
        fim = time.time() + limite
        while time.time() < fim:
            if len(self.heartbeats()) >= quantidade:
                return
            time.sleep(0.02)
        self.fail('esperava %d heartbeat(s), chegaram %d' % (quantidade, len(self.heartbeats())))

    def silencio(self, espera=0.3):
        self.drenar()
        time.sleep(espera)
        self.assertEqual(self.heartbeats(), [], 'nenhum heartbeat deveria sair')


class ConfiguracaoTests(Base):
    def test_intervalo_configuravel(self):
        casos = {None: 60, '': 60, 'abc': 60, 'nan': 60, 'inf': 60, '0': 0, '-5': 0, '5': 10, '10': 10, '90': 90,
                 '30.5': 30.5}
        for valor, esperado in casos.items():
            if valor is None:
                os.environ.pop('DOCA_CC_HEARTBEAT_SEC', None)
            else:
                os.environ['DOCA_CC_HEARTBEAT_SEC'] = valor
            self.assertEqual(cc.intervalo_do_heartbeat_s(), esperado, repr(valor))

    def test_sem_as_variaveis_nada_e_instalado_nem_enviado(self):
        ligado = criar_app(True).test_client()  # instalado com as variáveis...
        for k in VARIAVEIS:
            os.environ.pop(k, None)
        app = criar_app(False)
        self.assertFalse(cc.instalar(app))
        self.assertEqual(app.after_request_funcs, {})
        cliente = app.test_client()
        logar(cliente, 7)
        self.assertEqual(cliente.get('/').data, b'inicio')
        logar(ligado, 7)
        ligado.get('/')  # ...e as variáveis somem depois: também não envia
        self.assertFalse(cc.registrar_atividade(7))
        self.silencio()

    def test_segredo_curto_mantem_desligado(self):
        os.environ['DOCA_CC_WEBHOOK_SECRET'] = 'curto'
        self.assertFalse(cc.registrar_atividade(7))
        self.silencio()

    def test_zero_desliga_e_nem_instala(self):
        ja_ligado = criar_app(True)
        self.assertIn(cc._heartbeat_depois_do_pedido, ja_ligado.after_request_funcs[None])
        os.environ['DOCA_CC_HEARTBEAT_SEC'] = '0'
        app = criar_app(True)
        self.assertIn('doca_control_center', app.extensions)  # os outros avisos continuam ligados
        self.assertNotIn(cc._heartbeat_depois_do_pedido, app.after_request_funcs[None])
        for cliente in (app.test_client(), ja_ligado.test_client()):  # 0 vale também para o app já instalado
            logar(cliente, 7)
            self.assertEqual(cliente.get('/').status_code, 200)
        self.assertFalse(cc.registrar_atividade(7))
        self.silencio()


class HeartbeatFlaskTests(Base):
    def setUp(self):
        super().setUp()
        self.app = criar_app(True)
        self.cliente = self.app.test_client()

    def test_payload_e_so_o_external_id_igual_ao_do_retrato(self):
        logar(self.cliente, 7)
        r = self.cliente.get('/', headers={'X-Forwarded-For': '10.1.2.3', 'User-Agent': 'Navegador-Teste'})
        self.assertEqual((r.status_code, r.data), (200, b'inicio'))
        self.esperar(1)
        rec = self.heartbeats()[0]
        corpo = rec['corpo']
        self.assertEqual(rec['caminho'], '/api/webhooks/wms')
        esperado = hmac.new(SEGREDO.encode(), rec['carimbo'].encode() + b'.' + rec['bruto'], hashlib.sha256).hexdigest()
        self.assertTrue(hmac.compare_digest(rec['assinatura'], esperado))
        self.assertLess(abs(int(rec['carimbo']) - time.time()), 30)
        self.assertEqual(set(corpo), {'event_type', 'idempotency_key', 'occurred_at', 'system_slug', 'payload'})
        self.assertEqual(corpo['event_type'], 'session.heartbeat')
        self.assertEqual(corpo['system_slug'], 'wms')
        self.assertRegex(corpo['occurred_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        # exatamente o external_id que o retrato envia para a mesma pessoa, e nada mais
        self.assertEqual(corpo['payload'], {'external_id': cc.payload_do_usuario(USUARIOS[7])['external_id']})
        self.assertEqual(corpo['payload'], {'external_id': '7'})
        self.assertRegex(rec['chave'], r'^hb:wms:7:\d{13}$')
        self.assertEqual(rec['chave'], corpo['idempotency_key'])
        bruto = rec['bruto'].decode('utf-8')
        for proibido in ('Ana', 'ana@', '"ana"', '10.1.2.3', '127.0.0.1', 'Navegador', 'operador'):
            self.assertNotIn(proibido, bruto)

    def test_um_aviso_por_pessoa_a_cada_intervalo(self):
        logar(self.cliente, 7)
        for _ in range(5):
            self.cliente.get('/')
        outro = self.app.test_client()
        logar(outro, 8)
        outro.get('/')
        outro.get('/')
        self.esperar(2)
        self.drenar()
        self.assertEqual(sorted(self.ids()), ['7', '8'])
        self.relogio[0] += 59
        self.cliente.get('/')
        self.silencio_extra(2)
        self.relogio[0] += 1  # 60 s depois do primeiro: sai outro
        self.cliente.get('/')
        self.esperar(3)
        self.drenar()
        self.assertEqual(self.ids()[2], '7')
        self.assertEqual(len(self.ids()), 3)
        chaves = [r['chave'] for r in self.heartbeats()]
        self.assertEqual(len(set(chaves)), 3)  # chave de idempotência única por envio

    def silencio_extra(self, total):
        self.drenar()
        time.sleep(0.2)
        self.assertEqual(len(self.heartbeats()), total)

    def test_intervalo_da_variavel_e_respeitado(self):
        os.environ['DOCA_CC_HEARTBEAT_SEC'] = '120'
        logar(self.cliente, 7)
        self.cliente.get('/')
        self.esperar(1)
        self.relogio[0] += 60
        self.cliente.get('/')
        self.silencio_extra(1)
        self.relogio[0] += 60
        self.cliente.get('/')
        self.esperar(2)

    def test_anonimo_estatico_saude_sair_e_widget_nao_avisam(self):
        self.assertEqual(self.cliente.get('/').status_code, 200)  # anônimo
        logar(self.cliente, 7)
        r = self.cliente.get('/static/wms.js')
        self.assertEqual(r.status_code, 200)
        r.close()
        self.assertEqual(self.cliente.get('/static/nao-existe.css').status_code, 404)
        self.assertEqual(self.cliente.get('/api/health').status_code, 200)
        self.cliente.get('/favicon.ico')
        self.cliente.open('/', method='OPTIONS')
        # widget do app Android: busca sozinho a cada 30 min; não é a pessoa usando o WMS
        self.assertEqual(self.cliente.get('/api/app/resumo?token=8').status_code, 200)
        self.assertEqual(self.cliente.get('/sair').data, b'tchau')
        self.silencio()
        self.assertEqual(cc._hb_ultimo, {})

    def test_com_e_sem_heartbeat_as_respostas_sao_identicas(self):
        sem = criar_app(False).test_client()
        logar(sem, 7)
        logar(self.cliente, 7)
        for rota in ('/', '/api/health', '/api/app/resumo?token=7', '/nao-existe', '/sair'):
            a = sem.get(rota)
            b = self.cliente.get(rota)
            self.assertEqual((a.status_code, a.data, sorted(a.headers.items())),
                             (b.status_code, b.data, sorted(b.headers.items())), rota)


class FalhasTests(Base):
    def setUp(self):
        super().setUp()
        self.app = criar_app(True)
        self.cliente = self.app.test_client()

    def test_falha_no_envio_nao_propaga_e_a_resposta_nao_muda(self):
        def quebrado(*args, **kwargs):
            raise OSError('Control Center fora do ar')

        logar(self.cliente, 7)
        with mock.patch.object(cc, '_enviar_uma_vez', quebrado):
            r = self.cliente.get('/')
            self.assertEqual((r.status_code, r.data), (200, b'inicio'))
            self.drenar()
            self.assertFalse(cc._hb_enviar(cc._corpo_do_heartbeat('wms', '7'), cc._config()))  # sem levantar
        self.assertFalse(cc._hb_enviar(None, None))  # até com dados quebrados
        for alvo in ('registrar_atividade', '_id_do_usuario_sem_consultar'):  # erro em qualquer etapa do gancho
            with mock.patch.object(cc, alvo, side_effect=RuntimeError('quebrou')):
                self.relogio[0] += 1000
                r = self.cliente.get('/')
                self.assertEqual((r.status_code, r.data), (200, b'inicio'))
        for alvo in ('_config', '_hb_enfileirar', '_corpo_do_heartbeat'):
            with mock.patch.object(cc, alvo, side_effect=RuntimeError('quebrou')):
                self.relogio[0] += 1000
                self.assertFalse(cc.registrar_atividade(7))

    def test_usa_o_envio_assinado_do_modulo_com_limite_de_5_s_e_nao_atrasa_a_resposta(self):
        liberar = threading.Event()
        limites = []

        def lento(corpo, base, segredo, slug, limite):
            limites.append(limite)
            liberar.wait(3)

        logar(self.cliente, 7)
        with mock.patch.object(cc, '_enviar_uma_vez', lento):
            t0 = time.time()
            r = self.cliente.get('/')
            decorrido = time.time() - t0
            liberar.set()
            self.drenar()
        self.assertEqual(r.status_code, 200)
        self.assertLess(decorrido, 0.5)
        self.assertEqual(limites, [5])

    def test_control_center_fora_do_ar_nao_atrapalha(self):
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:9/api'  # porta fechada
        logar(self.cliente, 7)
        t0 = time.time()
        r = self.cliente.get('/')
        self.assertEqual(r.status_code, 200)
        self.assertLess(time.time() - t0, 0.5)
        self.drenar()

    def test_pausa_de_5_minutos_apos_3_falhas_seguidas(self):
        chamadas = []

        def quebrado(corpo, base, segredo, slug, limite):
            chamadas.append(corpo['payload']['external_id'])
            raise OSError('fora do ar')

        with mock.patch.object(cc, '_enviar_uma_vez', quebrado):
            for uid in (1, 2, 3):
                self.assertTrue(cc.registrar_atividade(uid))
                self.drenar()
            self.assertEqual(chamadas, ['1', '2', '3'])
            self.assertFalse(cc.registrar_atividade(4))  # pausado: nem entra na fila
            self.relogio[0] += cc.HEARTBEAT_PAUSA_S - 1
            self.assertFalse(cc.registrar_atividade(5))
            self.drenar()
            self.assertEqual(len(chamadas), 3)
        self.relogio[0] += 1  # 5 minutos depois: volta a tentar
        self.assertTrue(cc.registrar_atividade(6))
        self.esperar(1)
        self.assertEqual(self.ids(), ['6'])
        self.assertEqual((cc.HEARTBEAT_MAX_FALHAS_SEGUIDAS, cc.HEARTBEAT_PAUSA_S), (3, 300))

    def test_pausa_descarta_o_que_ja_estava_na_fila(self):
        with cc._hb_trava:
            cc._hb_estado['pausado_ate'] = self.relogio[0] + 10
        enviados = []
        with mock.patch.object(cc, '_enviar_uma_vez', lambda *a: enviados.append(a)):
            self.assertFalse(cc._hb_enviar(cc._corpo_do_heartbeat('wms', '7'), cc._config()))
        self.assertEqual(enviados, [])

    def test_sucesso_no_meio_zera_a_contagem_de_falhas(self):
        respostas = iter([True, True, False, True, True, False])  # True = falha

        def alternado(*args):
            if next(respostas):
                raise OSError('falhou')

        with mock.patch.object(cc, '_enviar_uma_vez', alternado):
            for uid in range(1, 6):
                self.assertTrue(cc.registrar_atividade(uid))
                self.drenar()
            self.assertTrue(cc.registrar_atividade(6))  # 2 falhas, sucesso, 2 falhas: não pausou
            self.drenar()

    def test_mapa_de_controle_e_limitado(self):
        with mock.patch.object(cc, 'HEARTBEAT_LIMITE_MAPA', 50), \
                mock.patch.object(cc, '_hb_enfileirar', lambda corpo, cfg: True):
            for uid in range(1000):
                self.assertTrue(cc.registrar_atividade(uid))
                self.assertLessEqual(len(cc._hb_ultimo), 50)
            self.assertFalse(cc.registrar_atividade(999))  # quem acabou de avisar continua limitado
            cc._reiniciar_estado()
            for uid in range(50):
                cc.registrar_atividade(uid)
            self.assertEqual(len(cc._hb_ultimo), 50)  # cheio
            self.relogio[0] += 60
            self.assertTrue(cc.registrar_atividade(5000))
            self.assertEqual(list(cc._hb_ultimo), ['5000'])  # passou o intervalo: os antigos saem sem perda
        self.assertEqual(cc.HEARTBEAT_LIMITE_MAPA, 5000)

    def test_fila_cheia_descarta_sem_esperar(self):
        cheia = queue.Queue(maxsize=1)
        cheia.put_nowait('ocupado')
        with cc._hb_trava:
            anterior = (cc._hb_estado['fila'], cc._hb_estado['pid'])
            cc._hb_estado['fila'], cc._hb_estado['pid'] = cheia, os.getpid()
        try:
            t0 = time.time()
            self.assertFalse(cc.registrar_atividade(7))
            self.assertLess(time.time() - t0, 0.2)
        finally:
            with cc._hb_trava:
                cc._hb_estado['fila'], cc._hb_estado['pid'] = anterior

    def test_uma_unica_linha_de_execucao_de_envio(self):
        for uid in range(20):
            cc.registrar_atividade(uid)
        self.esperar(20)
        self.drenar()
        nomes = [t.name for t in threading.enumerate() if t.name == 'control-center-heartbeat']
        self.assertEqual(len(nomes), 1)  # nada de uma thread por aviso
        self.assertEqual(len(set(r['chave'] for r in self.heartbeats())), 20)


class AppRealDoWmsTests(Base):
    """App REAL do WMS (modelo Usuario, before_request de login e rotas de verdade) com SQLite descartável."""

    def setUp(self):
        super().setUp()
        self._env = {k: os.environ.get(k) for k in ('DATABASE_URL', 'ADMIN_PASSWORD', 'RENDER', 'REDIRECIONAR_PARA',
                                                    'SECRET_KEY')}
        try:
            self._tmp = tempfile.TemporaryDirectory()
            os.environ.pop('RENDER', None)
            os.environ.pop('REDIRECIONAR_PARA', None)
            os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(self._tmp.name, 'teste.db').replace('\\', '/')
            os.environ['ADMIN_PASSWORD'] = 'senha-descartavel-de-teste'
            os.environ['SECRET_KEY'] = 'chave-descartavel-de-teste'
            from wms import create_app
            from wms.models import Usuario, db
            self.app = create_app()
        except Exception as e:  # dependências do WMS ausentes neste ambiente
            self.skipTest('app real do WMS indisponível: %s' % e)
        self.assertTrue(cc.instalar(self.app))
        self.Usuario, self.db = Usuario, db
        with self.app.app_context():
            for dados in (('joao', 'João Pereira', 'joao@exemplo.com', 'supervisor', True),
                          ('maria', 'Maria Lima', 'maria@exemplo.com', 'operador', False)):
                u = Usuario(username=dados[0], nome=dados[1], email=dados[2], perfil=dados[3], ativo=dados[4])
                u.set_password('segredo-que-nao-pode-sair-1')
                u.app_token = 'token-que-nao-pode-sair-' + dados[0]
                db.session.add(u)
            db.session.commit()
            self.ids_wms = {u.username: u.id for u in Usuario.query.all()}

    def tearDown(self):
        for k, v in getattr(self, '_env', {}).items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        try:
            self._tmp.cleanup()
        except Exception:
            pass
        super().tearDown()

    def test_mesmo_external_id_do_retrato_com_o_app_real(self):
        retrato = {p['username']: p['external_id'] for p in cc._usuarios_do_banco(self.app)}
        for login in ('admin', 'joao'):
            cliente = self.app.test_client()
            logar(cliente, self.ids_wms[login])
            self.assertEqual(cliente.get('/').status_code, 200)
        self.esperar(2)
        self.drenar()
        self.assertEqual(sorted(self.ids()), sorted([retrato['admin'], retrato['joao']]))
        for r in self.heartbeats():
            self.assertEqual(set(r['corpo']['payload']), {'external_id'})
            self.assertNotIn('nao-pode-sair', r['bruto'].decode('utf-8'))

    def test_anonimo_bloqueado_estatico_saude_widget_e_sair_nao_avisam(self):
        self.assertEqual(self.app.test_client().get('/').status_code, 302)  # anônimo vai para o login
        bloqueada = self.app.test_client()
        logar(bloqueada, self.ids_wms['maria'])  # usuária desativada: o WMS não a considera logada
        self.assertEqual(bloqueada.get('/').status_code, 302)
        cliente = self.app.test_client()
        logar(cliente, self.ids_wms['joao'])
        r = cliente.get('/static/wms.js')
        self.assertEqual(r.status_code, 200)
        r.close()
        self.assertEqual(cliente.get('/api/health').status_code, 200)
        self.assertEqual(cliente.get('/api/app/resumo?token=token-que-nao-pode-sair-joao').status_code, 200)
        self.assertEqual(cliente.get('/sair').status_code, 302)
        self.silencio()

    def test_objeto_expirado_nao_consulta_o_banco(self):
        from sqlalchemy import event

        with self.app.app_context():
            u = self.db.session.get(self.Usuario, self.ids_wms['joao'])
            self.db.session.expire(u)  # como depois do rollback de um erro de banco
            consultas = []

            def contar(*args, **kwargs):
                consultas.append(1)

            event.listen(self.db.engine, 'before_cursor_execute', contar)
            try:
                self.assertEqual(cc._id_do_usuario_sem_consultar(u), self.ids_wms['joao'])
            finally:
                event.remove(self.db.engine, 'before_cursor_execute', contar)
            self.assertEqual(consultas, [])
            self.assertEqual(cc.id_externo(cc._id_do_usuario_sem_consultar(u)),
                             cc.payload_do_usuario(self.db.session.get(self.Usuario, self.ids_wms['joao']))['external_id'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
