@echo off
REM ==========================================================
REM  AutoMassa Studio - gera o executavel no Windows
REM  Uso:  build.bat            (pasta dist\AutoMassaStudio\)
REM        build.bat onefile    (um unico dist\AutoMassaStudio.exe)
REM ==========================================================
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo Python 3.10+ nao encontrado. Instale em https://www.python.org/downloads/ & exit /b 1)

if not exist .venv (
    echo [1/3] Criando ambiente virtual...
    python -m venv .venv || exit /b 1
)
call .venv\Scripts\activate.bat

echo [2/3] Instalando dependencias...
python -m pip install --upgrade pip >nul
pip install -r requirements-dev.txt || exit /b 1

echo [3/3] Gerando executavel...
if /i "%1"=="onefile" (set AUTOMASSA_ONEFILE=1) else (set AUTOMASSA_ONEFILE=)
pyinstaller --noconfirm --clean automassa.spec || exit /b 1

echo.
if /i "%1"=="onefile" (
    echo Pronto!  dist\AutoMassaStudio.exe
) else (
    echo Pronto!  dist\AutoMassaStudio\AutoMassaStudio.exe
)
endlocal
