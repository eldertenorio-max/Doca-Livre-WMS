"""Ponto de entrada do WMS Doca Livre.

Local:    python app.py            (http://127.0.0.1:5002)
Producao: gunicorn app:app
"""
import os

from wms import create_app

app = create_app()

if __name__ == '__main__':
    app.run(host=os.environ.get('HOST', '127.0.0.1'),
            port=int(os.environ.get('PORT', '5002')),
            debug=os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true'))
