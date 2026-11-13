# WMS Doca Livre - imagem de producao (Azure Container Apps)
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# Um processo com varias linhas de execucao: o sistema guarda pequenos estados em memoria (rotina diaria, fila do DANFE).
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT:-8080} --workers 1 --worker-class gthread --threads 8 --timeout 120 --graceful-timeout 30 app:app"]
