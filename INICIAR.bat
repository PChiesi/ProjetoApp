@echo off
REM ==========================================================
REM  AutoMassa Studio - inicia o programa (duplo clique)
REM  Na primeira vez instala tudo automaticamente (alguns minutos).
REM ==========================================================
setlocal
cd /d "%~dp0"
title AutoMassa Studio

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Python nao encontrado.
    echo  Instale o Python 3.10 ou mais novo em https://www.python.org/downloads/
    echo  IMPORTANTE: marque a opcao "Add python.exe to PATH" na instalacao.
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)

if not exist .venv\Scripts\pythonw.exe (
    echo  Primeira execucao: preparando o AutoMassa Studio...
    python -m venv .venv || goto :erro
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip >nul
    pip install -r requirements.txt || goto :erro
    echo  Instalacao concluida.
) else (
    call .venv\Scripts\activate.bat
)

start "" .venv\Scripts\pythonw.exe run.py
exit /b 0

:erro
echo.
echo  Ocorreu um erro na instalacao. Verifique sua conexao com a internet e tente novamente.
pause
exit /b 1
