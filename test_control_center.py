"""Testes do aviso de falhas ao Control Center (control_center.py).

Rodam sem servidor externo e sem banco:  python -m unittest test_control_center -v
Um "Control Center" falso (HTTP local) recebe os avisos e confere a assinatura HMAC.
"""
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from flask import Flask, Response, g, jsonify, request, session
from werkzeug.exceptions import HTTPException

import control_center as cc

SEGREDO = 'segredo-de-teste-com-entropia-suficiente'
VARIAVEIS = ('DOCA_CC_URL', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SYSTEM_NAME')


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


class _UsuarioFalso:
    """Como um objeto do SQLAlchemy: depois do rollback ele "expira" e ler um campo faria nova consulta ao banco."""

    def __init__(self):
        self._expirado = False
        self._dados = {'id': 3, 'nome': 'Ana Souza', 'email': 'ana@x.com'}

    def __getattr__(self, nome):
        if nome.startswith('_'):
            raise AttributeError(nome)
        if self._expirado:
            raise RuntimeError('objeto expirado: consultaria o banco')
        if nome in self._dados:
            return self._dados[nome]
        raise AttributeError(nome)


def criar_app(ligar=True):
    app = Flask(__name__)
    app.config['SECRET_KEY'] = 'teste'

    @app.before_request
    def _carregar_usuario_como_o_wms():  # o WMS carrega g.usuario num before_request próprio
        if request.headers.get('X-Usuario-Falso'):
            g.usuario = _UsuarioFalso()

    @app.route('/api/expira', methods=['POST'])
    def expira():
        """Gravar com o banco indisponível."""
        g.usuario._expirado = True  # o rollback do SQLAlchemy expira o objeto
        return jsonify({'ok': False, 'erro': 'banco indisponível'}), 503

    @app.route('/login-teste', methods=['POST'])
    def login_teste():
        session['usuario'] = 'maria'
        session['usuario_id'] = 7
        return 'ok'

    @app.route('/api/ok')
    def ok():
        """Rota boa."""
        return jsonify(ok=True)

    @app.route('/api/falha/<int:item>', methods=['POST'])
    def falha(item):
        """Gravar o item de teste."""
        return jsonify({'ok': False, 'erro': 'Servidor acordando ou banco ocupado.', 'detalhe': 'connection refused'}), 503

    @app.route('/api/explode')
    def explode():
        """Rota que explode."""
        raise RuntimeError('duplicate key. Key (usuario)=(joao) already exists. postgresql://app:senha123@db:5432/x')

    @app.route('/pagina')
    def pagina():
        raise ValueError('quebrou a página')

    @app.route('/api/health')
    def health():
        return jsonify(ok=False), 503

    @app.route('/api/negado')
    def negado():
        return jsonify(ok=False), 401

    @app.route('/api/fluxo')
    def fluxo():
        def gerar():
            yield 'a'
            yield 'b'

        return Response(gerar(), status=500, mimetype='application/json')

    @app.errorhandler(Exception)
    def _tratador(e):  # igual ao do app.py do WMS
        if isinstance(e, HTTPException):
            if request.path.startswith('/api/') and e.code and int(e.code) >= 400:
                return jsonify({'ok': False, 'erro': getattr(e, 'description', None) or str(e)}), int(e.code)
            return e
        if request.path.startswith('/api/'):
            return jsonify({'ok': False, 'erro': str(e) or 'Erro interno do servidor.'}), 500
        raise e

    if ligar:
        cc.instalar(app)
    return app


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
        _CCFalso.recebidos.clear()
        cc._reiniciar_estado()
        self._antigas = {k: os.environ.get(k) for k in VARIAVEIS}
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:%d/api/' % self.porta
        os.environ['DOCA_CC_SYSTEM_SLUG'] = 'wms'
        os.environ['DOCA_CC_WEBHOOK_SECRET'] = SEGREDO
        os.environ['DOCA_CC_SYSTEM_NAME'] = 'WMS Pro'
        self._espera = cc.ESPERA_NOVA_TENTATIVA_S
        cc.ESPERA_NOVA_TENTATIVA_S = 0.05

    def tearDown(self):
        # Os avisos saem em segundo plano: espera terminarem para um teste não "vazar" avisos para o seguinte.
        for t in threading.enumerate():
            if t.name == 'control-center-aviso':
                t.join(timeout=5)
        cc.ESPERA_NOVA_TENTATIVA_S = self._espera
        for k, v in self._antigas.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def esperar(self, quantidade, limite=5.0):
        fim = time.time() + limite
        while time.time() < fim:
            if len(_CCFalso.recebidos) >= quantidade:
                return
            time.sleep(0.02)
        self.fail('esperava %d aviso(s), chegaram %d' % (quantidade, len(_CCFalso.recebidos)))

    def silencio(self, espera=0.4):
        time.sleep(espera)
        self.assertEqual(len(_CCFalso.recebidos), 0, 'nenhum aviso deveria sair: %r' % _CCFalso.recebidos)


class AvisoBasico(Base):
    def test_desligado_por_padrao_nao_registra_nada(self):
        for k in VARIAVEIS:
            os.environ.pop(k, None)
        app = Flask(__name__)
        self.assertFalse(cc.avisos_ativos())
        self.assertFalse(cc.instalar(app))
        self.assertEqual(app.after_request_funcs, {})
        self.assertNotIn('doca_control_center', app.extensions)
        cc.reportar_erro(titulo='x', chave='k')
        self.silencio()

    def test_segredo_curto_mantem_desligado(self):
        os.environ['DOCA_CC_WEBHOOK_SECRET'] = 'curto'
        self.assertFalse(cc.avisos_ativos())

    def test_assinatura_hmac_e_campos_do_system_error(self):
        cc.reportar_erro(nivel='error', titulo='Falha X', mensagem='deu ruim', usuario={'id': '7', 'name': 'maria'},
                         tela='https://wms.exemplo/estoque', acao='Gravar (POST /api/x)', detalhes={'status': 500}, chave='k1')
        self.esperar(1)
        r = _CCFalso.recebidos[0]
        self.assertEqual(r['caminho'], '/api/webhooks/wms')  # barra final da URL é descartada
        esperado = hmac.new(SEGREDO.encode(), r['carimbo'].encode() + b'.' + r['bruto'], hashlib.sha256).hexdigest()
        self.assertEqual(r['assinatura'], esperado)
        self.assertLess(abs(int(r['carimbo']) - time.time()), 30)
        self.assertEqual(r['chave'], r['corpo']['idempotency_key'])
        self.assertEqual(r['corpo']['event_type'], 'system.error')
        self.assertEqual(r['corpo']['system_slug'], 'wms')
        self.assertRegex(r['corpo']['occurred_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        self.assertEqual(r['corpo']['payload'], {
            'level': 'error', 'title': 'Falha X', 'message': 'deu ruim', 'user': {'id': '7', 'name': 'maria'},
            'screen': 'https://wms.exemplo/estoque', 'action': 'Gravar (POST /api/x)', 'details': {'status': 500},
        })

    def test_acentos_assinam_e_chegam_corretos(self):
        cc.reportar_erro(titulo='Falha na gravação', mensagem='não foi possível salvar — conexão', chave='acento')
        self.esperar(1)
        r = _CCFalso.recebidos[0]
        esperado = hmac.new(SEGREDO.encode(), r['carimbo'].encode() + b'.' + r['bruto'], hashlib.sha256).hexdigest()
        self.assertEqual(r['assinatura'], esperado)
        self.assertEqual(r['corpo']['payload']['message'], 'não foi possível salvar — conexão')

    def test_limpar_texto(self):
        s = cc.limpar_texto('duplicate. Key (email)=(ana@x.com) already exists.\n  em   duas linhas', 400)
        self.assertNotIn('ana@x.com', s)
        self.assertIn('Key (email)=([omitido])', s)
        self.assertNotIn('\n', s)
        u = cc.limpar_texto('falha em postgresql://app:senha123@db:5432/x e password=abc123 token: xyz', 400)
        self.assertNotIn('senha123', u)
        self.assertNotIn('abc123', u)
        self.assertNotIn('xyz', u)
        sqla = ('(psycopg.errors.UniqueViolation) duplicate key value violates unique constraint "usuario_username_key"\n'
                'DETAIL:  Key (username)=(joao) already exists.\n'
                '[SQL: INSERT INTO usuario (username, password_hash) VALUES (%(username)s, %(password_hash)s)]\n'
                "[parameters: {'username': 'joao', 'password_hash': 'pbkdf2:sha256:600000$abc123'}]\n"
                '(Background on this error at: https://sqlalche.me/e/20/gkpj)')
        q = cc.limpar_texto(sqla, 400)
        for proibido in ('joao', 'pbkdf2', 'abc123', 'INSERT', 'parameters', 'sqlalche'):
            self.assertNotIn(proibido, q)
        self.assertIn('usuario_username_key', q)  # o que ajuda a achar o problema continua
        self.assertEqual(len(cc.limpar_texto('a' * 1000, 50)), 50)
        self.assertEqual(cc.limpar_texto(ValueError('x'), 50), 'ValueError: x')
        self.assertEqual(cc.limpar_texto(None, 50), '')

    def test_repeticao_e_agrupada_e_outro_problema_passa(self):
        for _ in range(3):
            cc.reportar_erro(titulo='a', chave='mesmo')
        cc.reportar_erro(titulo='b', chave='outro')
        self.esperar(2)
        time.sleep(0.3)
        self.assertEqual(len(_CCFalso.recebidos), 2)

    def test_limite_de_20_por_minuto(self):
        for i in range(30):
            cc.reportar_erro(titulo='t', chave='k%d' % i)
        self.esperar(20)
        time.sleep(0.5)
        self.assertEqual(len(_CCFalso.recebidos), 20)

    def test_control_center_fora_do_ar_nunca_levanta_nem_demora(self):
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:9/api'  # porta fechada
        t0 = time.time()
        cc.reportar_erro(titulo='x', chave='fora')
        cc.reportar_erro(titulo='y', chave='fora2', aguardar=True)
        self.assertLess(time.time() - t0, 6)


class IntegracaoFlask(Base):
    def setUp(self):
        super().setUp()
        self.app = criar_app(True)
        self.cliente = self.app.test_client()

    def test_5xx_json_leva_usuario_tela_acao_e_motivo(self):
        self.cliente.post('/login-teste')
        r = self.cliente.post('/api/falha/42', headers={'Referer': 'https://wms.exemplo/estoque?token=abc#x'})
        self.assertEqual(r.status_code, 503)  # a resposta do sistema não muda
        self.assertEqual(r.get_json(), {'ok': False, 'erro': 'Servidor acordando ou banco ocupado.', 'detalhe': 'connection refused'})
        self.esperar(1)
        p = _CCFalso.recebidos[0]['corpo']['payload']
        self.assertEqual(p['level'], 'error')
        self.assertEqual(p['title'], 'Falha no servidor WMS Pro (HTTP 503)')
        self.assertEqual(p['message'], 'Servidor acordando ou banco ocupado. (connection refused)')
        self.assertEqual(p['user'], {'id': '7', 'name': 'maria'})
        self.assertEqual(p['screen'], 'https://wms.exemplo/estoque')  # sem querystring nem #fragmento
        self.assertEqual(p['action'], 'Gravar o item de teste (POST /api/falha/<int:item>)')
        self.assertEqual(p['details'], {'rota': 'POST /api/falha/<int:item>', 'status': 503})

    def test_usuario_vem_do_retrato_mesmo_com_o_objeto_expirado(self):
        r = self.cliente.post('/api/expira', headers={'X-Usuario-Falso': '1'})
        self.assertEqual(r.status_code, 503)
        self.esperar(1)
        self.assertEqual(_CCFalso.recebidos[0]['corpo']['payload']['user'], {'id': '3', 'name': 'Ana Souza', 'email': 'ana@x.com'})

    def test_sessao_com_user_id_tambem_identifica(self):
        with self.cliente.session_transaction() as s:
            s['user_id'] = 11
        self.cliente.post('/api/falha/1')
        self.esperar(1)
        self.assertEqual(_CCFalso.recebidos[0]['corpo']['payload']['user'], {'id': '11'})

    def test_sem_login_aviso_sai_sem_usuario(self):
        self.cliente.post('/api/falha/1')
        self.esperar(1)
        self.assertNotIn('user', _CCFalso.recebidos[0]['corpo']['payload'])

    def test_excecao_na_api_resposta_igual_e_valores_removidos_do_aviso(self):
        r = self.cliente.get('/api/explode')
        self.assertEqual(r.status_code, 500)
        self.assertIn('Key (usuario)=(joao)', r.get_json()['erro'])  # o cliente continua recebendo o mesmo de sempre
        self.esperar(1)
        bruto = _CCFalso.recebidos[0]['bruto'].decode()
        self.assertNotIn('joao', bruto)
        self.assertNotIn('senha123', bruto)
        self.assertIn('Key (usuario)=([omitido])', bruto)

    def test_excecao_em_pagina_leva_o_tipo_do_erro(self):
        r = self.cliente.get('/pagina')
        self.assertEqual(r.status_code, 500)
        self.esperar(1)
        p = _CCFalso.recebidos[0]['corpo']['payload']
        self.assertEqual(p['message'], 'ValueError: quebrou a página')
        self.assertEqual(p['action'], 'GET /pagina')

    def test_nao_avisa_para_2xx_4xx_nem_para_health(self):
        self.assertEqual(self.cliente.get('/api/ok').status_code, 200)
        self.assertEqual(self.cliente.get('/api/negado').status_code, 401)
        self.assertEqual(self.cliente.get('/api/nao-existe').status_code, 404)
        self.assertEqual(self.cliente.get('/api/health').status_code, 503)
        self.silencio()

    def test_resposta_em_fluxo_nao_e_consumida(self):
        r = self.cliente.get('/api/fluxo')
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.data, b'ab')
        self.esperar(1)
        self.assertEqual(_CCFalso.recebidos[0]['corpo']['payload']['message'], 'HTTP 500 em GET /api/fluxo')

    def test_com_e_sem_aviso_as_respostas_sao_identicas(self):
        sem = criar_app(False).test_client()
        for metodo, rota in (('get', '/api/ok'), ('post', '/api/falha/1'), ('get', '/api/explode'), ('get', '/pagina'),
                             ('get', '/api/negado'), ('get', '/api/nao-existe')):
            a = getattr(sem, metodo)(rota)
            b = getattr(self.cliente, metodo)(rota)
            self.assertEqual((a.status_code, a.data), (b.status_code, b.data), rota)

    def test_instalar_duas_vezes_nao_duplica(self):
        self.assertTrue(cc.instalar(self.app))
        self.cliente.post('/api/falha/9')
        self.esperar(1)
        time.sleep(0.3)
        self.assertEqual(len(_CCFalso.recebidos), 1)

    def test_control_center_fora_do_ar_nao_atrapalha_a_resposta(self):
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:9/api'
        t0 = time.time()
        r = self.cliente.post('/api/falha/5')
        self.assertEqual(r.status_code, 503)
        self.assertLess(time.time() - t0, 1.0)


