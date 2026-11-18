"""Testes do retrato de usuários enviado ao Control Center (control_center.py).

Rodam sem servidor externo e sem banco de produção:  python -m unittest test_control_center_retrato -v
Um "Control Center" falso (HTTP local) recebe os eventos e confere a assinatura HMAC. A última classe sobe o
app REAL do WMS com um SQLite descartável para provar que a leitura dos usuários funciona com o modelo de verdade.
"""
import hashlib
import hmac
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import control_center as cc

SEGREDO = 'segredo-de-teste-com-entropia-suficiente'
VARIAVEIS = ('DOCA_CC_URL', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SYSTEM_NAME',
             'DOCA_CC_SNAPSHOT_MIN')
CAMPOS_PERMITIDOS = {'external_id', 'name', 'username', 'email', 'role_code', 'created_at', 'last_login_at',
                     'last_seen_at', 'status'}


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


def usuario(id=1, username='ana', nome='Ana Souza', email='ana@exemplo.com', perfil='operador', ativo=True,
            criado_em=datetime(2026, 11, 18, 10, 0), ultimo_acesso=None, **extra):
    """Parece uma linha do banco; `extra` leva campos que NUNCA podem sair (senha, token...)."""
    return SimpleNamespace(id=id, username=username, nome=nome, email=email, perfil=perfil, ativo=ativo,
                           criado_em=criado_em, ultimo_acesso=ultimo_acesso, **extra)


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
        self._pausa = cc.RETRATO_PAUSA_S
        self._auto = cc.RETRATO_AUTOMATICO
        cc.RETRATO_PAUSA_S = 0
        self._balde = cc._balde_horario
        cc._balde_horario = lambda: '2026111810'  # hora fixa: os testes não podem depender da virada da hora
        os.environ['DOCA_CC_URL'] = 'http://127.0.0.1:%d/api/' % self.porta
        os.environ['DOCA_CC_SYSTEM_SLUG'] = 'wms'
        os.environ['DOCA_CC_WEBHOOK_SECRET'] = SEGREDO
        os.environ.pop('DOCA_CC_SNAPSHOT_MIN', None)

    def tearDown(self):
        cc.RETRATO_PAUSA_S = self._pausa
        cc._balde_horario = self._balde
        cc.RETRATO_AUTOMATICO = self._auto
        for k, v in self._antigas.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class PayloadTests(unittest.TestCase):
    def test_so_os_campos_combinados_e_nada_sensivel(self):
        u = usuario(password_hash='HASH-DE-SENHA-NAO-VAZAR', app_token='TOKEN-NAO-VAZAR', avatar='foto.png',
                    organizacao_id=3, confirmacao_hash='CONFIRMACAO-NAO-VAZAR')
        p = cc.payload_do_usuario(u)
        self.assertTrue(set(p) <= CAMPOS_PERMITIDOS, set(p) - CAMPOS_PERMITIDOS)
        texto = json.dumps(p)
        for proibido in ('NAO-VAZAR', 'foto.png', 'organizacao'):
            self.assertNotIn(proibido, texto)
        self.assertEqual(p['external_id'], '1')
        self.assertEqual(p['name'], 'Ana Souza')
        self.assertEqual(p['email'], 'ana@exemplo.com')
        self.assertEqual(p['username'], 'ana')

    def test_perfis_viram_os_papeis_do_control_center(self):
        casos = {'super': 'super_usuario', 'supervisor': 'gestor', 'gestor': 'gestor', 'operador': 'operador',
                 'cliente': 'operador', 'SUPER ': 'super_usuario', None: 'operador', '': 'operador'}
        for perfil, esperado in casos.items():
            self.assertEqual(cc.papel_do_cc(perfil), esperado, perfil)
            self.assertEqual(cc.payload_do_usuario(usuario(perfil=perfil))['role_code'], esperado)

    def test_situacao_do_usuario(self):
        self.assertEqual(cc.payload_do_usuario(usuario(ativo=True, ultimo_acesso=None))['status'], 'never')
        self.assertEqual(cc.payload_do_usuario(usuario(ativo=True, ultimo_acesso=datetime(2026, 11, 18, 9, 0)))['status'], 'offline')
        self.assertEqual(cc.payload_do_usuario(usuario(ativo=False))['status'], 'blocked')
        # nunca "online": quem decide isso é a sessão ao vivo (e o painel não sobrescreve online)
        for u in (usuario(ativo=True, ultimo_acesso=None), usuario(ativo=True, ultimo_acesso=datetime(2026, 11, 18, 9, 0)), usuario(ativo=False)):
            self.assertNotEqual(cc.payload_do_usuario(u)['status'], 'online')

    def test_desbloqueado_volta_a_nao_ser_bloqueado(self):
        # quem foi desbloqueado precisa mandar um status diferente de blocked, senão o painel mantém o bloqueio antigo
        antes = cc.payload_do_usuario(usuario(ativo=False))
        depois = cc.payload_do_usuario(usuario(ativo=True, ultimo_acesso=datetime(2026, 11, 18, 9, 0)))
        self.assertEqual(antes['status'], 'blocked')
        self.assertNotEqual(depois['status'], 'blocked')
        self.assertNotEqual(cc._hash_do_payload(antes), cc._hash_do_payload(depois))  # e a chave de idempotência muda

    def test_horarios_de_brasilia_viram_utc(self):
        p = cc.payload_do_usuario(usuario(criado_em=datetime(2026, 11, 18, 10, 0),
                                          ultimo_acesso=datetime(2026, 11, 18, 23, 30)))
        self.assertEqual(p['created_at'], '2026-11-18T13:00:00Z')
        self.assertEqual(p['last_login_at'], '2026-11-19T02:30:00Z')
        self.assertEqual(p['last_seen_at'], '2026-11-19T02:30:00Z')

    def test_campos_vazios_sao_omitidos_e_texto_e_normalizado(self):
        p = cc.payload_do_usuario(usuario(email=None, username='  ', nome='  Ana   \n Souza ', ultimo_acesso=None))
        self.assertNotIn('email', p)
        self.assertNotIn('username', p)
        self.assertNotIn('last_login_at', p)
        self.assertEqual(p['name'], 'Ana Souza')

    def test_hash_e_estavel_e_muda_com_o_cadastro(self):
        a = cc.payload_do_usuario(usuario())
        self.assertEqual(cc._hash_do_payload(a), cc._hash_do_payload(dict(a)))
        b = cc.payload_do_usuario(usuario(nome='Ana Souza Lima'))
        self.assertNotEqual(cc._hash_do_payload(a), cc._hash_do_payload(b))


