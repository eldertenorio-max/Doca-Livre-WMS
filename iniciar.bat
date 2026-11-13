@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Criando ambiente virtual e instalando dependencias...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo ERRO: Python nao encontrado. Instale o Python 3.
        pause
        exit /b 1
    )
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo.
echo  WMS Doca Livre em http://127.0.0.1:5002
echo  Feche esta janela para parar o sistema.
echo.
start "" http://127.0.0.1:5002
".venv\Scripts\python.exe" app.py
pause
