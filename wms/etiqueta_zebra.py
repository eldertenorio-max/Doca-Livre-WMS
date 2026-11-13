"""
Configuração ÚNICA — etiqueta Zebra ZD220 longarina 102×73 mm.

Driver Windows (stock ETIQUETA LONGARINA):
  Largura 102 mm · Altura 73 mm · Rotação 0° (Retrato)
  Chrome: margens Nenhuma · escala 100% · Gráficos de fundo LIGADO
"""

_MM_IN = 25.4
_W_MM = 102
_H_MM = 73
_W_IN = round(_W_MM / _MM_IN, 2)   # 4.02
_H_IN = round(_H_MM / _MM_IN, 2)   # 2.87

ETIQUETA_ZEBRA_ZD220 = {
    'modelo': 'ZD220',
    'dpi': 203,
    'largura_mm': _W_MM,
    'altura_mm': _H_MM,
    'largura_in': _W_IN,
    'altura_in': _H_IN,
    'driver_stock': 'ETIQUETA LONGARINA',
    'driver_largura_mm': _W_MM,
    'driver_altura_mm': _H_MM,
    'driver_rotacao': '0° Retrato',
    'chrome_margens': 'Nenhuma',
    'chrome_escala': '100%',
    'chrome_graficos_fundo': 'Ligado',
    # @page — polegadas primeiro (driver Zebra no Windows)
    'page_css_in': f'{_W_IN}in {_H_IN}in',
    'page_css_mm': f'{_W_MM}mm {_H_MM}mm',
    'page_css': f'{_W_IN}in {_H_IN}in',
    'grid_top_pct': 34,
    'grid_mid_pct': 42,
    'grid_bot_pct': 24,
}


def ctx_etiqueta_zebra():
    """Contexto Jinja para todos os templates de etiqueta WMS."""
    z = ETIQUETA_ZEBRA_ZD220
    w, h = z['largura_mm'], z['altura_mm']
    return {
        'etq_zebra': z,
        'etq_largura_mm': w,
        'etq_altura_mm': h,
        'etq_largura_in': z['largura_in'],
        'etq_altura_in': z['altura_in'],
        'etq_page_size': z['page_css'],
        'etq_page_size_in': z['page_css_in'],
        'etq_page_size_mm': z['page_css_mm'],
        'etq_driver_hint': (
            f"Driver <strong>{z.get('driver_stock', 'ETIQUETA LONGARINA')}</strong> "
            f"<strong>{w}×{h} mm</strong> · margens <strong>{z['chrome_margens']}</strong> · "
            f"escala <strong>{z['chrome_escala']}</strong> · "
            f"<strong>Gráficos de fundo</strong> {z['chrome_graficos_fundo'].lower()}."
        ),
    }


def zpl_dimensoes_mm():
    z = ETIQUETA_ZEBRA_ZD220
    return z['largura_mm'], z['altura_mm']


def zpl_longarina_grid_mm():
    """Linhas horizontais do grid longarina (mm), derivadas dos percentuais."""
    z = ETIQUETA_ZEBRA_ZD220
    h, w = z['altura_mm'], z['largura_mm']
    y2 = round(h * z['grid_top_pct'] / 100, 1)
    y3 = round(h * (z['grid_top_pct'] + z['grid_mid_pct']) / 100, 1)
    return y2, y3, round(w / 4, 1)


def zpl_dimensoes_dots():
    """Dots para APIs ZPL opcionais (download .txt / .bat)."""
    z = ETIQUETA_ZEBRA_ZD220
    dpm = z['dpi'] / _MM_IN
    return int(round(z['largura_mm'] * dpm)), int(round(z['altura_mm'] * dpm))


def zpl_longarina_grid_dots():
    w, h = zpl_dimensoes_dots()
    z = ETIQUETA_ZEBRA_ZD220
    y2 = int(round(h * z['grid_top_pct'] / 100))
    y3 = int(round(h * (z['grid_top_pct'] + z['grid_mid_pct']) / 100))
    return y2, y3, w // 4