class CapturaGlobal(Base):
    def setUp(self):
        super().setUp()
        self._thread_hook = threading.excepthook
        self._sys_hook = sys.excepthook
        self.repassados = []
        threading.excepthook = lambda args: self.repassados.append(('thread', args.exc_type.__name__))
        sys.excepthook = lambda t, v, tb: self.repassados.append(('sys', t.__name__))
        cc._captura_global_instalada[0] = False

    def tearDown(self):
        threading.excepthook = self._thread_hook
        sys.excepthook = self._sys_hook
        cc._captura_global_instalada[0] = False
        super().tearDown()

    def test_tarefa_em_segundo_plano_que_morre_avisa_e_repassa(self):
        cc._instalar_captura_global('WMS Pro')

        def tarefa():
            raise RuntimeError('tarefa quebrou')

        t = threading.Thread(target=tarefa, name='sincronizar-ravex')
        t.start()
        t.join()
        self.esperar(1)
        p = _CCFalso.recebidos[0]['corpo']['payload']
        self.assertEqual(p['level'], 'error')
        self.assertEqual(p['title'], 'Uma tarefa em segundo plano do WMS Pro falhou')
        self.assertEqual(p['message'], 'RuntimeError: tarefa quebrou')
        self.assertEqual(p['action'], 'Tarefa em segundo plano (sincronizar-ravex)')
        self.assertIn(('thread', 'RuntimeError'), self.repassados)  # o comportamento padrão continua

    def test_erro_fatal_avisa_critico_antes_de_retornar_e_repassa(self):
        cc._instalar_captura_global('WMS Pro')
        sys.excepthook(MemoryError, MemoryError('sem memória'), None)
        self.assertEqual(len(_CCFalso.recebidos), 1)  # síncrono: já chegou
        p = _CCFalso.recebidos[0]['corpo']['payload']
        self.assertEqual(p['level'], 'critical')
        self.assertEqual(p['title'], 'O servidor WMS Pro caiu (erro não tratado)')
        self.assertIn(('sys', 'MemoryError'), self.repassados)

    def test_ctrl_c_nao_avisa(self):
        cc._instalar_captura_global('WMS Pro')
        sys.excepthook(KeyboardInterrupt, KeyboardInterrupt(), None)
        self.silencio()
        self.assertIn(('sys', 'KeyboardInterrupt'), self.repassados)


if __name__ == '__main__':
    unittest.main(verbosity=2)
