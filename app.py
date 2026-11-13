"""Ponto de entrada do WMS Doca Livre.

Local:    python app.py            (http://127.0.0.1:5002)
Producao: gunicorn app:app
"""
import os

from wms import create_app

app = create_app()

try:
    # Avisos de falha ao Doca Livre Control Center. So ligam com DOCA_CC_URL, DOCA_CC_SYSTEM_SLUG e
    # DOCA_CC_WEBHOOK_SECRET; sem elas nada muda. Nunca impedem o sistema de subir.
    import control_center

    control_center.instalar(app)
except Exception:
    pass

if __name__ == '__main__':
    app.run(host=os.environ.get('HOST', '127.0.0.1'),
            port=int(os.environ.get('PORT', '5002')),
            debug=os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true'))
