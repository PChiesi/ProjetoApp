# -*- mode: python ; coding: utf-8 -*-
# Gera o executável do AutoMassa Studio:  pyinstaller --noconfirm automassa.spec
# Para gerar um único .exe (inicia um pouco mais devagar):  set AUTOMASSA_ONEFILE=1
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

onefile = os.environ.get("AUTOMASSA_ONEFILE") == "1"

datas = [
    ("automassa/drivers/web_picker.js", "automassa/drivers"),
    ("automassa/assets", "automassa/assets"),
]
datas += collect_data_files("playwright")          # driver Node do Playwright

hidden = []
hidden += collect_submodules("pywinauto")
hidden += collect_submodules("comtypes")
hidden += ["pynput.keyboard._win32", "pynput.mouse._win32", "win32timezone",
           "PySide6.QtCharts", "openpyxl.cell._writer"]

excludes = ["tkinter", "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets",
            "PySide6.Qt3DCore", "PySide6.QtQuick3D", "PySide6.QtMultimedia",
            "PySide6.QtPdf", "PySide6.QtQml", "PySide6.QtQuick", "matplotlib", "numpy"]

a = Analysis(
    ["run.py"],
    pathex=["."],
    datas=datas,
    hiddenimports=hidden,
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

common = dict(
    name="AutoMassaStudio",
    icon="automassa/assets/icon.ico",
    console=False,
    upx=False,
    version=None,
)

if onefile:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], **common)
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, **common)
    coll = COLLECT(exe, a.binaries, a.datas, name="AutoMassaStudio", upx=False)