class CicloTests(Base):
    def coletor(self, *usuarios):
        return lambda: [cc.payload_do_usuario(u) for u in usuarios]

    def test_envia_um_user_updated_por_usuario_com_assinatura_valida(self):
        enviados, falhas, interrompido = cc.executar_ciclo_retrato(
            self.coletor(usuario(1), usuario(2, 'bia', 'Bia Lima', 'bia@exemplo.com', 'super')))
        self.assertEqual((enviados, falhas, interrompido), (2, 0, False))
        self.assertEqual(len(_CCFalso.recebidos), 2)
        for r in _CCFalso.recebidos:
            self.assertEqual(r['caminho'], '/api/webhooks/wms')
            esperado = hmac.new(SEGREDO.encode(), r['carimbo'].encode() + b'.' + r['bruto'], hashlib.sha256).hexdigest()
            self.assertTrue(hmac.compare_digest(r['assinatura'], esperado))
            self.assertEqual(r['corpo']['event_type'], 'user.updated')
            self.assertEqual(r['corpo']['system_slug'], 'wms')
            self.assertTrue(r['chave'].startswith('snap:wms:'))
            self.assertEqual(r['chave'], r['corpo']['idempotency_key'])
            self.assertTrue(set(r['corpo']['payload']) <= CAMPOS_PERMITIDOS)
        self.assertEqual({r['corpo']['payload']['external_id'] for r in _CCFalso.recebidos}, {'1', '2'})

    def test_chave_de_idempotencia_so_muda_quando_o_cadastro_muda(self):
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))
        cc.executar_ciclo_retrato(self.coletor(usuario(1, nome='Ana Souza Lima')))
        chaves = [r['chave'] for r in _CCFalso.recebidos]
        self.assertEqual(len(chaves), 3)
        self.assertEqual(chaves[0], chaves[1])
        self.assertNotEqual(chaves[1], chaves[2])

    def test_chave_muda_na_hora_seguinte_e_o_estado_repetido_nao_e_ignorado(self):
        # bloqueado (hora 10) -> ativo (hora 10) -> bloqueado de novo (hora 11): a 3ª mudança NÃO pode reaproveitar a chave da 1ª
        cc.executar_ciclo_retrato(self.coletor(usuario(1, ativo=False)))
        cc.executar_ciclo_retrato(self.coletor(usuario(1, ativo=True)))
        cc._balde_horario = lambda: '2026111811'
        cc.executar_ciclo_retrato(self.coletor(usuario(1, ativo=False)))
        chaves = [r['chave'] for r in _CCFalso.recebidos]
        self.assertEqual(len(chaves), 3)
        self.assertEqual(len(set(chaves)), 3)
        self.assertTrue(chaves[0].endswith(':2026111810') and chaves[2].endswith(':2026111811'))
        self.assertEqual([r['corpo']['payload']['status'] for r in _CCFalso.recebidos][:2], ['blocked', 'never'])

    def test_quem_sumiu_vira_user_deleted_uma_unica_vez(self):
        cc.executar_ciclo_retrato(self.coletor(usuario(1), usuario(2, 'bia', 'Bia')))
        _CCFalso.recebidos.clear()
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))
        tipos = [(r['corpo']['event_type'], r['corpo']['payload']['external_id']) for r in _CCFalso.recebidos]
        self.assertIn(('user.deleted', '2'), tipos)
        self.assertIn(('user.updated', '1'), tipos)
        apagado = [r for r in _CCFalso.recebidos if r['corpo']['event_type'] == 'user.deleted'][0]
        self.assertEqual(apagado['corpo']['payload'], {'external_id': '2'})
        _CCFalso.recebidos.clear()
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))
        self.assertNotIn('user.deleted', [r['corpo']['event_type'] for r in _CCFalso.recebidos])

    def test_falha_do_control_center_nao_levanta_erro_e_interrompe_apos_3(self):
        tentativas = []

        def quebrado(corpo, base, segredo, slug, limite):
            tentativas.append(corpo['payload']['external_id'])
            raise OSError('Control Center fora do ar')

        resultado = cc.executar_ciclo_retrato(self.coletor(*[usuario(i, 'u%d' % i, 'U %d' % i) for i in range(1, 8)]),
                                              enviar=quebrado)
        self.assertEqual(resultado, (0, 3, True))
        self.assertEqual(len(tentativas), 3)  # parou: não insiste nos outros 4

    def test_apagado_que_nao_chegou_e_retentado_no_proximo_ciclo(self):
        cc.executar_ciclo_retrato(self.coletor(usuario(1), usuario(2, 'bia', 'Bia')))
        _CCFalso.recebidos.clear()

        def so_o_apagado_falha(corpo, base, segredo, slug, limite):
            if corpo['event_type'] == 'user.deleted':
                raise OSError('falhou')

        cc.executar_ciclo_retrato(self.coletor(usuario(1)), enviar=so_o_apagado_falha)
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))  # agora o Control Center responde
        self.assertIn(('user.deleted', '2'),
                      [(r['corpo']['event_type'], r['corpo']['payload']['external_id']) for r in _CCFalso.recebidos])

    def test_leitura_do_banco_falhando_nao_derruba_nem_envia(self):
        def banco_fora():
            raise RuntimeError('connection refused')

        self.assertEqual(cc.executar_ciclo_retrato(banco_fora), (0, 0, False))
        self.assertEqual(_CCFalso.recebidos, [])

    def test_banco_falhando_nao_apaga_a_memoria_de_quem_ja_existia(self):
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))

        def banco_fora():
            raise RuntimeError('connection refused')

        cc.executar_ciclo_retrato(banco_fora)
        _CCFalso.recebidos.clear()
        cc.executar_ciclo_retrato(self.coletor(usuario(1)))
        self.assertEqual([r['corpo']['event_type'] for r in _CCFalso.recebidos], ['user.updated'])  # sem user.deleted

    def test_desligado_sem_as_variaveis(self):
        for k in VARIAVEIS:
            os.environ.pop(k, None)
        self.assertEqual(cc.executar_ciclo_retrato(self.coletor(usuario(1))), (0, 0, False))
        self.assertEqual(_CCFalso.recebidos, [])
        cc.RETRATO_AUTOMATICO = True
        self.assertFalse(cc.iniciar_retrato(SimpleNamespace(extensions={})))

    def test_primeira_requisicao_tem_mais_tempo_que_as_demais(self):
        limites = []
        cc.executar_ciclo_retrato(self.coletor(usuario(1), usuario(2, 'b', 'B'), usuario(3, 'c', 'C')),
                                  enviar=lambda corpo, base, segredo, slug, limite: limites.append(limite))
        self.assertEqual(limites, [cc.RETRATO_TEMPO_PRIMEIRO_S, cc.RETRATO_TEMPO_DEMAIS_S, cc.RETRATO_TEMPO_DEMAIS_S])
        self.assertGreaterEqual(cc.RETRATO_TEMPO_PRIMEIRO_S, 60)  # o painel gratuito leva ~50 s para acordar

    def test_nao_sobrepoe_ciclos(self):
        liberar = threading.Event()
        dentro = threading.Event()

        def lento(corpo, base, segredo, slug, limite):
            dentro.set()
            liberar.wait(5)

        t = threading.Thread(target=cc.executar_ciclo_retrato, args=(self.coletor(usuario(1)), lento))
        t.start()
        self.assertTrue(dentro.wait(5))
        self.assertEqual(cc.executar_ciclo_retrato(self.coletor(usuario(1))), (0, 0, False))  # recusado: já há um
        liberar.set()
        t.join(5)
        self.assertEqual(cc.executar_ciclo_retrato(self.coletor(usuario(1)), enviar=lambda *a: None), (1, 0, False))

    def test_intervalo_configuravel(self):
        casos = {None: 600, '': 600, 'abc': 600, '5': 300, '1': 120, '0': 0, '-3': 0, '2.5': 150}
        for valor, esperado in casos.items():
            if valor is None:
                os.environ.pop('DOCA_CC_SNAPSHOT_MIN', None)
            else:
                os.environ['DOCA_CC_SNAPSHOT_MIN'] = valor
            self.assertEqual(cc.intervalo_do_retrato_s(), esperado, repr(valor))

    def test_agenda_uma_vez_e_zero_desliga(self):
        cc.RETRATO_AUTOMATICO = True
        app = SimpleNamespace(extensions={})
        antes = sum(1 for t in threading.enumerate() if t.name == 'control-center-retrato')
        try:
            self.assertTrue(cc.iniciar_retrato(app, coletor=lambda: []))
            self.assertTrue(cc.iniciar_retrato(app, coletor=lambda: []))  # segunda chamada não duplica
            depois = sum(1 for t in threading.enumerate() if t.name == 'control-center-retrato')
            self.assertEqual(depois - antes, 1)
        finally:
            app.extensions['doca_cc_retrato'].set()  # encerra o laço
        os.environ['DOCA_CC_SNAPSHOT_MIN'] = '0'
        self.assertFalse(cc.iniciar_retrato(SimpleNamespace(extensions={})))


