"""Tema visual (claro/escuro) aplicado por QSS."""
from __future__ import annotations

DARK = {
    "bg": "#0f1220", "surface": "#171b2e", "surface2": "#1f2440",
    "border": "#2a3052", "text": "#e7e9f5", "muted": "#8b91b5",
    "primary": "#5b7cfa", "primary_hover": "#7491ff", "primary_text": "#ffffff",
    "success": "#37b26c", "danger": "#f0506e", "warning": "#f5a524",
    "info": "#3fb6e8", "purple": "#9b6dff", "input": "#12162a",
    "selection": "#2e3a74", "sidebar": "#12152a", "chart_grid": "#2a3052",
}
LIGHT = {
    "bg": "#f4f6fb", "surface": "#ffffff", "surface2": "#eef1f8",
    "border": "#dfe3ee", "text": "#1d2135", "muted": "#6a7192",
    "primary": "#4263eb", "primary_hover": "#5c7cfa", "primary_text": "#ffffff",
    "success": "#2b9a5a", "danger": "#e03e5c", "warning": "#d98a00",
    "info": "#1c95c9", "purple": "#7c4dff", "input": "#ffffff",
    "selection": "#dbe4ff", "sidebar": "#ffffff", "chart_grid": "#e6e9f2",
}

_current = dict(DARK)
_name = "escuro"


def colors() -> dict:
    return _current


def name() -> str:
    return _name


