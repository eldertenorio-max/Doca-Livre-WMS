import unittest

from wms_endereco import (
    barcode_longarina,
    barcode_longarina_base,
    codigo_endereco,
    digito_verificador,
    parse_bip,
    parse_codigo_wms,
)


class TestMascaraCanon(unittest.TestCase):
    def test_pro_e_light(self):
        self.assertEqual(codigo_endereco(12, 'C', 14, 1), '12-C-14-1')
        self.assertEqual(codigo_endereco(11, 'A', 5, 3), '11-A-05-3')

    def test_plus_numerico(self):
        self.assertEqual(codigo_endereco(6, 1, 2, 3), '06-1-02-3')

    def test_parse_plus_interno(self):
        p = parse_codigo_wms('C6-R1-N3-P2')
        self.assertEqual(p, {'camara': 6, 'rua': '1', 'posicao': 2, 'nivel': 3})
        self.assertEqual(codigo_endereco(**p), '06-1-02-3')

    def test_parse_voz(self):
        p = parse_codigo_wms('C6-R1-C2-N3')
        self.assertEqual(p['posicao'], 2)
        self.assertEqual(p['nivel'], 3)

    def test_parse_exibicao_com_rua(self):
        p = parse_codigo_wms('12.C.14.1')
        self.assertEqual(p, {'camara': 12, 'rua': 'C', 'posicao': 14, 'nivel': 1})
        dv = digito_verificador(12, 'C', 14, 1)
        r = parse_bip(f'12.C.14.1*{dv}')
        self.assertTrue(r['ok'])
        self.assertEqual(r['codigo_wms'], '12-C-14-1')


class TestCheckDigit(unittest.TestCase):
    def test_nao_e_sequencial(self):
        a = digito_verificador(12, 'C', 14, 1)
        b = digito_verificador(12, 'C', 15, 1)
        c = digito_verificador(12, 'D', 14, 1)
        self.assertEqual(len(a), 2)
        self.assertNotEqual(a, b)
        self.assertNotEqual(a, c)

    def test_barcode_com_dv(self):
        bc = barcode_longarina(12, 14, 1, rua='C')
        self.assertTrue(bc.startswith('12.14.1*'))
        self.assertEqual(barcode_longarina_base(bc), '12.14.1')
        self.assertEqual(barcode_longarina_base('12.14.1.1'), '12.14.1')

    def test_bip_legado_sem_dv(self):
        r = parse_bip('12.14.1')
        self.assertTrue(r['ok'])
        self.assertTrue(r['legado'])

    def test_dv_invalido_no_codigo_wms(self):
        r = parse_bip('12-C-14-1*00')
        esperado = digito_verificador(12, 'C', 14, 1)
        if esperado != '00':
            self.assertFalse(r['ok'])
            self.assertIn('verificador', r['erro'].lower())

    def test_dv_valido(self):
        dv = digito_verificador(12, 'C', 14, 1)
        r = parse_bip(f'12-C-14-1*{dv}')
        self.assertTrue(r['ok'])
        self.assertEqual(r['codigo_wms'], '12-C-14-1')

    def test_barcode_identifica_rua_pelo_dv(self):
        bc_c = barcode_longarina(12, 14, 1, rua='C')
        bc_d = barcode_longarina(12, 14, 1, rua='D')
        self.assertNotEqual(bc_c, bc_d)
        self.assertTrue(bc_c.endswith('*' + digito_verificador(12, 'C', 14, 1)))
        self.assertTrue(bc_d.endswith('*' + digito_verificador(12, 'D', 14, 1)))


class TestTravelJson(unittest.TestCase):
    def test_serpentina_no_layout(self):
        import json
        import os

        path = os.path.join(os.path.dirname(__file__), 'data', 'wms_layout_camaras.json')
        with open(path, encoding='utf-8') as f:
            cfg = json.load(f)
        seq = (cfg.get('sequencia_rota') or {}).get('camaras') or {}
        # Renumeração 2026-11: 11→6, 12→7 e nova 16 (ruas I/J).
        self.assertEqual(seq['7']['sentido_posicao']['C'], 'asc')
        self.assertEqual(seq['7']['sentido_posicao']['D'], 'desc')
        self.assertEqual(seq['6']['sentido_posicao']['A'], 'asc')
        self.assertEqual(seq['6']['sentido_posicao']['B'], 'desc')
        self.assertEqual(seq['16']['sentido_posicao']['I'], 'asc')
        self.assertEqual(seq['16']['sentido_posicao']['J'], 'desc')


if __name__ == '__main__':
    unittest.main()