class AppRealDoWmsTests(Base):
    """Usa o app REAL do WMS (modelo Usuario de verdade) com um SQLite descartável. Nada de banco de produção."""

    def setUp(self):
        super().setUp()
        try:
            self._tmp = tempfile.TemporaryDirectory()
            self._env = {k: os.environ.get(k) for k in ('DATABASE_URL', 'ADMIN_PASSWORD', 'RENDER', 'REDIRECIONAR_PARA')}
            os.environ.pop('RENDER', None)
            os.environ.pop('REDIRECIONAR_PARA', None)
            os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(self._tmp.name, 'teste.db').replace('\\', '/')
            os.environ['ADMIN_PASSWORD'] = 'senha-descartavel-de-teste'
            from wms import create_app
            from wms.models import Usuario, db
            self.app = create_app()
        except Exception as e:  # dependências do WMS ausentes neste ambiente
            self.skipTest('app real do WMS indisponível: %s' % e)
        with self.app.app_context():
            for dados in (('joao', 'João Pereira', 'joao@exemplo.com', 'supervisor', True),
                          ('maria', 'Maria Lima', 'maria@exemplo.com', 'operador', False)):
                u = Usuario(username=dados[0], nome=dados[1], email=dados[2], perfil=dados[3], ativo=dados[4])
                u.set_password('segredo-que-nao-pode-sair-1')
                u.app_token = 'token-que-nao-pode-sair-' + dados[0]
                db.session.add(u)
            db.session.commit()

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

    def test_le_os_usuarios_reais_sem_nada_sensivel(self):
        usuarios = cc._usuarios_do_banco(self.app)
        por_login = {p.get('username'): p for p in usuarios}
        self.assertIn('joao', por_login)
        self.assertIn('maria', por_login)
        self.assertEqual(por_login['joao']['role_code'], 'gestor')
        self.assertEqual(por_login['maria']['status'], 'blocked')
        self.assertIn(por_login['joao']['status'], ('offline', 'never'))
        texto = json.dumps(usuarios)
        self.assertNotIn('nao-pode-sair', texto)
        self.assertNotIn('pbkdf2', texto)
        self.assertNotIn('scrypt', texto)
        for p in usuarios:
            self.assertTrue(set(p) <= CAMPOS_PERMITIDOS, set(p) - CAMPOS_PERMITIDOS)

    def test_ciclo_completo_com_o_app_real(self):
        enviados, falhas, interrompido = cc.executar_ciclo_retrato(lambda: cc._usuarios_do_banco(self.app))
        self.assertEqual((falhas, interrompido), (0, False))
        self.assertGreaterEqual(enviados, 3)  # admin inicial + joão + maria
        corpos = ' '.join(r['bruto'].decode('utf-8') for r in _CCFalso.recebidos)
        self.assertNotIn('nao-pode-sair', corpos)


if __name__ == '__main__':
    unittest.main()