def qss(c: dict) -> str:
    return f"""
* {{ font-family: "Segoe UI", "Inter", "Roboto", sans-serif; font-size: 10pt; color: {c['text']}; }}
QMainWindow, QDialog, #page {{ background: {c['bg']}; }}
QWidget#page {{ background: {c['bg']}; }}
QToolTip {{ background: {c['surface2']}; color: {c['text']}; border: 1px solid {c['border']}; padding: 6px; border-radius: 6px; }}

#sidebar {{ background: {c['sidebar']}; border-right: 1px solid {c['border']}; }}
#brand {{ font-size: 15pt; font-weight: 700; color: {c['text']}; padding: 4px 6px; }}
#brandSub {{ color: {c['muted']}; font-size: 8.5pt; padding: 0 6px; }}
QPushButton#nav {{
    text-align: left; padding: 10px 14px; border-radius: 10px; border: none;
    color: {c['muted']}; font-size: 10.5pt; background: transparent;
}}
QPushButton#nav:hover {{ background: {c['surface2']}; color: {c['text']}; }}
QPushButton#nav:checked {{ background: {c['primary']}; color: {c['primary_text']}; font-weight: 600; }}

#topbar {{ background: {c['bg']}; border-bottom: 1px solid {c['border']}; }}
#pageTitle {{ font-size: 17pt; font-weight: 700; }}
#pageSubtitle {{ color: {c['muted']}; }}
#muted, QLabel[muted="true"] {{ color: {c['muted']}; }}
#h2 {{ font-size: 12pt; font-weight: 600; }}
#h3 {{ font-size: 10.5pt; font-weight: 600; color: {c['muted']}; }}

#card {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 14px; }}
#kpi {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 14px; }}
#kpiValue {{ font-size: 20pt; font-weight: 700; }}
#kpiLabel {{ color: {c['muted']}; font-size: 9pt; }}
#hint {{ background: {c['surface2']}; border: 1px dashed {c['border']}; border-radius: 10px; color: {c['muted']}; padding: 10px; }}

QPushButton {{
    background: {c['surface2']}; border: 1px solid {c['border']}; border-radius: 9px;
    padding: 7px 14px; font-weight: 500;
}}
QPushButton:hover {{ border-color: {c['primary']}; }}
QPushButton:pressed {{ background: {c['selection']}; }}
QPushButton:disabled {{ color: {c['muted']}; background: {c['surface']}; }}
QPushButton[kind="primary"] {{ background: {c['primary']}; color: {c['primary_text']}; border: none; }}
QPushButton[kind="primary"]:hover {{ background: {c['primary_hover']}; }}
QPushButton[kind="success"] {{ background: {c['success']}; color: white; border: none; }}
QPushButton[kind="danger"] {{ background: {c['danger']}; color: white; border: none; }}
QPushButton[kind="warning"] {{ background: {c['warning']}; color: #1d1d1d; border: none; }}
QPushButton[kind="ghost"] {{ background: transparent; border: 1px solid transparent; color: {c['muted']}; }}
QPushButton[kind="ghost"]:hover {{ color: {c['text']}; border-color: {c['border']}; }}
QPushButton[kind="big"] {{ padding: 12px 20px; font-size: 11pt; font-weight: 600; }}

QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox, QDateEdit {{
    background: {c['input']}; border: 1px solid {c['border']}; border-radius: 8px; padding: 6px 8px;
    selection-background-color: {c['primary']};
}}
QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {{
    border: 1px solid {c['primary']};
}}
QComboBox::drop-down {{ border: none; width: 22px; }}
QComboBox QAbstractItemView {{ background: {c['surface']}; border: 1px solid {c['border']}; selection-background-color: {c['selection']}; outline: none; }}
QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{ width: 18px; height: 18px; border-radius: 5px; border: 1px solid {c['border']}; background: {c['input']}; }}
QCheckBox::indicator:checked {{ background: {c['primary']}; border-color: {c['primary']}; }}

QTableView, QTableWidget, QListWidget, QTreeWidget {{
    background: {c['surface']}; alternate-background-color: {c['surface2']};
    border: 1px solid {c['border']}; border-radius: 10px; gridline-color: {c['border']};
    selection-background-color: {c['selection']}; selection-color: {c['text']}; outline: none;
}}
QListWidget::item {{ padding: 8px; border-radius: 8px; margin: 2px 4px; }}
QListWidget::item:selected {{ background: {c['selection']}; }}
QListWidget::item:hover {{ background: {c['surface2']}; }}
QHeaderView::section {{
    background: {c['surface2']}; color: {c['muted']}; border: none; border-right: 1px solid {c['border']};
    border-bottom: 1px solid {c['border']}; padding: 6px 8px; font-weight: 600;
}}
QHeaderView {{ background: {c['surface2']}; border: none; }}
QTableCornerButton::section {{ background: {c['surface2']}; border: none; }}

QTabWidget::pane {{ border: 1px solid {c['border']}; border-radius: 10px; top: -1px; background: {c['surface']}; }}
QTabBar::tab {{ background: transparent; padding: 8px 16px; color: {c['muted']}; border-bottom: 2px solid transparent; }}
QTabBar::tab:selected {{ color: {c['text']}; border-bottom: 2px solid {c['primary']}; font-weight: 600; }}
QTabBar::tab:hover {{ color: {c['text']}; }}

QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {c['border']}; border-radius: 4px; min-height: 30px; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: {c['border']}; border-radius: 4px; min-width: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}
QScrollArea {{ border: none; background: transparent; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}

QProgressBar {{ background: {c['surface2']}; border: none; border-radius: 6px; height: 12px; text-align: center; color: {c['text']}; font-size: 8pt; }}
QProgressBar::chunk {{ background: {c['primary']}; border-radius: 6px; }}
QSlider::groove:horizontal {{ height: 6px; background: {c['surface2']}; border-radius: 3px; }}
QSlider::handle:horizontal {{ width: 16px; margin: -6px 0; border-radius: 8px; background: {c['primary']}; }}
QSlider::sub-page:horizontal {{ background: {c['primary']}; border-radius: 3px; }}
QSplitter::handle {{ background: transparent; }}
QMenu {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 8px; padding: 4px; }}
QMenu::item {{ padding: 6px 18px; border-radius: 6px; }}
QMenu::item:selected {{ background: {c['selection']}; }}
QGroupBox {{ border: 1px solid {c['border']}; border-radius: 10px; margin-top: 14px; padding-top: 10px; font-weight: 600; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 12px; padding: 0 4px; color: {c['muted']}; }}
#badge {{ border-radius: 9px; padding: 2px 8px; font-size: 8.5pt; font-weight: 600; }}
#toast {{ background: {c['surface2']}; border: 1px solid {c['border']}; border-radius: 12px; }}
#statusDot {{ border-radius: 5px; }}
#hud {{ background: rgba(23,27,46,235); border: 1px solid {c['primary']}; border-radius: 14px; }}
"""


def apply(app, theme: str = "escuro") -> None:
    global _name
    _name = theme
    _current.clear()
    _current.update(LIGHT if theme == "claro" else DARK)
    app.setStyleSheet(qss(_current))


STATUS_COLORS = {
    "Sucesso": "success", "Erro": "danger", "Aviso": "warning",
    "Pulado": "muted", "Executando": "info", "Pendente": "muted",
    "Repetido": "warning", "Desviado": "purple",
}


def status_color(status: str) -> str:
    return _current.get(STATUS_COLORS.get(status, "muted"), _current["muted"])


def rgba(hex_color: str, alpha: float) -> str:
    """Cor com transparência no formato aceito pelo QSS."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{int(alpha * 255)})"
